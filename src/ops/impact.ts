import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { getRelationGraph } from './query';
import { checkDrift } from './context';

// ── pre_change_check ──

export interface AffectedCard {
  key: string;
  summary: string;
  linkType: 'direct' | 'boundary' | 'transitive';
  affectedLinks: number;
  via?: string;
  linkStatus?: { valid: number; broken: number };
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PreChangeResult {
  affectedCards: AffectedCard[];
  riskLevel: RiskLevel;
  newUncoveredFiles: string[];
  suggestedActions: string[];
}

/**
 * Analyze the impact of changing specific files/symbols before making changes.
 *
 * 1. Find cards with direct code links to the given files/symbols.
 * 2. Find cards whose boundary patterns match the given files.
 * 3. BFS backward to find cards that transitively depend on affected cards.
 * 4. Identify files not covered by any card.
 * 5. Calculate risk level and suggest actions.
 */
export function preChangeCheck(
  ctx: EmberdeckContext,
  files: string[],
  symbols?: string[],
): PreChangeResult {
  const directCards = new Map<string, number>();
  const symbolSet = symbols ? new Set(symbols) : null;

  // Find directly affected cards by codeLinks
  for (const file of files) {
    const links = ctx.codeLinkRepo.findByFile(file);
    for (const link of links) {
      if (symbolSet && !symbolSet.has(link.symbol)) continue;
      const count = directCards.get(link.cardKey) ?? 0;
      directCards.set(link.cardKey, count + 1);
    }
  }

  // Find cards affected by boundary matching
  const boundaryCards = new Map<string, CardRow>();
  const allCards = ctx.cardRepo.list();
  for (const card of allCards) {
    if (directCards.has(card.key)) continue; // Already a direct match
    if (!card.boundaryJson) continue;
    let boundary: string[];
    try {
      boundary = JSON.parse(card.boundaryJson);
    } catch {
      continue;
    }
    if (!Array.isArray(boundary) || boundary.length === 0) continue;

    for (const file of files) {
      let matched = false;
      for (const pattern of boundary) {
        const glob = new Bun.Glob(pattern);
        if (glob.match(file)) {
          matched = true;
          break;
        }
      }
      if (matched) {
        boundaryCards.set(card.key, card);
        break;
      }
    }
  }

  const affectedCards: AffectedCard[] = [];
  const primaryKeys = new Set<string>();

  // Add direct cards
  for (const [key, count] of directCards) {
    primaryKeys.add(key);
    const row = ctx.cardRepo.findByKey(key);
    const linkStatus = computeLinkStatus(ctx, key);
    affectedCards.push({
      key,
      summary: row?.summary ?? '',
      linkType: 'direct',
      affectedLinks: count,
      ...(linkStatus ? { linkStatus } : {}),
    });
  }

  // Add boundary cards
  for (const [key, card] of boundaryCards) {
    primaryKeys.add(key);
    const linkStatus = computeLinkStatus(ctx, key);
    affectedCards.push({
      key,
      summary: card.summary,
      linkType: 'boundary',
      affectedLinks: 0,
      ...(linkStatus ? { linkStatus } : {}),
    });
  }

  // Find transitive dependents (cards that depend-on affected cards)
  const transitiveCards = new Set<string>();
  for (const directKey of primaryKeys) {
    const graph = getRelationGraph(ctx, directKey, { maxDepth: 3, direction: 'backward' });
    for (const node of graph) {
      if (!primaryKeys.has(node.key) && !transitiveCards.has(node.key)) {
        transitiveCards.add(node.key);
        const row = ctx.cardRepo.findByKey(node.key);
        affectedCards.push({
          key: node.key,
          summary: row?.summary ?? '',
          linkType: 'transitive',
          affectedLinks: 0,
          via: directKey,
        });
      }
    }
  }

  // Detect uncovered files
  const coveredFiles = new Set<string>();
  for (const card of allCards) {
    // Files covered by codeLinks
    const links = ctx.codeLinkRepo.findByCardKey(card.key);
    for (const link of links) {
      coveredFiles.add(link.file);
    }
    // Files covered by boundary
    if (card.boundaryJson) {
      try {
        const boundary: string[] = JSON.parse(card.boundaryJson);
        if (Array.isArray(boundary)) {
          for (const file of files) {
            for (const pattern of boundary) {
              const glob = new Bun.Glob(pattern);
              if (glob.match(file)) {
                coveredFiles.add(file);
              }
            }
          }
        }
      } catch {
        // skip
      }
    }
  }

  const newUncoveredFiles: string[] = [];
  for (const file of files) {
    if (coveredFiles.has(file)) continue;
    // Apply coverageIgnore
    let ignored = false;
    for (const pattern of ctx.coverageIgnore) {
      const glob = new Bun.Glob(pattern);
      if (glob.match(file)) {
        ignored = true;
        break;
      }
    }
    if (!ignored) {
      newUncoveredFiles.push(file);
    }
  }

  // Calculate risk level: card count + drifted ratio
  const driftedCount = affectedCards.filter((c) => {
    const row = ctx.cardRepo.findByKey(c.key);
    return row && row.status === 'drifted';
  }).length;
  const totalAffected = affectedCards.length;
  const driftedRatio = totalAffected > 0 ? driftedCount / totalAffected : 0;

  let riskLevel: RiskLevel;
  if (totalAffected >= 5 || driftedRatio > 0.5) {
    riskLevel = 'critical';
  } else if (totalAffected >= 3 || driftedRatio > 0.25) {
    riskLevel = 'high';
  } else if (totalAffected >= 1) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Generate suggested actions
  const suggestedActions: string[] = [];
  for (const card of affectedCards.filter((c) => c.linkType === 'direct')) {
    suggestedActions.push(
      `Review card "${card.key}" — ${card.affectedLinks} code link(s) affected.`,
    );
  }
  for (const card of affectedCards.filter((c) => c.linkType === 'boundary')) {
    suggestedActions.push(
      `Review card "${card.key}" — file is within its boundary scope.`,
    );
  }
  for (const card of affectedCards.filter((c) => c.linkType === 'transitive')) {
    suggestedActions.push(
      `Check transitive dependency: ${card.key} (via ${card.via}).`,
    );
  }
  if (newUncoveredFiles.length > 0) {
    suggestedActions.push(
      `${newUncoveredFiles.length} file(s) not covered by any card — consider creating specs.`,
    );
  }

  return { affectedCards, riskLevel, newUncoveredFiles, suggestedActions };
}

/**
 * Compute link status (valid/broken) for a card using gildash.
 * Returns undefined if gildash is not available.
 */
function computeLinkStatus(
  ctx: EmberdeckContext,
  cardKey: string,
): { valid: number; broken: number } | undefined {
  if (!ctx.gildash) return undefined;

  const links = ctx.codeLinkRepo.findByCardKey(cardKey);
  if (links.length === 0) return { valid: 0, broken: 0 };

  let valid = 0;
  let broken = 0;
  for (const link of links) {
    const results = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });
    if (!Array.isArray(results)) {
      broken++;
    } else {
      const found = results.find((s) => s.name === link.symbol && s.filePath === link.file);
      if (found) valid++;
      else broken++;
    }
  }
  return { valid, broken };
}

// ── regression_guard ──

export interface RegressionResult {
  passOrFail: 'pass' | 'fail';
  driftedRatio: number;
  affectedCards: Array<{ key: string; status: string; driftType?: string }>;
  threshold: number;
}

/**
 * Regression guard based on drifted card ratio among affected cards.
 *
 * Uses preChangeCheck to find affected cards, then runs drift detection
 * to determine how many are drifted. If the drifted ratio exceeds the
 * threshold, the guard fails.
 *
 * - 0 affected cards → pass
 * - driftedRatio <= threshold → pass
 * - driftedRatio > threshold → fail
 */
export async function regressionGuard(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<RegressionResult> {
  const threshold = ctx.regressionThreshold;

  // Find affected cards
  const impact = preChangeCheck(ctx, changedFiles);
  const affected = impact.affectedCards;

  if (affected.length === 0) {
    return { passOrFail: 'pass', driftedRatio: 0, affectedCards: [], threshold };
  }

  // Run fresh drift detection on affected cards (read-only, no auto-transition)
  const affectedKeys = affected.map((c) => c.key);
  const driftMap = new Map<string, { status: string; driftType?: string }>();

  for (const key of affectedKeys) {
    const driftResult = await checkDrift(ctx, key, { maxDepth: 0, autoTransition: false });
    const driftCard = driftResult.cards.find((c) => c.key === key);
    if (driftCard) {
      driftMap.set(key, { status: driftCard.status, driftType: driftCard.driftType });
    } else {
      // Draft or not found in drift analysis
      const row = ctx.cardRepo.findByKey(key);
      driftMap.set(key, { status: row?.status ?? 'draft' });
    }
  }

  const affectedResult: RegressionResult['affectedCards'] = [];
  let driftedCount = 0;

  for (const card of affected) {
    const info = driftMap.get(card.key) ?? { status: 'draft' };
    affectedResult.push({ key: card.key, status: info.status, ...(info.driftType ? { driftType: info.driftType } : {}) });
    if (info.status === 'drifted') driftedCount++;
  }

  const driftedRatio = affectedResult.length > 0
    ? driftedCount / affectedResult.length
    : 0;

  const passOrFail = driftedRatio > threshold ? 'fail' : 'pass';

  return { passOrFail, driftedRatio, affectedCards: affectedResult, threshold };
}
