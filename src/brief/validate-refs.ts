/**
 * Cross-reference validation for brief structured body.
 *
 * Verifies that every `covers`/`governs`/`verifies`/`addresses` reference
 * resolves to an existing ID in the same brief, and that all required
 * coverage relationships are satisfied.
 */

import type { BriefBody } from '../card/types';
import { CardValidationError } from '../card/errors';

interface RefSets {
  goalIds: Set<string>;
  flowIds: Set<string>;
  externalIds: Set<string>;
  limitIds: Set<string>;
}

function collectIds(body: BriefBody): RefSets {
  return {
    goalIds: new Set(body.scope.goals.map((g) => g.id)),
    flowIds: new Set(body.flow.map((f) => f.id)),
    externalIds: new Set((body.external ?? []).map((e) => e.id)),
    limitIds: new Set((body.limits ?? []).map((l) => l.id)),
  };
}

/**
 * Validate brief body cross-references.
 *
 * Rules:
 *  - flow[].covers references must exist in scope.goals[].id
 *  - policy[].governs references must exist in flow[].id
 *  - criteria[].verifies references must exist in flow[].id
 *  - rationale.addresses references must exist in external[].id ∪ limits[].id
 *  - flow must contain at least 1 happy and 1 failure
 *  - every goal must be covered by ≥1 flow (no orphan goal)
 *  - every flow must be governed by ≥1 policy (no ungoverned flow)
 *  - every flow must be verified by ≥1 criterion (no unverified flow)
 *
 * @throws {CardValidationError} after accumulating every violation found in the body. The error
 *   message joins each unresolved reference with the offending field path so callers see the
 *   complete list instead of one-at-a-time fast-fail output.
 * @spec card-model/schema-and-validation/validate-card-input
 */
export function validateBriefRefs(body: BriefBody): void {
  const errors: string[] = [];
  const refs = collectIds(body);

  // ── flow.covers → scope.goals ─────────────────────────────
  for (const flow of body.flow) {
    for (const goalRef of flow.covers) {
      if (!refs.goalIds.has(goalRef)) {
        errors.push(`brief.flow[${flow.id}].covers references unknown goal "${goalRef}"`);
      }
    }
  }

  // ── policy.governs → flow ─────────────────────────────────
  for (const pol of body.policy) {
    for (const flowRef of pol.governs) {
      if (!refs.flowIds.has(flowRef)) {
        errors.push(`brief.policy[${pol.id}].governs references unknown flow "${flowRef}"`);
      }
    }
  }

  // ── criteria.verifies → flow ──────────────────────────────
  for (const c of body.criteria) {
    for (const flowRef of c.verifies) {
      if (!refs.flowIds.has(flowRef)) {
        errors.push(`brief.criteria[${c.id}].verifies references unknown flow "${flowRef}"`);
      }
    }
  }

  // ── rationale.addresses → external ∪ limits ──────────────
  for (const addrRef of body.rationale.addresses) {
    if (!refs.externalIds.has(addrRef) && !refs.limitIds.has(addrRef)) {
      errors.push(`brief.rationale.addresses references unknown external/limit "${addrRef}"`);
    }
  }

  // ── flow must have ≥1 happy and ≥1 failure ────────────────
  const hasHappy = body.flow.some((f) => f.kind === 'happy');
  const hasFailure = body.flow.some((f) => f.kind === 'failure');
  if (!hasHappy) errors.push('brief.flow must contain at least 1 happy scenario');
  if (!hasFailure) errors.push('brief.flow must contain at least 1 failure scenario');

  // ── every goal covered by ≥1 flow ─────────────────────────
  const coveredGoals = new Set<string>();
  for (const flow of body.flow) {
    for (const goalRef of flow.covers) coveredGoals.add(goalRef);
  }
  for (const goal of body.scope.goals) {
    if (!coveredGoals.has(goal.id)) {
      errors.push(`brief.scope.goals[${goal.id}] is not covered by any flow`);
    }
  }

  // ── every flow governed by ≥1 policy ──────────────────────
  const governedFlows = new Set<string>();
  for (const pol of body.policy) {
    for (const flowRef of pol.governs) governedFlows.add(flowRef);
  }
  for (const flow of body.flow) {
    if (!governedFlows.has(flow.id)) {
      errors.push(`brief.flow[${flow.id}] is not governed by any policy`);
    }
  }

  // ── every flow verified by ≥1 criterion ───────────────────
  const verifiedFlows = new Set<string>();
  for (const c of body.criteria) {
    for (const flowRef of c.verifies) verifiedFlows.add(flowRef);
  }
  for (const flow of body.flow) {
    if (!verifiedFlows.has(flow.id)) {
      errors.push(`brief.flow[${flow.id}] is not verified by any criterion`);
    }
  }

  if (errors.length > 0) {
    throw new CardValidationError(`Brief cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
