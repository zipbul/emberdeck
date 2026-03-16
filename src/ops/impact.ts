import type { EmberdeckContext } from '../config';
import type { AcceptanceCriterion } from '../card/types';
import type { CardRow, CodeLinkRow } from '../db/repository';
import { getRelationGraph } from './query';

// ── pre_change_check ──

export interface AffectedCard {
  key: string;
  linkType: 'direct' | 'transitive';
  affectedLinks: number;
  via?: string;
}

export interface AtRiskAcceptance {
  cardKey: string;
  criterionId: string;
  description: string;
  relatedSymbol: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PreChangeResult {
  affectedCards: AffectedCard[];
  atRiskAcceptance: AtRiskAcceptance[];
  riskLevel: RiskLevel;
  suggestedActions: string[];
}

/**
 * Analyze the impact of changing specific files/symbols before making changes.
 *
 * 1. Find cards with direct code links to the given files/symbols.
 * 2. BFS backward to find cards that transitively depend on affected cards.
 * 3. Identify at-risk acceptance criteria.
 * 4. Calculate risk level and suggest actions.
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

  // Find at-risk acceptance criteria
  const atRiskAcceptance: AtRiskAcceptance[] = [];
  for (const [key] of directCards) {
    const row = ctx.cardRepo.findByKey(key);
    if (!row?.acceptanceJson) continue;
    const criteria = JSON.parse(row.acceptanceJson) as AcceptanceCriterion[];
    const links = ctx.codeLinkRepo.findByCardKey(key);
    const affectedSymbols = links
      .filter((l) => files.includes(l.file) && (!symbolSet || symbolSet.has(l.symbol)))
      .map((l) => l.symbol);

    for (const ac of criteria) {
      if (!ac.verified) continue; // Only at-risk if previously verified
      // Every verified criterion on a directly affected card is at risk
      for (const sym of affectedSymbols) {
        atRiskAcceptance.push({
          cardKey: key,
          criterionId: ac.id,
          description: ac.description,
          relatedSymbol: sym,
        });
        break; // One per criterion is enough
      }
    }
  }

  // Calculate risk level
  let riskLevel: RiskLevel = 'low';
  const allAffectedKeys = [...directCards.keys(), ...transitiveCards];
  const hasCritical = allAffectedKeys.some((key) => {
    const row = ctx.cardRepo.findByKey(key);
    return row?.priority === 'critical';
  });

  if (hasCritical) {
    riskLevel = 'critical';
  } else if (directCards.size >= 3 || atRiskAcceptance.length > 0) {
    riskLevel = 'high';
  } else if (directCards.size >= 1) {
    riskLevel = 'medium';
  } else if (transitiveCards.size > 0) {
    riskLevel = 'low';
  }

  // Generate suggested actions
  const suggestedActions: string[] = [];
  for (const risk of atRiskAcceptance) {
    suggestedActions.push(
      `Re-verify ${risk.cardKey} criterion ${risk.criterionId} (${risk.description}).`,
    );
  }
  for (const card of affectedCards.filter((c) => c.linkType === 'transitive')) {
    suggestedActions.push(
      `Check transitive dependency: ${card.key} (via ${card.via}).`,
    );
  }

  return { affectedCards, atRiskAcceptance, riskLevel, suggestedActions };
}

// ── regression_guard ──

export interface RegressionResult {
  qualityGate: 'pass' | 'warn' | 'fail';
  newIssues: unknown[];
  affectedAcceptance: AtRiskAcceptance[];
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
 * Cross-references with card acceptance criteria to determine quality gate status.
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

  // Find affected acceptance criteria
  const impact = preChangeCheck(ctx, changedFiles);
  const affectedAcceptance = impact.atRiskAcceptance;

  // Determine quality gate
  const hasCriticalIssues = newIssues.some(
    (i) => i.severity === 'critical' || i.severity === 'error',
  );
  const hasWarnings = newIssues.length > 0 || affectedAcceptance.length > 0;

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
    if (affectedAcceptance.length > 0) parts.push(`${affectedAcceptance.length} at-risk acceptance criteria`);
    recommendation = `Review needed: ${parts.join(', ')}.`;
  } else {
    recommendation = 'All checks passed. Safe to proceed.';
  }

  return {
    qualityGate,
    newIssues,
    affectedAcceptance,
    recommendation,
  };
}
