import { describe, expect, it } from 'bun:test';
import { validateSpecRefs, collectSpecDeriveErrors } from './validate-refs';
import { CardValidationError } from '../card/errors';
import type { BriefBody, SpecBody } from '../card/types';

function makeSpecBody(overrides: Partial<SpecBody> = {}): SpecBody {
  const base: SpecBody = {
    preconditions: [
      { id: 'PRE-001', condition: 'cond', derives: 'parent-brief#G-001' },
    ],
    postconditions: [
      { id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent-brief#G-001' },
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
      scope: { goals: [{ id: 'G-001', statement: 'g' }], non_goals: [], assumptions: [] },
      flow: [],
      approach: '',
      policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: [] }],
      external: [],
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

describe('collectSpecDeriveErrors — deck-wide broken-derives surface (§10 P1.4b)', () => {
  function briefWith(): BriefBody {
    return {
      context: { problem: '', impact: [] },
      scope: {
        goals: [{ id: 'G-001', statement: 'g' }],
        non_goals: [],
        assumptions: [],
      },
      flow: [{ id: 'S-F-01', kind: 'failure', given: 'g', when: 'w', then: 't', covers: ['G-001'] }],
      approach: '',
      policy: [],
      external: [],
      limits: [],
      criteria: [],
      rationale: {
        alternatives: [{ option: 'a', pros: [], cons: [] }, { option: 'b', pros: [], cons: [] }],
        chosen: { option: 'a', reasoning: 'r' },
        addresses: [],
      },
    };
  }
  const lookup = (k: string) => (k === 'pb' ? briefWith() : null);
  const validPrePost = {
    preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'pb#G-001' }],
    postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST' as const, derives: 'pb#G-001' }],
  };

  it('returns [] for valid pre/post derives resolving to brief goals', () => {
    expect(collectSpecDeriveErrors(makeSpecBody(validPrePost), lookup)).toEqual([]);
  });

  it('flags derives to a non-existent brief goal', () => {
    const spec = makeSpecBody({ ...validPrePost, preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'pb#G-999' }] });
    expect(collectSpecDeriveErrors(spec, lookup).some((e) => /"G-999" which is not a goal/.test(e))).toBe(true);
  });

  it('rejects derives pointing at a flow id (type discipline: derives→goal only)', () => {
    const spec = makeSpecBody({ ...validPrePost, preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'pb#S-F-01' }] });
    expect(collectSpecDeriveErrors(spec, lookup).some((e) => /"S-F-01" which is not a goal/.test(e))).toBe(true);
  });

  it('flags derives to an unknown brief', () => {
    const spec = makeSpecBody({ ...validPrePost, preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'nope#G-001' }] });
    expect(collectSpecDeriveErrors(spec, lookup).some((e) => /unknown brief/.test(e))).toBe(true);
  });

  it('validates failures.case_of → brief failure-flow (S-F) [v18]', () => {
    const ok = makeSpecBody({ ...validPrePost, failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', case_of: 'pb#S-F-01' }] });
    expect(collectSpecDeriveErrors(ok, lookup)).toEqual([]);
    const bad = makeSpecBody({ ...validPrePost, failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', case_of: 'pb#S-F-99' }] });
    expect(collectSpecDeriveErrors(bad, lookup).some((e) => /"S-F-99" which is not a failure-flow/.test(e))).toBe(true);
  });

  it('rejects case_of pointing at a goal id (type discipline: case_of→failure-flow only)', () => {
    const bad = makeSpecBody({ ...validPrePost, failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', case_of: 'pb#G-001' }] });
    expect(collectSpecDeriveErrors(bad, lookup).some((e) => /"G-001" which is not a failure-flow/.test(e))).toBe(true);
  });

  it('ignores failures without case_of', () => {
    expect(collectSpecDeriveErrors(makeSpecBody(validPrePost), lookup)).toEqual([]);
  });

  it('only checks format when no briefLookup is given', () => {
    expect(collectSpecDeriveErrors(makeSpecBody(validPrePost))).toEqual([]);
    const bad = makeSpecBody({ ...validPrePost, preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'bad' }] });
    expect(collectSpecDeriveErrors(bad).some((e) => /must follow/.test(e))).toBe(true);
  });
});
