import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { BriefBody, CardFile, CardType, CardStatus, DomainBody, PrincipleBody, SpecBody } from '../card/types';
import { buildSearchableText } from '../card/searchable-text';
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
import { validateSpecSourceBindings } from './activation-source-binding';
import { readGlossary, GlossaryValidationError } from '../glossary/io';
import { validateCardGlossaryField } from '../glossary/validation';
// Body section validation (legacy markdown 8/3-section path) has been removed —
// canonical structure lives in frontmatter.brief / frontmatter.spec namespaces.
// Body is now free-form prose (examples, narrative context).

import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { txDb } from '../db/connection';
import { safeWriteOperation } from './safe';
import { serializeNamespaces } from './sync';

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
  /** List of tags for classification (optional). */
  tags?: string[];
  /** List of related card keys (optional). */
  relations?: string[];
  /** Glossary words declared by this card (optional). */
  glossary?: string[];
  /** principle namespace (only when type=principle). */
  principle?: PrincipleBody;
  /** domain namespace (only when type=domain). */
  domain?: DomainBody;
  /** brief namespace (only when type=brief). */
  brief?: BriefBody;
  /** spec namespace (only when type=spec). */
  spec?: SpecBody;
}

/**
 * Result returned on successful `createCard`.
 */
export interface CreateCardResult {
  /** Absolute path of the newly created card file. */
  filePath: string;
  /** fullKey of the created card (= normalized key). */
  fullKey: string;
  /** Complete data of the created card. */
  card: CardFile;
  /** Relation targets that failed to persist (FK violation under concurrent contention).
   *  Empty array when every relation row was inserted. */
  failedRelationTargets: string[];
}

/**
 * Creates a new design card.
 *
 * 1. Normalizes the key and computes the file path.
 * 2. Validates inputs, then checks for duplicate keys.
 * 3. Atomically executes a DB transaction (card, relations, classifications, code links) and file write.
 * 4. Rolls back the DB if file write fails (`safeWriteOperation`).
 *


 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param input - Card data to create.
 * @returns Creation result (filePath, fullKey, card).
 * @throws {CardKeyError} When the key is invalid.
 * @throws {CardAlreadyExistsError} When a card with the same key already exists.
 * @throws {ParentValidationError} When parent validation fails.
 * @throws {ActivationGuardError} When activation conditions are not met.
 * @throws {CompensationError} When file write fails after DB success and compensation also fails.
 * @spec card-lifecycle/mutation-workflows/create-card
 */
export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  validateCardInput({
    key: input.key,
    summary: input.summary,
    tags: input.tags,
    relations: input.relations,
    type: input.type,
    status: input.status,
  });
  const slug = normalizeSlug(input.key);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);
  const status = input.status ?? 'draft';

  return (async () => {
      // Reject both file-exists AND DB-row-exists. Checking only file leaves a
      // hole where an externally-deleted card file lets createCard upsert over
      // a live DB row, silently changing card identity.
      const fileExists = await Bun.file(filePath).exists();
      const dbExists = ctx.cardRepo.existsByKey(fullKey);
      if (fileExists || dbExists) {
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
      if (glossaryEntries.length > 0 && (!input.glossary || input.glossary.length === 0)) {
        throw new GlossaryValidationError('glossary field is required when project glossary exists');
      }
      if (input.glossary && input.glossary.length > 0) {
        validateCardGlossaryField(input.glossary, glossaryEntries);
      }

      // Activation guard (namespace-based — body is free-form, no section check)
      if (status === 'active') {
        await validateActivationGuard(ctx, {
          type: input.type,
          parent: input.parent ?? null,
          principle: input.principle,
          domain: input.domain,
          brief: input.brief,
          spec: input.spec,
          key: fullKey,
        }, validateSpecSourceBindings);
      }

      const frontmatter = {
        key: fullKey,
        summary: input.summary,
        status,
        type: input.type,
        ...(input.parent ? { parent: input.parent } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags.map((t) => t.toLowerCase()) } : {}),
        ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
        ...(input.glossary && input.glossary.length > 0 ? { glossary: input.glossary } : {}),
        ...(input.principle ? { principle: input.principle } : {}),
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.brief ? { brief: input.brief } : {}),
        ...(input.spec ? { spec: input.spec } : {}),
      };

      const card: CardFile = { filePath, frontmatter };
      // Searchable namespace text for FTS5 indexing.
      const searchableBody = buildSearchableText(frontmatter);

      const now = new Date().toISOString();
      let failedRelationTargets: string[] = [];

      return safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);

            const row: CardRow = {
              key: fullKey,
              summary: input.summary,
              status,
              type: input.type,
              parent: input.parent ?? null,
              namespacesJson: serializeNamespaces(frontmatter),
              body: searchableBody,
              glossaryJson: input.glossary && input.glossary.length > 0
                ? JSON.stringify(input.glossary)
                : '[]',
              filePath,
              updatedAt: now,
            };

            cardRepo.upsert(row);
            if (input.relations && input.relations.length > 0) {
              failedRelationTargets = relationRepo.replaceForCard(fullKey, input.relations);
            }
            if (input.tags && input.tags.length > 0) {
              classRepo.replaceTags(fullKey, input.tags.map((t) => t.toLowerCase()));
            }
          });
          return { filePath, fullKey, card, failedRelationTargets };
        },
        fileAction: async () => {
          await mkdir(dirname(filePath), { recursive: true });
          await writeCardFile(filePath, card);
        },
        compensate: () => {
          ctx.cardRepo.deleteByKey(fullKey);
        },
      });
    })();}
