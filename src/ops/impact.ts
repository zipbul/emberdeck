import type { EmberdeckContext } from '../config';
import { getRelationGraph } from './query';

// ── pre_change_check ──

export interface AffectedCard {
  key: string;
  linkType: 'direct' | 'transitive';
  affectedLinks: number;
  via?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PreChangeResult {
  affectedCards: AffectedCard[];
  riskLevel: RiskLevel;
  suggestedActions: string[];
}

/**
 * Analyze the impact of changing specific files/symbols before making changes.
 *
 * 1. Find cards with direct code links to the given files/symbols.
 * 2. BFS backward to find cards that transitively depend on affected cards.
 * 3. Calculate risk level and suggest actions.
 */
export function preChangeCheck(
  ctx: EmberdeckContext,
  files: string[],
  symbols?: string[],
): PreChangeResult {
  const directCards = new Map<string, number>();
  const symbolSet = symbols ? new Set(symbols) : null;

  // Find directly affected cards
  for (const file of files) {
    const links = ctx.codeLinkRepo.findByFile(file);
    for (const link of links) {
      if (symbolSet && !symbolSet.has(link.symbol)) continue;
      const count = directCards.get(link.cardKey) ?? 0;
      directCards.set(link.cardKey, count + 1);
    }
  }

  const affectedCards: AffectedCard[] = [];
  for (const [key, count] of directCards) {
    affectedCards.push({ key, linkType: 'direct', affectedLinks: count });
  }

  // Find transitive dependents (cards that depend-on affected cards)
  const transitiveCards = new Set<string>();
  for (const [directKey] of directCards) {
    const graph = getRelationGraph(ctx, directKey, { maxDepth: 3, direction: 'backward' });
    for (const node of graph) {
      if (!directCards.has(node.key) && !transitiveCards.has(node.key)) {
        transitiveCards.add(node.key);
        affectedCards.push({
          key: node.key,
          linkType: 'transitive',
          affectedLinks: 0,
          via: directKey,
        });
      }
    }
  }

  // Calculate risk level
  let riskLevel: RiskLevel = 'low';

  if (directCards.size >= 3) {
    riskLevel = 'high';
  } else if (directCards.size >= 1) {
    riskLevel = 'medium';
  } else if (transitiveCards.size > 0) {
    riskLevel = 'low';
  }

  // Generate suggested actions
  const suggestedActions: string[] = [];
  for (const card of affectedCards.filter((c) => c.linkType === 'direct')) {
    suggestedActions.push(
      `Review card "${card.key}" — ${card.affectedLinks} code link(s) affected.`,
    );
  }
  for (const card of affectedCards.filter((c) => c.linkType === 'transitive')) {
    suggestedActions.push(
      `Check transitive dependency: ${card.key} (via ${card.via}).`,
    );
  }

  return { affectedCards, riskLevel, suggestedActions };
}

// ── regression_guard ──

export interface RegressionResult {
  qualityGate: 'pass' | 'warn' | 'fail';
  newIssues: unknown[];
  affectedCardCount: number;
  recommendation: string;
}

interface FirebatIssue {
  file?: string;
  rule?: string;
  message?: string;
  severity?: string;
  [key: string]: unknown;
}

/**
 * Regression guard combining changed file analysis with optional Firebat report.
 *
 * Accepts Firebat scan results as-is (unknown type, parsed internally).
 * Cross-references with affected cards to determine quality gate status.
 */
export function regressionGuard(
  ctx: EmberdeckContext,
  changedFiles: string[],
  firebatReport?: unknown,
): RegressionResult {
  // Parse Firebat report if provided
  const newIssues: FirebatIssue[] = [];
  if (firebatReport != null) {
    if (Array.isArray(firebatReport)) {
      for (const item of firebatReport) {
        if (item && typeof item === 'object') {
          newIssues.push(item as FirebatIssue);
        }
      }
    } else if (typeof firebatReport === 'object') {
      const report = firebatReport as Record<string, unknown>;
      if (Array.isArray(report.issues)) {
        for (const item of report.issues) {
          if (item && typeof item === 'object') {
            newIssues.push(item as FirebatIssue);
          }
        }
      }
    }
  }

  // Find affected cards
  const impact = preChangeCheck(ctx, changedFiles);
  const affectedCardCount = impact.affectedCards.length;

  // Determine quality gate
  const hasCriticalIssues = newIssues.some(
    (i) => i.severity === 'critical' || i.severity === 'error',
  );
  const hasWarnings = newIssues.length > 0 || affectedCardCount > 0;

  let qualityGate: 'pass' | 'warn' | 'fail';
  if (hasCriticalIssues) {
    qualityGate = 'fail';
  } else if (hasWarnings) {
    qualityGate = 'warn';
  } else {
    qualityGate = 'pass';
  }

  // Generate recommendation
  let recommendation: string;
  if (qualityGate === 'fail') {
    recommendation = `Critical issues detected. Fix ${newIssues.filter((i) => i.severity === 'critical' || i.severity === 'error').length} critical issue(s) before merging.`;
  } else if (qualityGate === 'warn') {
    const parts: string[] = [];
    if (newIssues.length > 0) parts.push(`${newIssues.length} quality issue(s)`);
    if (affectedCardCount > 0) parts.push(`${affectedCardCount} affected card(s)`);
    recommendation = `Review needed: ${parts.join(', ')}.`;
  } else {
    recommendation = 'All checks passed. Safe to proceed.';
  }

  return {
    qualityGate,
    newIssues,
    affectedCardCount,
    recommendation,
  };
}
