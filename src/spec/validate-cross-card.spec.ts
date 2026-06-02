import { describe, expect, it } from 'bun:test';
import { collectSpecCrossCardErrors, type SpecNode } from './validate-cross-card';
import type { CardType, SpecBody } from '../card/types';

function spec(over: Partial<SpecBody> = {}): SpecBody {
  return {
    preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'b#G-001' }],
    postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'b#G-001' }],
    invariants: [{ id: 'INV-001', statement: 's', always_holds: 'per-call' }],
    failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b' }],
    ...over,
  };
}
const node = (key: string, s: SpecBody, status = 'active'): SpecNode => ({ key, status, spec: s });
const types = (entries: Array<[string, CardType]>) => new Map<string, CardType>(entries);

describe('invokes[].to', () => {
  it('passes when target exists and is a spec', () => {
    const n = [node('a', spec({ invokes: [{ to: 'b', kind: 'per-call' }] })), node('b', spec())];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']]))).toEqual([]);
  });
  it('flags a nonexistent invoke target', () => {
    const n = [node('a', spec({ invokes: [{ to: 'ghost', kind: 'per-call' }] }))];
    const r = collectSpecCrossCardErrors(n, types([['a', 'spec']]));
    expect(r.some((i) => i.code === 'broken-invoke' && /does not exist/.test(i.message))).toBe(true);
  });
  it('flags an invoke target that is not a spec', () => {
    const n = [node('a', spec({ invokes: [{ to: 'dom', kind: 'per-call' }] }))];
    const r = collectSpecCrossCardErrors(n, types([['a', 'spec'], ['dom', 'domain']]));
    expect(r.some((i) => i.code === 'broken-invoke' && /expected "spec"/.test(i.message))).toBe(true);
  });
});

describe('SHP deck-global uniqueness', () => {
  it('flags a duplicate SHP id across two specs', () => {
    const sh = { id: 'SHP-001', role: 'output' as const, schema: 'x' };
    const n = [node('a', spec({ shapes: [sh] })), node('b', spec({ shapes: [sh] }))];
    const r = collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']]));
    expect(r.filter((i) => i.code === 'duplicate-shape-id')).toHaveLength(2);
  });
  it('allows unique SHP ids', () => {
    const n = [
      node('a', spec({ shapes: [{ id: 'SHP-001', role: 'output', schema: 'x' }] })),
      node('b', spec({ shapes: [{ id: 'SHP-002', role: 'output', schema: 'y' }] })),
    ];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']]))).toEqual([]);
  });
});

describe('postconditions[].references → SHP', () => {
  it('passes when the SHP is declared by some spec', () => {
    const n = [
      node('a', spec({ postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'b#G-001', references: 'SHP-001' }] })),
      node('b', spec({ shapes: [{ id: 'SHP-001', role: 'output', schema: 'x' }] })),
    ];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']]))).toEqual([]);
  });
  it('flags a reference to an undeclared SHP', () => {
    const n = [node('a', spec({ postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'b#G-001', references: 'SHP-999' }] }))];
    const r = collectSpecCrossCardErrors(n, types([['a', 'spec']]));
    expect(r.some((i) => i.code === 'broken-shape-ref')).toBe(true);
  });
});

describe('failures[].owner / references', () => {
  it('passes when owner is a spec and references an existing FAIL there', () => {
    const n = [
      node('a', spec({ failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', owner: 'b', references: 'FAIL-007' }] })),
      node('b', spec({ failures: [{ id: 'FAIL-007', violation: 'v', behavior: 'b' }] })),
    ];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']]))).toEqual([]);
  });
  it('flags owner that does not exist / is not a spec', () => {
    const n = [node('a', spec({ failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', owner: 'ghost' }] }))];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec']])).some((i) => i.code === 'broken-failure-owner')).toBe(true);
  });
  it('flags references without an owner', () => {
    const n = [node('a', spec({ failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', references: 'FAIL-007' }] }))];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec']])).some((i) => i.code === 'broken-failure-ref' && /requires an owner/.test(i.message))).toBe(true);
  });
  it('flags references not found in the owner spec', () => {
    const n = [
      node('a', spec({ failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', owner: 'b', references: 'FAIL-999' }] })),
      node('b', spec({ failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b' }] })),
    ];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec'], ['b', 'spec']])).some((i) => i.code === 'broken-failure-ref' && /not found in owner/.test(i.message))).toBe(true);
  });
});

describe('draft handling', () => {
  it('skips draft specs (subject and registry)', () => {
    const n = [node('a', spec({ invokes: [{ to: 'ghost', kind: 'per-call' }] }), 'draft')];
    expect(collectSpecCrossCardErrors(n, types([['a', 'spec']]))).toEqual([]);
  });
});
