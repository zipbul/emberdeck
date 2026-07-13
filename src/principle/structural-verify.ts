/**
 * Structural verify engine (§5 — verify.class=structural).
 *
 * A principle whose `verify.class` is `structural` declares a closed graph-shape
 * predicate. This engine evaluates that predicate over the principle's
 * `applies_to` scope (card-key globs) and reports violations. Without this
 * engine a structural principle would be decorative — the whole point of
 * `principle` is that a norm declared in a card is actually enforced, so the
 * source of truth for the norm lives in the card, not hard-coded in validate.
 *
 * Enforcement strength is the principle's own `enforcement`: blocking
 * violations gate `validate cards`; warning violations are non-gating;
 * advisory violations are informational and not emitted as validate findings.
 *
 * Pure (no ctx / no IO): callers pass the card graph + forward relations.
 *
 */

import type { CardType, PrincipleStructuralPredicate } from '../card/types';
import { matchesAnyGlob } from '../util/glob';

export interface StructuralCardNode {
  key: string;
  type: CardType;
  status: string;
  parent: string | null;
}

export interface StructuralPrincipleRule {
  key: string;
  appliesTo: '*' | string[];
  enforcement: 'blocking' | 'warning' | 'advisory';
  predicate: PrincipleStructuralPredicate;
  /** Card-key globs explicitly exempted from this principle (principle.exemptions[].target). */
  exemptions?: string[];
}

export interface StructuralViolation {
  principleKey: string;
  cardKey: string;
  enforcement: 'blocking' | 'warning' | 'advisory';
  message: string;
}

/** True when a card key falls within a principle's applies_to scope. */
function inScope(cardKey: string, appliesTo: '*' | string[]): boolean {
  if (appliesTo === '*') return true;
  return appliesTo.includes('*') || matchesAnyGlob(cardKey, appliesTo);
}

/**
 * Evaluate every active structural principle against the card graph.
 *
 * Only active principles enforce, and only non-draft in-scope cards are
 * checked (drafts are work-in-progress, mirroring the empty-tree rule).
 *
 * `forwardEdgesBySrc` is the union of a card's outgoing coupling edges —
 * `relations`, `cross_domain_dependencies`, and spec `invokes` targets — so a
 * boundary principle catches coupling expressed through any of them, not just
 * the legacy `relations[]` field.
 */
export function evaluateStructuralPrinciples(
  cards: StructuralCardNode[],
  forwardEdgesBySrc: Map<string, string[]>,
  rules: StructuralPrincipleRule[],
): StructuralViolation[] {
  const violations: StructuralViolation[] = [];
  if (rules.length === 0) return violations;

  for (const rule of rules) {
    for (const card of cards) {
      if (card.status === 'draft') continue;
      if (!inScope(card.key, rule.appliesTo)) continue;
      if (rule.exemptions && rule.exemptions.length > 0 && matchesAnyGlob(card.key, rule.exemptions)) continue;

      const glob = rule.predicate.targetGlob;
      for (const dst of forwardEdgesBySrc.get(card.key) ?? []) {
        if (matchesAnyGlob(dst, [glob])) {
          violations.push({
            principleKey: rule.key,
            cardKey: card.key,
            enforcement: rule.enforcement,
            message: `${card.type} card "${card.key}" declares a forbidden edge to "${dst}" matching "${glob}" (principle "${rule.key}")`,
          });
        }
      }
    }
  }
  return violations;
}
