import { describe, expect, it } from 'bun:test';
import { validateSpecRefs } from './validate-refs';
import { CardValidationError } from '../card/errors';
import type { BriefBody, CardFrontmatter, SpecBody } from '../card/types';

function makeFm(overrides: Partial<CardFrontmatter> = {}): CardFrontmatter {
  return {
    key: 'test',
    summary: 's',
    status: 'draft',
    type: 'spec',
    codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }],
    ...overrides,
  };
}

function makeSpecBody(overrides: Partial<SpecBody> = {}): SpecBody {
  const base: SpecBody = {
    preconditions: [
      {
        id: 'PRE-001',
        condition: 'cond',
        binds: [{ file: 'src/a.ts', symbol: 'foo' }],
        derives: 'parent-brief#R-001',
      },
    ],
    postconditions: [
      {
        id: 'POST-001',
        guarantee: 'g',
        keyword: 'MUST',
        binds: [{ file: 'src/a.ts', symbol: 'foo' }],
        derives: 'parent-brief#R-001',
      },
    ],
    invariants: [
      {
        id: 'INV-001',
        statement: 's',
        binds: [{ file: 'src/a.ts', symbol: 'foo' }],
        always_holds: 'per-call',
      },
    ],
    failures: [
      {
        violation: 'v',
        behavior: 'b',
        exception: { class: 'E', file: 'src/errors.ts' },
      },
    ],
  };
  return { ...base, ...overrides };
}

describe('validateSpecRefs', () => {
  it('accepts a valid spec body without brief lookup', () => {
    expect(() => validateSpecRefs(makeSpecBody(), makeFm())).not.toThrow();
  });

  it('requires at least one precondition', () => {
    const body = makeSpecBody({ preconditions: [] });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/preconditions.*at least 1/);
  });

  it('requires at least one postcondition', () => {
    const body = makeSpecBody({ postconditions: [] });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/postconditions.*at least 1/);
  });

  it('requires at least one invariant', () => {
    const body = makeSpecBody({ invariants: [] });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/invariants.*at least 1/);
  });

  it('requires at least one failure', () => {
    const body = makeSpecBody({ failures: [] });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/failures.*at least 1/);
  });

  it('rejects binds referencing symbol not in codeLinks', () => {
    const body = makeSpecBody({
      preconditions: [
        {
          id: 'PRE-001',
          condition: 'c',
          binds: [{ file: 'src/a.ts', symbol: 'unknown' }],
          derives: 'b#R-001',
        },
      ],
    });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/binds references "src\/a\.ts::unknown"/);
  });

  it('rejects binds referencing file not in codeLinks', () => {
    const body = makeSpecBody({
      invariants: [
        {
          id: 'INV-001',
          statement: 's',
          binds: [{ file: 'src/other.ts', symbol: 'foo' }],
          always_holds: 'per-call',
        },
      ],
    });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/binds references "src\/other\.ts::foo"/);
  });

  it('rejects derives without "brief-key#item-id" format', () => {
    const body = makeSpecBody({
      preconditions: [
        {
          id: 'PRE-001',
          condition: 'c',
          binds: [{ file: 'src/a.ts', symbol: 'foo' }],
          derives: 'R-001-no-hash',
        },
      ],
    });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(/derives.*format/);
  });

  it('rejects derives referencing unknown brief when lookup provided', () => {
    const body = makeSpecBody();
    const lookup = (_key: string): BriefBody | null => null;
    expect(() => validateSpecRefs(body, makeFm(), lookup)).toThrow(/unknown brief "parent-brief"/);
  });

  it('rejects derives referencing unknown item in known brief', () => {
    const body = makeSpecBody({
      preconditions: [
        {
          id: 'PRE-001',
          condition: 'c',
          binds: [{ file: 'src/a.ts', symbol: 'foo' }],
          derives: 'parent-brief#R-999',
        },
      ],
    });
    const fakeBrief: BriefBody = {
      context: { problem: 'p', impact: [] },
      scope: { goals: [{ id: 'G-001', statement: 'g' }], non_goals: [], assumptions: [] },
      flow: [],
      design: { overview: 'o', components: [], data_flow: [], invariants: [] },
      policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: [] }],
      external: [],
      compatibility: { guarantees: [] },
      limits: [],
      criteria: [],
      rationale: {
        alternatives: [
          { option: 'A', pros: ['p'], cons: ['c'] },
          { option: 'B', pros: ['p'], cons: ['c'] },
        ],
        chosen: { option: 'A', reasoning: 'r' },
        addresses: [],
      },
    };
    const lookup = (_key: string): BriefBody | null => fakeBrief;
    expect(() => validateSpecRefs(body, makeFm(), lookup)).toThrow(/unknown item "R-999"/);
  });

  it('throws CardValidationError type on failure', () => {
    const body = makeSpecBody({ preconditions: [] });
    expect(() => validateSpecRefs(body, makeFm())).toThrow(CardValidationError);
  });
});
