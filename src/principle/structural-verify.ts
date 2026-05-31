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
 * @spec card-storage/persistence/sync
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
 * Card types that can be the direct parent of `childType` under the 4-tier rule.
 * requires-child-type only checks cards of these types, so `applies_to:'*' +
 * requires-child-type{brief}` reads naturally as "every domain must have a brief".
 */
function validParentTypes(childType: CardType): CardType[] {
  switch (childType) {
    case 'brief': return ['domain'];
    case 'spec': return ['brief', 'spec'];
    default: return []; // vision/principle/domain are roots — nothing parents them
  }
}

/**
 * Evaluate every active structural principle against the card graph.
 *
 * Only active principles enforce, and only non-draft in-scope cards are
 * checked (drafts are work-in-progress, mirroring the empty-tree rule).
 */
export function evaluateStructuralPrinciples(
  cards: StructuralCardNode[],
  forwardRelationsBySrc: Map<string, string[]>,
  rules: StructuralPrincipleRule[],
): StructuralViolation[] {
  const violations: StructuralViolation[] = [];
  if (rules.length === 0) return violations;

  // childTypesByParent: parent key → set of direct child types.
  const childTypesByParent = new Map<string, Set<CardType>>();
  for (const c of cards) {
    if (!c.parent) continue;
    const set = childTypesByParent.get(c.parent) ?? new Set<CardType>();
    set.add(c.type);
    childTypesByParent.set(c.parent, set);
  }

  for (const rule of rules) {
    for (const card of cards) {
      if (card.status === 'draft') continue;
      if (!inScope(card.key, rule.appliesTo)) continue;

      if (rule.predicate.kind === 'requires-child-type') {
        const want = rule.predicate.childType;
        // Only cards that could legally parent `want` are subject to this rule.
        if (!validParentTypes(want).includes(card.type)) continue;
        const has = childTypesByParent.get(card.key)?.has(want) ?? false;
        if (!has) {
          violations.push({
            principleKey: rule.key,
            cardKey: card.key,
            enforcement: rule.enforcement,
            message: `${card.type} card "${card.key}" has no direct ${want} child (required by principle "${rule.key}")`,
          });
        }
      } else {
        const glob = rule.predicate.targetGlob;
        for (const dst of forwardRelationsBySrc.get(card.key) ?? []) {
          if (matchesAnyGlob(dst, [glob])) {
            violations.push({
              principleKey: rule.key,
              cardKey: card.key,
              enforcement: rule.enforcement,
              message: `${card.type} card "${card.key}" declares a forbidden relation to "${dst}" matching "${glob}" (principle "${rule.key}")`,
            });
          }
        }
      }
    }
  }
  return violations;
}
