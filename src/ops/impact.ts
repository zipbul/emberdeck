import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { getRelationGraph } from './query';
import { checkDrift } from './context';
import { readGlossary, type GlossaryEntry } from '../glossary/io';
import { parseStringArrayJson } from '../card/json-fields';
import { matchesAnyGlob } from '../util/glob';
import { SymbolFileCache, expandAffectedFiles, makeSymbolFileCache, gildashProjectNames } from './link';

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
  /** Highest fan-in across input files (gildash). 0 when gildash unavailable. */
  maxFanIn?: number;
  /** Highest fan-out across input files (gildash). */
  maxFanOut?: number;
  /** Direct importers of any input file (gildash.getDependents). */
  directDependents?: string[];
  /** Full project glossary (for agent context). */
  glossary?: GlossaryEntry[];
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
export async function preChangeCheck(
  ctx: EmberdeckContext,
  files: string[],
  symbols?: string[],
): Promise<PreChangeResult> {
  const directCards = new Map<string, number>();
  const symbolSet = symbols ? new Set(symbols) : null;

  // Expand input through gildash import graph so changes propagate to cards
  // that link to importers of the changed files (not just direct linkers).
  const expandedFiles = await expandAffectedFiles(ctx, files);

  // Shared symbol cache reused across all per-card link-status checks below.
  const sharedCache = ctx.gildash ? makeSymbolFileCache(ctx)! : undefined;

  // Find directly affected cards by codeLinks
  for (const file of expandedFiles) {
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
    const boundary = parseStringArrayJson(card.boundaryJson);
    if (boundary.length === 0) continue;

    if (files.some((f) => matchesAnyGlob(f, boundary))) {
      boundaryCards.set(card.key, card);
    }
  }

  const affectedCards: AffectedCard[] = [];
  const primaryKeys = new Set<string>();

  // Add direct cards
  for (const [key, count] of directCards) {
    primaryKeys.add(key);
    const row = ctx.cardRepo.findByKey(key);
    const linkStatus = computeLinkStatus(ctx, key, sharedCache);
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
    const linkStatus = computeLinkStatus(ctx, key, sharedCache);
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

  // Detect uncovered files. Single bulk read of code links instead of N
  // findByCardKey calls — only the file column matters here.
  const coveredFiles = new Set<string>();
  for (const link of ctx.codeLinkRepo.findAll()) {
    coveredFiles.add(link.file);
  }
  for (const card of allCards) {
    const boundary = parseStringArrayJson(card.boundaryJson);
    if (boundary.length === 0) continue;
    for (const file of files) {
      if (matchesAnyGlob(file, boundary)) coveredFiles.add(file);
    }
  }

  const newUncoveredFiles: string[] = [];
  for (const file of files) {
    if (coveredFiles.has(file)) continue;
    if (!matchesAnyGlob(file, ctx.ignorePatterns)) {
      newUncoveredFiles.push(file);
    }
  }

  // Calculate risk level: card count + drifted ratio + fan-in (gildash hot files).
  // A change to a high-fan-in file affects more importers, so we elevate the
  // risk one tier when any input file has fan-in ≥ HOT_FILE_FANIN.
  const driftedCount = affectedCards.filter((c) => {
    const row = ctx.cardRepo.findByKey(c.key);
    return row && row.status === 'drifted';
  }).length;
  const totalAffected = affectedCards.length;
  const driftedRatio = totalAffected > 0 ? driftedCount / totalAffected : 0;

  // Aggregate fan metrics + dependents across all gildash projects (monorepo).
  let maxFanIn = 0;
  let maxFanOut = 0;
  const projectNames = ctx.gildash ? gildashProjectNames(ctx) : [undefined];
  if (ctx.gildash && typeof ctx.gildash.getFanMetrics === 'function') {
    for (const file of files) {
      for (const project of projectNames) {
        try {
          const metrics = project
            ? await ctx.gildash.getFanMetrics(file, project)
            : await ctx.gildash.getFanMetrics(file);
          if (metrics.fanIn > maxFanIn) maxFanIn = metrics.fanIn;
          if (metrics.fanOut > maxFanOut) maxFanOut = metrics.fanOut;
        } catch {
          // best-effort
        }
      }
    }
  }

  // Direct importers (gildash.getDependents) aggregated across projects.
  const directDependentsSet = new Set<string>();
  if (ctx.gildash && typeof ctx.gildash.getDependents === 'function') {
    for (const file of files) {
      for (const project of projectNames) {
        try {
          const deps = ctx.gildash.getDependents(file, project);
          for (const d of deps) directDependentsSet.add(d);
        } catch {
          // best-effort
        }
      }
    }
  }
  const directDependents = [...directDependentsSet];

  const HOT_FILE_FANIN = 10;
  const baseRisk: RiskLevel =
    totalAffected >= 5 || driftedRatio > 0.5
      ? 'critical'
      : totalAffected >= 3 || driftedRatio > 0.25
        ? 'high'
        : totalAffected >= 1
          ? 'medium'
          : 'low';
  // Promote one tier when a hot file is involved (cap at 'critical').
  const tiers: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  const baseIdx = tiers.indexOf(baseRisk);
  const promoted = maxFanIn >= HOT_FILE_FANIN ? Math.min(baseIdx + 1, tiers.length - 1) : baseIdx;
  const riskLevel = tiers[promoted]!;

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

  // Attach full glossary for agent context (M8)
  const glossaryEntries = readGlossary(ctx);

  return {
    affectedCards,
    riskLevel,
    newUncoveredFiles,
    suggestedActions,
    ...(maxFanIn > 0 ? { maxFanIn } : {}),
    ...(maxFanOut > 0 ? { maxFanOut } : {}),
    ...(directDependents.length > 0 ? { directDependents } : {}),
    ...(glossaryEntries.length > 0 ? { glossary: glossaryEntries } : {}),
  };
}

/**
 * Compute link status (valid/broken) for a card using gildash.
 * Returns undefined if gildash is not available.
 *
 * Accepts an optional shared SymbolFileCache so a sweep over many cards
 * (preChangeCheck) reuses one getSymbolsByFile call per file.
 */
function computeLinkStatus(
  ctx: EmberdeckContext,
  cardKey: string,
  cache?: SymbolFileCache,
): { valid: number; broken: number } | undefined {
  if (!ctx.gildash) return undefined;

  const links = ctx.codeLinkRepo.findByCardKey(cardKey);
  if (links.length === 0) return { valid: 0, broken: 0 };

  const symbolCache = cache ?? makeSymbolFileCache(ctx)!;
  let valid = 0;
  let broken = 0;
  for (const link of links) {
    try {
      if (symbolCache.find(link.file, link.symbol)) valid++;
      else broken++;
    } catch {
      broken++;
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
  const impact = await preChangeCheck(ctx, changedFiles);
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
    if (info.driftType || info.status === 'drifted') driftedCount++;
  }

  const driftedRatio = affectedResult.length > 0
    ? driftedCount / affectedResult.length
    : 0;

  const passOrFail = driftedRatio > threshold ? 'fail' : 'pass';

  return { passOrFail, driftedRatio, affectedCards: affectedResult, threshold };
}
