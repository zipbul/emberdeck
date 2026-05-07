import { parseCrossDomainDependencies } from '../card/json-fields';
import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardFile } from '../card/types';
import { parseFullKey, normalizeSlug, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardAlreadyExistsError, CardRenameSamePathError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { withCardLock, withRetry } from './safe';
import { syncCardFromFile } from './sync';

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
  /** Card keys that contain the old key in their body text. */
  bodyReferencesFound?: string[];
  /** Card keys whose file update failed (DB has new key but file retains old key). */
  failedReferenceUpdates?: string[];
}

/**
 * Renames a card's slug (name).
 *
 * 1. Moves the source file to the new path (OS rename).
 * 2. Updates the frontmatter key field to the new key.
 * 3. UPDATEs the card row's key in the DB. FK CASCADE UPDATE propagates
 *    to all referencing tables (relations, tags, codeLinks, changelog).
 * 4. Updates referencing cards' files (relations, parent fields).
 * 5. Records key change in changelog.
 * 6. If the DB update fails, restores the file to its original state.
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

        // Collect all cards that reference this key (relations or parent)
        const allCards = ctx.cardRepo.list();
        const referencingCards: Array<{ key: string; filePath: string }> = [];
        const bodyReferencesFound: string[] = [];

        // Bulk-resolve cards that have a forward relation pointing to oldKey
        // (one query instead of N findByCardKey calls).
        const forwardRefSrcKeys = new Set<string>();
        for (const rel of ctx.relationRepo.findAll()) {
          if (!rel.isReverse && rel.dstCardKey === oldKey && rel.srcCardKey !== oldKey) {
            forwardRefSrcKeys.add(rel.srcCardKey);
          }
        }

        // Domains whose cross_domain_dependencies reference oldKey — must
        // also be rewritten when renaming a domain card.
        const crossDomainRefSrcKeys = new Set<string>();
        for (const row of allCards) {
          if (row.type !== 'domain' || row.key === oldKey) continue;
          if (parseCrossDomainDependencies(row.namespacesJson).some((d) => d.domain === oldKey)) {
            crossDomainRefSrcKeys.add(row.key);
          }
        }

        for (const row of allCards) {
          if (row.key === oldKey) continue;
          if (
            row.parent === oldKey ||
            forwardRefSrcKeys.has(row.key) ||
            crossDomainRefSrcKeys.has(row.key)
          ) {
            referencingCards.push({ key: row.key, filePath: row.filePath });
          }
          if (row.body?.includes(oldKey)) bodyReferencesFound.push(row.key);
        }

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
        const failedReferenceUpdates: string[] = [];
        try {
          // UPDATE the key in-place + changelog inside a single transaction.
          // FK ON UPDATE CASCADE propagates to all referencing tables
          // (relations, tags, codeLinks, changelog), preserving incoming relations.
          ctx.db.$client.transaction(() => {
            ctx.db.$client.run(
              `UPDATE card SET key = ?, file_path = ?, updated_at = ? WHERE key = ?`,
              [newFullKey, newFilePath, now, oldKey],
            );

            ctx.changelogRepo.insert({
              cardKey: newFullKey,
              field: 'key',
              oldValue: oldKey,
              newValue: newFullKey,
              changedAt: now,
              changedBy: 'agent',
            });
          })();

          // Update referencing cards' files (relations, parent)
          for (const ref of referencingCards) {
            try {
              const refFile = await readCardFile(ref.filePath);
              const updatedFm = { ...refFile.frontmatter };
              let changed = false;

              // Update parent reference
              if (updatedFm.parent === oldKey) {
                updatedFm.parent = newFullKey;
                changed = true;
              }

              // Update relations references
              if (updatedFm.relations) {
                const newRelations = updatedFm.relations.map((r) => r === oldKey ? newFullKey : r);
                if (newRelations.some((r, i) => r !== updatedFm.relations![i])) {
                  updatedFm.relations = newRelations;
                  changed = true;
                }
              }

              // Update domain.cross_domain_dependencies references
              if (updatedFm.domain?.cross_domain_dependencies) {
                const newDeps = updatedFm.domain.cross_domain_dependencies.map(
                  (d) => d.domain === oldKey ? { ...d, domain: newFullKey } : d,
                );
                if (newDeps.some((d, i) => d.domain !== updatedFm.domain!.cross_domain_dependencies![i]!.domain)) {
                  updatedFm.domain = { ...updatedFm.domain, cross_domain_dependencies: newDeps };
                  changed = true;
                }
              }

              if (changed) {
                await writeCardFile(ref.filePath, { ...refFile, frontmatter: updatedFm });
                // Sync the rewritten file back to DB so validateCards / activation
                // see the up-to-date namespacesJson (cross_domain_dependencies etc).
                await syncCardFromFile(ctx, ref.filePath);
              }
            } catch {
              failedReferenceUpdates.push(ref.key);
            }
          }
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

        const result: RenameCardResult = { oldFilePath, newFilePath, newFullKey, card };
        if (bodyReferencesFound.length > 0) {
          result.bodyReferencesFound = bodyReferencesFound;
        }
        if (failedReferenceUpdates.length > 0) {
          result.failedReferenceUpdates = failedReferenceUpdates;
        }
        return result;
      }),
    ),
  );
}
