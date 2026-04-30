/**
 * Cross-reference validation for spec structured body.
 *
 * Verifies that:
 *  - Every `binds` reference matches an entry in the card's frontmatter codeLinks
 *  - Every `derives` reference (e.g., "brief-key#R-001") points to a real brief item
 *    when the parent brief is loadable
 *  - Spec body has at least 1 precondition, 1 postcondition, 1 invariant, 1 failure
 */

import type { CardFrontmatter, SpecBindRef, SpecBody, BriefBody } from '../card/types';
import { CardValidationError } from '../card/errors';

function bindKey(b: SpecBindRef): string {
  return `${b.file}::${b.symbol}`;
}

/**
 * Validate that all `binds` references in spec body match the frontmatter codeLinks set.
 */
function validateBindsAgainstCodeLinks(spec: SpecBody, fm: CardFrontmatter): string[] {
  const errors: string[] = [];
  const codeLinks = fm.codeLinks ?? [];
  const linkSet = new Set(codeLinks.map((l) => `${l.file}::${l.symbol}`));

  const checkBinds = (id: string, binds: SpecBindRef[], section: string) => {
    for (const b of binds) {
      if (!linkSet.has(bindKey(b))) {
        errors.push(
          `${section}[${id}].binds references "${b.file}::${b.symbol}" not in card.codeLinks`,
        );
      }
    }
  };

  for (const p of spec.preconditions) checkBinds(p.id, p.binds, 'spec.preconditions');
  for (const p of spec.postconditions) checkBinds(p.id, p.binds, 'spec.postconditions');
  for (const i of spec.invariants) checkBinds(i.id, i.binds, 'spec.invariants');
  if (spec.state_transitions) {
    for (const t of spec.state_transitions) {
      checkBinds(`${t.from}->${t.to}`, t.binds, 'spec.state_transitions');
    }
  }

  return errors;
}

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
 * @param fm - the spec card's frontmatter (for codeLinks lookup)
 * @param briefLookup - optional: function to fetch parent brief body by key.
 *   When provided, derives references are resolved against the brief.
 *   When omitted, derives format is validated but target existence is not checked.
 */
export function validateSpecRefs(
  spec: SpecBody,
  fm: CardFrontmatter,
  briefLookup?: (key: string) => BriefBody | null,
): void {
  const errors: string[] = [];

  // ── Required minimums ─────────────────────────────────────
  if (spec.preconditions.length === 0) errors.push('spec.preconditions must have at least 1 entry');
  if (spec.postconditions.length === 0) errors.push('spec.postconditions must have at least 1 entry');
  if (spec.invariants.length === 0) errors.push('spec.invariants must have at least 1 entry');
  if (spec.failures.length === 0) errors.push('spec.failures must have at least 1 entry');

  // ── binds against codeLinks ───────────────────────────────
  errors.push(...validateBindsAgainstCodeLinks(spec, fm));

  // ── code_patterns: per-entry shape check ──────────────────
  if (spec.code_patterns) {
    const seenIds = new Set<string>();
    for (const cp of spec.code_patterns) {
      if (!cp.id || !cp.id.trim()) {
        errors.push('spec.code_patterns[].id must be non-empty');
      } else if (seenIds.has(cp.id)) {
        errors.push(`spec.code_patterns[${cp.id}] duplicate id`);
      } else {
        seenIds.add(cp.id);
      }
      if (!cp.pattern || !cp.pattern.trim()) {
        errors.push(`spec.code_patterns[${cp.id || '?'}].pattern must be non-empty`);
      }
      if (cp.rule !== 'forbidden' && cp.rule !== 'required') {
        errors.push(`spec.code_patterns[${cp.id || '?'}].rule must be "forbidden" or "required"`);
      }
    }
  }

  // ── derives format + (optional) target existence ──────────
  const checkDerives = (id: string, ref: string, section: string) => {
    const parsed = parseDerives(ref);
    if (!parsed) {
      errors.push(`${section}[${id}].derives "${ref}" must follow format "brief-key#item-id"`);
      return;
    }
    if (briefLookup) {
      const brief = briefLookup(parsed.briefKey);
      if (!brief) {
        errors.push(`${section}[${id}].derives references unknown brief "${parsed.briefKey}"`);
        return;
      }
      const ids = collectBriefRefIds(brief);
      if (!ids.has(parsed.itemId)) {
        errors.push(
          `${section}[${id}].derives references unknown item "${parsed.itemId}" in brief "${parsed.briefKey}"`,
        );
      }
    }
  };

  for (const p of spec.preconditions) checkDerives(p.id, p.derives, 'spec.preconditions');
  for (const p of spec.postconditions) checkDerives(p.id, p.derives, 'spec.postconditions');

  if (errors.length > 0) {
    throw new CardValidationError(`Spec cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
