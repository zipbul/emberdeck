import { describe, expect, it } from 'bun:test';
import { validateSpecRefs } from './validate-refs';
import { CardValidationError } from '../card/errors';
import type { BriefBody, SpecBody } from '../card/types';

function makeSpecBody(overrides: Partial<SpecBody> = {}): SpecBody {
  const base: SpecBody = {
    preconditions: [
      { id: 'PRE-001', condition: 'cond', derives: 'parent-brief#R-001' },
    ],
    postconditions: [
      { id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent-brief#R-001' },
    ],
    invariants: [
      { id: 'INV-001', statement: 's', always_holds: 'per-call' },
    ],
    failures: [{ violation: 'v', behavior: 'b' }],
  };
  return { ...base, ...overrides };
}

describe('validateSpecRefs', () => {
  it('passes a well-formed spec body without briefLookup', () => {
    expect(() => validateSpecRefs(makeSpecBody())).not.toThrow();
  });

  it('throws when preconditions are empty', () => {
    expect(() => validateSpecRefs(makeSpecBody({ preconditions: [] }))).toThrow(
      CardValidationError,
    );
  });

  it('throws when postconditions are empty', () => {
    expect(() => validateSpecRefs(makeSpecBody({ postconditions: [] }))).toThrow(
      CardValidationError,
    );
  });

  it('throws when invariants are empty', () => {
    expect(() => validateSpecRefs(makeSpecBody({ invariants: [] }))).toThrow(
      CardValidationError,
    );
  });

  it('throws when failures are empty', () => {
    expect(() => validateSpecRefs(makeSpecBody({ failures: [] }))).toThrow(
      CardValidationError,
    );
  });

  it('rejects malformed derives reference (no #)', () => {
    const body = makeSpecBody({
      preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'no-hash-here' }],
    });
    expect(() => validateSpecRefs(body)).toThrow(/must follow format/);
  });

  it('verifies derives target existence via briefLookup', () => {
    const brief: BriefBody = {
      context: { problem: '', impact: [] },
      scope: { goals: [], non_goals: [], assumptions: [] },
      flow: [],
      design: { overview: '', components: [], data_flow: [], invariants: [] },
      policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: [] }],
      external: [],
      compatibility: { guarantees: [] },
      limits: [],
      criteria: [],
      rationale: {
        alternatives: [
          { option: 'a', pros: [], cons: [] },
          { option: 'b', pros: [], cons: [] },
        ],
        chosen: { option: 'a', reasoning: 'r' },
        addresses: [],
      },
    };
    const lookup = (k: string) => (k === 'parent-brief' ? brief : null);
    expect(() => validateSpecRefs(makeSpecBody(), lookup)).not.toThrow();
  });

  it('rejects derives pointing at an unknown brief', () => {
    expect(() =>
      validateSpecRefs(makeSpecBody(), () => null),
    ).toThrow(/unknown brief/);
  });
});
