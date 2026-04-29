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
      // Guard on DB existence, not file existence.
      // The file may have been externally deleted; we still need to clean up DB records.
      if (!ctx.cardRepo.existsByKey(key)) {
        throw new CardNotFoundError(key);
      }

      const fileExists = await Bun.file(filePath).exists();

      // Check for children
      const children = ctx.cardRepo.findChildren(key);
      if (children.length > 0 && !force) {
        throw new CardValidationError(
          `Cannot delete card "${key}": has ${children.length} child card(s). Use force=true to delete anyway.`,
        );
      }

      // Collect referencing cards (cards that have this key in their relations)
      // Their files will be updated (best-effort) after the card file is deleted
      const referencingRelations = ctx.relationRepo.findByCardKey(key);
      const referencingCardKeys = new Set<string>();
      for (const rel of referencingRelations) {
        // Reverse relations: other cards that declared a forward relation to this card
        if (rel.isReverse) {
          referencingCardKeys.add(rel.dstCardKey);
        }
      }

      // Cross-domain dependents (other domain cards whose
      // cross_domain_dependencies reference the card we're about to delete).
      const crossDomainDependents: Array<{ key: string; filePath: string }> = [];
      for (const row of ctx.cardRepo.list()) {
        if (row.type !== 'domain' || row.key === key || !row.namespacesJson) continue;
        try {
          const ns = JSON.parse(row.namespacesJson) as { domain?: { cross_domain_dependencies?: Array<{ domain: string }> } };
          const deps = ns.domain?.cross_domain_dependencies ?? [];
          if (deps.some((d) => d.domain === key)) {
            crossDomainDependents.push({ key: row.key, filePath: row.filePath });
          }
        } catch { /* skip malformed */ }
      }
      if (crossDomainDependents.length > 0 && !force) {
        throw new CardValidationError(
          `Cannot delete card "${key}": ${crossDomainDependents.length} domain card(s) reference it via cross_domain_dependencies (${crossDomainDependents.map((c) => c.key).join(', ')}). Use force=true to remove the entries automatically.`,
        );
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
          // Delete the card file first — if this fails, no side-effect files
          // have been modified yet, so compensation restores DB cleanly.
          await deleteCardFile(filePath);

          // Best effort: update children files (remove parent field)
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

          // Best effort: update referencing cards' files (remove from relations)
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

          // Best effort: update cross_domain_dependencies in dependent domain cards
          // (only reachable when force=true — non-force path threw above).
          for (const dep of crossDomainDependents) {
            try {
              const depFile = await readCardFile(dep.filePath);
              if (depFile.frontmatter.domain?.cross_domain_dependencies) {
                const filtered = depFile.frontmatter.domain.cross_domain_dependencies.filter(
                  (d) => d.domain !== key,
                );
                const updatedDomain = { ...depFile.frontmatter.domain };
                if (filtered.length > 0) {
                  updatedDomain.cross_domain_dependencies = filtered;
                } else {
                  delete updatedDomain.cross_domain_dependencies;
                }
                await writeCardFile(dep.filePath, {
                  ...depFile,
                  frontmatter: { ...depFile.frontmatter, domain: updatedDomain },
                });
                // Sync the rewritten file back to DB so namespacesJson refreshes.
                await syncCardFromFile(ctx, dep.filePath);
              }
            } catch {
              // Best effort — dependent file may have been removed concurrently
            }
          }
        },
        compensate: async () => {
          // Can only restore DB from file if the file still exists on disk
          if (fileExists) {
            await syncCardFromFile(ctx, filePath);
          }
          // If file was already gone, DB deletion is the desired outcome — nothing to compensate

          // Restore DB state for related cards affected by FK CASCADE:
          // - children: parent was SET NULL by FK cascade
          // - referencing cards: forward relation rows to this card were CASCADE deleted
          // Their files are unmodified (deleteCardFile runs before best-effort updates),
          // so re-syncing from file restores the correct DB state.
          if (force && children.length > 0) {
            for (const child of children) {
              try { await syncCardFromFile(ctx, child.filePath); } catch { /* best-effort */ }
            }
          }
          for (const refKey of referencingCardKeys) {
            try {
              const refRow = ctx.cardRepo.findByKey(refKey);
              if (refRow) await syncCardFromFile(ctx, refRow.filePath);
            } catch { /* best-effort */ }
          }
        },
      });
    }),
  );
}
