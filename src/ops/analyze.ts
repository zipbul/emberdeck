import type { EmberdeckContext } from '../config';
import { checkDrift, type DriftType } from './context';
import { getUncoveredSymbols } from './spec-sync';

// ── Types ──

export interface AnalyzeHealth {
  total: number;
  active: number;
  drifted: number;
  draft: number;
  brokenLinks: number;
  staleBoundary: number;
}

export interface AnalyzeCoverage {
  totalSymbols: number;
  covered: number;
  ratio: number;
}

export interface UnlinkedSymbol {
  file: string;
  symbol: string;
  kind: string;
}

export interface DriftedCardSummary {
  key: string;
  summary: string;
  driftType: DriftType;
  brokenLinks: number;
  totalLinks: number;
  body?: string | null;
}

export interface AnalyzeResult {
  health: AnalyzeHealth;
  coverage: AnalyzeCoverage;
  unlinkedSymbols: UnlinkedSymbol[];
  driftedCards: DriftedCardSummary[];
}

export interface AnalyzeOptions {
  includeBody?: boolean;
}

// ── Constants ──

const UNLINKED_SYMBOLS_LIMIT = 20;

// ── Operation ──

/**
 * Full project analysis: card health, symbol coverage, drift detection.
 *
 * Combines check_drift and getUncoveredSymbols into a single report.
 * Always operates on the entire project (no file/symbol params).
 */
export async function analyze(
  ctx: EmberdeckContext,
  options?: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const includeBody = options?.includeBody ?? false;

  // 1. Drift detection (autoTransition=false to keep it read-only)
  const driftResult = await checkDrift(ctx, undefined, { autoTransition: false });

  // 2. Health counts — use detected state, not just DB status
  // checkDrift skips draft cards, so count drafts from allCards
  const allCards = ctx.cardRepo.list();
  const draft = allCards.filter((c) => c.status === 'draft').length;

  // For non-draft cards, use checkDrift results to determine actual health
  // A card is "effectively drifted" if checkDrift detects any driftType,
  // regardless of its current DB status
  let active = 0;
  let drifted = 0;
  const driftedCards: DriftedCardSummary[] = [];
  let totalBrokenLinks = 0;

  for (const card of driftResult.cards) {
    totalBrokenLinks += card.brokenLinks;

    if (card.driftType) {
      // Drift detected — always count as drifted
      drifted++;
      const entry: DriftedCardSummary = {
        key: card.key,
        summary: card.summary,
        driftType: card.driftType,
        brokenLinks: card.brokenLinks,
        totalLinks: card.totalLinks,
      };
      if (includeBody) {
        const row = ctx.cardRepo.findByKey(card.key);
        entry.body = row?.body ?? null;
      }
      driftedCards.push(entry);
    } else if (card.status === 'drifted') {
      // No drift detected now, but card was previously marked drifted in DB
      // (e.g., code was fixed but card not re-activated) — still count as drifted
      drifted++;
    } else {
      active++;
    }
  }

  // 3. Stale boundary count: boundary globs that match no files
  let staleBoundary = 0;
  if (ctx.projectRoot) {
    for (const card of allCards) {
      if (!card.boundaryJson) continue;
      try {
        const boundary: string[] = JSON.parse(card.boundaryJson);
        if (!Array.isArray(boundary) || boundary.length === 0) continue;
        let anyMatch = false;
        for (const pattern of boundary) {
          const glob = new Bun.Glob(pattern);
          for (const _ of glob.scanSync({ cwd: ctx.projectRoot })) {
            anyMatch = true;
            break;
          }
          if (anyMatch) break;
        }
        if (!anyMatch) staleBoundary++;
      } catch {
        // skip
      }
    }
  }

  // 4. Symbol coverage (requires gildash)
  let coverage: AnalyzeCoverage = { totalSymbols: 0, covered: 0, ratio: 1 };
  let unlinkedSymbols: UnlinkedSymbol[] = [];

  if (ctx.gildash) {
    const uncoveredResult = await getUncoveredSymbols(ctx);
    coverage = {
      totalSymbols: uncoveredResult.totalSymbols,
      covered: uncoveredResult.coveredSymbols,
      ratio: uncoveredResult.coverageRatio,
    };
    unlinkedSymbols = uncoveredResult.uncovered
      .slice(0, UNLINKED_SYMBOLS_LIMIT)
      .map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind }));
  }

  return {
    health: {
      total: allCards.length,
      active,
      drifted,
      draft,
      brokenLinks: totalBrokenLinks,
      staleBoundary,
    },
    coverage,
    unlinkedSymbols,
    driftedCards,
  };
}
