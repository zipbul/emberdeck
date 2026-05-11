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

  it.each(['draft', 'active', 'drifted', 'retired'])('accepts status=%s', (status) => {
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

  it('parses boundary glob array', () => {
    const result = parseCard(makeCard({ boundary: ['src/auth/**', 'lib/*.ts'] }));
    expect(result.frontmatter.boundary).toEqual(['src/auth/**', 'lib/*.ts']);
  });

  it('returns undefined boundary when absent', () => {
    const result = parseCard(makeCard());
    expect(result.frontmatter.boundary).toBeUndefined();
  });

  it('parses all optional fields together', () => {
    const result = parseCard(makeCard({
      parent: 'p',
      tags: ['t1'],
      relations: ['other'],
      boundary: ['src/**'],
    }));
    expect(result.frontmatter.tags).toEqual(['t1']);
    expect(result.frontmatter.relations).toEqual(['other']);
    expect(result.frontmatter.parent).toBe('p');
    expect(result.frontmatter.boundary).toEqual(['src/**']);
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
    { boundary: 123 },
    { boundary: [''] },
  ])('throws on invalid optional field shape: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });
});

// ── codeLinks ──────────────────────────────────────────────────────────

describe('parseCard — codeLinks', () => {
  it('parses single codeLink', () => {
    const result = parseCard(makeCard({
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' }],
    }));
    expect(result.frontmatter.codeLinks).toEqual([
      { kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' },
    ]);
  });

  it('parses multiple codeLinks', () => {
    const links = [
      { kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' },
      { kind: 'class', file: 'src/auth/TokenService.ts', symbol: 'TokenService' },
    ];
    const result = parseCard(makeCard({ codeLinks: links }));
    expect(result.frontmatter.codeLinks).toEqual(links);
  });

  it('preserves codeLinks order', () => {
    const result = parseCard(makeCard({
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'alpha' },
        { kind: 'class', file: 'src/b.ts', symbol: 'beta' },
      ],
    }));
    expect(result.frontmatter.codeLinks![0]!.symbol).toBe('alpha');
    expect(result.frontmatter.codeLinks![1]!.symbol).toBe('beta');
  });

  it('returns undefined when codeLinks absent', () => {
    const result = parseCard(makeCard());
    expect(result.frontmatter.codeLinks).toBeUndefined();
  });

  it('returns undefined when codeLinks is null', () => {
    const result = parseCard(makeCard({ codeLinks: null }));
    expect(result.frontmatter.codeLinks).toBeUndefined();
  });

  it('returns empty array when codeLinks is []', () => {
    const result = parseCard(makeCard({ codeLinks: [] }));
    expect(result.frontmatter.codeLinks).toEqual([]);
  });

  it('parses codeLinks with relations alongside', () => {
    const result = parseCard(makeCard({
      relations: ['other'],
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }],
    }));
    expect(result.frontmatter.relations).toEqual(['other']);
    expect(result.frontmatter.codeLinks).toEqual([{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }]);
  });

  it.each([
    { codeLinks: 42 },
    { codeLinks: { kind: 'function' } },
    { codeLinks: [null] },
    { codeLinks: [{ kind: '', file: 'src/a.ts', symbol: 'foo' }] },
    { codeLinks: [{ file: 'src/a.ts', symbol: 'foo' }] },
    { codeLinks: [{ kind: 'function', file: '', symbol: 'foo' }] },
    { codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: '' }] },
    {
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'foo' },
        { kind: '', file: 'src/b.ts', symbol: 'bar' },
      ],
    },
  ])('throws on invalid codeLinks shape: %p', (override) => {
    expect(() => parseCard(makeCard(override))).toThrow(CardValidationError);
  });
});

// ── serializeCard ──────────────────────────────────────────────────────

describe('serializeCard', () => {
  it('emits canonical JSON with 2-space indent', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    const result = serializeCard(fm);
    expect(result.startsWith('{\n  "key": "k"')).toBe(true);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('emits codeLinks when present', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' }],
    };
    const result = serializeCard(fm);
    expect(result).toContain('"codeLinks"');
    expect(result).toContain('"refreshToken"');
  });

  it('omits codeLinks when absent', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    const result = serializeCard(fm);
    expect(result).not.toContain('"codeLinks"');
  });

  it('emits tags when present', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'spec', tags: ['t1', 't2'],
    };
    const result = serializeCard(fm);
    expect(result).toContain('"t1"');
    expect(result).toContain('"t2"');
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
      boundary: ['src/api/**'],
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
    expect(reparsed.frontmatter.boundary).toEqual(original.boundary);
  });

  it('round-trip: codeLinks survive', () => {
    const original: CardFrontmatter = {
      key: 'auth/token',
      summary: 'Token spec',
      status: 'active',
      type: 'spec',
      codeLinks: [
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'refreshToken' },
        { kind: 'class', file: 'src/auth/TokenService.ts', symbol: 'TokenService' },
      ],
    };
    const reparsed = parseCard(serializeCard(original));
    expect(reparsed.frontmatter.codeLinks).toEqual(original.codeLinks);
  });

  it('round-trip: serialize is idempotent (canonical key ordering)', () => {
    const fm: CardFrontmatter = {
      key: 'k', summary: 's', status: 'draft', type: 'spec',
      tags: ['t1'], parent: 'p', boundary: ['src/**'],
    };
    const first = serializeCard(fm);
    const second = serializeCard(parseCard(first).frontmatter);
    expect(second).toBe(first);
  });
});
