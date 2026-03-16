import type { EmberdeckContext } from '../config';
import type {
  CardFile,
  CardFrontmatter,
  CardRelation,
  CardStatus,
  CardType,
  CardPriority,
  AcceptanceCriterion,
  CodeLink,
} from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, RelationTypeError } from '../card/errors';
import { validateCardInput } from '../card/validation';
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

/**
 * Partial update fields passed to `updateCard`.
 * Fields set to `undefined` are left unchanged. `null` deletes the field.
 */
export interface UpdateCardFields {
  /** New summary. If undefined, kept as-is. */
  summary?: string;
  /** Card type. null to remove. */
  type?: CardType | null;
  /** Card priority. null to remove. */
  priority?: CardPriority | null;
  /** Acceptance criteria. null to remove. */
  acceptance?: AcceptanceCriterion[] | null;
  /** New body. If undefined, kept as-is. */
  body?: string;
  /** Keywords. null or empty array deletes the field. */
  keywords?: string[] | null;
  /** Tags. null or empty array deletes the field. */
  tags?: string[] | null;
  /** Constraints. If undefined, kept as-is. */
  constraints?: unknown;
  /** Relations list. null or empty array deletes the field. */
  relations?: CardRelation[] | null;
  /** Code links list. null or empty array deletes the field. */
  codeLinks?: CodeLink[] | null;
}

/**
 * Result returned on successful `updateCard`.
 */
export interface UpdateCardResult {
  /** Absolute path of the updated card file. */
  filePath: string;
  /** Complete updated card data. */
  card: CardFile;
  /** Warnings (e.g. unverified acceptance criteria on status transition). */
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
 * @throws {RelationTypeError} When a disallowed relation type is used.
 */
export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  validateCardInput({
    summary: fields.summary,
    body: fields.body,
    keywords: fields.keywords ?? undefined,
    tags: fields.tags ?? undefined,
    relations: fields.relations ?? undefined,
    codeLinks: fields.codeLinks ?? undefined,
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

      if (fields.relations && fields.relations !== null) {
        for (const rel of fields.relations) {
          if (!ctx.allowedRelationTypes.includes(rel.type)) {
            throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
          }
        }
      }

      const prev = current.frontmatter;
      const next: CardFrontmatter = { ...prev };
      if (fields.summary !== undefined) next.summary = fields.summary;
      if (fields.type !== undefined) {
        if (fields.type === null) delete next.type;
        else next.type = fields.type;
      }
      if (fields.priority !== undefined) {
        if (fields.priority === null) delete next.priority;
        else next.priority = fields.priority;
      }
      if (fields.acceptance !== undefined) {
        if (fields.acceptance === null || fields.acceptance.length === 0) delete next.acceptance;
        else next.acceptance = fields.acceptance;
      }
      if (fields.keywords !== undefined) {
        if (fields.keywords === null || fields.keywords.length === 0) delete next.keywords;
        else next.keywords = fields.keywords;
      }
      if (fields.tags !== undefined) {
        if (fields.tags === null || fields.tags.length === 0) delete next.tags;
        else next.tags = fields.tags;
      }
      if (fields.constraints !== undefined) {
        if (fields.constraints === null) delete next.constraints;
        else next.constraints = fields.constraints;
      }
      if (fields.relations !== undefined) {
        if (fields.relations === null || fields.relations.length === 0) delete next.relations;
        else next.relations = fields.relations;
      }
      if (fields.codeLinks !== undefined) {
        if (fields.codeLinks === null || fields.codeLinks.length === 0) delete next.codeLinks;
        else next.codeLinks = fields.codeLinks;
      }

      const nextBody = fields.body !== undefined ? fields.body : current.body;
      const card: CardFile = { filePath, frontmatter: next, body: nextBody };

      const now = new Date().toISOString();

      return safeWriteOperation({
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
              type: next.type ?? null,
              priority: next.priority ?? null,
              acceptanceJson: next.acceptance ? JSON.stringify(next.acceptance) : null,
              constraintsJson: next.constraints !== undefined ? JSON.stringify(next.constraints) : null,
              body: nextBody,
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
            if (fields.priority !== undefined && fields.priority !== (prev.priority ?? null)) {
              changelogRepo.insert({ cardKey: key, field: 'priority', oldValue: prev.priority ?? null, newValue: fields.priority, changedAt: now, changedBy });
            }
            if (fields.body !== undefined && fields.body !== current.body) {
              changelogRepo.insert({ cardKey: key, field: 'body', oldValue: null, newValue: null, changedAt: now, changedBy });
            }
            if (fields.acceptance !== undefined) {
              changelogRepo.insert({ cardKey: key, field: 'acceptance', oldValue: prev.acceptance ? JSON.stringify(prev.acceptance) : null, newValue: next.acceptance ? JSON.stringify(next.acceptance) : null, changedAt: now, changedBy });
            }

            if (fields.relations !== undefined) {
              relationRepo.replaceForCard(key, next.relations ?? []);
              changelogRepo.insert({ cardKey: key, field: 'relations', oldValue: prev.relations ? JSON.stringify(prev.relations) : null, newValue: next.relations ? JSON.stringify(next.relations) : null, changedAt: now, changedBy });
            }
            if (fields.keywords !== undefined) {
              classRepo.replaceKeywords(key, next.keywords ?? []);
              changelogRepo.insert({ cardKey: key, field: 'keywords', oldValue: prev.keywords ? JSON.stringify(prev.keywords) : null, newValue: next.keywords ? JSON.stringify(next.keywords) : null, changedAt: now, changedBy });
            }
            if (fields.tags !== undefined) {
              classRepo.replaceTags(key, next.tags ?? []);
              changelogRepo.insert({ cardKey: key, field: 'tags', oldValue: prev.tags ? JSON.stringify(prev.tags) : null, newValue: next.tags ? JSON.stringify(next.tags) : null, changedAt: now, changedBy });
            }
            if (fields.codeLinks !== undefined) {
              codeLinkRepo.replaceForCard(key, next.codeLinks ?? []);
              changelogRepo.insert({ cardKey: key, field: 'codeLinks', oldValue: prev.codeLinks ? JSON.stringify(prev.codeLinks) : null, newValue: next.codeLinks ? JSON.stringify(next.codeLinks) : null, changedAt: now, changedBy });
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

/**
 * Changes only the card's status.
 *
 * A status-only shortcut helper for `updateCard`. Other fields are left unchanged.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to update.
 * @param status - New status value.
 * @returns Updated result (filePath, card).
 * @throws {CardNotFoundError} When no card exists for the given key.
 */
export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
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

      const oldStatus = current.frontmatter.status;
      const card: CardFile = {
        filePath,
        frontmatter: { ...current.frontmatter, status },
        body: current.body,
      };

      // Check for unverified acceptance criteria when transitioning to 'implemented'
      const warnings: string[] = [];
      if (status === 'implemented' && current.frontmatter.acceptance) {
        const unverified = current.frontmatter.acceptance.filter((ac) => !ac.verified);
        for (const ac of unverified) {
          warnings.push(`${ac.id}: unverified. Review recommended before marking as implemented.`);
        }
      }

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
                  type: current.frontmatter.type ?? null,
                  priority: current.frontmatter.priority ?? null,
                  acceptanceJson: current.frontmatter.acceptance
                    ? JSON.stringify(current.frontmatter.acceptance)
                    : null,
                  constraintsJson: current.frontmatter.constraints !== undefined
                    ? JSON.stringify(current.frontmatter.constraints)
                    : null,
                  body: current.body,
                  filePath,
                  updatedAt: now,
                };
            cardRepo.upsert(row);

            // Record status change in changelog
            if (oldStatus !== status) {
              changelogRepo.insert({
                cardKey: key,
                field: 'status',
                oldValue: oldStatus,
                newValue: status,
                changedAt: now,
                changedBy: 'agent',
              });
            }
          });

          const result: UpdateCardResult = { filePath, card };
          if (warnings.length > 0) result.warnings = warnings;
          return result;
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
