import type { EmberdeckContext } from '../config';
import type { CodeLinkRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { getRelationGraph } from './query';

// ── check_drift ──

export interface StaleCard {
  key: string;
  lastCardUpdate: string;
  codeChangesAfter: number;
  brokenLinks: number;
}

export interface DriftResult {
  driftScore: number;
  staleCards: StaleCard[];
  summary: string;
}

export interface CheckDriftOptions {
  maxDepth?: number;
}

/**
 * Calculate drift score for a card (and its graph) or all cards.
 *
 * Drift score formula (weighted sum, range 0-1):
 *   brokenLinkRatio     * 0.4
 * + staleCardRatio      * 0.4
 * + missingLinkRatio    * 0.2 (0 without @spec auto-detection)
 */
export function checkDrift(
  ctx: EmberdeckContext,
  fullKey?: string,
  options?: CheckDriftOptions,
): DriftResult {
  const maxDepth = options?.maxDepth ?? 3;

  let targetKeys: string[];
  if (fullKey) {
    const rootKey = parseFullKey(fullKey);
    const graphNodes = getRelationGraph(ctx, rootKey, { maxDepth, direction: 'both' });
    targetKeys = [rootKey, ...graphNodes.map((n) => n.key)];
  } else {
    targetKeys = ctx.cardRepo.list().map((r) => r.key);
  }

  if (targetKeys.length === 0) {
    return { driftScore: 0, staleCards: [], summary: 'No cards found.' };
  }

  let totalLinks = 0;
  let brokenLinks = 0;
  let staleCount = 0;
  const staleCards: StaleCard[] = [];

  for (const key of targetKeys) {
    const row = ctx.cardRepo.findByKey(key);
    if (!row) continue;

    const cardUpdatedAt = new Date(row.updatedAt).getTime();

    // Count code link health via gildash symbol validation
    const links = ctx.codeLinkRepo.findByCardKey(key);
    let cardBrokenLinks = 0;
    let cardCodeChangesAfter = 0;
    let cardIsStale = false;
    const isPlanning = row.status === 'draft';

    for (const link of links) {
      totalLinks++;
      if (ctx.gildash) {
        // Validate symbol exists in gildash index
        const results = ctx.gildash.searchSymbols({
          text: link.symbol,
          exact: true,
          filePath: link.file,
        });
        if (!Array.isArray(results)) {
          if (!isPlanning) cardBrokenLinks++;
        } else {
          const found = results.find((s) => s.name === link.symbol && s.filePath === link.file);
          if (!found && !isPlanning) cardBrokenLinks++;
        }

        // Check if linked file was modified after the card was last updated
        const fileInfo = ctx.gildash.getFileInfo(link.file);
        if (fileInfo) {
          const fileMtime = fileInfo.mtimeMs;
          if (fileMtime > cardUpdatedAt) {
            cardCodeChangesAfter++;
            cardIsStale = true;
          }
        }
      }
      // Without gildash, broken link counting is skipped (graceful degradation)
    }

    if (cardIsStale) staleCount++;
    brokenLinks += cardBrokenLinks;

    staleCards.push({
      key,
      lastCardUpdate: row.updatedAt,
      codeChangesAfter: cardCodeChangesAfter,
      brokenLinks: cardBrokenLinks,
    });
  }

  // Calculate ratios
  const brokenLinkRatio = totalLinks > 0 ? brokenLinks / totalLinks : 0;
  const missingLinkRatio = 0; // @spec auto-detection — graceful degradation
  const staleCardRatio = targetKeys.length > 0 ? staleCount / targetKeys.length : 0;

  const driftScore = Math.min(1, Math.max(0,
    brokenLinkRatio * 0.4 +
    staleCardRatio * 0.4 +
    missingLinkRatio * 0.2,
  ));

  // Filter to only report cards with issues
  const problemCards = staleCards.filter(
    (c) => c.brokenLinks > 0 || c.codeChangesAfter > 0,
  );

  const totalCards = targetKeys.length;
  const issueCount = problemCards.length;
  const summary = issueCount > 0
    ? `${issueCount} of ${totalCards} cards have issues (${brokenLinks} broken links, ${staleCount} stale).`
    : `All ${totalCards} cards are in good health.`;

  return {
    driftScore: Math.round(driftScore * 100) / 100,
    staleCards: problemCards,
    summary,
  };
}

// ── check_interactions ──

export interface SharedSymbol {
  file: string;
  symbol: string;
}

export interface CardInteraction {
  pair: [string, string];
  sharedSymbols: SharedSymbol[];
  /** Files that both cards have code links to (different symbols, same file). */
  sharedFiles: string[];
  hasRelation: boolean;
  potentialConflicts: string[];
}

export interface UndefinedRelation {
  pair: [string, string];
  suggestion: string;
}

export interface InteractionResult {
  interactions: CardInteraction[];
  undefinedRelations: UndefinedRelation[];
}

/**
 * Analyze interactions between a set of cards.
 * Detects shared code symbols, existing relations, and potential conflicts.
 */
export function checkInteractions(
  ctx: EmberdeckContext,
  cardKeys: string[],
): InteractionResult {
  const keys = cardKeys.map(parseFullKey);
  const interactions: CardInteraction[] = [];
  const undefinedRelations: UndefinedRelation[] = [];

  // Build code link map: key -> Map<file, CodeLinkRow[]>
  const linkMap = new Map<string, Map<string, CodeLinkRow[]>>();
  for (const key of keys) {
    const links = ctx.codeLinkRepo.findByCardKey(key);
    const fileMap = new Map<string, CodeLinkRow[]>();
    for (const link of links) {
      const existing = fileMap.get(link.file) ?? [];
      existing.push(link);
      fileMap.set(link.file, existing);
    }
    linkMap.set(key, fileMap);
  }

  // Check all pairs
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i]!;
      const keyB = keys[j]!;

      // Find shared symbols
      const sharedSymbols: SharedSymbol[] = [];
      const linksA = linkMap.get(keyA) ?? new Map();
      const linksB = linkMap.get(keyB) ?? new Map();

      for (const [file, aLinks] of linksA) {
        const bLinks = linksB.get(file);
        if (!bLinks) continue;
        for (const aLink of aLinks) {
          for (const bLink of bLinks) {
            if (aLink.symbol === bLink.symbol) {
              sharedSymbols.push({ file, symbol: aLink.symbol });
            }
          }
        }
      }

      // Find existing relation between this pair
      const relationsA = ctx.relationRepo.findByCardKey(keyA);
      const directRelation = relationsA.find(
        (r) => !r.isReverse && r.dstCardKey === keyB,
      );
      const reverseRelation = relationsA.find(
        (r) => r.isReverse && r.dstCardKey === keyB,
      );
      const hasRelation = !!(directRelation || reverseRelation);

      // Detect shared files (both cards link to the same file)
      const sharedFileSet = new Set<string>();
      for (const [file] of linksA) {
        if (linksB.has(file)) sharedFileSet.add(file);
      }
      const sharedFiles = [...sharedFileSet];

      // Detect potential conflicts
      const potentialConflicts: string[] = [];
      if (sharedFiles.length > 0 && !hasRelation) {
        potentialConflicts.push(
          `Cards share ${sharedFiles.length} file(s) but have no defined relation.`,
        );
      }

      // Only include pairs with some interaction
      if (sharedSymbols.length > 0 || sharedFiles.length > 0 || hasRelation || potentialConflicts.length > 0) {
        interactions.push({
          pair: [keyA, keyB],
          sharedSymbols,
          sharedFiles,
          hasRelation,
          potentialConflicts,
        });
      }

      // Track undefined relations (shared code links but no relation)
      if (sharedSymbols.length > 0 && !hasRelation) {
        undefinedRelations.push({
          pair: [keyA, keyB],
          suggestion: 'related',
        });
      }
    }
  }

  return { interactions, undefinedRelations };
}
