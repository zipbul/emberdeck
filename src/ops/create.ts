import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRelation, CardFile, CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError, RelationTypeError } from '../card/errors';
import { validateCardInput } from '../card/validation';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';

/**
 * Input parameters passed to `createCard`.
 */
export interface CreateCardInput {
  /** Slug that becomes the card filename. Only alphanumeric, hyphens, underscores, dots, and slashes are allowed. */
  slug: string;
  /** One-line summary of the card (required). */
  summary: string;
  /** Markdown body (optional). */
  body?: string;
  /** List of keywords for search (optional). */
  keywords?: string[];
  /** List of tags for classification (optional). */
  tags?: string[];
  /** List of relations to other cards (optional). Each type must be in allowedRelationTypes. */
  relations?: CardRelation[];
  /** List of source code symbol references (optional). Can be validated via gildash when projectRoot is configured. */
  codeLinks?: CodeLink[];
  /** Free-form constraints (optional). Must be JSON-serializable. */
  constraints?: unknown;
}

/**
 * Result returned on successful `createCard`.
 */
export interface CreateCardResult {
  /** Absolute path of the newly created card file. */
  filePath: string;
  /** fullKey of the created card (= normalized slug). */
  fullKey: string;
  /** Complete data of the created card (frontmatter + body). */
  card: CardFile;
}

/**
 * Creates a new design card.
 *
 * 1. Normalizes the slug and computes the file path.
 * 2. Validates relation types, then checks for duplicate keys.
 * 3. Atomically executes a DB transaction (card, relations, classifications, code links) and file write.
 * 4. Rolls back the DB if file write fails (`safeWriteOperation`).
 *
 * Concurrent calls for the same ctx + key are serialized in FIFO order (`withCardLock`).
 * Retries with exponential backoff on SQLite BUSY errors (`withRetry`).
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param input - Card data to create.
 * @returns Creation result (filePath, fullKey, card).
 * @throws {CardKeyError} When the slug is invalid.
 * @throws {RelationTypeError} When a disallowed relation type is used.
 * @throws {CardAlreadyExistsError} When a card with the same key already exists.
 * @throws {CompensationError} When file write fails after DB success and compensation also fails.
 */
export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  validateCardInput({
    summary: input.summary,
    body: input.body,
    keywords: input.keywords,
    tags: input.tags,
    relations: input.relations,
    codeLinks: input.codeLinks,
  });
  const slug = normalizeSlug(input.slug);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);

  return withCardLock(ctx, fullKey, () =>
    withRetry(async () => {
      if (input.relations) {
        for (const rel of input.relations) {
          if (!ctx.allowedRelationTypes.includes(rel.type)) {
            throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
          }
        }
      }

      const exists = await Bun.file(filePath).exists();
      if (exists) {
        throw new CardAlreadyExistsError(fullKey);
      }

      const frontmatter = {
        key: fullKey,
        summary: input.summary,
        status: 'draft' as const,
        ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
        ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
        ...(input.codeLinks && input.codeLinks.length > 0 ? { codeLinks: input.codeLinks } : {}),
      };

      const body = input.body ?? '';
      const card: CardFile = { filePath, frontmatter, body };

      const now = new Date().toISOString();

      return safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            const codeLinkRepo = new DrizzleCodeLinkRepository(d);

            const row: CardRow = {
              key: fullKey,
              summary: input.summary,
              status: 'draft',
              constraintsJson: input.constraints !== undefined ? JSON.stringify(input.constraints) : null,
              body,
              filePath,
              updatedAt: now,
            };

            cardRepo.upsert(row);
            if (input.relations && input.relations.length > 0) {
              relationRepo.replaceForCard(fullKey, input.relations);
            }
            if (input.keywords && input.keywords.length > 0) {
              classRepo.replaceKeywords(fullKey, input.keywords);
            }
            if (input.tags && input.tags.length > 0) {
              classRepo.replaceTags(fullKey, input.tags);
            }
            if (input.codeLinks && input.codeLinks.length > 0) {
              codeLinkRepo.replaceForCard(fullKey, input.codeLinks);
            }
          });
          return { filePath, fullKey, card } as CreateCardResult;
        },
        fileAction: async () => {
          await mkdir(dirname(filePath), { recursive: true });
          await writeCardFile(filePath, card);
        },
        compensate: () => {
          ctx.cardRepo.deleteByKey(fullKey);
        },
      });
    }),
  );
}
