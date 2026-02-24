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
import { txDb } from '../db/connection';
import { withCardLock, withRetry } from './safe';

/**
 * `renameCard` 성공 시 반환되는 결과.
 */
export interface RenameCardResult {
  /** 이전 카드 파일의 절대 경로. */
  oldFilePath: string;
  /** 새 카드 파일의 절대 경로. */
  newFilePath: string;
  /** 새 fullKey (= 새 정규화된 newSlug). */
  newFullKey: string;
  /** 새 카드 데이터 (frontmatter 업데이트된 상태). */
  card: CardFile;
}

/**
 * 카드의 slug(이름)을 변경한다.
 *
 * 1. 소스 파일을 새 경로로 이동한다 (OS rename).
 * 2. frontmatter의 key 필드를 새 key로 갱신한다.
 * 3. DB 트랜잭션에서 이전 row를 삭제하고 새 key로 재삽입한다.
 *    (relations, keywords, tags, codeLinks 모두 보존)
 * 4. DB TX 실패 시 파일을 원래대로 복원한다.
 *
 * 데드락 방지를 위해 두 키를 알파벳 순 직렬화한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 이름을 바꿀 원본 fullKey.
 * @param newSlug - 새 slug.
 * @returns rename 결과.
 * @throws {CardKeyError} 어느 slug이라도 유효하지 않을 때.
 * @throws {CardRenameSamePathError} 원본과 대상이 같을 때.
 * @throws {CardNotFoundError} 원본 카드가 없었을 때.
 * @throws {CardAlreadyExistsError} 새 key의 카드가 이미 존재할 때.
 */
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
  const [firstKey, secondKey] = [oldKey, newFullKey].sort() as [string, string];
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
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            const codeLinkRepo = new DrizzleCodeLinkRepository(d);

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
