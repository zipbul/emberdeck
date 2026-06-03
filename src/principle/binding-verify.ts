/**
 * Binding verify engine (§5 — verify.class=binding).
 *
 * source-as-binding-sot: the ONLY code-binding mechanism is the
 * `/** @spec <card-key> *​/` annotation on SPEC cards (→ code_link cache).
 * principle/brief/domain/vision do NOT bind to code. So a `binding` principle —
 * verified by source-binding evidence — is satisfied by the @spec evidence of
 * the SPEC cards it GOVERNS (applies_to): each governed spec must carry @spec
 * source bindings (≥1 code_link row).
 *
 * Presence-only ("evidence present/missing", §5): a governed spec with no @spec
 * binding evidence is the violation. Non-spec cards in scope are skipped
 * (unbindable). Draft specs are skipped (WIP, not bound yet).
 */

import type { CardType } from '../card/types';
import { matchesAnyGlob } from '../util/glob';

export interface BindingCardNode {
  key: string;
  type: CardType;
  status: string;
}

export interface BindingPrincipleRule {
  key: string;
  appliesTo: '*' | string[];
  enforcement: 'blocking' | 'warning' | 'advisory';
  exemptions?: string[];
}

export interface BindingViolation {
  principleKey: string;
  cardKey: string;
  enforcement: 'blocking' | 'warning' | 'advisory';
  message: string;
}

function inScope(cardKey: string, appliesTo: '*' | string[]): boolean {
  if (appliesTo === '*') return true;
  return appliesTo.includes('*') || matchesAnyGlob(cardKey, appliesTo);
}

/**
 * @param hasBinding - spec keys that have ≥1 @spec code_link evidence row.
 */
export function evaluateBindingPrinciples(
  cards: BindingCardNode[],
  hasBinding: Set<string>,
  rules: BindingPrincipleRule[],
): BindingViolation[] {
  const violations: BindingViolation[] = [];
  if (rules.length === 0) return violations;

  for (const rule of rules) {
    for (const card of cards) {
      if (card.type !== 'spec') continue; // only spec cards carry @spec bindings
      if (card.status === 'draft') continue;
      if (!inScope(card.key, rule.appliesTo)) continue;
      if (rule.exemptions && rule.exemptions.length > 0 && matchesAnyGlob(card.key, rule.exemptions)) continue;

      if (!hasBinding.has(card.key)) {
        violations.push({
          principleKey: rule.key,
          cardKey: card.key,
          enforcement: rule.enforcement,
          message: `spec card "${card.key}" has no @spec source-binding evidence (required by binding principle "${rule.key}")`,
        });
      }
    }
  }
  return violations;
}
