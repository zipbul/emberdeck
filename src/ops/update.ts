import type { EmberdeckContext } from '../config';
import type {
  BriefBody,
  CardFile,
  CardFrontmatter,
  CardStatus,
  CardType,
  CodeLink,
  PrincipleBody,
  SpecBody,
} from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardValidationError } from '../card/errors';
import {
  validateCardInput,
  validateParentExists,
  validateParentType,
  validateParentCycle,
  validateRelationTargets,
  validateChildrenHierarchy,
  validateActivationGuard,
  validateTypeChangeActivation,
} from '../card/validation';
import { readGlossary } from '../glossary/io';
import { validateCardGlossaryField } from '../glossary/validation';
import { validateBriefSections, validateSpecSections } from '../brief/validate';

import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { DrizzleChangelogRepository } from '../db/changelog-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';
import { buildSearchableText } from '../card/searchable-text';

/**
 * Partial update fields passed to `updateCard`.
 * Fields set to `undefined` are left unchanged. `null` deletes the field.
 */
/**
 * Search-and-replace patch for card body content.
 * Each patch's `old` must appear exactly once in the body at the time it is applied.
 * Patches are applied sequentially in array order.
 */
export interface BodyPatch {
  /** Text to find in the current body. Must appear exactly once at apply time. */
  old: string;
  /** Replacement text. */
  new: string;
}

export interface UpdateCardFields {
  /** New summary. If undefined, kept as-is. */
  summary?: string;
  /** Card type. */
  type?: CardType;
  /** Card status. */
  status?: CardStatus;
  /** Parent card key. null to remove parent. */
  parent?: string | null;
  /** Boundary glob patterns. */
  boundary?: string[];
  /** New body. If undefined, kept as-is. Mutually exclusive with bodyPatches. */
  body?: string;
  /** Partial body edits via search-and-replace. Applied sequentially. Mutually exclusive with body. */
  bodyPatches?: BodyPatch[];
  /** Tags. null or empty array deletes the field. */
  tags?: string[] | null;
  /** Relations list (string[]). null or empty array deletes the field. */
  relations?: string[] | null;
  /** Code links list. null or empty array deletes the field. */
  codeLinks?: CodeLink[] | null;
  /** Glossary words declared by this card. */
  glossary?: string[];
  /** principle namespace (only when type=principle). null deletes. */
  principle?: PrincipleBody | null;
  /** brief namespace (only when type=brief). null deletes. */
  brief?: BriefBody | null;
  /** spec namespace (only when type=spec). null deletes. */
  spec?: SpecBody | null;
}

/**
 * Result returned on successful `updateCard`.
 */
export interface UpdateCardResult {
  /** Absolute path of the updated card file. */
  filePath: string;
  /** Complete updated card data. */
  card: CardFile;
  /** Warnings (e.g. type change forced status to draft). */
  warnings?: string[];
}

/**
 * Partially updates an existing card.
 *
 * - `fields` entries set to `undefined` are left unchanged.
 * - Setting to `null` or an empty array deletes the corresponding frontmatter field.
 * - On file write failure, compensates the DB via `syncCardFromFile`.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to update.
 * @param fields - Fields to change. Unspecified fields are preserved.
 * @returns Updated result (filePath, card).
 * @throws {CardKeyError} When fullKey is invalid.
 * @throws {CardNotFoundError} When no card exists for the given key.
 * @throws {ParentValidationError} When parent validation fails.
 * @throws {ActivationGuardError} When activation conditions are not met.
 */
export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  if (fields.body !== undefined && fields.bodyPatches !== undefined) {
    throw new CardValidationError('body and bodyPatches are mutually exclusive');
  }
  validateCardInput({
    summary: fields.summary,
    body: fields.body,
    tags: fields.tags ?? undefined,
    relations: fields.relations ?? undefined,
    codeLinks: fields.codeLinks ?? undefined,
    boundary: fields.boundary,
    type: fields.type,
    status: fields.status,
  });
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      if (!(await Bun.file(filePath).exists())) {
        throw new CardNotFoundError(key);
      }

      const current = await readCardFile(filePath);
      if (current.frontmatter.key !== key) {
        throw new CardNotFoundError(key);
      }

      const prev = current.frontmatter;
      const next: CardFrontmatter = { ...prev };
      const warnings: string[] = [];

      if (fields.summary !== undefined) next.summary = fields.summary;
      if (fields.type !== undefined) {
        next.type = fields.type;
      }
      if (fields.parent !== undefined) {
        if (fields.parent === null) {
          delete next.parent;
        } else {
          validateParentExists(ctx, fields.parent);
          validateParentType(ctx, next.type, fields.parent);
          validateParentCycle(ctx, key, fields.parent);
          next.parent = fields.parent;
        }
      }
      if (fields.boundary !== undefined) {
        if (fields.boundary.length === 0) {
          delete next.boundary;
        } else {
          next.boundary = fields.boundary;
        }
      }
      if (fields.tags !== undefined) {
        if (fields.tags === null || fields.tags.length === 0) delete next.tags;
        else next.tags = fields.tags.map((t) => t.toLowerCase());
      }
      if (fields.relations !== undefined) {
        if (fields.relations === null || fields.relations.length === 0) delete next.relations;
        else {
          validateRelationTargets(ctx, key, fields.relations);
          next.relations = fields.relations;
        }
      }
      if (fields.codeLinks !== undefined) {
        if (fields.codeLinks === null || fields.codeLinks.length === 0) delete next.codeLinks;
        else next.codeLinks = fields.codeLinks;
      }
      if (fields.principle !== undefined) {
        if (fields.principle === null) delete next.principle;
        else next.principle = fields.principle;
      }
      if (fields.brief !== undefined) {
        if (fields.brief === null) delete next.brief;
        else next.brief = fields.brief;
      }
      if (fields.spec !== undefined) {
        if (fields.spec === null) delete next.spec;
        else next.spec = fields.spec;
      }
      // Glossary validation (M2, M3) — only when explicitly provided
      const glossaryEntries = readGlossary(ctx);
      if (fields.glossary !== undefined) {
        if (fields.glossary.length === 0) delete next.glossary;
        else {
          validateCardGlossaryField(fields.glossary, glossaryEntries);
          next.glossary = fields.glossary;
        }
      }

      // Type change on active card: re-validate activation, may force to draft
      if (fields.type !== undefined && fields.type !== prev.type) {
        validateChildrenHierarchy(ctx, key, fields.type);
        const newStatus = await validateTypeChangeActivation(
          ctx,
          {
            status: next.status,
            type: fields.type,
            codeLinks: next.codeLinks,
            boundary: next.boundary,
            principle: next.principle,
            brief: next.brief,
            spec: next.spec,
          },
          fields.type,
        );
        if (newStatus !== next.status) {
          warnings.push(`Type changed to ${fields.type}: status forced to ${newStatus} (activation conditions unmet)`);
          next.status = newStatus as CardStatus;
        }
      }

      // Status change
      if (fields.status !== undefined) {
        next.status = fields.status;
      }

      // Activation guard when status=active
      // Re-run guard when: (a) becoming active, (b) explicitly set to active,
      // or (c) already active and activation-critical fields changed.
      const activationFieldsChanged =
        prev.status === 'active' &&
        fields.status === undefined &&
        (fields.codeLinks !== undefined || fields.boundary !== undefined || fields.type !== undefined);
      if (next.status === 'active' && (fields.status === 'active' || prev.status !== 'active' || activationFieldsChanged)) {
        await validateActivationGuard(ctx, {
          type: next.type,
          codeLinks: next.codeLinks,
          boundary: next.boundary,
          principle: next.principle,
          brief: next.brief,
          spec: next.spec,
          key,
        });
      }

      let nextBody: string;
      if (fields.bodyPatches !== undefined && fields.bodyPatches.length > 0) {
        nextBody = current.body;
        for (let i = 0; i < fields.bodyPatches.length; i++) {
          const patch = fields.bodyPatches[i]!;
          const occurrences = nextBody.split(patch.old).length - 1;
          if (occurrences === 0) {
            throw new CardValidationError(`bodyPatches[${i}].old not found in card body`);
          }
          if (occurrences > 1) {
            throw new CardValidationError(`bodyPatches[${i}].old appears ${occurrences} times in card body (must be unique)`);
          }
          nextBody = nextBody.replace(patch.old, () => patch.new);
        }
        validateCardInput({ body: nextBody });
      } else if (fields.body !== undefined) {
        nextBody = fields.body;
      } else {
        nextBody = current.body;
      }
      // Body section validation: active cards must have required sections
      if (next.status === 'active') {
        if (next.type === 'brief') validateBriefSections(nextBody);
        else if (next.type === 'spec') validateSpecSections(nextBody);
      }

      const card: CardFile = { filePath, frontmatter: next, body: nextBody };

      const now = new Date().toISOString();

      const result = await safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            const codeLinkRepo = new DrizzleCodeLinkRepository(d);
            const changelogRepo = new DrizzleChangelogRepository(d);

            const row: CardRow = {
              key,
              summary: next.summary,
              status: next.status,
              type: next.type,
              parent: next.parent ?? null,
              boundaryJson: next.boundary ? JSON.stringify(next.boundary) : null,
              body: (() => {
                const ns = buildSearchableText(next);
                return [nextBody, ns].filter((s) => s.trim().length > 0).join('\n\n');
              })(),
              glossaryJson: next.glossary ? JSON.stringify(next.glossary) : '[]',
              filePath,
              updatedAt: now,
            };
            cardRepo.upsert(row);

            // Record changelog for changed fields
            const changedBy = 'agent';
            if (fields.summary !== undefined && fields.summary !== prev.summary) {
              changelogRepo.insert({ cardKey: key, field: 'summary', oldValue: prev.summary, newValue: fields.summary, changedAt: now, changedBy });
            }
            if (fields.type !== undefined && fields.type !== (prev.type ?? null)) {
              changelogRepo.insert({ cardKey: key, field: 'type', oldValue: prev.type ?? null, newValue: fields.type, changedAt: now, changedBy });
            }
            if (fields.status !== undefined && fields.status !== prev.status) {
              changelogRepo.insert({ cardKey: key, field: 'status', oldValue: prev.status, newValue: fields.status, changedAt: now, changedBy });
            }
            if (fields.parent !== undefined && fields.parent !== (prev.parent ?? null)) {
              changelogRepo.insert({ cardKey: key, field: 'parent', oldValue: prev.parent ?? null, newValue: fields.parent, changedAt: now, changedBy });
            }
            if (fields.boundary !== undefined) {
              changelogRepo.insert({ cardKey: key, field: 'boundary', oldValue: prev.boundary ? JSON.stringify(prev.boundary) : null, newValue: next.boundary ? JSON.stringify(next.boundary) : null, changedAt: now, changedBy });
            }
            if ((fields.body !== undefined && fields.body !== current.body) || (fields.bodyPatches !== undefined && fields.bodyPatches.length > 0)) {
              changelogRepo.insert({ cardKey: key, field: 'body', oldValue: null, newValue: null, changedAt: now, changedBy });
            }

            if (fields.relations !== undefined) {
              relationRepo.replaceForCard(key, next.relations ?? []);
              changelogRepo.insert({ cardKey: key, field: 'relations', oldValue: prev.relations ? JSON.stringify(prev.relations) : null, newValue: next.relations ? JSON.stringify(next.relations) : null, changedAt: now, changedBy });
            }
            if (fields.tags !== undefined) {
              classRepo.replaceTags(key, next.tags ?? []);
              changelogRepo.insert({ cardKey: key, field: 'tags', oldValue: prev.tags ? JSON.stringify(prev.tags) : null, newValue: next.tags ? JSON.stringify(next.tags) : null, changedAt: now, changedBy });
            }
            if (fields.codeLinks !== undefined) {
              codeLinkRepo.replaceForCard(key, next.codeLinks ?? []);
              changelogRepo.insert({ cardKey: key, field: 'codeLinks', oldValue: prev.codeLinks ? JSON.stringify(prev.codeLinks) : null, newValue: next.codeLinks ? JSON.stringify(next.codeLinks) : null, changedAt: now, changedBy });
            }
            if (fields.glossary !== undefined) {
              changelogRepo.insert({ cardKey: key, field: 'glossary', oldValue: prev.glossary ? JSON.stringify(prev.glossary) : null, newValue: next.glossary ? JSON.stringify(next.glossary) : null, changedAt: now, changedBy });
            }
          });
          const r: UpdateCardResult = { filePath, card };
          if (warnings.length > 0) r.warnings = warnings;
          return r;
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      });
      return result;
    }),
  );
}

/**
 * Changes only the card's status.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to update.
 * @param status - New status value.
 * @param reason - Optional reason for the status change (recorded in changelog).
 * @returns Updated result (filePath, card).
 * @throws {CardNotFoundError} When no card exists for the given key.
 * @throws {ActivationGuardError} When activation conditions are not met for active status.
 */
export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
  reason?: string,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      if (!(await Bun.file(filePath).exists())) {
        throw new CardNotFoundError(key);
      }

      const current = await readCardFile(filePath);
      if (current.frontmatter.key !== key) {
        throw new CardNotFoundError(key);
      }

      // Activation guard for active status
      if (status === 'active') {
        // Body section validation
        if (current.frontmatter.type === 'brief') {
          validateBriefSections(current.body);
        } else if (current.frontmatter.type === 'spec') {
          validateSpecSections(current.body);
        }
        await validateActivationGuard(ctx, {
          type: current.frontmatter.type,
          codeLinks: current.frontmatter.codeLinks,
          boundary: current.frontmatter.boundary,
          principle: current.frontmatter.principle,
          brief: current.frontmatter.brief,
          spec: current.frontmatter.spec,
          key,
        });
      }

      const oldStatus = current.frontmatter.status;
      const card: CardFile = {
        filePath,
        frontmatter: { ...current.frontmatter, status },
        body: current.body,
      };

      const now = new Date().toISOString();

      return safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const changelogRepo = new DrizzleChangelogRepository(d);

            const existing = cardRepo.findByKey(key);
            const row: CardRow = existing
              ? { ...existing, status, updatedAt: now }
              : {
                  key,
                  summary: current.frontmatter.summary,
                  status,
                  type: current.frontmatter.type,
                  parent: current.frontmatter.parent ?? null,
                  boundaryJson: current.frontmatter.boundary
                    ? JSON.stringify(current.frontmatter.boundary)
                    : null,
                  body: current.body,
                  glossaryJson: current.frontmatter.glossary
                    ? JSON.stringify(current.frontmatter.glossary)
                    : '[]',
                  filePath,
                  updatedAt: now,
                };
            cardRepo.upsert(row);

            // Record status change in changelog
            if (oldStatus !== status) {
              const newValue = reason ? `${status} (${reason})` : status;
              changelogRepo.insert({
                cardKey: key,
                field: 'status',
                oldValue: oldStatus,
                newValue,
                changedAt: now,
                changedBy: 'agent',
              });
            }
          });

          return { filePath, card } as UpdateCardResult;
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}
