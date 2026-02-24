import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

/**
 * 카드를 삭제한다 (DB + 파일).
 *
 * 1. DB를 먼저 삭제한다 (FK CASCADE로 relation/keyword/tag 자동 정리).
 * 2. 파일시스템 삭제 시 실패하면 `syncCardFromFile`로 DB를 복구한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 삭제할 카드의 fullKey.
 * @returns 삭제된 파일 경로.
 * @throws {CardKeyError} fullKey가 유효하지 않을 때.
 * @throws {CardNotFoundError} 해당 key의 카드가 없었을 때.
 */
export async function deleteCard(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      const exists = await Bun.file(filePath).exists();
      if (!exists) {
        throw new CardNotFoundError(key);
      }

      return safeWriteOperation({
        dbAction: () => {
          // DB 먼저 삭제(FK cascade로 relation, keyword, tag 매핑 자동 삭제)
          ctx.cardRepo.deleteByKey(key);
          return { filePath };
        },
        fileAction: async () => {
          await deleteCardFile(filePath);
        },
        compensate: async () => {
          // 파일이 아직 남아있으므로 syncCardFromFile로 DB 복구
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}
