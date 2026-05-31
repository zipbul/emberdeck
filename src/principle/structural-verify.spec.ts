/**
 * Structural verify engine — pure predicate evaluation over the card graph.
 */
import { describe, expect, it } from 'bun:test';
import {
  evaluateStructuralPrinciples,
  type StructuralCardNode,
  type StructuralPrincipleRule,
} from './structural-verify';

const rels = (entries: Array<[string, string[]]>) => new Map<string, string[]>(entries);

describe('requires-child-type', () => {
  const rule: StructuralPrincipleRule = {
    key: 'domains-have-briefs',
    appliesTo: ['*'],
    enforcement: 'blocking',
    predicate: { kind: 'requires-child-type', childType: 'brief' },
  };

  it('flags an in-scope card with no child of the required type', () => {
    const cards: StructuralCardNode[] = [
      { key: 'dom-a', type: 'domain', status: 'active', parent: null },
    ];
    const v = evaluateStructuralPrinciples(cards, rels([]), [rule]);
    expect(v).toHaveLength(1);
    expect(v[0]?.cardKey).toBe('dom-a');
    expect(v[0]?.enforcement).toBe('blocking');
  });

  it('passes when the required child type is present', () => {
    const cards: StructuralCardNode[] = [
      { key: 'dom-a', type: 'domain', status: 'active', parent: null },
      { key: 'dom-a/b', type: 'brief', status: 'active', parent: 'dom-a' },
    ];
    expect(evaluateStructuralPrinciples(cards, rels([]), [rule])).toHaveLength(0);
  });

  it('skips draft cards', () => {
    const cards: StructuralCardNode[] = [
      { key: 'dom-a', type: 'domain', status: 'draft', parent: null },
    ];
    expect(evaluateStructuralPrinciples(cards, rels([]), [rule])).toHaveLength(0);
  });

  it('respects applies_to scope (only in-scope cards checked)', () => {
    const scoped: StructuralPrincipleRule = { ...rule, appliesTo: ['core/*'] };
    const cards: StructuralCardNode[] = [
      { key: 'other-dom', type: 'domain', status: 'active', parent: null },
      { key: 'core/x', type: 'domain', status: 'active', parent: null },
    ];
    const v = evaluateStructuralPrinciples(cards, rels([]), [scoped]);
    expect(v.map((x) => x.cardKey)).toEqual(['core/x']);
  });
});

describe('forbids-relation-to', () => {
  const rule: StructuralPrincipleRule = {
    key: 'no-cross-coupling',
    appliesTo: ['a/*'],
    enforcement: 'warning',
    predicate: { kind: 'forbids-relation-to', targetGlob: 'b/*' },
  };

  it('flags a forbidden relation target', () => {
    const cards: StructuralCardNode[] = [
      { key: 'a/x', type: 'brief', status: 'active', parent: null },
    ];
    const v = evaluateStructuralPrinciples(cards, rels([['a/x', ['b/y', 'a/z']]]), [rule]);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('b/y');
    expect(v[0]?.enforcement).toBe('warning');
  });

  it('allows relations that do not match the forbidden glob', () => {
    const cards: StructuralCardNode[] = [
      { key: 'a/x', type: 'brief', status: 'active', parent: null },
    ];
    expect(evaluateStructuralPrinciples(cards, rels([['a/x', ['a/z', 'c/w']]]), [rule])).toHaveLength(0);
  });
});

it('returns nothing when there are no rules', () => {
  expect(evaluateStructuralPrinciples([{ key: 'k', type: 'domain', status: 'active', parent: null }], new Map(), [])).toEqual([]);
});
