import { describe, expect, it } from 'bun:test';
import { evaluateBindingPrinciples, type BindingCardNode, type BindingPrincipleRule } from './binding-verify';
import type { CardType } from '../card/types';

const node = (key: string, type: CardType = 'spec', status = 'active'): BindingCardNode => ({ key, type, status });
const rule = (over: Partial<BindingPrincipleRule> = {}): BindingPrincipleRule => ({
  key: 'must-bind', appliesTo: ['sec/*'], enforcement: 'blocking', ...over,
});

describe('evaluateBindingPrinciples', () => {
  it('flags an in-scope spec with no @spec binding evidence', () => {
    const v = evaluateBindingPrinciples([node('sec/a')], new Set<string>(), [rule()]);
    expect(v).toHaveLength(1);
    expect(v[0]?.cardKey).toBe('sec/a');
    expect(v[0]?.enforcement).toBe('blocking');
  });

  it('passes a governed spec that has @spec binding evidence', () => {
    expect(evaluateBindingPrinciples([node('sec/a')], new Set(['sec/a']), [rule()])).toHaveLength(0);
  });

  it('only checks spec cards (a brief in scope is unbindable, skipped)', () => {
    expect(evaluateBindingPrinciples([node('sec/b', 'brief')], new Set<string>(), [rule()])).toHaveLength(0);
  });

  it('skips draft specs', () => {
    expect(evaluateBindingPrinciples([node('sec/a', 'spec', 'draft')], new Set<string>(), [rule()])).toHaveLength(0);
  });

  it('respects applies_to scope', () => {
    const v = evaluateBindingPrinciples([node('sec/a'), node('other/x')], new Set<string>(), [rule()]);
    expect(v.map((x) => x.cardKey)).toEqual(['sec/a']);
  });

  it('skips exempted specs', () => {
    expect(evaluateBindingPrinciples([node('sec/a')], new Set<string>(), [rule({ exemptions: ['sec/a'] })])).toHaveLength(0);
  });

  it('returns nothing with no rules', () => {
    expect(evaluateBindingPrinciples([node('sec/a')], new Set<string>(), [])).toEqual([]);
  });
});
