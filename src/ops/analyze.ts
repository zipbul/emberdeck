import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { checkDrift, type DriftType } from './context';
import { getUncoveredSymbols } from './spec-sync';
import { readGlossary, type GlossaryEntry } from '../glossary/io';
import { buildCardFromDb } from './sync';
import { parseStringArrayJson } from '../card/json-fields';
import { matchesAnyGlob } from '../util/glob';
import { ensureReindexed, gildashProjectNames } from './link';

/** Days of changelog history to retain when pruning at the end of `analyze`. */
const CHANGELOG_RETENTION_DAYS = 90;

/**
 * Read a card's body via buildCardFromDb so the returned text does NOT include
 * the FTS5-only namespace tail concatenated into row.body at sync time.
 * Returns null if the card cannot be reconstructed.
 */
function readBodyFromDb(ctx: import('../config').EmberdeckContext, key: string): string | null {
  try {
    return buildCardFromDb(ctx, key).body;
  } catch {
    return null;
  }
}

// ── Types ──

export interface AnalyzeHealth {
  total: number;
  active: number;
  drifted: number;
  draft: number;
  brokenLinks: number;
  staleBoundary: number;
  /** Code-side architectural warnings (populated when gildash is available). */
  codeCycles?: {
    /** Number of distinct cycles detected in the import graph. */
    count: number;
    /** Up to MAX_CYCLE_SAMPLES example cycles, each as a list of files in loop order. */
    samples: string[][];
  };
  /** Code-side aggregate counts (gildash.getStats). */
  codeStats?: {
    files: number;
    symbols: number;
  };
}

/** Cap on cycle samples surfaced in analyze output (display layer only). */
const MAX_CYCLE_SAMPLES = 5;
/**
 * Safety cap on `getCyclePaths` calls — large enough to cover real codebases
 * (typeorm has ~500+ cycles in 314 files; cost is <200ms even at this cap),
 * small enough to bound runtime if a pathological project has thousands.
 */
const MAX_CYCLES_FETCH = 200;

export interface AnalyzeCoverage {
  totalSymbols: number;
  covered: number;
  /**
   * `covered / totalSymbols`, or `null` when there are no cards yet (or no
   * indexed symbols). Distinguishes "no information available" from
   * "0% covered" — agents should treat `null` as "set up cards first".
   */
  ratio: number | null;
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
      if (includeBody) entry.body = readBodyFromDb(ctx, card.key);
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
      if (includeBody) entry.body = readBodyFromDb(ctx, card.key);
      driftedCards.push(entry);
    } else {
      active++;
    }
  }

  // 3. Stale boundary count: boundary globs that match no indexed files.
  // Empty index treated as "no information" (consistent with checkDrift's
  // boundary_inactive guard) so we don't false-positive when gildash isn't
  // configured or the project happens to have zero indexed sources.
  let staleBoundary = 0;
  if (ctx.gildash && typeof ctx.gildash.listIndexedFiles === 'function') {
    await ensureReindexed(ctx);
    // Aggregate across all gildash projects (monorepo support).
    const indexedFiles: string[] = [];
    for (const project of gildashProjectNames(ctx)) {
      try {
        const list = ctx.gildash.listIndexedFiles(project);
        for (const f of list) indexedFiles.push(f.filePath);
      } catch {
        // skip
      }
    }
    if (indexedFiles.length > 0) {
      for (const card of allCards) {
        const boundary = parseStringArrayJson(card.boundaryJson);
        if (boundary.length === 0) continue;
        let anyMatch = false;
        try {
          anyMatch = indexedFiles.some((f) => matchesAnyGlob(f, boundary));
        } catch {
          // invalid glob — count as stale
        }
        if (!anyMatch) staleBoundary++;
      }
    }
  } else if (ctx.projectRoot) {
    // Fallback when gildash is absent: scan the projectRoot directly.
    for (const card of allCards) {
      const boundary = parseStringArrayJson(card.boundaryJson);
      if (boundary.length === 0) continue;
      let anyMatch = false;
      try {
        for (const pattern of boundary) {
          const glob = new Bun.Glob(pattern);
          for (const _ of glob.scanSync({ cwd: ctx.projectRoot })) {
            anyMatch = true;
            break;
          }
          if (anyMatch) break;
        }
      } catch {
        // unreadable projectRoot — count as stale
      }
      if (!anyMatch) staleBoundary++;
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
    for (const w of parseStringArrayJson(card.glossaryJson)) usedGlossaryWords.add(w);
  }
  const unusedWords = glossaryEntries
    .filter((e) => !usedGlossaryWords.has(e.word))
    .map((e) => e.word);

  // Code-side aggregate stats — UNIQUE files + symbols across all gildash
  // projects. Project boundaries can overlap (nestjs: same file in multiple
  // sub-projects); dedupe by file path AND by (file, symbol-name) pair so a
  // symbol shared across projects counts once.
  let codeStats: AnalyzeHealth['codeStats'];
  if (
    ctx.gildash &&
    typeof ctx.gildash.listIndexedFiles === 'function' &&
    typeof ctx.gildash.getSymbolsByFile === 'function'
  ) {
    try {
      const uniqueFiles = new Map<string, string | undefined>();
      for (const project of gildashProjectNames(ctx)) {
        try {
          const files = ctx.gildash.listIndexedFiles(project);
          for (const f of files) {
            if (!uniqueFiles.has(f.filePath)) uniqueFiles.set(f.filePath, project);
          }
        } catch {
          // skip project
        }
      }
      // Count symbols by total length (NOT (file,name) dedup) — overloaded
      // functions with the same name in the same file ARE distinct symbols
      // in gildash. Matches `coverage.totalSymbols` counting semantics so
      // both fields produce the same number for the same data set.
      let symbolTotal = 0;
      for (const [file, project] of uniqueFiles) {
        try {
          const syms = ctx.gildash.getSymbolsByFile(file, project);
          symbolTotal += syms.length;
        } catch {
          // skip file
        }
      }
      codeStats = { files: uniqueFiles.size, symbols: symbolTotal };
    } catch {
      // best-effort
    }
  }

  // Code-side architectural debt: aggregate cycles across ALL projects.
  let codeCycles: AnalyzeHealth['codeCycles'];
  if (
    ctx.gildash &&
    typeof ctx.gildash.getCyclePaths === 'function' &&
    typeof ctx.gildash.hasCycle === 'function'
  ) {
    try {
      const allCycles: string[][] = [];
      for (const project of gildashProjectNames(ctx)) {
        try {
          const has = await ctx.gildash.hasCycle(project);
          if (!has) continue;
          const cycles = project
            ? await ctx.gildash.getCyclePaths(project, { maxCycles: MAX_CYCLES_FETCH })
            : await ctx.gildash.getCyclePaths(undefined, { maxCycles: MAX_CYCLES_FETCH });
          allCycles.push(...cycles);
          if (allCycles.length >= MAX_CYCLES_FETCH) break;
        } catch {
          // skip project on failure
        }
      }
      codeCycles = {
        count: allCycles.length,
        samples: allCycles.slice(0, MAX_CYCLE_SAMPLES),
      };
    } catch {
      // best-effort; cycle reporting is informational
    }
  }

  // Hygiene: prune old gildash changelog entries on each analyze run.
  // Bounded retention prevents `.gildash/` from growing unbounded across
  // long-lived projects; failures are non-fatal (analyze must still return).
  if (ctx.gildash && typeof ctx.gildash.pruneChangelog === 'function') {
    try {
      const cutoff = new Date(Date.now() - CHANGELOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      ctx.gildash.pruneChangelog(cutoff);
    } catch {
      // best-effort; do not fail the report
    }
  }

  return {
    health: {
      total: allCards.length,
      active,
      drifted,
      draft,
      brokenLinks: totalBrokenLinks,
      staleBoundary,
      ...(codeStats ? { codeStats } : {}),
      ...(codeCycles ? { codeCycles } : {}),
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
  byType: { principle: number; domain: number; brief: number; spec: number };
  byStatus: { draft: number; active: number; drifted: number; retired: number };
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
  const byType = { principle: 0, domain: 0, brief: 0, spec: 0 };
  for (const card of allCards) {
    if (card.type === 'principle') byType.principle++;
    else if (card.type === 'domain') byType.domain++;
    else if (card.type === 'brief') byType.brief++;
    else if (card.type === 'spec') byType.spec++;
  }

  // Count by status
  const byStatus = { draft: 0, active: 0, drifted: 0, retired: 0 };
  for (const card of allCards) {
    if (card.status === 'draft') byStatus.draft++;
    else if (card.status === 'active') byStatus.active++;
    else if (card.status === 'drifted') byStatus.drifted++;
    else if (card.status === 'retired') byStatus.retired++;
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
