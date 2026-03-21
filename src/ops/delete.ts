import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardValidationError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { deleteCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

export interface DeleteCardOptions {
  /** If true, delete even when children exist (children's parent is set to null). */
  force?: boolean;
}

/**
 * Deletes a card (DB + file).
 *
 * - force=false (default): throws if the card has children.
 * - force=true: deletes the card, removes parent field from children,
 *   and removes this card's key from other cards' relations fields.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to delete.
 * @param options - Optional: force delete even with children.
 * @returns The deleted file path.
 * @throws {CardKeyError} When fullKey is invalid.
 * @throws {CardNotFoundError} When no card exists for the given key.
 * @throws {CardValidationError} When the card has children and force is false.
 * @spec card-crud
 */
export async function deleteCard(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: DeleteCardOptions,
): Promise<{ filePath: string }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  const force = options?.force ?? false;

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      const exists = await Bun.file(filePath).exists();
      if (!exists) {
        throw new CardNotFoundError(key);
      }

      // Check for children
      const children = ctx.cardRepo.findChildren(key);
      if (children.length > 0 && !force) {
        throw new CardValidationError(
          `Cannot delete card "${key}": has ${children.length} child card(s). Use force=true to delete anyway.`,
        );
      }

      // Collect referencing cards (cards that have this key in their relations)
      // We need to update these cards' files before deleting
      const referencingRelations = ctx.relationRepo.findByCardKey(key);
      const referencingCardKeys = new Set<string>();
      for (const rel of referencingRelations) {
        // Reverse relations: other cards that declared a forward relation to this card
        if (rel.isReverse) {
          referencingCardKeys.add(rel.dstCardKey);
        }
      }

      return safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            // Delete from DB (FK cascade auto-deletes relation, tag mappings, code links, changelog)
            cardRepo.deleteByKey(key);
            // After cascade, only mappings are deleted; tags themselves may remain
            classRepo.pruneOrphans();
          });
          return { filePath };
        },
        fileAction: async () => {
          // Update children files: remove parent field
          if (force && children.length > 0) {
            for (const child of children) {
              try {
                const childFile = await readCardFile(child.filePath);
                const updated = { ...childFile.frontmatter };
                delete updated.parent;
                await writeCardFile(child.filePath, { ...childFile, frontmatter: updated });
              } catch {
                // Best effort — child file may not exist
              }
            }
          }

          // Update referencing cards' files: remove this key from relations
          for (const refKey of referencingCardKeys) {
            try {
              const refRow = ctx.cardRepo.findByKey(refKey);
              if (!refRow) continue;
              const refFile = await readCardFile(refRow.filePath);
              if (refFile.frontmatter.relations) {
                const filtered = refFile.frontmatter.relations.filter((r) => r !== key);
                const updated = { ...refFile.frontmatter };
                if (filtered.length > 0) {
                  updated.relations = filtered;
                } else {
                  delete updated.relations;
                }
                await writeCardFile(refRow.filePath, { ...refFile, frontmatter: updated });
              }
            } catch {
              // Best effort — file may not exist
            }
          }

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
