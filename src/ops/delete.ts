import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';

export async function deleteCard(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  const exists = await Bun.file(filePath).exists();
  if (!exists) {
    throw new CardNotFoundError(key);
  }

  // DB 먼저 삭제(FK cascade로 relation, keyword, tag 매핑 자동 삭제) 후 파일 삭제
  // 이순서로 DB 실패 시 파일 유지 → syncCardFromFile로 복구 가능
  ctx.cardRepo.deleteByKey(key);
  await deleteCardFile(filePath);

  return { filePath };
}
