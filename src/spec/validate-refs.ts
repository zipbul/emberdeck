/**
 * Cross-reference validation for spec structured body.
 *
 * Verifies that:
 *  - Every `derives` reference (e.g., "brief-key#R-001") points to a real brief item
 *    when the parent brief is loadable
 *  - Spec body has at least 1 precondition, 1 postcondition, 1 invariant, 1 failure
 */

import type { SpecBody, BriefBody } from '../card/types';
import { CardValidationError } from '../card/errors';

/**
 * Parse a derives reference like "brief-key#R-001" into {briefKey, itemId}.
 * Returns null if format is invalid.
 */
function parseDerives(ref: string): { briefKey: string; itemId: string } | null {
  const match = ref.match(/^([^#]+)#(.+)$/);
  if (!match) return null;
  return { briefKey: match[1]!, itemId: match[2]! };
}

/**
 * Collect all referenceable IDs from a brief body.
 * Includes goals, flow, policy, design.invariants — anything a spec might derive from.
 */
function collectBriefRefIds(brief: BriefBody): Set<string> {
  const ids = new Set<string>();
  for (const g of brief.scope.goals) ids.add(g.id);
  for (const f of brief.flow) ids.add(f.id);
  for (const p of brief.policy) ids.add(p.id);
  for (const di of brief.design.invariants) ids.add(di.id);
  return ids;
}

/**
 * Validate spec body cross-references.
 *
 * @param spec - the structured spec body
 * @param briefLookup - optional: function to fetch parent brief body by key.
 *   When provided, derives references are resolved against the brief.
 *   When omitted, derives format is validated but target existence is not checked.
 * @spec card-model/schema-and-validation/validate-card-input
 */
/**
 * Collect derives/case_of reference errors for a spec body WITHOUT throwing.
 * Reusable by both activation (validateSpecRefs throws) and deck-wide
 * `ed validate cards` (surfaces each as a `broken-derives` warning).
 *
 * Checks: pre/post `derives` → brief#goal, failures `case_of` (v18) → brief#flow.
 * Format is always validated; target existence only when `briefLookup` is given.
 * @spec card-model/schema-and-validation/validate-card-input
 */
export function collectSpecDeriveErrors(
  spec: SpecBody,
  briefLookup?: (key: string) => BriefBody | null,
): string[] {
  const errors: string[] = [];
  const check = (id: string, ref: string, section: string) => {
    const parsed = parseDerives(ref);
    if (!parsed) {
      errors.push(`${section}[${id}] reference "${ref}" must follow format "brief-key#item-id"`);
      return;
    }
    if (briefLookup) {
      const brief = briefLookup(parsed.briefKey);
      if (!brief) {
        errors.push(`${section}[${id}] references unknown brief "${parsed.briefKey}"`);
        return;
      }
      if (!collectBriefRefIds(brief).has(parsed.itemId)) {
        errors.push(`${section}[${id}] references unknown item "${parsed.itemId}" in brief "${parsed.briefKey}"`);
      }
    }
  };

  for (const p of spec.preconditions) check(p.id, p.derives, 'spec.preconditions');
  for (const p of spec.postconditions) check(p.id, p.derives, 'spec.postconditions');
  // [v18] failures.case_of → brief failure-flow (S-F). Optional; only checked when present.
  for (const f of spec.failures) {
    if (f.case_of != null) check(f.id ?? 'FAIL-?', f.case_of, 'spec.failures(case_of)');
  }
  return errors;
}

export function validateSpecRefs(
  spec: SpecBody,
  briefLookup?: (key: string) => BriefBody | null,
): void {
  const errors: string[] = [];

  // ── Required minimums ─────────────────────────────────────
  if (spec.preconditions.length === 0) errors.push('spec.preconditions must have at least 1 entry');
  if (spec.postconditions.length === 0) errors.push('spec.postconditions must have at least 1 entry');
  if (spec.invariants.length === 0) errors.push('spec.invariants must have at least 1 entry');
  if (spec.failures.length === 0) errors.push('spec.failures must have at least 1 entry');

  // ── derives / case_of format + (optional) target existence ──
  errors.push(...collectSpecDeriveErrors(spec, briefLookup));

  if (errors.length > 0) {
    throw new CardValidationError(`Spec cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
