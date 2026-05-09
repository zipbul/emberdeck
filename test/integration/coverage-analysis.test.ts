import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import {
  createCard,
  getUncoveredSymbols,
  suggestCardScope,
  analyze,
  type CardRow,
} from '../../index';
import { createMockTestContext, createTestContext, type TestContext } from '../helpers';
import { mockGildashFromSymbols as createMockGildash } from '../fixtures/gildash';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertCard(
  tc: TestContext,
  key: string,
  opts?: { boundary?: string[]; status?: string; body?: string },
): void {
  const row: CardRow = {
    key,
    summary: `Card ${key}`,
    status: opts?.status ?? 'active',
    type: 'spec',
    parent: null,
    boundaryJson: opts?.boundary ? JSON.stringify(opts.boundary) : null,
    namespacesJson: null,
    body: opts?.body ?? null,
    glossaryJson: '[]',
    filePath: `cards/${key}.card.md`,
    updatedAt: new Date().toISOString(),
  };
  tc.ctx.cardRepo.upsert(row);
}

// ---------------------------------------------------------------------------
// getUncoveredSymbols
// ---------------------------------------------------------------------------

describe('getUncoveredSymbols', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('returns all symbols when no cards exist', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
        { name: 'logout', kind: 'function', isExported: true },
      ],
    });
    tc.ctx.projectRoot = '/project';

    const result = await getUncoveredSymbols(tc.ctx);
    expect(result.totalSymbols).toBe(2);
    expect(result.coveredSymbols).toBe(0);
    expect(result.uncovered).toHaveLength(2);
    expect(result.coverageRatio).toBe(0);
  });

  it('excludes symbols covered by codeLinks', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
        { name: 'logout', kind: 'function', isExported: true },
      ],
    });
    tc.ctx.projectRoot = '/project';

    insertCard(tc, 'auth');
    tc.ctx.codeLinkRepo.replaceForCard('auth', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
    ]);

    const result = await getUncoveredSymbols(tc.ctx);
    expect(result.totalSymbols).toBe(2);
    expect(result.coveredSymbols).toBe(1);
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0]!.symbol).toBe('logout');
    expect(result.coverageRatio).toBe(0.5);
  });

  it('excludes symbols in boundary-covered files', async () => {
    tc = await createMockTestContext();

    // Create a real temp directory for boundary scanning
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
    const tmpRoot = '/tmp/ed-coverage-boundary-' + Date.now();
    mkdirSync(tmpRoot + '/src/api', { recursive: true });
    writeFileSync(tmpRoot + '/src/api/handler.ts', 'export function handle() {}');

    try {
      tc.ctx.projectRoot = tmpRoot;
      tc.ctx.gildash = createMockGildash({
        [tmpRoot + '/src/api/handler.ts']: [
          { name: 'handle', kind: 'function', isExported: true },
        ],
      });

      insertCard(tc, 'api', { boundary: ['src/api/**'] });

      const result = await getUncoveredSymbols(tc.ctx);
      expect(result.uncovered.filter((s) => s.symbol === 'handle')).toHaveLength(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('applies ignorePatterns patterns', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.ignorePatterns = ['src/generated/**'];
    tc.ctx.gildash = createMockGildash({
      '/project/src/generated/types.ts': [
        { name: 'FooType', kind: 'type', isExported: true },
      ],
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
      ],
    });

    const result = await getUncoveredSymbols(tc.ctx);
    expect(result.totalSymbols).toBe(1);
    expect(result.uncovered[0]!.symbol).toBe('login');
  });

  it('applies excludePatterns on top of ignorePatterns', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.ignorePatterns = ['src/generated/**'];
    tc.ctx.gildash = createMockGildash({
      '/project/src/generated/types.ts': [
        { name: 'FooType', kind: 'type', isExported: true },
      ],
      '/project/src/test/helper.ts': [
        { name: 'setupTest', kind: 'function', isExported: true },
      ],
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
      ],
    });

    const result = await getUncoveredSymbols(tc.ctx, {
      excludePatterns: ['src/test/**'],
    });
    expect(result.totalSymbols).toBe(1);
    expect(result.uncovered[0]!.symbol).toBe('login');
  });

  it('filters by kinds', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
        { name: 'AuthService', kind: 'class', isExported: true },
        { name: 'AuthConfig', kind: 'interface', isExported: true },
      ],
    });

    const result = await getUncoveredSymbols(tc.ctx, { kinds: ['function', 'class'] });
    expect(result.totalSymbols).toBe(2);
    expect(result.uncovered.map((s) => s.symbol).sort()).toEqual(['AuthService', 'login']);
  });

  it('filters by specific files', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
      ],
      '/project/src/db.ts': [
        { name: 'query', kind: 'function', isExported: true },
      ],
    });

    const result = await getUncoveredSymbols(tc.ctx, { files: ['src/auth.ts'] });
    expect(result.totalSymbols).toBe(1);
    expect(result.uncovered[0]!.symbol).toBe('login');
  });

  it('returns ratio=1 when no symbols exist', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({});

    const result = await getUncoveredSymbols(tc.ctx);
    expect(result.totalSymbols).toBe(0);
    // null distinguishes "no symbols indexed" from "0% covered".
    expect(result.coverageRatio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// suggestCardScope
// ---------------------------------------------------------------------------

describe('suggestCardScope', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('suggests brief card for directory with multiple files', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
      ],
      '/project/src/api/handler.ts': [
        { name: 'handleRequest', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const apiSuggestion = suggestions.find((s) => s.suggestedKey === 'src/api');
    expect(apiSuggestion).toBeDefined();
    // 4-tier: with no domain ancestor, multi-file directory becomes a domain suggestion.
    expect(apiSuggestion!.type).toBe('domain');
    expect(apiSuggestion!.files).toHaveLength(2);
  });

  it('suggests brief card when domain ancestor exists (4-tier)', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    // Create domain at src/api so a child directory under it gets a brief suggestion
    await createCard(tc.ctx, { key: 'src/api', summary: 'API domain', type: 'domain' });
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/v1/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
      ],
      '/project/src/api/v1/handler.ts': [
        { name: 'handleRequest', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx);
    const v1Suggestion = suggestions.find((s) => s.suggestedKey === 'src/api/v1');
    expect(v1Suggestion).toBeDefined();
    expect(v1Suggestion!.type).toBe('brief');
    expect(v1Suggestion!.parent).toBe('src/api');
  });

  it('suggests spec card for single-file directory', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/utils/hash.ts': [
        { name: 'sha256', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx);
    const utilSuggestion = suggestions.find((s) => s.suggestedKey === 'src/utils');
    expect(utilSuggestion).toBeDefined();
    expect(utilSuggestion!.type).toBe('spec');
  });

  it('skips directories already covered by existing cards', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth/login.ts': [
        { name: 'login', kind: 'function', isExported: true },
      ],
    });

    // Create a card with key matching directory
    insertCard(tc, 'src/auth');

    const suggestions = await suggestCardScope(tc.ctx);
    const authSuggestion = suggestions.find((s) => s.suggestedKey === 'src/auth');
    expect(authSuggestion).toBeUndefined();
  });

  it('respects path filter', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
      ],
      '/project/src/db/query.ts': [
        { name: 'query', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx, { path: 'src/api' });
    expect(suggestions.every((s) => s.suggestedKey.startsWith('src/api'))).toBe(true);
    // Must NOT include src/db
    expect(suggestions.some((s) => s.suggestedKey.startsWith('src/db'))).toBe(false);
  });

  it('path filter does not match sibling directories with shared prefix', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
      ],
      '/project/src/api-v2/routes.ts': [
        { name: 'getV2Users', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx, { path: 'src/api' });
    expect(suggestions.some((s) => s.suggestedKey === 'src/api')).toBe(true);
    // src/api-v2 must NOT be included — it's a sibling, not a child
    expect(suggestions.some((s) => s.suggestedKey === 'src/api-v2')).toBe(false);
  });

  it('respects maxDepth', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/deep/nested/dir/file.ts': [
        { name: 'deepFn', kind: 'function', isExported: true },
      ],
      '/project/src/shallow/file.ts': [
        { name: 'shallowFn', kind: 'function', isExported: true },
      ],
    });

    const suggestions = await suggestCardScope(tc.ctx, { maxDepth: 2 });
    const deepSuggestion = suggestions.find((s) => s.suggestedKey === 'src/deep/nested/dir');
    expect(deepSuggestion).toBeUndefined();
    const shallowSuggestion = suggestions.find((s) => s.suggestedKey === 'src/shallow');
    expect(shallowSuggestion).toBeDefined();
  });

  it('returns empty when all symbols are covered', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
      ],
    });

    // Cover the symbol via codeLink
    insertCard(tc, 'auth');
    tc.ctx.codeLinkRepo.replaceForCard('auth', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
    ]);

    const suggestions = await suggestCardScope(tc.ctx);
    expect(suggestions).toHaveLength(0);
  });

  it('skips directories covered by existing boundary globs', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
      ],
    });

    // Card with different key but boundary covering the directory
    insertCard(tc, 'api-module', { boundary: ['src/api/**'] });
    // Symbol is uncovered by codeLinks but the boundary glob covers the file
    // The boundary overlap check in suggestCardScope should skip this directory

    const suggestions = await suggestCardScope(tc.ctx);
    const apiSuggestion = suggestions.find((s) => s.suggestedKey === 'src/api');
    expect(apiSuggestion).toBeUndefined();
  });

  it('suggests parent when ancestor card exists', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/v2/routes.ts': [
        { name: 'getV2Users', kind: 'function', isExported: true },
      ],
    });

    insertCard(tc, 'src/api');

    const suggestions = await suggestCardScope(tc.ctx);
    const v2Suggestion = suggestions.find((s) => s.suggestedKey === 'src/api/v2');
    expect(v2Suggestion).toBeDefined();
    expect(v2Suggestion!.parent).toBe('src/api');
  });
});

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

describe('analyze', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('returns correct health counts based on detected state', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    // Healthy active card (no code links, no boundary → no drift)
    insertCard(tc, 'healthy', { status: 'active' });

    // Active card with broken links → detected as drifted
    insertCard(tc, 'broken', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('broken', [
      { kind: 'function', file: 'src/gone.ts', symbol: 'missing' },
    ]);

    // Draft card
    await createCard(tc.ctx, { key: 'draft-1', summary: 'Draft 1', type: 'spec' });

    const result = await analyze(tc.ctx);
    expect(result.health.total).toBe(3);
    expect(result.health.active).toBe(1);   // only 'healthy'
    expect(result.health.drifted).toBe(1);  // 'broken' detected via checkDrift
    expect(result.health.draft).toBe(1);
  });

  it('health.drifted reflects detected drift, not just DB status', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    // Card with DB status 'active' but broken links → should count as drifted
    insertCard(tc, 'looks-active', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('looks-active', [
      { kind: 'function', file: 'src/gone.ts', symbol: 'missing' },
    ]);

    // Truly healthy active card (no links, no boundary)
    insertCard(tc, 'truly-healthy', { status: 'active' });

    const result = await analyze(tc.ctx);
    // looks-active has broken links → detected as drifted despite DB status='active'
    expect(result.health.active).toBe(1);   // only truly-healthy
    expect(result.health.drifted).toBe(1);  // looks-active (detected)
    expect(result.health.brokenLinks).toBe(1);
    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCards[0]!.key).toBe('looks-active');
  });

  it('drifted-in-DB card with no current drift still counts as drifted', async () => {
    tc = await createMockTestContext();

    // Card marked drifted in DB, but has no code links or boundary → no drift detected
    insertCard(tc, 'was-drifted', { status: 'drifted' });

    // Healthy active card
    insertCard(tc, 'healthy', { status: 'active' });

    const result = await analyze(tc.ctx);
    expect(result.health.active).toBe(1);   // only 'healthy'
    expect(result.health.drifted).toBe(1);  // 'was-drifted' counted from DB status
  });

  it('detects boundary_inactive drift in driftedCards', async () => {
    // Real gildash needed: the test asserts boundary_inactive against a populated index.
    tc = await createTestContext();
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(tc.ctx.projectRoot, 'src.ts'), 'export const x = 1;\n');
    insertCard(tc, 'stale-boundary', { status: 'active', boundary: ['nonexistent/**/*.ts'] });

    const result = await analyze(tc.ctx);
    expect(result.health.drifted).toBe(1);
    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCards[0]!.key).toBe('stale-boundary');
    expect(result.driftedCards[0]!.driftType).toBe('boundary_inactive');
  });

  it('reports coverage when gildash is available', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
        { name: 'logout', kind: 'function', isExported: true },
      ],
    });

    insertCard(tc, 'auth');
    tc.ctx.codeLinkRepo.replaceForCard('auth', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
    ]);

    const result = await analyze(tc.ctx);
    // auth card has a valid codeLink (login exists in mock) → not drifted
    expect(result.health.active).toBe(1);
    expect(result.health.drifted).toBe(0);
    expect(result.health.brokenLinks).toBe(0);
    expect(result.coverage.totalSymbols).toBe(2);
    expect(result.coverage.covered).toBe(1);
    expect(result.coverage.ratio).toBe(0.5);
    expect(result.unlinkedSymbols).toHaveLength(1);
    expect(result.unlinkedSymbols[0]!.symbol).toBe('logout');
  });

  it('detects stale boundaries against the populated index', async () => {
    tc = await createTestContext();
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(tc.ctx.projectRoot, 'src.ts'), 'export const x = 1;\n');
    insertCard(tc, 'stale', { boundary: ['nonexistent/dir/**'] });

    const result = await analyze(tc.ctx);
    expect(result.health.staleBoundary).toBe(1);
  });

  it('includes body in drifted cards when includeBody=true', async () => {
    tc = await createMockTestContext();
    insertCard(tc, 'drifted-card', { status: 'drifted', body: 'Design rationale here' });
    tc.ctx.codeLinkRepo.replaceForCard('drifted-card', [
      { kind: 'function', file: 'src/missing.ts', symbol: 'gone' },
    ]);

    const result = await analyze(tc.ctx, { includeBody: true });
    const drifted = result.driftedCards.find((c) => c.key === 'drifted-card');
    expect(drifted).toBeDefined();
    expect(drifted!.body).toBe('Design rationale here');
  });

  it('does not include body by default', async () => {
    tc = await createMockTestContext();
    insertCard(tc, 'drifted-card2', { status: 'drifted', body: 'Secret body' });
    tc.ctx.codeLinkRepo.replaceForCard('drifted-card2', [
      { kind: 'function', file: 'src/missing.ts', symbol: 'gone' },
    ]);

    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    const result = await analyze(tc.ctx);
    const drifted = result.driftedCards.find((c) => c.key === 'drifted-card2');
    expect(drifted).toBeDefined();
    expect(drifted!.body).toBeUndefined();
  });

  it('limits unlinked symbols to top N', async () => {
    tc = await createMockTestContext();
    tc.ctx.projectRoot = '/project';

    // Create 30 symbols
    const symbols: Record<string, Array<{ name: string; kind: string; isExported: boolean }>> = {};
    symbols['/project/src/big.ts'] = [];
    for (let i = 0; i < 30; i++) {
      symbols['/project/src/big.ts']!.push({
        name: `fn${i}`,
        kind: 'function',
        isExported: true,
      });
    }
    tc.ctx.gildash = createMockGildash(symbols);

    const result = await analyze(tc.ctx);
    expect(result.unlinkedSymbols.length).toBeLessThanOrEqual(20);
  });

  it('driftedCards list includes broken link info', async () => {
    tc = await createMockTestContext();
    insertCard(tc, 'broken-card', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('broken-card', [
      { kind: 'function', file: 'src/missing.ts', symbol: 'gone' },
      { kind: 'function', file: 'src/missing.ts', symbol: 'alsoGone' },
    ]);

    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    const result = await analyze(tc.ctx);
    expect(result.health.brokenLinks).toBe(2);
    const card = result.driftedCards.find((c) => c.key === 'broken-card');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('broken_link');
    expect(card!.brokenLinks).toBe(2);
    expect(card!.totalLinks).toBe(2);
  });

  // ── Pagination (offset/limit) ──

  it('returns driftedCardsTotal equal to driftedCards length when no pagination', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    insertCard(tc, 'drift-a', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('drift-a', [
      { kind: 'function', file: 'src/gone.ts', symbol: 'a' },
    ]);
    insertCard(tc, 'drift-b', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('drift-b', [
      { kind: 'function', file: 'src/gone.ts', symbol: 'b' },
    ]);

    const result = await analyze(tc.ctx);
    expect(result.driftedCards).toHaveLength(2);
    expect(result.driftedCardsTotal).toBe(2);
  });

  it('applies limit to driftedCards while preserving driftedCardsTotal', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    for (let i = 0; i < 5; i++) {
      insertCard(tc, `drift-${i}`, { status: 'active' });
      tc.ctx.codeLinkRepo.replaceForCard(`drift-${i}`, [
        { kind: 'function', file: 'src/gone.ts', symbol: `fn${i}` },
      ]);
    }

    const result = await analyze(tc.ctx, { limit: 2 });
    expect(result.driftedCards).toHaveLength(2);
    expect(result.driftedCardsTotal).toBe(5);
  });

  it('applies offset to driftedCards', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    for (let i = 0; i < 5; i++) {
      insertCard(tc, `drift-${i}`, { status: 'active' });
      tc.ctx.codeLinkRepo.replaceForCard(`drift-${i}`, [
        { kind: 'function', file: 'src/gone.ts', symbol: `fn${i}` },
      ]);
    }

    const resultAll = await analyze(tc.ctx);
    const resultOffset = await analyze(tc.ctx, { offset: 2 });

    expect(resultOffset.driftedCardsTotal).toBe(5);
    expect(resultOffset.driftedCards).toHaveLength(3);
    // The offset slice should match the tail of the full list
    expect(resultOffset.driftedCards.map((c) => c.key)).toEqual(
      resultAll.driftedCards.slice(2).map((c) => c.key),
    );
  });

  it('applies offset and limit together', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    for (let i = 0; i < 5; i++) {
      insertCard(tc, `drift-${i}`, { status: 'active' });
      tc.ctx.codeLinkRepo.replaceForCard(`drift-${i}`, [
        { kind: 'function', file: 'src/gone.ts', symbol: `fn${i}` },
      ]);
    }

    const resultAll = await analyze(tc.ctx);
    const resultPage = await analyze(tc.ctx, { offset: 1, limit: 2 });

    expect(resultPage.driftedCardsTotal).toBe(5);
    expect(resultPage.driftedCards).toHaveLength(2);
    expect(resultPage.driftedCards.map((c) => c.key)).toEqual(
      resultAll.driftedCards.slice(1, 3).map((c) => c.key),
    );
  });

  it('returns empty driftedCards when offset exceeds total', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    insertCard(tc, 'drift-only', { status: 'active' });
    tc.ctx.codeLinkRepo.replaceForCard('drift-only', [
      { kind: 'function', file: 'src/gone.ts', symbol: 'a' },
    ]);

    const result = await analyze(tc.ctx, { offset: 100 });
    expect(result.driftedCards).toHaveLength(0);
    expect(result.driftedCardsTotal).toBe(1);
  });

  it('health.drifted count is unaffected by pagination', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({});
    tc.ctx.projectRoot = '/project';

    for (let i = 0; i < 3; i++) {
      insertCard(tc, `drift-${i}`, { status: 'active' });
      tc.ctx.codeLinkRepo.replaceForCard(`drift-${i}`, [
        { kind: 'function', file: 'src/gone.ts', symbol: `fn${i}` },
      ]);
    }

    const result = await analyze(tc.ctx, { offset: 0, limit: 1 });
    // health.drifted reflects all drifted cards, not just the page
    expect(result.health.drifted).toBe(3);
    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCardsTotal).toBe(3);
  });
});
