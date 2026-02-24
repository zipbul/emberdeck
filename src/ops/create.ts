import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRelation, CardFile, CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError, RelationTypeError } from '../card/errors';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import type { EmberdeckDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';

export interface CreateCardInput {
  slug: string;
  summary: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
  relations?: CardRelation[];
  codeLinks?: CodeLink[];
  constraints?: unknown;
}

export interface CreateCardResult {
  filePath: string;
  fullKey: string;
  card: CardFile;
}

export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
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
            const cardRepo = new DrizzleCardRepository(tx as unknown as EmberdeckDb);
            const relationRepo = new DrizzleRelationRepository(tx as unknown as EmberdeckDb);
            const classRepo = new DrizzleClassificationRepository(tx as unknown as EmberdeckDb);
            const codeLinkRepo = new DrizzleCodeLinkRepository(tx as unknown as EmberdeckDb);

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
