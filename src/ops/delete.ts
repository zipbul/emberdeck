import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

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
