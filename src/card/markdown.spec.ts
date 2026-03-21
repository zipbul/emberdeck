import { describe, it, expect } from 'bun:test';
import { parseCardMarkdown, serializeCardMarkdown } from './markdown';
import { CardValidationError } from './errors';
import type { CardFrontmatter } from './types';

// ---- Helpers ----

function makeMarkdown(
  overrides: Partial<Record<string, unknown>> = {},
  body = '',
): string {
  const fm: Record<string, unknown> = {
    key: 'test/card',
    summary: 'A test card',
    status: 'draft',
    type: 'spec',
    ...overrides,
  };
  const yaml = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        const items = v.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return `  - ${Object.entries(item).map(([ik, iv]) => `${ik}: ${iv}`).join('\n    ')}`;
          }
          return `  - ${item}`;
        });
        return `${k}:\n${items.join('\n')}`;
      }
      if (typeof v === 'object' && v !== null) {
        return `${k}: ${JSON.stringify(v)}`;
      }
      return `${k}: ${v}`;
    })
    .join('\n');
  return `---\n${yaml}\n---\n${body}`;
}

// ---- Tests ----

describe('parseCardMarkdown', () => {
  // HP — Happy Path
  it('should parse frontmatter when minimal valid markdown given', () => {
    // Arrange
    const md = makeMarkdown();
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.key).toBe('test/card');
    expect(result.frontmatter.summary).toBe('A test card');
    expect(result.frontmatter.status).toBe('draft');
    expect(result.frontmatter.type).toBe('spec');
  });

  it('should parse status=draft when status is draft', () => {
    const md = makeMarkdown({ status: 'draft' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('draft');
  });

  it('should parse status=active when status is active', () => {
    const md = makeMarkdown({ status: 'active' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('active');
  });

  it('should parse status=drifted when status is drifted', () => {
    const md = makeMarkdown({ status: 'drifted' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('drifted');
  });

  it('should parse type=architecture when type is architecture', () => {
    const md = makeMarkdown({ type: 'architecture' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.type).toBe('architecture');
  });

  it('should parse type=spec when type is spec', () => {
    const md = makeMarkdown({ type: 'spec' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.type).toBe('spec');
  });

  it('should parse tags when tags array given', () => {
    // Arrange
    const md = makeMarkdown({ tags: ['alpha', 'beta'] });
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('should normalize tags to lowercase when uppercase tags given', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ntags:\n  - Alpha\n  - BETA\n---\n`;
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('should parse relations as string array when relations given', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - other/card\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.relations).toEqual(['other/card']);
  });

  it('should parse parent when parent field given', () => {
    const md = makeMarkdown({ parent: 'parent/card' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.parent).toBe('parent/card');
  });

  it('should return undefined parent when parent field absent', () => {
    const md = makeMarkdown();
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.parent).toBeUndefined();
  });

  it('should parse boundary when boundary array given', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nboundary:\n  - src/auth/**\n  - lib/*.ts\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.boundary).toEqual(['src/auth/**', 'lib/*.ts']);
  });

  it('should return undefined boundary when boundary field absent', () => {
    const md = makeMarkdown();
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.boundary).toBeUndefined();
  });

  it('should throw CardValidationError when boundary item is empty string', () => {
    expect(() =>
      parseCardMarkdown(
        "---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nboundary:\n  - ''\n---\n",
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when boundary is not array', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nboundary: 123\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should return body when body is present after frontmatter', () => {
    // Arrange
    const md = makeMarkdown({}, '## Section\nsome content');
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.body).toBe('## Section\nsome content');
  });

  it('should return empty string body when no body after frontmatter', () => {
    const md = makeMarkdown({}, '');
    const result = parseCardMarkdown(md);
    expect(result.body).toBe('');
  });

  it('should normalize CRLF to LF when CRLF line endings given', () => {
    const md = '---\r\nkey: k\r\nsummary: s\r\nstatus: draft\r\ntype: spec\r\n---\r\nbody text';
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.key).toBe('k');
    expect(result.body).toBe('body text');
  });

  it('should include --- in body when --- appears after second delimiter', () => {
    const md = '---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\n---\n---\nThis is body\n---';
    const result = parseCardMarkdown(md);
    expect(result.body).toContain('---');
  });

  it('should return empty tags when tags is empty array', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ntags: []\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('should return empty relations when relations is empty array', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations: []\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.relations).toEqual([]);
  });

  it('should return single-item tags array when single tag given', () => {
    const md = makeMarkdown({ tags: ['only-one'] });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual(['only-one']);
  });

  it('should parse all optional fields together when tags+relations+parent+boundary given', () => {
    // CO — all optional fields
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nparent: p\ntags:\n  - t1\nrelations:\n  - other\nboundary:\n  - src/**\n---\nbody`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual(['t1']);
    expect(result.frontmatter.relations).toEqual(['other']);
    expect(result.frontmatter.parent).toBe('p');
    expect(result.frontmatter.boundary).toEqual(['src/**']);
    expect(result.body).toBe('body');
  });

  // ID
  it('should return identical result when called twice with same input', () => {
    const md = makeMarkdown({ tags: ['x'] }, 'body');
    const first = parseCardMarkdown(md);
    const second = parseCardMarkdown(md);
    expect(first.frontmatter).toEqual(second.frontmatter);
    expect(first.body).toBe(second.body);
  });

  // NE — Negative/Error
  it('should throw CardValidationError when empty string given', () => {
    expect(() => parseCardMarkdown('')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when no --- header', () => {
    expect(() => parseCardMarkdown('no frontmatter here')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when unterminated frontmatter', () => {
    expect(() => parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: spec')).toThrow(
      CardValidationError,
    );
  });

  it('should throw CardValidationError when status is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when status is unknown value', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: unknown\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when old status "accepted" is used', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: accepted\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when old status "deprecated" is used', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: deprecated\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when type is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when type field has invalid value', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: feature\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when key is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nsummary: s\nstatus: draft\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when summary is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nstatus: draft\ntype: spec\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when key is empty string', () => {
    expect(() =>
      parseCardMarkdown("---\nkey: ''\nsummary: s\nstatus: draft\ntype: spec\n---\n"),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when summary is empty string', () => {
    expect(() =>
      parseCardMarkdown("---\nkey: k\nsummary: ''\nstatus: draft\ntype: spec\n---\n"),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when frontmatter is YAML array', () => {
    expect(() =>
      parseCardMarkdown('---\n- item1\n- item2\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw when YAML is invalid syntax', () => {
    // Invalid YAML will throw an error (not necessarily CardValidationError)
    expect(() =>
      parseCardMarkdown('---\n{invalid yaml: [unclosed\n---\n'),
    ).toThrow();
  });

  it('should throw CardValidationError when tags is not array', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ntags: 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when tags contains non-string', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ntags:\n  - 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations is not array', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations: 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is not a string', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - 123\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is null', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - null\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is empty string', () => {
    expect(() =>
      parseCardMarkdown(
        "---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - ''\n---\n",
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is old-style object {type, target}', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - type: depends-on\n    target: other\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when frontmatter is scalar YAML', () => {
    expect(() => parseCardMarkdown('---\njust a string\n---\n')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when first line has trailing space (not exactly ---)', () => {
    expect(() => parseCardMarkdown('--- \nkey: k\nsummary: s\nstatus: draft\ntype: spec\n---\n')).toThrow(
      CardValidationError,
    );
  });

  it('should throw CardValidationError when YAML frontmatter is syntactically invalid', () => {
    // When Bun.YAML.parse fails (e.g. `key: [[`), throw CardValidationError instead of native error
    const md = '---\nkey: [[\n---\nbody';
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });
});

// ── codeLinks parsing ─────────────────────────────────────────────────────

describe('parseCardMarkdown — codeLinks', () => {
  // 1. [HP] single valid codeLink
  it('should parse codeLinks when single valid codeLink given', () => {
    // Arrange
    const md = makeMarkdown({
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' }],
    });
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks).toEqual([
      { kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' },
    ]);
  });

  // 2. [HP] multiple codeLinks
  it('should parse all codeLinks when multiple valid codeLinks given', () => {
    // Arrange
    const links = [
      { kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' },
      { kind: 'class', file: 'src/auth/TokenService.ts', symbol: 'TokenService' },
    ];
    const md = makeMarkdown({ codeLinks: links });
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks).toEqual(links);
  });

  // 3. [HP] codeLinks not specified -> undefined
  it('should return undefined codeLinks when codeLinks field absent', () => {
    // Arrange
    const md = makeMarkdown();
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks).toBeUndefined();
  });

  // 4. [HP] codeLinks: null -> undefined
  it('should return undefined codeLinks when codeLinks is null in YAML', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks: null\n---\n`;
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks).toBeUndefined();
  });

  // 5. [ED] codeLinks: [] -> empty array
  it('should return empty array codeLinks when codeLinks is empty array', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks: []\n---\n`;
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks).toEqual([]);
  });

  // 6. [NE] codeLinks is a number -> throw
  it('should throw CardValidationError when codeLinks is a number', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks: 42\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 7. [NE] codeLinks is a non-array object -> throw
  it('should throw CardValidationError when codeLinks is a non-array object', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  kind: function\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 8. [NE] item is null -> throw
  it('should throw CardValidationError when codeLinks item is null', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - null\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 9. [NE] item kind is empty string -> throw
  it('should throw CardValidationError when codeLinks item kind is empty string', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - kind: ''\n    file: src/a.ts\n    symbol: foo\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 10. [NE] item missing kind key -> throw
  it('should throw CardValidationError when codeLinks item is missing kind', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - file: src/a.ts\n    symbol: foo\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 11. [NE] item file is empty string -> throw
  it('should throw CardValidationError when codeLinks item file is empty string', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - kind: function\n    file: ''\n    symbol: foo\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 12. [NE] item symbol is empty string -> throw
  it('should throw CardValidationError when codeLinks item symbol is empty string', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - kind: function\n    file: src/a.ts\n    symbol: ''\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });

  // 13. [HP] codeLinks and relations coexist
  it('should parse both codeLinks and relations when both fields given', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\nrelations:\n  - other\ncodeLinks:\n  - kind: function\n    file: src/a.ts\n    symbol: foo\n---\n`;
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.relations).toEqual(['other']);
    expect(result.frontmatter.codeLinks).toEqual([{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }]);
  });

  // 14. [HP] order preservation
  it('should preserve codeLinks order when multiple codeLinks given', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - kind: function\n    file: src/a.ts\n    symbol: alpha\n  - kind: class\n    file: src/b.ts\n    symbol: beta\n---\n`;
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.codeLinks![0]!.symbol).toBe('alpha');
    expect(result.frontmatter.codeLinks![1]!.symbol).toBe('beta');
  });

  // 15. [CO] first item valid, second item kind='' -> throw
  it('should throw CardValidationError when second codeLinks item has empty kind', () => {
    // Arrange
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntype: spec\ncodeLinks:\n  - kind: function\n    file: src/a.ts\n    symbol: foo\n  - kind: ''\n    file: src/b.ts\n    symbol: bar\n---\n`;
    // Act / Assert
    expect(() => parseCardMarkdown(md)).toThrow(CardValidationError);
  });
});

// ── codeLinks serialization ──────────────────────────────────────────────────

describe('serializeCardMarkdown — codeLinks', () => {
  // 16. [HP] frontmatter with codeLinks -> YAML includes codeLinks
  it('should include codeLinks in YAML when codeLinks present in frontmatter', () => {
    // Arrange
    const fm: CardFrontmatter = {
      key: 'k',
      summary: 's',
      status: 'draft',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'refreshToken' }],
    };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result).toContain('codeLinks');
    expect(result).toContain('refreshToken');
  });

  // 17. [HP] frontmatter without codeLinks -> YAML excludes codeLinks
  it('should not include codeLinks in YAML when codeLinks absent from frontmatter', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result).not.toContain('codeLinks');
  });

  // 18. [HP] round-trip: parse->serialize preserves codeLinks values
  it('should preserve codeLinks after round-trip parse then serialize then parse', () => {
    // Arrange
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
    // Act
    const serialized = serializeCardMarkdown(original, 'body');
    const reparsed = parseCardMarkdown(serialized);
    // Assert
    expect(reparsed.frontmatter.codeLinks).toEqual(original.codeLinks);
  });
});

describe('serializeCardMarkdown', () => {
  // HP
  it('should return header+body format when called with frontmatter and body', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    const body = 'body content';
    // Act
    const result = serializeCardMarkdown(fm, body);
    // Assert
    expect(result).toContain('---\n');
    expect(result).toContain('body content');
  });

  it('should output --- delimiters when serializing frontmatter', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result.startsWith('---\n')).toBe(true);
    const secondDelim = result.indexOf('---\n', 4);
    expect(secondDelim).toBeGreaterThan(0);
  });

  it('should return header only when body is empty string', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec' };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result).toMatch(/^---\n[\s\S]+---\n$/);
  });

  it('should include tags when tags present in frontmatter', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec', tags: ['t1', 't2'] };
    const result = serializeCardMarkdown(fm, '');
    expect(result).toContain('t1');
    expect(result).toContain('t2');
  });

  it('should include parent when parent present in frontmatter', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec', parent: 'parent/card' };
    const result = serializeCardMarkdown(fm, '');
    expect(result).toContain('parent');
    expect(result).toContain('parent/card');
  });

  it('should include boundary when boundary present in frontmatter', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', type: 'spec', boundary: ['src/**'] };
    const result = serializeCardMarkdown(fm, '');
    expect(result).toContain('boundary');
    expect(result).toContain('src/**');
  });

  // CO — round-trip
  it('should yield same frontmatter after round-trip parse->serialize->parse', () => {
    // Arrange
    const original: CardFrontmatter = {
      key: 'spec/api',
      summary: 'API spec',
      status: 'active',
      type: 'architecture',
      tags: ['api', 'v2'],
      relations: ['core/module'],
      parent: 'spec/root',
      boundary: ['src/api/**'],
    };
    const body = '## Details\ncontent here';
    // Act
    const serialized = serializeCardMarkdown(original, body);
    const reparsed = parseCardMarkdown(serialized);
    // Assert
    expect(reparsed.frontmatter.key).toBe(original.key);
    expect(reparsed.frontmatter.summary).toBe(original.summary);
    expect(reparsed.frontmatter.status).toBe(original.status);
    expect(reparsed.frontmatter.type).toBe(original.type);
    expect(reparsed.frontmatter.tags).toEqual(original.tags);
    expect(reparsed.frontmatter.relations).toEqual(original.relations);
    expect(reparsed.frontmatter.parent).toBe(original.parent);
    expect(reparsed.frontmatter.boundary).toEqual(original.boundary);
    expect(reparsed.body).toBe(body);
  });

  it('should preserve type and parent after round-trip', () => {
    // Arrange
    const fm: CardFrontmatter = {
      key: 'spec/round',
      summary: 'Round-trip spec',
      status: 'draft',
      type: 'architecture',
      parent: 'root',
      boundary: ['src/**', 'lib/**'],
    };
    const body = '## Notes\nround-trip body';
    // Act
    const serialized = serializeCardMarkdown(fm, body);
    const reparsed = parseCardMarkdown(serialized);
    // Assert
    expect(reparsed.frontmatter.type).toBe('architecture');
    expect(reparsed.frontmatter.parent).toBe('root');
    expect(reparsed.frontmatter.boundary).toEqual(['src/**', 'lib/**']);
    expect(reparsed.body).toBe(body);
  });
});
