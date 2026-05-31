import { describe, expect, it } from 'bun:test';
import { validateBriefRefs } from './validate-refs';
import { CardValidationError } from '../card/errors';
import type { BriefBody } from '../card/types';

function makeBriefBody(overrides: Partial<BriefBody> = {}): BriefBody {
  const base: BriefBody = {
    context: { problem: 'p', impact: [{ statement: 'i' }] },
    scope: {
      goals: [{ id: 'G-001', statement: 'g' }],
      non_goals: [],
      assumptions: [],
    },
    flow: [
      { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
    ],
    approach: 'o',
    policy: [
      { id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01', 'S-F-01'] },
    ],
    external: [{ id: 'C-001', statement: 's', reference: { title: 't', locator: 'l' } }],
    limits: [{ id: 'KL-001', statement: 'lim' }],
    criteria: [
      { id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-01', 'S-F-01'] },
    ],
    rationale: {
      alternatives: [
        { option: 'A', pros: ['p1'], cons: ['c1'] },
        { option: 'B', pros: ['p2'], cons: ['c2'] },
      ],
      chosen: { option: 'A', reasoning: 'r' },
      addresses: ['C-001'],
    },
  };
  return { ...base, ...overrides };
}

describe('validateBriefRefs', () => {
  it('accepts a valid brief body', () => {
    expect(() => validateBriefRefs(makeBriefBody())).not.toThrow();
  });

  it('rejects flow.covers referencing unknown goal', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-999'] },
        { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(/unknown goal "G-999"/);
  });

  it('rejects policy.governs referencing unknown flow', () => {
    const body = makeBriefBody({
      policy: [
        { id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-99'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(/unknown flow "S-H-99"/);
  });

  it('rejects criteria.verifies referencing unknown flow', () => {
    const body = makeBriefBody({
      criteria: [
        { id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-99'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(/unknown flow "S-H-99"/);
  });

  it('rejects rationale.addresses referencing unknown external/limit', () => {
    const body = makeBriefBody({
      rationale: {
        alternatives: [
          { option: 'A', pros: ['p'], cons: ['c'] },
          { option: 'B', pros: ['p'], cons: ['c'] },
        ],
        chosen: { option: 'A', reasoning: 'r' },
        addresses: ['UNKNOWN-001'],
      },
    });
    expect(() => validateBriefRefs(body)).toThrow(/unknown external\/limit "UNKNOWN-001"/);
  });

  it('requires at least one happy scenario', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
      policy: [
        { id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-F-01'] },
      ],
      criteria: [
        { id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-F-01'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(/at least 1 happy scenario/);
  });

  it('requires at least one failure scenario', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
      policy: [
        { id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01'] },
      ],
      criteria: [
        { id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-01'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(/at least 1 failure scenario/);
  });

  it('requires every goal to be covered by a flow', () => {
    const body = makeBriefBody({
      scope: {
        goals: [
          { id: 'G-001', statement: 'g1' },
          { id: 'G-002', statement: 'g2 (uncovered)' },
        ],
        non_goals: [],
        assumptions: [],
      },
    });
    expect(() => validateBriefRefs(body)).toThrow(/G-002.*not covered by any flow/);
  });

  it('requires every flow to be governed by a policy', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
        { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
        { id: 'S-H-02', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
      // policy only governs S-H-01 and S-F-01
    });
    // Add criteria for S-H-02 so we hit governs check first
    body.criteria.push({ id: 'SC-002', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-02'] });
    expect(() => validateBriefRefs(body)).toThrow(/S-H-02.*not governed by any policy/);
  });

  it('requires every flow to be verified by a criterion', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
        { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
        { id: 'S-H-02', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
      policy: [
        {
          id: 'R-001',
          subject: 's',
          keyword: 'MUST',
          predicate: 'p',
          governs: ['S-H-01', 'S-F-01', 'S-H-02'],
        },
      ],
      // criteria only verifies S-H-01 and S-F-01
    });
    expect(() => validateBriefRefs(body)).toThrow(/S-H-02.*not verified by any criterion/);
  });

  it('throws CardValidationError type on failure', () => {
    const body = makeBriefBody({
      flow: [
        { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-999'] },
        { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      ],
    });
    expect(() => validateBriefRefs(body)).toThrow(CardValidationError);
  });
});
