/**
 * Drift detection, impact analysis, spec-sync, and interaction tests.
 *
 * Covers: boundary_inactive, symbol_changed, linkStatus,
 * importDependencies with gildash, markerMissing, linkMissing.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createCard,
  updateCardStatus,
  checkDrift,
  checkInteractions,
  preChangeCheck,
  syncSpecAnnotations,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

// ── Mock Gildash Factory ──

function createMockGildash(overrides: {
  searchAnnotations?: (...args: unknown[]) => unknown[];
  searchSymbols?: (...args: unknown[]) => unknown;
  getSymbolChanges?: (...args: unknown[]) => unknown[];
  getSymbolsByFile?: (...args: unknown[]) => unknown[] | null;
  getFileInfo?: (...args: unknown[]) => unknown;
  getDependencies?: (...args: unknown[]) => unknown;
  reindex?: () => Promise<void>;
} = {}) {
  return {
    searchAnnotations: mock(overrides.searchAnnotations ?? (() => [])),
    searchSymbols: mock(overrides.searchSymbols ?? (() => [])),
    getSymbolChanges: mock(overrides.getSymbolChanges ?? (() => [])),
    getSymbolsByFile: mock(overrides.getSymbolsByFile ?? (() => [])),
    getFileInfo: mock(overrides.getFileInfo ?? (() => null)),
    getDependencies: overrides.getDependencies ? mock(overrides.getDependencies) : undefined,
    reindex: mock(overrides.reindex ?? (() => Promise.resolve())),
    close: mock(() => Promise.resolve()),
  } as any;
}

// ════════════════════════════════════════
// 1. checkDrift — boundary_inactive
// ════════════════════════════════════════

describe('checkDrift — boundary_inactive', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect boundary_inactive when boundary glob matches no files', async () => {
    // Create a temp project root with no files matching the boundary
    const tmpDir = await mkdtemp(join(tmpdir(), 'drift_boundary_'));
    tc = await createTestContext();
    tc.ctx.projectRoot = tmpDir;

    await createCard(tc.ctx, {
      key: 'bnd-inactive',
      summary: 'Boundary inactive',
      type: 'spec',
      boundary: ['src/nonexistent/**'],
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }],
    });
    await updateCardStatus(tc.ctx, 'bnd-inactive', 'active');

    // No gildash → broken_link won't trigger (no symbol check)
    const result = await checkDrift(tc.ctx, 'bnd-inactive', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'bnd-inactive');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('boundary_inactive');
    // autoTransition=false → DB status should remain active
    expect(card!.status).toBe('active');
    const rowBefore = tc.ctx.cardRepo.findByKey('bnd-inactive');
    expect(rowBefore!.status).toBe('active');

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should auto-transition active → drifted when boundary_inactive and autoTransition=true', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'drift_boundary_'));
    tc = await createTestContext();
    tc.ctx.projectRoot = tmpDir;

    await createCard(tc.ctx, {
      key: 'bnd-trans',
      summary: 'Boundary transition',
      type: 'spec',
      boundary: ['src/nonexistent/**'],
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }],
    });
    await updateCardStatus(tc.ctx, 'bnd-trans', 'active');

    // autoTransition=true (default)
    const result = await checkDrift(tc.ctx, 'bnd-trans');
    const card = result.cards.find((c) => c.key === 'bnd-trans');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('boundary_inactive');
    expect(card!.status).toBe('drifted');

    // Verify DB was updated
    const row = tc.ctx.cardRepo.findByKey('bnd-trans');
    expect(row!.status).toBe('drifted');

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should NOT detect boundary_inactive when files match the boundary', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'drift_boundary_'));
    // Create a file that matches the boundary
    await mkdir(join(tmpDir, 'src', 'ops'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'ops', 'test.ts'), 'export const x = 1;');

    tc = await createTestContext();
    tc.ctx.projectRoot = tmpDir;

    await createCard(tc.ctx, {
      key: 'bnd-active',
      summary: 'Boundary active',
      type: 'spec',
      boundary: ['src/ops/**'],
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }],
    });
    await updateCardStatus(tc.ctx, 'bnd-active', 'active');

    const result = await checkDrift(tc.ctx, 'bnd-active', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'bnd-active');
    expect(card).toBeDefined();
    // boundary matches files, so no boundary_inactive
    expect(card!.driftType).toBeUndefined();

    await rm(tmpDir, { recursive: true, force: true });
  });
});

// ════════════════════════════════════════
// 2. checkDrift — symbol_changed
// ════════════════════════════════════════

describe('checkDrift — symbol_changed', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect symbol_changed when boundary file symbols changed after card update', async () => {
    tc = await createTestContext();

    // Create card with boundary, codeLinks (to pass activation), and set as active
    await createCard(tc.ctx, {
      key: 'sym-changed',
      summary: 'Symbol changed',
      type: 'spec',
      boundary: ['src/auth/**'],
      codeLinks: [{ kind: 'function', file: 'src/auth/login.ts', symbol: 'login' }],
    });
    await updateCardStatus(tc.ctx, 'sym-changed', 'active');

    // Set card updatedAt to a past time
    const row = tc.ctx.cardRepo.findByKey('sym-changed')!;
    tc.ctx.cardRepo.upsert({ ...row, updatedAt: '2020-01-01T00:00:00.000Z' });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'login', filePath: 'src/auth/login.ts', kind: 'function' }],
      getSymbolChanges: () => [{
        changeType: 'modified',
        symbolName: 'login',
        symbolKind: 'function',
        filePath: 'src/auth/login.ts',
        oldName: null,
        oldFilePath: null,
        fingerprint: 'abc',
        changedAt: '2025-01-01T00:00:00.000Z', // after card's updatedAt
        isFullIndex: false,
        indexRunId: 'run-1',
      }],
    });

    const result = await checkDrift(tc.ctx, 'sym-changed', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'sym-changed');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('symbol_changed');
    expect(card!.symbolChanges).toBeDefined();
    expect(card!.symbolChanges!.length).toBeGreaterThanOrEqual(1);
    expect(card!.symbolChanges![0]!.symbolName).toBe('login');
  });

  it('should NOT detect symbol_changed when changes are before card updatedAt', async () => {
    tc = await createTestContext();

    await createCard(tc.ctx, {
      key: 'sym-old',
      summary: 'Old change',
      type: 'spec',
      boundary: ['src/auth/**'],
      codeLinks: [{ kind: 'function', file: 'src/auth/login.ts', symbol: 'login' }],
    });
    await updateCardStatus(tc.ctx, 'sym-old', 'active');

    // Card updatedAt is recent (just created), change is old
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'login', filePath: 'src/auth/login.ts', kind: 'function' }],
      getSymbolChanges: () => [{
        changeType: 'modified',
        symbolName: 'login',
        symbolKind: 'function',
        filePath: 'src/auth/login.ts',
        oldName: null,
        oldFilePath: null,
        fingerprint: 'abc',
        changedAt: '2000-01-01T00:00:00.000Z', // before card's updatedAt
        isFullIndex: false,
        indexRunId: 'run-1',
      }],
    });

    const result = await checkDrift(tc.ctx, 'sym-old', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'sym-old');
    expect(card).toBeDefined();
    expect(card!.driftType).toBeUndefined();
  });
});

// ════════════════════════════════════════
// 3. preChangeCheck — linkStatus with gildash
// ════════════════════════════════════════

describe('preChangeCheck — linkStatus', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should include linkStatus when gildash is available', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'ls-card',
      summary: 'Link status card',
      type: 'spec',
      codeLinks: [
        { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
        { kind: 'function', file: 'src/auth.ts', symbol: 'logout' },
      ],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: ({ text }: any) => {
        if (text === 'login') return [{ name: 'login', filePath: 'src/auth.ts', kind: 'function' }];
        return []; // logout not found
      },
    });

    const result = preChangeCheck(tc.ctx, ['src/auth.ts']);
    const card = result.affectedCards.find((c) => c.key === 'ls-card');
    expect(card).toBeDefined();
    expect(card!.linkStatus).toBeDefined();
    expect(card!.linkStatus!.valid).toBe(1);
    expect(card!.linkStatus!.broken).toBe(1);
  });

  it('should not include linkStatus when gildash is not available', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'no-gildash',
      summary: 'No gildash',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/a.ts']);
    const card = result.affectedCards.find((c) => c.key === 'no-gildash');
    expect(card).toBeDefined();
    expect(card!.linkStatus).toBeUndefined();
  });
});

// ════════════════════════════════════════
// 4. checkInteractions — importDependencies with gildash
// ════════════════════════════════════════

describe('checkInteractions — importDependencies', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect importDependencies when gildash.getDependencies is available', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'dep-a',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }],
    });
    await createCard(tc.ctx, {
      key: 'dep-b',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/b.ts', symbol: 'fnB' }],
    });

    tc.ctx.gildash = createMockGildash({
      getDependencies: (...args: unknown[]) => {
        const file = args[0] as string;
        if (file === 'src/a.ts') return ['src/b.ts']; // A imports B
        return [];
      },
    });

    const result = checkInteractions(tc.ctx, ['dep-a', 'dep-b']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.importDependencies.length).toBeGreaterThanOrEqual(1);
    const dep = result.interactions[0]!.importDependencies.find((d) => d.from === 'dep-a' && d.to === 'dep-b');
    expect(dep).toBeDefined();
    expect(dep!.file).toBe('src/a.ts');
  });

  it('should return empty importDependencies when gildash has no getDependencies', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'no-dep-a',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }],
    });
    await createCard(tc.ctx, {
      key: 'no-dep-b',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/b.ts', symbol: 'fnB' }],
    });

    // gildash without getDependencies
    tc.ctx.gildash = {
      searchSymbols: mock(() => []),
      close: mock(() => Promise.resolve()),
    } as any;

    const result = checkInteractions(tc.ctx, ['no-dep-a', 'no-dep-b']);
    // No interactions because no shared symbols/files/deps
    expect(result.interactions).toHaveLength(0);
  });
});

// ════════════════════════════════════════
// 5. syncSpecAnnotations — markerMissing
// ════════════════════════════════════════

describe('syncSpecAnnotations — markerMissing', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect markerMissing when codeLink exists but no @spec annotation', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'marker-test',
      summary: 'Marker test',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'login' }],
    });

    // No @spec annotations found
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.markerMissing).toHaveLength(1);
    expect(result.markerMissing[0]!.cardKey).toBe('marker-test');
    expect(result.markerMissing[0]!.file).toBe('src/auth.ts');
    expect(result.markerMissing[0]!.symbol).toBe('login');
  });

  it('should NOT report markerMissing when @spec annotation matches the codeLink', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'marker-ok',
      summary: 'Marker OK',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'login' }],
    });

    // @spec annotation matches the codeLink
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'marker-ok', filePath: 'src/auth.ts', symbolName: 'login', source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.markerMissing).toHaveLength(0);
    expect(result.alreadyLinked).toBe(1);
  });
});

// ════════════════════════════════════════
// 6. syncSpecAnnotations — linkMissing
// ════════════════════════════════════════

describe('syncSpecAnnotations — linkMissing', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should report linkMissing for newly created links from @spec annotations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'link-missing',
      summary: 'Link missing',
      type: 'spec',
    });

    // @spec annotation for a symbol not yet linked
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'link-missing', filePath: 'src/new.ts', symbolName: 'newFn', source: 'line' },
      ],
      searchSymbols: () => [{ name: 'newFn', filePath: 'src/new.ts', kind: 'function' }],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(1);
    expect(result.linkMissing).toHaveLength(1);
    expect(result.linkMissing[0]!.cardKey).toBe('link-missing');
    expect(result.linkMissing[0]!.symbol).toBe('newFn');
  });

  it('should NOT report linkMissing when link already exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'link-exists',
      summary: 'Link exists',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/existing.ts', symbol: 'existingFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'link-exists', filePath: 'src/existing.ts', symbolName: 'existingFn', source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.alreadyLinked).toBe(1);
    expect(result.linkMissing).toHaveLength(0);
  });
});

// ════════════════════════════════════════
// 7. preChangeCheck — ignorePatterns in newUncoveredFiles
// ════════════════════════════════════════

describe('preChangeCheck — ignorePatterns', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should exclude ignorePatterns-matched files from newUncoveredFiles', async () => {
    tc = await createTestContext();
    // Set ignorePatterns patterns
    tc.ctx.ignorePatterns = ['test/**', '*.test.ts'];

    const result = preChangeCheck(tc.ctx, ['src/uncovered.ts', 'test/helper.ts', 'foo.test.ts']);
    // src/uncovered.ts: not covered, not ignored → should appear
    expect(result.newUncoveredFiles).toContain('src/uncovered.ts');
    // test/helper.ts: not covered, but matches ignorePatterns 'test/**' → excluded
    expect(result.newUncoveredFiles).not.toContain('test/helper.ts');
    // foo.test.ts: not covered, but matches '*.test.ts' → excluded
    expect(result.newUncoveredFiles).not.toContain('foo.test.ts');
  });

  it('should not exclude non-matching files from newUncoveredFiles', async () => {
    tc = await createTestContext();
    tc.ctx.ignorePatterns = ['vendor/**'];

    const result = preChangeCheck(tc.ctx, ['src/new-feature.ts']);
    // src/new-feature.ts doesn't match 'vendor/**' → should appear
    expect(result.newUncoveredFiles).toContain('src/new-feature.ts');
  });
});

// ════════════════════════════════════════
// 8. validateCodeLinks — batch mode via MCP tool
// ════════════════════════════════════════

describe('validateCodeLinks — batch mode (MCP layer)', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should validate all cards when key is omitted via MCP tool pattern', async () => {
    tc = await createTestContext();
    const { validateCodeLinks } = await import('../../index');

    // Create two cards with codeLinks
    await createCard(tc.ctx, {
      key: 'batch-a',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }],
    });
    await createCard(tc.ctx, {
      key: 'batch-b',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/b.ts', symbol: 'fnB' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [], // all links broken → planned (draft cards)
    });

    // Simulate MCP batch pattern: iterate all cards
    const allCards = tc.ctx.cardRepo.list();
    const results: Record<string, any> = {};
    for (const card of allCards) {
      try {
        results[card.key] = await validateCodeLinks(tc.ctx, card.key);
      } catch {
        // skip
      }
    }

    expect(Object.keys(results)).toHaveLength(2);
    expect(results['batch-a']).toBeDefined();
    expect(results['batch-b']).toBeDefined();
    expect(results['batch-a'].declared).toBe(1);
    expect(results['batch-b'].declared).toBe(1);
    // Both are draft, so broken → planned
    expect(results['batch-a'].planned).toHaveLength(1);
    expect(results['batch-b'].planned).toHaveLength(1);
  });
});
