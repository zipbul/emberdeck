import { describe, it, expect } from 'bun:test';
import jsyaml from 'js-yaml';
import { parseCard, serializeCard } from './serialize';
import { CardValidationError } from './errors';
import type { CardFrontmatter } from './types';

function makeCard(overrides: Partial<Record<string, unknown>> = {}): string {
  const fm: Record<string, unknown> = {
    key: 'test/card',
    summary: 'A test card',
    status: 'draft',
    type: 'spec',
    ...overrides,
  };
  for (const k of Object.keys(fm)) {
    if (fm[k] === undefined) delete fm[k];
  }
  return `---\n${jsyaml.dump(fm)}---\n`;
}

// ── parseCard — required and common fields ─────────────────────────────

describe('parseCard', () => {
  it('parses minimal valid card', () => {
    const result = parseCard(makeCard());
    expect(result.frontmatter.key).toBe('test/card');
    expect(result.frontmatter.summary).toBe('A test card');
    expect(result.frontmatter.status).toBe('draft');
    expect(result.frontmatter.type).toBe('spec');
  });

  it.each(['draft', 'active', 'drifted'])('accepts status=%s', (status) => {
    const result = parseCard(makeCard({ status }));
    expect(result.frontmatter.status).toBe(status);
  });

  it.each(['principle', 'domain', 'brief', 'spec'])('accepts type=%s', (type) => {
    const result = parseCard(makeCard({ type }));
    expect(result.frontmatter.type).toBe(type);
  });

  it('parses parent', () => {
    const result = parseCard(makeCard({ parent: 'parent/card' }));
    expect(result.frontmatter.parent).toBe('parent/card');
  });

  it('returns undefined parent when absent', () => {
    const result = parseCard(makeCard());
    expect(result.frontmatter.parent).toBeUndefined();
  });

  it('parses tags', () => {
    const result = parseCard(makeCard({ tags: ['alpha', 'beta'] }));
    expect(result.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('normalizes tags to lowercase', () => {
    const result = parseCard(makeCard({ tags: ['Alpha', 'BETA'] }));
    expect(result.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('parses empty tags array', () => {
    const result = parseCard(makeCard({ tags: [] }));
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('parses relations', () => {
    const result = parseCard(makeCard({ relations: ['other/card'] }));
    expect(result.frontmatter.relations).toEqual(['other/card']);
  });

  it('parses empty relations array', () => {
    const result = parseCard(makeCard({ relations: [] }));
    expect(result.frontmatter.relations).toEqual([]);
  });

  it('parses all optional fields together', () => {
    const result = parseCard(makeCard({
      parent: 'p',
      tags: ['t1'],
      relations: ['other'],
      }));
    expect(result.frontmatter.tags).toEqual(['t1']);
    expect(result.frontmatter.relations).toEqual(['other']);
    expect(result.frontmatter.parent).toBe('p');
  });

  it('returns identical result on repeated parse', () => {
    const text = makeCard({ tags: ['x'] });
    const first = parseCard(text);
    const second = parseCard(text);
    expect(first.frontmatter).toEqual(second.frontmatter);
  });
});

// ── parseCard — error paths ────────────────────────────────────────────

describe('parseCard — errors', () => {
  it('throws on empty input (no frontmatter delimiters)', () => {
    expect(() => parseCard('')).toThrow(CardValidationError);
  });

  it('throws on missing closing delimiter', () => {
    expect(() => parseCard('---\nkey: x\n')).toThrow(CardValidationError);
  });

  it('throws on invalid YAML inside frontmatter', () => {
    expect(() => parseCard('---\nkey: [unclosed\n---\n')).toThrow(CardValidationError);
  });

  it('throws on top-level YAML array', () => {
    expect(() => parseCard('---\n- a\n- b\n---\n')).toThrow(CardValidationError);
  });

  it('throws on top-level scalar', () => {
    expect(() => parseCard('---\njust a string\n---\n')).toThrow(CardValidationError);
  });

  it.each([
    { status: undefined },
    { status: 'unknown' },
    { status: 'accepted' },
    { status: 'deprecated' },
  ])('throws on bad status: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });

  it.each([
    { type: undefined },
    { type: 'feature' },
  ])('throws on bad type: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });

  it.each([
    { key: undefined },
    { key: '' },
  ])('throws on bad key: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });

  it.each([
    { summary: undefined },
    { summary: '' },
  ])('throws on bad summary: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });

  it.each([
    { tags: 123 },
    { tags: [123] },
    { relations: 123 },
    { relations: [123] },
    { relations: [null] },
    { relations: [''] },
    { relations: [{ type: 'depends-on', target: 'other' }] },
  ])('throws on invalid optional field shape: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });
});

// ── serializeCard ──────────────────────────────────────────────────────

describe('serializeCard', () => {
  it('emits markdown frontmatter wrapped in --- delimiters', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    const result = serializeCard(fm);
    expect(result.startsWith('---\nkey: k\n')).toBe(true);
    expect(result.endsWith('---\n')).toBe(true);
  });

  it('emits tags when present', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'spec', tags: ['t1', 't2'],
    };
    const result = serializeCard(fm);
    expect(result).toContain('tags:');
    expect(result).toContain('- t1');
    expect(result).toContain('- t2');
  });

  it('round-trip: parse(serialize(x)) preserves all fields', () => {
    const original: CardFrontmatter = {
      key: 'spec/api',
      summary: 'API spec',
      status: 'active',
      type: 'brief',
      tags: ['api', 'v2'],
      relations: ['core/module'],
      parent: 'spec/root',
      };
    const text = serializeCard(original);
    const reparsed = parseCard(text);
    expect(reparsed.frontmatter.key).toBe(original.key);
    expect(reparsed.frontmatter.summary).toBe(original.summary);
    expect(reparsed.frontmatter.status).toBe(original.status);
    expect(reparsed.frontmatter.type).toBe(original.type);
    expect(reparsed.frontmatter.tags).toEqual(original.tags);
    expect(reparsed.frontmatter.relations).toEqual(original.relations);
    expect(reparsed.frontmatter.parent).toBe(original.parent);
  });

  it('round-trip: serialize is idempotent (canonical key ordering)', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'spec',
      tags: ['t1'], parent: 'p', };
    const first = serializeCard(fm);
    const second = serializeCard(parseCard(first).frontmatter);
    expect(second).toBe(first);
  });

  // glossary field round-trip (moved from test/ops/glossary.test.ts —
  // pure parse/serialize, no ctx needed).
  it('round-trip preserves glossary field', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'brief',
      glossary: ['Job', 'Worker'],
    };
    const parsed = parseCard(serializeCard(fm));
    expect(parsed.frontmatter.glossary).toEqual(['Job', 'Worker']);
  });

  it('round-trip omits glossary field when not set', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'brief',
    };
    const parsed = parseCard(serializeCard(fm));
    expect(parsed.frontmatter.glossary).toBeUndefined();
  });
});

// brief.criteria.measure optional-field preservation across all 3 variants
describe('parseCard — brief.criteria.measure optional-field round-trip', () => {
  // Minimal valid brief frontmatter that lets parseCard succeed. Only `criteria` varies.
  function makeBriefWithCriteria(criteria: unknown): string {
    return makeCard({
      type: 'brief',
      parent: 'parent-domain',
      brief: {
        context: { problem: 'p', impact: [{ statement: 's' }] },
        scope: {
          goals: [{ id: 'G-001', statement: 'g' }],
          non_goals: [],
          assumptions: [],
        },
        flow: [
          { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
          { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
        ],
        approach: 'conceptual approach prose',
        policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01'] }],
        external: [{ id: 'C-001', statement: 's', reference: { title: 't', locator: 'l' } }],
        limits: [],
        criteria,
        rationale: {
          alternatives: [
            { option: 'A', pros: ['p'], cons: ['c'] },
            { option: 'B', pros: ['p'], cons: ['c'] },
          ],
          chosen: { option: 'A', reasoning: 'r' },
          addresses: ['C-001'],
        },
      },
    });
  }

  it('binary variant: preserves predicate + optional method + optional reference', () => {
    const yaml = makeBriefWithCriteria([
      { id: 'SC-001', type: 'binary', measure: { predicate: 'P', method: 'M', reference: 'R' }, verifies: ['S-H-01'] },
    ]);
    const parsed = parseCard(yaml);
    const c0 = parsed.frontmatter.brief?.criteria[0];
    if (!c0) throw new Error('brief.criteria[0] missing');
    expect(c0.measure).toEqual({ predicate: 'P', method: 'M', reference: 'R' });
  });

  it('binary variant: minimal (predicate only) survives round-trip without inventing optionals', () => {
    const yaml = makeBriefWithCriteria([
      { id: 'SC-001', type: 'binary', measure: { predicate: 'P' }, verifies: ['S-H-01'] },
    ]);
    const parsed = parseCard(yaml);
    const c0 = parsed.frontmatter.brief?.criteria[0];
    if (!c0) throw new Error('brief.criteria[0] missing');
    expect(c0.measure).toEqual({ predicate: 'P' });
  });

  it('numeric variant: preserves predicate + value + comparator + unit + optional reference', () => {
    const yaml = makeBriefWithCriteria([
      { id: 'SC-001', type: 'numeric', measure: { predicate: 'P', value: 1, comparator: '<=', unit: 'ms', reference: 'R' }, verifies: ['S-H-01'] },
    ]);
    const parsed = parseCard(yaml);
    const c0 = parsed.frontmatter.brief?.criteria[0];
    if (!c0) throw new Error('brief.criteria[0] missing');
    expect(c0.measure).toEqual({ predicate: 'P', value: 1, comparator: '<=', unit: 'ms', reference: 'R' });
  });

  it('verification variant: preserves method + reference + optional predicate + optional unit', () => {
    const yaml = makeBriefWithCriteria([
      { id: 'SC-001', type: 'verification', measure: { method: 'M', reference: 'R', predicate: 'P', unit: 'count' }, verifies: ['S-H-01'] },
    ]);
    const parsed = parseCard(yaml);
    const c0 = parsed.frontmatter.brief?.criteria[0];
    if (!c0) throw new Error('brief.criteria[0] missing');
    expect(c0.measure).toEqual({ method: 'M', reference: 'R', predicate: 'P', unit: 'count' });
  });

  it('full round-trip (parse → serialize → parse) preserves all measure optionals', () => {
    const yaml = makeBriefWithCriteria([
      { id: 'SC-001', type: 'binary', measure: { predicate: 'P', method: 'M', reference: 'R' }, verifies: ['S-H-01'] },
      { id: 'SC-002', type: 'numeric', measure: { predicate: 'Q', value: 5, comparator: '>=', unit: 's', reference: 'R2' }, verifies: ['S-H-01'] },
      { id: 'SC-003', type: 'verification', measure: { method: 'M3', reference: 'R3', predicate: 'P3', unit: 'pct' }, verifies: ['S-H-01'] },
    ]);
    const first = parseCard(yaml);
    const second = parseCard(serializeCard(first.frontmatter));
    if (!first.frontmatter.brief || !second.frontmatter.brief) throw new Error('brief missing');
    expect(second.frontmatter.brief.criteria).toEqual(first.frontmatter.brief.criteria);
  });
});

describe('spec.invariants always_holds enum (v19 / §10 Phase 1.5)', () => {
  function specCard(alwaysHolds: string): string {
    return makeCard({
      type: 'spec',
      parent: 'parent/brief',
      spec: {
        preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'parent#R-001' }],
        postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent#R-001' }],
        invariants: [{ id: 'INV-001', statement: 's', always_holds: alwaysHolds }],
        failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b' }],
      },
    });
  }

  it('accepts per-call', () => {
    const r = parseCard(specCard('per-call'));
    expect(r.frontmatter.spec?.invariants[0]?.always_holds).toBe('per-call');
  });

  it('accepts cross-call', () => {
    const r = parseCard(specCard('cross-call'));
    expect(r.frontmatter.spec?.invariants[0]?.always_holds).toBe('cross-call');
  });

  it('rejects cross-process (removed in v19; MSA-gated re-expansion only)', () => {
    expect(() => parseCard(specCard('cross-process'))).toThrow(CardValidationError);
  });
});

describe('v18 spec schema: shapes[]/invokes[]/failures{id,case_of,owner,references} (§ v18)', () => {
  function v18SpecCard(spec: Record<string, unknown>): string {
    return makeCard({ type: 'spec', parent: 'parent/brief', spec });
  }
  const fullSpec = {
    preconditions: [{ id: 'PRE-001', condition: 'c', derives: 'parent#G-001' }],
    postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent#G-001', references: 'SHP-001' }],
    invariants: [{ id: 'INV-001', statement: 's', always_holds: 'per-call' }],
    failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b', case_of: 'parent#S-F-01', owner: 'other/spec', references: 'FAIL-002' }],
    shapes: [{ id: 'SHP-001', role: 'output' as const, when: 'success', schema: '{ key: string }' }],
    invokes: [{ to: 'alpha/x', kind: 'per-call' as const, note: 'validate' }],
  };

  it('round-trips spec.shapes', () => {
    expect(parseCard(v18SpecCard(fullSpec)).frontmatter.spec?.shapes).toEqual(fullSpec.shapes);
  });

  it('round-trips spec.invokes', () => {
    expect(parseCard(v18SpecCard(fullSpec)).frontmatter.spec?.invokes).toEqual(fullSpec.invokes);
  });

  it('round-trips failures id/case_of/owner/references', () => {
    expect(parseCard(v18SpecCard(fullSpec)).frontmatter.spec?.failures[0]).toEqual(fullSpec.failures[0]);
  });

  it('round-trips postconditions.references (shape-ref)', () => {
    expect(parseCard(v18SpecCard(fullSpec)).frontmatter.spec?.postconditions[0]?.references).toBe('SHP-001');
  });

  it('serialize→parse is stable for v18 fields', () => {
    const first = parseCard(v18SpecCard(fullSpec));
    const second = parseCard(serializeCard(first.frontmatter));
    expect(second.frontmatter.spec).toEqual(first.frontmatter.spec);
  });

  it('rejects invalid shape role', () => {
    expect(() => parseCard(v18SpecCard({ ...fullSpec, shapes: [{ id: 'SHP-001', role: 'bogus', schema: 'x' }] }))).toThrow(CardValidationError);
  });

  it('rejects invalid invoke kind', () => {
    expect(() => parseCard(v18SpecCard({ ...fullSpec, invokes: [{ to: 'x/y', kind: 'bogus' }] }))).toThrow(CardValidationError);
  });

  it('round-trips note? on a cross_domain_dependency (§10 P2.2)', () => {
    const r = parseCard(makeCard({
      type: 'domain',
      domain: { overview: 'o', scope: 's', cross_domain_dependencies: [{ domain: 'other', relationship: 'invokes', note: 'calls subcommands' }] },
    }));
    expect(r.frontmatter.domain?.cross_domain_dependencies?.[0]).toEqual({ domain: 'other', relationship: 'invokes', note: 'calls subcommands' });
  });

  it('omits absent v18 optionals (shapes/invokes/case_of/owner/references); failures.id is required', () => {
    const minimal = {
      preconditions: fullSpec.preconditions,
      postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent#G-001' }],
      invariants: fullSpec.invariants,
      failures: [{ id: 'FAIL-001', violation: 'v', behavior: 'b' }],
    };
    const r = parseCard(v18SpecCard(minimal));
    expect(r.frontmatter.spec?.shapes).toBeUndefined();
    expect(r.frontmatter.spec?.invokes).toBeUndefined();
    expect(r.frontmatter.spec?.failures[0]?.id).toBe('FAIL-001');
    expect(r.frontmatter.spec?.failures[0]?.case_of).toBeUndefined();
    expect(r.frontmatter.spec?.postconditions[0]?.references).toBeUndefined();
  });

  it('rejects a failure with no id (failures.id required)', () => {
    const noId = {
      preconditions: fullSpec.preconditions,
      postconditions: [{ id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent#G-001' }],
      invariants: fullSpec.invariants,
      failures: [{ violation: 'v', behavior: 'b' }],
    };
    expect(() => parseCard(v18SpecCard(noId))).toThrow();
  });
});

describe('brief: approach required, design/compatibility removed (§10 P2.1③ strict)', () => {
  const common = {
    context: { problem: 'p', impact: [{ statement: 's' }] },
    scope: { goals: [{ id: 'G-001', statement: 'g' }], non_goals: [], assumptions: [] },
    flow: [
      { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
    ],
    policy: [{ id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01'] }],
    external: [{ id: 'C-001', statement: 's', reference: { title: 't', locator: 'l' } }],
    limits: [],
    criteria: [],
    rationale: { alternatives: [{ option: 'A', pros: ['p'], cons: ['c'] }, { option: 'B', pros: ['p'], cons: ['c'] }], chosen: { option: 'A', reasoning: 'r' }, addresses: ['C-001'] },
  };
  function briefCard(brief: Record<string, unknown>): string {
    return makeCard({ type: 'brief', parent: 'parent-domain', brief });
  }

  it('accepts a brief with approach present', () => {
    const r = parseCard(briefCard({ ...common, approach: 'conceptual design prose' }));
    expect(r.frontmatter.brief?.approach).toBe('conceptual design prose');
  });

  it('accepts a brief missing approach (optional — design §154 "6 req + 3 opt")', () => {
    const r = parseCard(briefCard({ ...common }));
    expect(r.frontmatter.brief?.approach).toBeUndefined();
  });

  it('ignores legacy design/compatibility keys (no longer surfaced)', () => {
    const r = parseCard(briefCard({ ...common, approach: 'a', design: { overview: 'o', components: [], data_flow: [], invariants: [{ id: 'DI-001', statement: 'inv' }] }, compatibility: { guarantees: [] } }));
    expect(r.frontmatter.brief?.approach).toBe('a');
    expect((r.frontmatter.brief as unknown as Record<string, unknown>).design).toBeUndefined();
    expect((r.frontmatter.brief as unknown as Record<string, unknown>).compatibility).toBeUndefined();
  });

  it('round-trips approach', () => {
    const first = parseCard(briefCard({ ...common, approach: 'X' }));
    const second = parseCard(serializeCard(first.frontmatter));
    expect(second.frontmatter.brief?.approach).toBe('X');
  });
});

describe('principle.verify.class (§5 — verify class + integrity rule)', () => {
  function pcard(principle: Record<string, unknown>): string {
    return makeCard({ type: 'principle', principle });
  }
  const base = { statement: 'X MUST Y', rationale: 'r', applies_to: ['src/**'] };

  const structuralPredicate = { kind: 'forbids-relation-to', targetGlob: 'other/*' };

  it('round-trips verify.class', () => {
    const r = parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'structural', structural: structuralPredicate } }));
    expect(r.frontmatter.principle?.verify?.class).toBe('structural');
  });

  it('rejects invalid verify.class', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'bogus' } }))).toThrow(CardValidationError);
  });

  it('rejects prose class + blocking enforcement (integrity: false enforcement)', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'blocking', verify: { class: 'prose' } }))).toThrow(CardValidationError);
  });

  it('rejects metric class + blocking enforcement (no measurement feed yet)', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'blocking', verify: { class: 'metric' } }))).toThrow(CardValidationError);
  });

  it('allows structural class + blocking enforcement', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'blocking', verify: { class: 'structural', structural: structuralPredicate } }))).not.toThrow();
  });

  it('rejects structural class without a structural predicate', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'structural' } }))).toThrow(CardValidationError);
  });

  it('rejects a structural predicate on a non-structural class', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'prose', structural: structuralPredicate } }))).toThrow(CardValidationError);
  });

  it('rejects an unknown structural predicate kind', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'structural', structural: { kind: 'bogus' } } }))).toThrow(CardValidationError);
  });

  it('round-trips a forbids-relation-to predicate', () => {
    const r = parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'structural', structural: { kind: 'forbids-relation-to', targetGlob: 'other/*' } } }));
    expect(r.frontmatter.principle?.verify?.structural).toEqual({ kind: 'forbids-relation-to', targetGlob: 'other/*' });
  });

  it('allows binding class + blocking enforcement (binding has an engine: @spec evidence)', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'blocking', verify: { class: 'binding' } }))).not.toThrow();
  });

  it('allows prose class with warning enforcement', () => {
    const r = parseCard(pcard({ ...base, enforcement: 'warning', verify: { class: 'prose' } }));
    expect(r.frontmatter.principle?.verify?.class).toBe('prose');
  });

  it('rejects a principle without verify (§5: verify required — no silent hollow principle)', () => {
    expect(() => parseCard(pcard({ ...base, enforcement: 'blocking' }))).toThrow(CardValidationError);
  });
});
