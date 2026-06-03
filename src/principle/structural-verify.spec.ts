/**
 * Structural verify engine — pure predicate evaluation over the card graph.
 * Sole predicate: forbids-relation-to (boundary enforcement over the union of
 * relations / cross_domain_dependencies / invokes edges).
 */
import { describe, expect, it } from 'bun:test';
import {
  evaluateStructuralPrinciples,
  type StructuralCardNode,
  type StructuralPrincipleRule,
} from './structural-verify';

const edges = (entries: Array<[string, string[]]>) => new Map<string, string[]>(entries);

describe('forbids-relation-to', () => {
  const rule: StructuralPrincipleRule = {
    key: 'no-cross-coupling',
    appliesTo: ['a/*'],
    enforcement: 'warning',
    predicate: { kind: 'forbids-relation-to', targetGlob: 'b/*' },
  };
  const cards: StructuralCardNode[] = [{ key: 'a/x', type: 'brief', status: 'active', parent: null }];

  it('flags a forbidden edge target (from the unioned edge set)', () => {
    const v = evaluateStructuralPrinciples(cards, edges([['a/x', ['b/y', 'a/z']]]), [rule]);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('b/y');
    expect(v[0]?.enforcement).toBe('warning');
  });

  it('allows edges that do not match the forbidden glob', () => {
    expect(evaluateStructuralPrinciples(cards, edges([['a/x', ['a/z', 'c/w']]]), [rule])).toHaveLength(0);
  });

  it('respects applies_to scope (only in-scope cards checked)', () => {
    const scoped = [
      { key: 'a/x', type: 'brief' as const, status: 'active', parent: null },
      { key: 'other', type: 'brief' as const, status: 'active', parent: null },
    ];
    const v = evaluateStructuralPrinciples(scoped, edges([['a/x', ['b/y']], ['other', ['b/z']]]), [rule]);
    expect(v.map((x) => x.cardKey)).toEqual(['a/x']);
  });

  it('skips draft cards', () => {
    const draft = [{ key: 'a/x', type: 'brief' as const, status: 'draft', parent: null }];
    expect(evaluateStructuralPrinciples(draft, edges([['a/x', ['b/y']]]), [rule])).toHaveLength(0);
  });

  it('skips exempted cards (principle.exemptions)', () => {
    const exempted = { ...rule, exemptions: ['a/x'] };
    expect(evaluateStructuralPrinciples(cards, edges([['a/x', ['b/y']]]), [exempted])).toHaveLength(0);
  });
});

it('returns nothing when there are no rules', () => {
  expect(evaluateStructuralPrinciples([{ key: 'k', type: 'domain', status: 'active', parent: null }], new Map(), [])).toEqual([]);
});
