import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardFile, CodeLink, CardType, CardStatus } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError } from '../card/errors';
import {
  validateCardInput,
  validateParentExists,
  validateParentType,
  validateParentCycle,
  validateRelationTargets,
  validateActivationGuard,
} from '../card/validation';
import { readGlossary, GlossaryValidationError } from '../glossary/io';
import { validateCardGlossaryField } from '../glossary/validation';
import { validateBriefSections, validateSpecSections } from '../brief/validate';

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
  /** Card key used as filename. Only alphanumeric, hyphens, underscores, dots, and slashes are allowed. */
  key: string;
  /** One-line summary of the card (required). */
  summary: string;
  /** Card type (required). */
  type: CardType;
  /** Card status (optional, default: 'draft'). If 'active', activation guard is applied. */
  status?: CardStatus;
  /** Parent card key (optional). */
  parent?: string;
  /** File/directory glob patterns this card is responsible for (optional). */
  boundary?: string[];
  /** Markdown body (optional). */
  body?: string;
  /** List of tags for classification (optional). */
  tags?: string[];
  /** List of related card keys (optional). */
  relations?: string[];
  /** List of source code symbol references (optional). */
  codeLinks?: CodeLink[];
  /** Glossary words declared by this card (optional). */
  glossary?: string[];
}

/**
 * Result returned on successful `createCard`.
 */
export interface CreateCardResult {
  /** Absolute path of the newly created card file. */
  filePath: string;
  /** fullKey of the created card (= normalized key). */
  fullKey: string;
  /** Complete data of the created card (frontmatter + body). */
  card: CardFile;

}

/**
 * Creates a new design card.
 *
 * 1. Normalizes the key and computes the file path.
 * 2. Validates inputs, then checks for duplicate keys.
 * 3. Atomically executes a DB transaction (card, relations, classifications, code links) and file write.
 * 4. Rolls back the DB if file write fails (`safeWriteOperation`).
 *
 * Concurrent calls for the same ctx + key are serialized in FIFO order (`withCardLock`).
 * Retries with exponential backoff on SQLite BUSY errors (`withRetry`).
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param input - Card data to create.
 * @returns Creation result (filePath, fullKey, card).
 * @throws {CardKeyError} When the key is invalid.
 * @throws {CardAlreadyExistsError} When a card with the same key already exists.
 * @throws {ParentValidationError} When parent validation fails.
 * @throws {ActivationGuardError} When activation conditions are not met.
 * @throws {CompensationError} When file write fails after DB success and compensation also fails.
  * @spec spec-create-card
 */
export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  validateCardInput({
    key: input.key,
    summary: input.summary,
    body: input.body,
    tags: input.tags,
    relations: input.relations,
    codeLinks: input.codeLinks,
    boundary: input.boundary,
  });
  const slug = normalizeSlug(input.key);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);
  const status = input.status ?? 'draft';

  return withCardLock(ctx, fullKey, () =>
    withRetry(async () => {
      const exists = await Bun.file(filePath).exists();
      if (exists) {
        throw new CardAlreadyExistsError(fullKey);
      }

      // Parent validation
      if (input.parent) {
        validateParentExists(ctx, input.parent);
        validateParentType(ctx, input.type, input.parent);
        validateParentCycle(ctx, fullKey, input.parent);
      }

      // Relation target validation
      if (input.relations && input.relations.length > 0) {
        validateRelationTargets(ctx, fullKey, input.relations);
      }

      // Glossary validation (M1, M2, M3)
      // Progressive enforcement: required only when glossary.yaml has entries
      const glossaryEntries = readGlossary(ctx);
      if (glossaryEntries.length > 0) {
        if (!input.glossary || input.glossary.length === 0) {
          throw new GlossaryValidationError('glossary field is required when project glossary exists');
        }
        validateCardGlossaryField(input.glossary, glossaryEntries);
      } else if (input.glossary && input.glossary.length > 0) {
        validateCardGlossaryField(input.glossary, glossaryEntries);
      }

      // Activation guard
      if (status === 'active') {
        // Body section validation: active cards must have required sections
        if (input.type === 'brief') {
          validateBriefSections(input.body ?? '');
        } else if (input.type === 'spec') {
          validateSpecSections(input.body ?? '');
        }
        await validateActivationGuard(ctx, {
          type: input.type,
          codeLinks: input.codeLinks,
          boundary: input.boundary,
        });
      }

      const frontmatter = {
        key: fullKey,
        summary: input.summary,
        status,
        type: input.type,
        ...(input.parent ? { parent: input.parent } : {}),
        ...(input.boundary && input.boundary.length > 0 ? { boundary: input.boundary } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags.map((t) => t.toLowerCase()) } : {}),
        ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
        ...(input.codeLinks && input.codeLinks.length > 0 ? { codeLinks: input.codeLinks } : {}),
        ...(input.glossary && input.glossary.length > 0 ? { glossary: input.glossary } : {}),
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
              status,
              type: input.type,
              parent: input.parent ?? null,
              boundaryJson: input.boundary && input.boundary.length > 0
                ? JSON.stringify(input.boundary)
                : null,
              body,
              glossaryJson: input.glossary && input.glossary.length > 0
                ? JSON.stringify(input.glossary)
                : '[]',
              filePath,
              updatedAt: now,
            };

            cardRepo.upsert(row);
            if (input.relations && input.relations.length > 0) {
              relationRepo.replaceForCard(fullKey, input.relations);
            }
            if (input.tags && input.tags.length > 0) {
              classRepo.replaceTags(fullKey, input.tags.map((t) => t.toLowerCase()));
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
