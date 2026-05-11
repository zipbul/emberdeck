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
});
