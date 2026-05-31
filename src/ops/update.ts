import type { EmberdeckContext } from '../config';
import type {
  BriefBody,
  CardFile,
  CardFrontmatter,
  CardStatus,
  CardType,
  DomainBody,
  PrincipleBody,
  SpecBody,
  VisionBody,
} from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardValidationError } from '../card/errors';
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
import { validateSpecSourceBindings } from './activation-source-binding';
import { readGlossary } from '../glossary/io';
import { validateCardGlossaryField } from '../glossary/validation';
// Body section validation removed — namespace is canonical, body is free-form.

import { readCardFileOrThrow } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleChangelogRepository, CHANGED_BY } from '../db/changelog-repo';
import { txDb } from '../db/connection';
import { safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';
import { serializeNamespaces } from '../card/json-fields';
import { buildSearchableText } from '../card/searchable-text';

/**
 * Throw a CardValidationError if `value` is not a fully-formed namespace body.
 * Used so that partial-patch updates fail with a clear error rather than
 * crashing later inside buildSearchableText / FTS indexer.
 *
 * The check is structural (matches the production normalizer's required-field
 * shape via a temporary parse round-trip), not deep — sub-array contents are
 * validated downstream by validateBriefRefs / validateSpecRefs at activation.
 */
function assertCompleteNamespace(field: 'vision' | 'principle' | 'domain' | 'brief' | 'spec', value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CardValidationError(`invalid ${field} namespace: must be an object`);
  }
  // Required top-level fields per card/types.ts namespaces.
  const required: Record<typeof field, string[]> = {
    vision: ['statement', 'rationale', 'success_direction'],
    principle: ['statement', 'rationale', 'applies_to', 'enforcement'],
    domain: ['overview', 'scope'],
    brief: ['context', 'scope', 'flow', 'approach', 'policy', 'external', 'limits', 'criteria', 'rationale'],
    spec: ['preconditions', 'postconditions', 'invariants', 'failures'],
  };
  const obj = value as Record<string, unknown>;
  const missing = required[field].filter((k) => obj[k] === undefined);
  if (missing.length > 0) {
    throw new CardValidationError(
      `${field} namespace is incomplete; --patch replaces the entire namespace and cannot omit required fields. Missing: ${missing.join(', ')}`,
    );
  }
}

/**
 * Partial update fields passed to `updateCard`.
 * Fields set to `undefined` are left unchanged. `null` deletes the field.
 */
export interface UpdateCardFields {
  /** New summary. If undefined, kept as-is. */
  summary?: string;
  /** Card type. */
  type?: CardType;
  /** Card status. */
  status?: CardStatus;
  /** Parent card key. null to remove parent. */
  parent?: string | null;
  /** Tags. null or empty array deletes the field. */
  tags?: string[] | null;
  /** Relations list (string[]). null or empty array deletes the field. */
  relations?: string[] | null;
  /** Glossary words declared by this card. */
  glossary?: string[];
  /** vision namespace (only when type=vision). null deletes. */
  vision?: VisionBody | null;
  /** principle namespace (only when type=principle). null deletes. */
  principle?: PrincipleBody | null;
  /** domain namespace (only when type=domain). null deletes. */
  domain?: DomainBody | null;
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
  /** Relation targets that failed to persist (FK violation under concurrent contention).
   *  Empty array when every relation row was inserted. */
  failedRelationTargets: string[];
}

/**
 * Apply UpdateCardFields to a copy of the prior frontmatter and return the
 * merged result. Validates parent existence/type/cycle, relation targets,
 * namespace shape, and glossary words against the project glossary. Each
 * undefined field leaves the prior value untouched; null or empty array
 * deletes the field.
 *
 * Pure with respect to side effects on the indexed cache (no writes), but
 * may throw CardValidationError / ParentValidationError. Extracted from
 * updateCard to keep the orchestration small (R2 phase4 #2 split).
 */
function mergeUpdateFields(
  ctx: EmberdeckContext,
  key: string,
  prev: CardFrontmatter,
  fields: UpdateCardFields,
): CardFrontmatter {
  const next: CardFrontmatter = { ...prev };

  if (fields.summary !== undefined) next.summary = fields.summary;
  if (fields.type !== undefined) next.type = fields.type;
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
  if (fields.vision !== undefined) {
    if (fields.vision === null) delete next.vision;
    else { assertCompleteNamespace('vision', fields.vision); next.vision = fields.vision; }
  }
  if (fields.principle !== undefined) {
    if (fields.principle === null) delete next.principle;
    else { assertCompleteNamespace('principle', fields.principle); next.principle = fields.principle; }
  }
  if (fields.domain !== undefined) {
    if (fields.domain === null) delete next.domain;
    else { assertCompleteNamespace('domain', fields.domain); next.domain = fields.domain; }
  }
  if (fields.brief !== undefined) {
    if (fields.brief === null) delete next.brief;
    else { assertCompleteNamespace('brief', fields.brief); next.brief = fields.brief; }
  }
  if (fields.spec !== undefined) {
    if (fields.spec === null) delete next.spec;
    else { assertCompleteNamespace('spec', fields.spec); next.spec = fields.spec; }
  }
  if (fields.glossary !== undefined) {
    if (fields.glossary.length === 0) {
      delete next.glossary;
    } else {
      validateCardGlossaryField(fields.glossary, readGlossary(ctx));
      next.glossary = fields.glossary;
    }
  }
  return next;
}

/**
 * Record one changelog row per changed field. Called inside the dbAction
 * transaction so changelog inserts roll back atomically with the card row.
 *
 * Extracted out of updateCard to keep that function focused on the
 * orchestration, not the per-field changelog wiring (R2 phase4 #2 split).
 */
function recordUpdateChangelog(
  changelogRepo: DrizzleChangelogRepository,
  key: string,
  prev: CardFrontmatter,
  fields: UpdateCardFields,
  now: string,
): void {
  const changedBy = CHANGED_BY.AGENT;
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
  if (fields.relations !== undefined) {
    changelogRepo.insert({
      cardKey: key,
      field: 'relations',
      oldValue: prev.relations ? JSON.stringify(prev.relations) : null,
      newValue: fields.relations ? JSON.stringify(fields.relations) : null,
      changedAt: now,
      changedBy,
    });
  }
  if (fields.tags !== undefined) {
    changelogRepo.insert({
      cardKey: key,
      field: 'tags',
      oldValue: prev.tags ? JSON.stringify(prev.tags) : null,
      newValue: fields.tags ? JSON.stringify(fields.tags) : null,
      changedAt: now,
      changedBy,
    });
  }
  if (fields.glossary !== undefined) {
    changelogRepo.insert({
      cardKey: key,
      field: 'glossary',
      oldValue: prev.glossary ? JSON.stringify(prev.glossary) : null,
      newValue: fields.glossary ? JSON.stringify(fields.glossary) : null,
      changedAt: now,
      changedBy,
    });
  }
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
 * @spec card-lifecycle/mutation-workflows/update-card
 */
export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  // Defense in depth: CLI 'card update' already rejects no-field payloads, but
  // direct lib callers (and bulk paths) could still pass {} — refuse explicitly
  // rather than silently doing a wasteful timestamp-only write.
  if (Object.keys(fields).length === 0) {
    throw new CardValidationError('updateCard called with no fields — nothing to update');
  }
  validateCardInput({
    summary: fields.summary,
    tags: fields.tags ?? undefined,
    relations: fields.relations ?? undefined,
    type: fields.type,
    status: fields.status,
  });
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

      const current = await readCardFileOrThrow(filePath, key, { checkKey: true });

      const prev = current.frontmatter;
      const next = mergeUpdateFields(ctx, key, prev, fields);
      const warnings: string[] = [];

      // Type change on active card: re-validate activation, may force to draft
      if (fields.type !== undefined && fields.type !== prev.type) {
        validateChildrenHierarchy(ctx, key, fields.type);
        const newStatus = await validateTypeChangeActivation(
          ctx,
          {
            status: next.status,
            type: fields.type,
            parent: next.parent ?? null,
            vision: next.vision,
            principle: next.principle,
            domain: next.domain,
            brief: next.brief,
            spec: next.spec,
            key,
          },
          fields.type,
          validateSpecSourceBindings,
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

      // Activation guard when status=active.
      // Re-run guard when: (a) becoming active, (b) explicitly set to active,
      // or (c) already active and any activation-critical field changed.
      // Critical fields = anything the guard inspects: type / parent /
      // principle / domain / brief / spec namespaces. Source bindings are
      // refreshed by `ed spec sync`, not by card update.
      const activationFieldsChanged =
        prev.status === 'active' &&
        fields.status === undefined &&
        (
          fields.type !== undefined ||
          fields.parent !== undefined ||
          fields.vision !== undefined ||
          fields.principle !== undefined ||
          fields.domain !== undefined ||
          fields.brief !== undefined ||
          fields.spec !== undefined
        );
      if (next.status === 'active' && (fields.status === 'active' || prev.status !== 'active' || activationFieldsChanged)) {
        await validateActivationGuard(ctx, {
          type: next.type,
          parent: next.parent ?? null,
          vision: next.vision,
          principle: next.principle,
          domain: next.domain,
          brief: next.brief,
          spec: next.spec,
          key,
        }, validateSpecSourceBindings);
      }

      const card: CardFile = { filePath, frontmatter: next };

      const now = new Date().toISOString();
      let failedRelationTargets: string[] = [];

      const result = await safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            const changelogRepo = new DrizzleChangelogRepository(d);

            const row: CardRow = {
              key,
              summary: next.summary,
              status: next.status,
              type: next.type,
              parent: next.parent ?? null,
              namespacesJson: serializeNamespaces(next),
              body: buildSearchableText(next),
              glossaryJson: next.glossary ? JSON.stringify(next.glossary) : '[]',
              filePath,
              updatedAt: now,
            };
            cardRepo.upsert(row);

            if (fields.relations !== undefined) {
              failedRelationTargets = relationRepo.replaceForCard(key, next.relations ?? []);
            }
            if (fields.tags !== undefined) {
              classRepo.replaceTags(key, next.tags ?? []);
            }
            recordUpdateChangelog(changelogRepo, key, prev, fields, now);
          });
          const r: UpdateCardResult = { filePath, card, failedRelationTargets };
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
 * @spec card-lifecycle/status-and-safe-write/update-card-status
 */
export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
  reason?: string,
): Promise<UpdateCardResult & { oldStatus: CardStatus }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

      const current = await readCardFileOrThrow(filePath, key, { checkKey: true });

      // Activation guard for active status
      if (status === 'active') {
        await validateActivationGuard(ctx, {
          type: current.frontmatter.type,
          parent: current.frontmatter.parent ?? null,
          principle: current.frontmatter.principle,
          domain: current.frontmatter.domain,
          brief: current.frontmatter.brief,
          spec: current.frontmatter.spec,
          key,
        }, validateSpecSourceBindings);
      }

      const oldStatus = current.frontmatter.status;
      const card: CardFile = {
        filePath,
        frontmatter: { ...current.frontmatter, status },
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
                  namespacesJson: serializeNamespaces(current.frontmatter),
                  body: buildSearchableText(current.frontmatter),
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
                changedBy: CHANGED_BY.AGENT,
              });
            }
          });

          return { filePath, card, oldStatus } as UpdateCardResult & { oldStatus: CardStatus };
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      }) as Promise<UpdateCardResult & { oldStatus: CardStatus }>;
}
