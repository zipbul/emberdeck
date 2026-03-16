import type { EmberdeckContext } from '../config';
import type { AcceptanceCriterion } from '../card/types';
import type { CardRow, CodeLinkRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { getRelationGraph, type RelationGraphNode } from './query';

// ── generate_context ──

export interface ContextCardSummary {
  key: string;
  summary: string;
  status: string;
  type: string | null;
  priority: string | null;
  body?: string;
}

export interface ContextRelation {
  from: string;
  to: string;
  type: string;
  direction: 'forward' | 'backward';
}

export interface ContextAcceptance {
  cardKey: string;
  id: string;
  description: string;
  verified: boolean;
}

export interface ContextCodeLink {
  cardKey: string;
  kind: string;
  file: string;
  symbol: string;
}

export interface ContextChange {
  cardKey: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

export interface ContextPack {
  cards: ContextCardSummary[];
  relationGraph: ContextRelation[];
  acceptanceCriteria: ContextAcceptance[];
  codeLinks: ContextCodeLink[];
  recentChanges: ContextChange[];
  constraints: Record<string, unknown>;
}

export interface GenerateContextOptions {
  maxCards?: number;
  maxDepth?: number;
  includeBody?: boolean;
}

/**
 * Generate a multi-card context pack starting from a root card.
 * BFS-traverses the relation graph and collects summaries, acceptance criteria,
 * code links, recent changes, and constraints for all connected cards.
 */
export async function generateContext(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: GenerateContextOptions,
): Promise<ContextPack> {
  const rootKey = parseFullKey(fullKey);
  const maxCards = options?.maxCards ?? 20;
  const maxDepth = options?.maxDepth ?? 3;
  const includeBody = options?.includeBody ?? false;

  // Get root card
  const rootRow = ctx.cardRepo.findByKey(rootKey);
  if (!rootRow) {
    throw new Error(`Card not found: ${rootKey}`);
  }

  // BFS to find connected cards
  const graphNodes = getRelationGraph(ctx, rootKey, { maxDepth, direction: 'both' });
  const connectedKeys = graphNodes.map((n) => n.key).slice(0, maxCards - 1);
  const allKeys = [rootKey, ...connectedKeys];

  // Pre-fetch all card rows into a cache to avoid repeated DB queries
  const rowCache = new Map<string, CardRow>();
  for (const key of allKeys) {
    const row = ctx.cardRepo.findByKey(key);
    if (row) rowCache.set(key, row);
  }

  // Collect card summaries
  const cards: ContextCardSummary[] = [];
  for (const key of allKeys) {
    const row = rowCache.get(key);
    if (!row) continue;
    const card: ContextCardSummary = {
      key: row.key,
      summary: row.summary,
      status: row.status,
      type: row.type,
      priority: row.priority,
    };
    if (includeBody && key === rootKey && row.body) {
      card.body = row.body;
    }
    cards.push(card);
  }

  // Collect relation graph edges
  const relationGraph: ContextRelation[] = [];
  for (const node of graphNodes) {
    if (!allKeys.includes(node.key)) continue;
    // Find the source for this edge by looking at relations
    const relations = ctx.relationRepo.findByCardKey(node.key);
    for (const rel of relations) {
      if (!rel.isReverse && allKeys.includes(rel.dstCardKey)) {
        const edge: ContextRelation = {
          from: rel.srcCardKey,
          to: rel.dstCardKey,
          type: rel.type,
          direction: 'forward',
        };
        // Avoid duplicates
        if (!relationGraph.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
          relationGraph.push(edge);
        }
      }
    }
  }

  // Also get root card's own relations
  const rootRelations = ctx.relationRepo.findByCardKey(rootKey);
  for (const rel of rootRelations) {
    if (!rel.isReverse && allKeys.includes(rel.dstCardKey)) {
      const edge: ContextRelation = {
        from: rel.srcCardKey,
        to: rel.dstCardKey,
        type: rel.type,
        direction: 'forward',
      };
      if (!relationGraph.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
        relationGraph.push(edge);
      }
    }
  }

  // Collect acceptance criteria
  const acceptanceCriteria: ContextAcceptance[] = [];
  for (const key of allKeys) {
    const row = rowCache.get(key);
    if (!row?.acceptanceJson) continue;
    const criteria = JSON.parse(row.acceptanceJson) as AcceptanceCriterion[];
    for (const ac of criteria) {
      acceptanceCriteria.push({
        cardKey: key,
        id: ac.id,
        description: ac.description,
        verified: ac.verified,
      });
    }
  }

  // Collect code links
  const codeLinks: ContextCodeLink[] = [];
  for (const key of allKeys) {
    const links = ctx.codeLinkRepo.findByCardKey(key);
    for (const link of links) {
      codeLinks.push({
        cardKey: key,
        kind: link.kind,
        file: link.file,
        symbol: link.symbol,
      });
    }
  }

  // Collect recent changes (last 10 per card, max 50 total)
  const recentChanges: ContextChange[] = [];
  for (const key of allKeys) {
    const history = ctx.changelogRepo.findByCardKey(key, 10);
    for (const entry of history) {
      recentChanges.push({
        cardKey: key,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        changedAt: entry.changedAt,
      });
    }
    if (recentChanges.length >= 50) break;
  }

  // Collect constraints
  const constraints: Record<string, unknown> = {};
  for (const key of allKeys) {
    const row = rowCache.get(key);
    if (row?.constraintsJson) {
      constraints[key] = JSON.parse(row.constraintsJson);
    }
  }

  return {
    cards,
    relationGraph,
    acceptanceCriteria,
    codeLinks,
    recentChanges,
    constraints,
  };
}

// ── check_drift ──

export interface StaleCard {
  key: string;
  lastCardUpdate: string;
  codeChangesAfter: number;
  brokenLinks: number;
  unverifiedAcceptance: number;
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
 *   brokenLinkRatio     * 0.3
 * + staleCardRatio      * 0.3
 * + unverifiedRatio     * 0.2
 * + missingLinkRatio    * 0.2 (0 without Phase 2)
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
  let totalAcceptance = 0;
  let unverifiedAcceptance = 0;
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
          cardBrokenLinks++;
        } else {
          const found = results.find((s) => s.name === link.symbol && s.filePath === link.file);
          if (!found) cardBrokenLinks++;
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

    // Count acceptance health
    let cardUnverified = 0;
    if (row.acceptanceJson) {
      const criteria = JSON.parse(row.acceptanceJson) as AcceptanceCriterion[];
      totalAcceptance += criteria.length;
      cardUnverified = criteria.filter((ac) => !ac.verified).length;
      unverifiedAcceptance += cardUnverified;
    }

    staleCards.push({
      key,
      lastCardUpdate: row.updatedAt,
      codeChangesAfter: cardCodeChangesAfter,
      brokenLinks: cardBrokenLinks,
      unverifiedAcceptance: cardUnverified,
    });
  }

  // Calculate ratios
  const brokenLinkRatio = totalLinks > 0 ? brokenLinks / totalLinks : 0;
  const unverifiedRatio = totalAcceptance > 0 ? unverifiedAcceptance / totalAcceptance : 0;
  const missingLinkRatio = 0; // Phase 2 @spec auto-detection — graceful degradation
  const staleCardRatio = targetKeys.length > 0 ? staleCount / targetKeys.length : 0;

  const driftScore = Math.min(1, Math.max(0,
    brokenLinkRatio * 0.3 +
    staleCardRatio * 0.3 +
    unverifiedRatio * 0.2 +
    missingLinkRatio * 0.2,
  ));

  // Filter to only report cards with issues
  const problemCards = staleCards.filter(
    (c) => c.brokenLinks > 0 || c.unverifiedAcceptance > 0 || c.codeChangesAfter > 0,
  );

  const totalCards = targetKeys.length;
  const issueCount = problemCards.length;
  const summary = issueCount > 0
    ? `${issueCount} of ${totalCards} cards have issues (${unverifiedAcceptance} unverified acceptance, ${brokenLinks} broken links, ${staleCount} stale).`
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
  relationType: string | null;
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

  // Build code link map: key -> Set of "file:symbol"
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
      const relationType = directRelation?.type ?? reverseRelation?.type ?? null;

      // Detect potential conflicts
      const potentialConflicts: string[] = [];

      // Shared files without defined relation
      const sharedFiles = new Set<string>();
      for (const [file] of linksA) {
        if (linksB.has(file)) sharedFiles.add(file);
      }
      if (sharedFiles.size > 0 && !relationType) {
        potentialConflicts.push(
          `Cards share ${sharedFiles.size} file(s) but have no defined relation.`,
        );
      }

      // Only include pairs with some interaction
      if (sharedSymbols.length > 0 || relationType || potentialConflicts.length > 0) {
        interactions.push({
          pair: [keyA, keyB],
          sharedSymbols,
          relationType,
          potentialConflicts,
        });
      }

      // Track undefined relations (shared code links but no relation)
      if (sharedSymbols.length > 0 && !relationType) {
        undefinedRelations.push({
          pair: [keyA, keyB],
          suggestion: 'related',
        });
      }
    }
  }

  return { interactions, undefinedRelations };
}
