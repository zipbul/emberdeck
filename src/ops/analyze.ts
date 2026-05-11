import type { EmberdeckContext } from '../config';
import { checkDrift, type DriftType } from './context';
import { getUncoveredSymbols } from './spec-sync';
import { readGlossary, type GlossaryEntry } from '../glossary/io';
import { parseStringArrayJson } from '../card/json-fields';
import { ensureReindexed, gildashProjectNames, listAllIndexedFilesWithProject } from './link';

/** Days of changelog history to retain when pruning at the end of `analyze`. */
const CHANGELOG_RETENTION_DAYS = 90;

// ── Types ──

export interface AnalyzeHealth {
  total: number;
  active: number;
  drifted: number;
  draft: number;
  brokenLinks: number;
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
  * @spec analysis/impact-and-aggregate/interactions-and-analyze
 */
export async function analyze(
  ctx: EmberdeckContext,
  options?: AnalyzeOptions,
): Promise<AnalyzeResult> {
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
      driftedCards.push({
        key: card.key,
        summary: card.summary,
        driftType: card.driftType,
        brokenLinks: card.brokenLinks,
        totalLinks: card.totalLinks,
      });
    } else if (card.status === 'drifted') {
      // No drift detected now, but card was previously marked drifted in DB
      // (e.g., code was fixed but card not re-activated) — still count as drifted
      drifted++;
      driftedCards.push({
        key: card.key,
        summary: card.summary,
        brokenLinks: card.brokenLinks,
        totalLinks: card.totalLinks,
      });
    } else {
      active++;
    }
  }

  // Gildash reindex before symbol coverage queries below.
  await ensureReindexed(ctx);

  // 3. Symbol coverage
  const uncoveredResult = await getUncoveredSymbols(ctx);
  const coverage: AnalyzeCoverage = {
    totalSymbols: uncoveredResult.totalSymbols,
    covered: uncoveredResult.coveredSymbols,
    ratio: uncoveredResult.coverageRatio,
  };
  const unlinkedSymbols: UnlinkedSymbol[] = uncoveredResult.uncovered
    .slice(0, UNLINKED_SYMBOLS_LIMIT)
    .map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind }));

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
  try {
    const uniqueFiles = new Map<string, string | undefined>();
    for (const f of listAllIndexedFilesWithProject(ctx)) uniqueFiles.set(f.filePath, f.project);
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

  // Code-side architectural debt: aggregate cycles across ALL projects.
  let codeCycles: AnalyzeHealth['codeCycles'];
  try {
    const allCycles: string[][] = [];
    for (const project of gildashProjectNames(ctx)) {
      try {
        const has = await ctx.gildash.hasCycle(project);
        if (!has) continue;
        const cycles = await ctx.gildash.getCyclePaths(project, { maxCycles: MAX_CYCLES_FETCH });
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

  // Hygiene: prune old gildash changelog entries on each analyze run.
  // Bounded retention prevents `.gildash/` from growing unbounded across
  // long-lived projects; failures are non-fatal (analyze must still return).
  try {
    const cutoff = new Date(Date.now() - CHANGELOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    ctx.gildash.pruneChangelog(cutoff);
  } catch {
    // best-effort; do not fail the report
  }

  return {
    health: {
      total: allCards.length,
      active,
      drifted,
      draft,
      brokenLinks: totalBrokenLinks,
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

