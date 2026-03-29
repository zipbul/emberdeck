import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { checkDrift, type DriftType } from './context';
import { getUncoveredSymbols } from './spec-sync';
import { readGlossary, type GlossaryEntry } from '../glossary/io';

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
  /** Drift type detected by checkDrift. Undefined when card is DB-drifted but no active drift detected. */
  driftType?: DriftType;
  brokenLinks: number;
  totalLinks: number;
  body?: string | null;
}

export interface AnalyzeGlossary {
  totalWords: number;
  unusedWords: string[];
  entries: GlossaryEntry[];
}

export interface AnalyzeResult {
  health: AnalyzeHealth;
  coverage: AnalyzeCoverage;
  unlinkedSymbols: UnlinkedSymbol[];
  driftedCards: DriftedCardSummary[];
  /** Total number of drifted cards before offset/limit slicing. */
  driftedCardsTotal: number;
  glossary: AnalyzeGlossary;
}

export interface AnalyzeOptions {
  includeBody?: boolean;
  /** Number of drifted cards to skip (default: 0). */
  offset?: number;
  /** Maximum number of drifted cards to return. Omit for all. */
  limit?: number;
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
  const offset = options?.offset ?? 0;
  const limit = options?.limit;

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
      const entry: DriftedCardSummary = {
        key: card.key,
        summary: card.summary,
        brokenLinks: card.brokenLinks,
        totalLinks: card.totalLinks,
      };
      if (includeBody) {
        const row = ctx.cardRepo.findByKey(card.key);
        entry.body = row?.body ?? null;
      }
      driftedCards.push(entry);
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

  // Apply offset/limit to driftedCards
  const driftedCardsTotal = driftedCards.length;
  const slicedDriftedCards = limit !== undefined
    ? driftedCards.slice(offset, offset + limit)
    : driftedCards.slice(offset);

  // 5. Glossary stats
  const glossaryEntries = readGlossary(ctx);
  const usedGlossaryWords = new Set<string>();
  for (const card of allCards) {
    const gj = (card as any).glossaryJson;
    if (gj && gj !== '[]') {
      try {
        const parsed = JSON.parse(gj);
        if (Array.isArray(parsed)) {
          for (const w of parsed) usedGlossaryWords.add(w);
        }
      } catch { /* skip */ }
    }
  }
  const unusedWords = glossaryEntries
    .filter((e) => !usedGlossaryWords.has(e.word))
    .map((e) => e.word);

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
    driftedCards: slicedDriftedCards,
    driftedCardsTotal,
    glossary: {
      totalWords: glossaryEntries.length,
      unusedWords,
      entries: glossaryEntries,
    },
  };
}

// ── Onboarding Summary ──

export interface OnboardingHierarchyNode {
  key: string;
  summary: string;
  type: string;
  status: string;
  children: OnboardingHierarchyNode[];
}

export interface OnboardingDriftedCard {
  key: string;
  summary: string;
  /** Drift type detected by checkDrift. Undefined when drift cause is no longer detectable. */
  driftType?: DriftType;
}

export interface OnboardingSummary {
  totalCards: number;
  byType: { intent: number; spec: number };
  byStatus: { draft: number; active: number; drifted: number };
  hierarchy: OnboardingHierarchyNode[];
  coverageRatio: number | null;
  driftedCards: OnboardingDriftedCard[];
  relationCount: number;
  glossary: { totalWords: number; exists: boolean };
}

const HIERARCHY_MAX_DEPTH = 3;

/**
 * Build a hierarchy tree from a root card, limited to maxDepth levels.
 */
function buildHierarchyNode(
  ctx: EmberdeckContext,
  row: CardRow,
  depth: number,
): OnboardingHierarchyNode {
  const children: OnboardingHierarchyNode[] = [];
  if (depth + 1 < HIERARCHY_MAX_DEPTH) {
    const childRows = ctx.cardRepo.findChildren(row.key);
    for (const child of childRows) {
      children.push(buildHierarchyNode(ctx, child, depth + 1));
    }
  }
  return {
    key: row.key,
    summary: row.summary,
    type: row.type,
    status: row.status,
    children,
  };
}

/**
 * Get a complete overview of the card structure for fresh context onboarding.
 *
 * Returns card counts by type/status, a hierarchy tree of root cards (max 3 levels),
 * coverage ratio (if gildash available), drifted card summaries, and total relation count.
 * Designed for quick orientation at the start of a new conversation.
 */
export async function getOnboardingSummary(
  ctx: EmberdeckContext,
): Promise<OnboardingSummary> {
  const allCards = ctx.cardRepo.list();

  // Count by type
  const byType = { intent: 0, spec: 0 };
  for (const card of allCards) {
    if (card.type === 'intent') byType.intent++;
    else if (card.type === 'spec') byType.spec++;
  }

  // Count by status
  const byStatus = { draft: 0, active: 0, drifted: 0 };
  for (const card of allCards) {
    if (card.status === 'draft') byStatus.draft++;
    else if (card.status === 'active') byStatus.active++;
    else if (card.status === 'drifted') byStatus.drifted++;
  }

  // Build hierarchy from root cards (cards without a parent)
  const roots = allCards.filter((c) => c.parent === null);
  const hierarchy: OnboardingHierarchyNode[] = roots.map((root) =>
    buildHierarchyNode(ctx, root, 0),
  );

  // Coverage ratio (requires gildash)
  let coverageRatio: number | null = null;
  if (ctx.gildash) {
    const uncoveredResult = await getUncoveredSymbols(ctx);
    coverageRatio = uncoveredResult.coverageRatio;
  }

  // Drifted cards (from DB status, lightweight — no drift re-detection)
  const driftedCards: OnboardingDriftedCard[] = [];
  for (const card of allCards) {
    if (card.status === 'drifted') {
      driftedCards.push({
        key: card.key,
        summary: card.summary,
      });
    }
  }

  // If there are drifted cards, run lightweight drift detection to get actual driftType
  if (driftedCards.length > 0) {
    const driftResult = await checkDrift(ctx, undefined, { autoTransition: false });
    for (const dc of driftedCards) {
      const match = driftResult.cards.find((c) => c.key === dc.key && c.driftType);
      if (match?.driftType) {
        dc.driftType = match.driftType;
      }
    }
  }

  // Count total relations (forward only to avoid double-counting)
  let relationCount = 0;
  for (const card of allCards) {
    const relations = ctx.relationRepo.findByCardKey(card.key);
    relationCount += relations.filter((r) => !r.isReverse).length;
  }

  const onboardingGlossary = readGlossary(ctx);

  return {
    totalCards: allCards.length,
    byType,
    byStatus,
    hierarchy,
    coverageRatio,
    driftedCards,
    relationCount,
    glossary: {
      totalWords: onboardingGlossary.length,
      exists: onboardingGlossary.length > 0,
    },
  };
}
