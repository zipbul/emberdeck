import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

/**
 * Deletes a card (DB + file).
 *
 * 1. Deletes from the DB first (FK CASCADE auto-cleans relations/keywords/tags).
 * 2. If filesystem deletion fails, restores the DB via `syncCardFromFile`.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to delete.
 * @returns The deleted file path.
 * @throws {CardKeyError} When fullKey is invalid.
 * @throws {CardNotFoundError} When no card exists for the given key.
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
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            // Delete from DB (FK cascade auto-deletes relation, keyword, tag mappings)
            cardRepo.deleteByKey(key);
            // After cascade, only mappings are deleted; keywords/tags themselves may remain
            classRepo.pruneOrphans();
          });
          return { filePath };
        },
        fileAction: async () => {
          await deleteCardFile(filePath);
        },
        compensate: async () => {
          // File still exists, so restore DB via syncCardFromFile
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}
