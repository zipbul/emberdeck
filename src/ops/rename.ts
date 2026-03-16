import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sql } from 'drizzle-orm';

import type { EmberdeckContext } from '../config';
import type { CardFile } from '../card/types';
import { parseFullKey, normalizeSlug, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardAlreadyExistsError, CardRenameSamePathError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { withCardLock, withRetry } from './safe';

/**
 * Result returned on successful `renameCard`.
 */
export interface RenameCardResult {
  /** Absolute path of the old card file. */
  oldFilePath: string;
  /** Absolute path of the new card file. */
  newFilePath: string;
  /** New fullKey (= newly normalized newSlug). */
  newFullKey: string;
  /** New card data (with updated frontmatter). */
  card: CardFile;
}

/**
 * Renames a card's slug (name).
 *
 * 1. Moves the source file to the new path (OS rename).
 * 2. Updates the frontmatter key field to the new key.
 * 3. UPDATEs the card row's key in the DB. FK CASCADE UPDATE propagates
 *    to all referencing tables (relations, keywords, tags, codeLinks, changelog).
 * 4. If the DB update fails, restores the file to its original state.
 *
 * Locks both keys in alphabetical order to prevent deadlocks.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - The original fullKey to rename.
 * @param newSlug - The new slug.
 * @returns Rename result.
 * @throws {CardKeyError} When any slug is invalid.
 * @throws {CardRenameSamePathError} When source and destination are the same.
 * @throws {CardNotFoundError} When the source card does not exist.
 * @throws {CardAlreadyExistsError} When a card with the new key already exists.
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

  // Lock both keys (sorted alphabetically to prevent deadlocks)
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
          // UPDATE the key in-place. FK ON UPDATE CASCADE propagates to all
          // referencing tables (relations, keywords, tags, codeLinks, changelog),
          // preserving incoming relations from other cards.
          ctx.db.$client.run(
            `UPDATE card SET key = ?, file_path = ?, updated_at = ? WHERE key = ?`,
            [newFullKey, newFilePath, now, oldKey],
          );
        } catch (dbErr) {
          // DB update failed -> restore file to original state
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
