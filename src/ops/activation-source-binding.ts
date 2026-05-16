import type { EmberdeckContext } from '../config';
import {
  ensureReindexed,
  makeSymbolFileCache,
  listAllIndexedFilesWithProject,
} from './link';

/**
 * Resolve the source-binding part of the spec activation guard.
 *
 * Returns the list of unmet conditions (empty array on success). The card
 * layer's validateActivationGuard composes this result with the pure
 * cross-reference checks; keeping the binding check here preserves the
 * single-direction dependency (ops → card, never card → ops).
 *
 * Semantics:
 *   - Empty code index means "no information" — neither demand annotations
 *     nor try to resolve, matching drift-detection elsewhere.
 *   - A non-empty index requires every cached binding for the card key to
 *     resolve in the index, and at least one binding must exist.
 *  @spec card-lifecycle/status-and-safe-write
 */
export async function validateSpecSourceBindings(
  ctx: EmberdeckContext,
  cardKey: string,
): Promise<string[]> {
  await ensureReindexed(ctx);
  const indexedFiles = listAllIndexedFilesWithProject(ctx);
  if (indexedFiles.length === 0) return [];

  const links = ctx.codeLinkRepo.findByCardKey(cardKey);
  if (links.length === 0) {
    return [
      `spec card has no source bindings — add at least one '@spec ${cardKey}' JSDoc annotation`,
    ];
  }

  const cache = makeSymbolFileCache(ctx);
  const unmet: string[] = [];
  for (const link of links) {
    try {
      if (!cache.find(link.file, link.symbol)) {
        unmet.push(`source binding '${link.file}:${link.symbol}' unresolved`);
      }
    } catch {
      unmet.push(`source binding '${link.file}:${link.symbol}' unresolved`);
    }
  }
  return unmet;
}
