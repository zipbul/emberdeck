import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardFile } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, normalizeSlug, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardAlreadyExistsError, CardRenameSamePathError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import type { EmberdeckDb } from '../db/connection';
import { withCardLock, withRetry } from './safe';

export interface RenameCardResult {
  oldFilePath: string;
  newFilePath: string;
  newFullKey: string;
  card: CardFile;
}

export async function renameCard(
  ctx: EmberdeckContext,
  fullKey: string,
  newSlug: string,
): Promise<RenameCardResult> {
  const oldKey = parseFullKey(fullKey);
  const normalizedNewSlug = normalizeSlug(newSlug);
  const newFullKey = normalizedNewSlug;

  const oldFilePath = buildCardPath(ctx.cardsDir, oldKey);
  const newFilePath = buildCardPath(ctx.cardsDir, newFullKey);

  if (oldFilePath === newFilePath) throw new CardRenameSamePathError();

  // 양쪽 키 모두 lock (oldKey 먼저, 알파벳 순 정렬로 데드락 방지)
  const [firstKey, secondKey] = [oldKey, newFullKey].sort();
  return withCardLock(ctx, firstKey, () =>
    withCardLock(ctx, secondKey, () =>
      withRetry(async () => {
        if (!(await Bun.file(oldFilePath).exists())) throw new CardNotFoundError(oldKey);
        if (await Bun.file(newFilePath).exists()) throw new CardAlreadyExistsError(newFullKey);

        await mkdir(dirname(newFilePath), { recursive: true });
        await rename(oldFilePath, newFilePath);

        const current = await readCardFile(newFilePath);
        const card: CardFile = {
          filePath: newFilePath,
          frontmatter: { ...current.frontmatter, key: newFullKey },
          body: current.body,
        };
        await writeCardFile(newFilePath, card);

        const now = new Date().toISOString();
        try {
          ctx.db.transaction((tx) => {
            const cardRepo = new DrizzleCardRepository(tx as unknown as EmberdeckDb);
            const relationRepo = new DrizzleRelationRepository(tx as unknown as EmberdeckDb);
            const classRepo = new DrizzleClassificationRepository(tx as unknown as EmberdeckDb);
            const codeLinkRepo = new DrizzleCodeLinkRepository(tx as unknown as EmberdeckDb);

            // 기존 관계/분류/코드링크 백업
            const oldRelations = relationRepo
              .findByCardKey(oldKey)
              .filter((r) => !r.isReverse)
              .map((r) => ({ type: r.type, target: r.dstCardKey }));
            const oldKeywords = classRepo.findKeywordsByCard(oldKey);
            const oldTags = classRepo.findTagsByCard(oldKey);
            const oldCodeLinks = codeLinkRepo.findByCardKey(oldKey);

            cardRepo.deleteByKey(oldKey); // cascade 삭제

            const row: CardRow = {
              key: newFullKey,
              summary: card.frontmatter.summary,
              status: card.frontmatter.status,
              constraintsJson: card.frontmatter.constraints
                ? JSON.stringify(card.frontmatter.constraints)
                : null,
              body: card.body,
              filePath: newFilePath,
              updatedAt: now,
            };
            cardRepo.upsert(row);

            if (oldRelations.length > 0) relationRepo.replaceForCard(newFullKey, oldRelations);
            if (oldKeywords.length > 0) classRepo.replaceKeywords(newFullKey, oldKeywords);
            if (oldTags.length > 0) classRepo.replaceTags(newFullKey, oldTags);
            if (oldCodeLinks.length > 0)
              codeLinkRepo.replaceForCard(
                newFullKey,
                oldCodeLinks.map((l) => ({ kind: l.kind, file: l.file, symbol: l.symbol })),
              );
          });
        } catch (dbErr) {
          // DB tx 실패 → 파일을 원래대로 복원
          await rename(newFilePath, oldFilePath);
          const orig = await readCardFile(oldFilePath);
          const restored: CardFile = {
            filePath: oldFilePath,
            frontmatter: { ...orig.frontmatter, key: oldKey },
            body: orig.body,
          };
          await writeCardFile(oldFilePath, restored);
          throw dbErr;
        }

        return { oldFilePath, newFilePath, newFullKey, card };
      }),
    ),
  );
}
