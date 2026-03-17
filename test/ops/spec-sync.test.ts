/**
 * Integration tests for Phase 2: code link automation.
 *
 * Gildash is outside the SUT boundary → mocked via ctx.gildash.
 * Real DB + real file system inside SUT boundary.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';

import {
  createCard,
  syncSpecAnnotations,
  syncSymbolChanges,
  getLinkCoverage,
  GildashNotConfiguredError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

// ── Mock Gildash Factory ──

function createMockGildash(overrides: {
  searchAnnotations?: (...args: unknown[]) => unknown[];
  searchSymbols?: (...args: unknown[]) => unknown;
  getSymbolChanges?: (...args: unknown[]) => unknown[];
  getSymbolsByFile?: (...args: unknown[]) => unknown[] | null;
} = {}) {
  return {
    searchAnnotations: mock(overrides.searchAnnotations ?? (() => [])),
    searchSymbols: mock(overrides.searchSymbols ?? (() => [])),
    getSymbolChanges: mock(overrides.getSymbolChanges ?? (() => [])),
    getSymbolsByFile: mock(overrides.getSymbolsByFile ?? (() => [])),
    close: mock(() => Promise.resolve()),
  } as any;
}

// ════════════════════════════════════════
// syncSpecAnnotations
// ════════════════════════════════════════

describe('syncSpecAnnotations', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── HP: Happy Path ──

  it('should create code link from @spec annotation matching an existing card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'auth-token', summary: 'Auth token', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'auth-token', filePath: 'src/auth.ts', symbolName: 'generateToken', source: 'line' },
      ],
      searchSymbols: () => [
        { name: 'generateToken', filePath: 'src/auth.ts', kind: 'function' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(1);
    expect(result.alreadyLinked).toBe(0);
    expect(result.unmatched).toHaveLength(0);

    const links = tc.ctx.codeLinkRepo.findByCardKey('auth-token');
    expect(links).toHaveLength(1);
    expect(links[0]!.symbol).toBe('generateToken');
    expect(links[0]!.kind).toBe('function');
  });

  it('should create multiple code links from multiple annotations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'card-a', summary: 'A', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    await createCard(tc.ctx, { slug: 'card-b', summary: 'B', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'card-a', filePath: 'src/a.ts', symbolName: 'fnA', source: 'jsdoc' },
        { tag: 'spec', value: 'card-b', filePath: 'src/b.ts', symbolName: 'fnB', source: 'line' },
      ],
      searchSymbols: ({ text }: any) => {
        if (text === 'fnA') return [{ name: 'fnA', filePath: 'src/a.ts', kind: 'function' }];
        if (text === 'fnB') return [{ name: 'fnB', filePath: 'src/b.ts', kind: 'class' }];
        return [];
      },
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(2);
  });

  // ── NE: Negative / Error ──

  it('should throw GildashNotConfiguredError when gildash is not set', async () => {
    tc = await createTestContext();
    await expect(syncSpecAnnotations(tc.ctx)).rejects.toThrow(GildashNotConfiguredError);
  });

  it('should report unmatched when card does not exist for annotation', async () => {
    tc = await createTestContext();
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'nonexistent', filePath: 'src/x.ts', symbolName: 'fn', source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]!.cardKey).toBe('nonexistent');
  });

  // ── ED: Edge ──

  it('should skip annotation with empty value', async () => {
    tc = await createTestContext();
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: '  ', filePath: 'src/x.ts', symbolName: 'fn', source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it('should skip annotation with null symbolName', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'orphan', summary: 'Orphan', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'orphan', filePath: 'src/x.ts', symbolName: null, source: 'block' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
  });

  it('should return zero counts when no annotations found', async () => {
    tc = await createTestContext();
    tc.ctx.gildash = createMockGildash({ searchAnnotations: () => [] });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it('should not create duplicate link when link already exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'dup-link',
      summary: 'Dup',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'existing' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'dup-link', filePath: 'src/a.ts', symbolName: 'existing', source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.alreadyLinked).toBe(1);

    const links = tc.ctx.codeLinkRepo.findByCardKey('dup-link');
    expect(links).toHaveLength(1);
  });

  it('should preserve existing manual links when adding new annotation link', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'preserve',
      summary: 'Preserve',
      codeLinks: [{ kind: 'class', file: 'src/old.ts', symbol: 'OldClass' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'preserve', filePath: 'src/new.ts', symbolName: 'newFn', source: 'jsdoc' },
      ],
      searchSymbols: () => [{ name: 'newFn', filePath: 'src/new.ts', kind: 'function' }],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(1);

    const links = tc.ctx.codeLinkRepo.findByCardKey('preserve');
    expect(links).toHaveLength(2);
    expect(links.some((l) => l.symbol === 'OldClass')).toBe(true);
    expect(links.some((l) => l.symbol === 'newFn')).toBe(true);
  });

  it('should set kind to unknown when searchSymbols returns error Result', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'err-sym', summary: 'Error symbol', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'err-sym', filePath: 'src/err.ts', symbolName: 'badFn', source: 'line' },
      ],
      searchSymbols: () => ({ data: 'some error', isErr: true }), // non-array = error
    });

    await syncSpecAnnotations(tc.ctx);
    const links = tc.ctx.codeLinkRepo.findByCardKey('err-sym');
    expect(links[0]!.kind).toBe('unknown');
  });

  it('should set kind to unknown when searchSymbols finds no match', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-match', summary: 'No match', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'no-match', filePath: 'src/x.ts', symbolName: 'ghost', source: 'line' },
      ],
      searchSymbols: () => [], // empty = no match
    });

    await syncSpecAnnotations(tc.ctx);
    const links = tc.ctx.codeLinkRepo.findByCardKey('no-match');
    expect(links[0]!.kind).toBe('unknown');
  });

  // ── CO: Corner ──

  it('should not report unmatched when card missing and symbolName is null', async () => {
    tc = await createTestContext();
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'nonexistent', filePath: 'src/x.ts', symbolName: null, source: 'line' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.unmatched).toHaveLength(0);
  });

  // ── ID: Idempotency ──

  it('should return same result when called twice with same state', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idem', summary: 'Idempotent', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'idem', filePath: 'src/i.ts', symbolName: 'fn', source: 'line' },
      ],
      searchSymbols: () => [{ name: 'fn', filePath: 'src/i.ts', kind: 'function' }],
    });

    const r1 = await syncSpecAnnotations(tc.ctx);
    expect(r1.created).toBe(1);

    const r2 = await syncSpecAnnotations(tc.ctx);
    expect(r2.created).toBe(0); // already exists
    expect(r2.alreadyLinked).toBe(1);

    expect(tc.ctx.codeLinkRepo.findByCardKey('idem')).toHaveLength(1);
  });
});

// ════════════════════════════════════════
// syncSymbolChanges
// ════════════════════════════════════════

describe('syncSymbolChanges', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── HP ──

  it('should update symbol name on rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'rename-card',
      summary: 'Rename',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'oldName' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [{
        changeType: 'renamed',
        symbolName: 'newName',
        symbolKind: 'function',
        filePath: 'src/auth.ts',
        oldName: 'oldName',
        oldFilePath: null,
        fingerprint: 'abc',
        changedAt: new Date().toISOString(),
        isFullIndex: false,
        indexRunId: 'run-1',
      }],
    });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.changes[0]!.changeType).toBe('renamed');
    expect(result.changes[0]!.newSymbol).toBe('newName');

    const links = tc.ctx.codeLinkRepo.findByCardKey('rename-card');
    expect(links[0]!.symbol).toBe('newName');
  });

  it('should update file path on move', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'move-card',
      summary: 'Move',
      codeLinks: [{ kind: 'class', file: 'src/old-path.ts', symbol: 'MyClass' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [{
        changeType: 'moved',
        symbolName: 'MyClass',
        symbolKind: 'class',
        filePath: 'src/new-path.ts',
        oldName: 'MyClass',
        oldFilePath: 'src/old-path.ts',
        fingerprint: 'def',
        changedAt: new Date().toISOString(),
        isFullIndex: false,
        indexRunId: 'run-2',
      }],
    });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.changes[0]!.newFile).toBe('src/new-path.ts');

    const links = tc.ctx.codeLinkRepo.findByCardKey('move-card');
    expect(links[0]!.file).toBe('src/new-path.ts');
  });

  it('should report removed symbols as broken without deleting links', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'del-card',
      summary: 'Deleted',
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'deletedFn' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [{
        changeType: 'removed',
        symbolName: 'deletedFn',
        symbolKind: 'function',
        filePath: 'src/gone.ts',
        oldName: null,
        oldFilePath: null,
        fingerprint: null,
        changedAt: new Date().toISOString(),
        isFullIndex: false,
        indexRunId: 'run-3',
      }],
    });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.broken).toBe(1);
    expect(result.updated).toBe(0);

    // Link should still exist (not auto-deleted)
    const links = tc.ctx.codeLinkRepo.findByCardKey('del-card');
    expect(links).toHaveLength(1);
  });

  // ── NE ──

  it('should throw GildashNotConfiguredError when gildash is not set', async () => {
    tc = await createTestContext();
    expect(() => syncSymbolChanges(tc.ctx, '2020-01-01')).toThrow(GildashNotConfiguredError);
  });

  // ── ED ──

  it('should return zero counts when no changes detected', async () => {
    tc = await createTestContext();
    tc.ctx.gildash = createMockGildash({ getSymbolChanges: () => [] });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(0);
    expect(result.broken).toBe(0);
    expect(result.changes).toHaveLength(0);
  });

  it('should skip changes with no matching code links', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'unrelated',
      summary: 'Unrelated',
      codeLinks: [{ kind: 'function', file: 'src/other.ts', symbol: 'otherFn' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [{
        changeType: 'renamed',
        symbolName: 'newName',
        symbolKind: 'function',
        filePath: 'src/nowhere.ts',
        oldName: 'oldName',
        oldFilePath: null,
        fingerprint: 'xyz',
        changedAt: new Date().toISOString(),
        isFullIndex: false,
        indexRunId: 'run-4',
      }],
    });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(0);
    expect(result.broken).toBe(0);
  });

  // ── CO ──

  it('should handle rename where oldName is null (uses symbolName as fallback)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'fallback',
      summary: 'Fallback',
      codeLinks: [{ kind: 'function', file: 'src/f.ts', symbol: 'sameName' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [{
        changeType: 'renamed',
        symbolName: 'sameName',
        symbolKind: 'function',
        filePath: 'src/f.ts',
        oldName: null, // null → falls back to symbolName
        oldFilePath: null,
        fingerprint: 'abc',
        changedAt: new Date().toISOString(),
        isFullIndex: false,
        indexRunId: 'run-5',
      }],
    });

    // oldName is null → oldName = symbolName = 'sameName', same as current
    // This means the link matches but new name is same → still counts as update
    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
  });

  it('should handle multiple changes affecting the same card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'multi-change',
      summary: 'Multi',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
        { kind: 'function', file: 'src/b.ts', symbol: 'fnB' },
      ], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      getSymbolChanges: () => [
        {
          changeType: 'renamed', symbolName: 'fnA2', symbolKind: 'function',
          filePath: 'src/a.ts', oldName: 'fnA', oldFilePath: null,
          fingerprint: 'a', changedAt: new Date().toISOString(), isFullIndex: false, indexRunId: 'r',
        },
        {
          changeType: 'removed', symbolName: 'fnB', symbolKind: 'function',
          filePath: 'src/b.ts', oldName: null, oldFilePath: null,
          fingerprint: null, changedAt: new Date().toISOString(), isFullIndex: false, indexRunId: 'r',
        },
      ],
    });

    const result = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.changes).toHaveLength(2);
  });

  // ── ID ──

  it('should be idempotent when called twice with same changes', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'idem-sync',
      summary: 'Idem',
      codeLinks: [{ kind: 'function', file: 'src/i.ts', symbol: 'old' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    const mockChanges = [{
      changeType: 'renamed' as const, symbolName: 'new', symbolKind: 'function',
      filePath: 'src/i.ts', oldName: 'old', oldFilePath: null,
      fingerprint: 'x', changedAt: new Date().toISOString(), isFullIndex: false, indexRunId: 'r',
    }];
    tc.ctx.gildash = createMockGildash({ getSymbolChanges: () => mockChanges });

    syncSymbolChanges(tc.ctx, '2020-01-01');
    // Second call: oldName 'old' no longer exists in code links (now 'new')
    const r2 = syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(r2.updated).toBe(0);
  });
});

// ════════════════════════════════════════
// getLinkCoverage
// ════════════════════════════════════════

describe('getLinkCoverage', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── HP ──

  it('should return full coverage when all links resolve', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'full-cov',
      summary: 'Full coverage',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
        { kind: 'class', file: 'src/b.ts', symbol: 'ClassB' },
      ], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: ({ text, filePath }: any) => {
        if (text === 'fnA') return [{ name: 'fnA', filePath: 'src/a.ts', kind: 'function' }];
        if (text === 'ClassB') return [{ name: 'ClassB', filePath: 'src/b.ts', kind: 'class' }];
        return [];
      },
      getSymbolsByFile: () => [],
    });

    const result = await getLinkCoverage(tc.ctx, 'full-cov');
    expect(result.declared).toBe(2);
    expect(result.resolved).toBe(2);
    expect(result.broken).toBe(0);
    expect(result.coverage).toBe(1);
  });

  it('should report broken links and reduced coverage', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'partial-cov',
      summary: 'Partial',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'exists' },
        { kind: 'function', file: 'src/b.ts', symbol: 'missing' },
      ], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: ({ text }: any) => {
        if (text === 'exists') return [{ name: 'exists', filePath: 'src/a.ts', kind: 'function' }];
        return [];
      },
      getSymbolsByFile: () => [],
    });

    const result = await getLinkCoverage(tc.ctx, 'partial-cov');
    expect(result.declared).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.coverage).toBe(0.5);
  });

  it('should find unreferenced symbols in linked files', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'unref',
      summary: 'Unreferenced',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'fnA', filePath: 'src/a.ts', kind: 'function' }],
      getSymbolsByFile: (...args: unknown[]) => {
        if (args[0] === 'src/a.ts') return [
          { name: 'fnA', kind: 'function' },
          { name: 'fnB', kind: 'function' },
          { name: 'ClassC', kind: 'class' },
        ];
        return [];
      },
    });

    const result = await getLinkCoverage(tc.ctx, 'unref');
    expect(result.unreferenced).toHaveLength(2);
    expect(result.unreferenced.some((u) => u.symbol === 'fnB')).toBe(true);
    expect(result.unreferenced.some((u) => u.symbol === 'ClassC')).toBe(true);
  });

  // ── NE ──

  it('should throw GildashNotConfiguredError when gildash is not set', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-gildash', summary: 'No gildash', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    await expect(getLinkCoverage(tc.ctx, 'no-gildash')).rejects.toThrow(GildashNotConfiguredError);
  });

  // ── ED ──

  it('should return coverage 1 and empty arrays for card with no code links', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-links', summary: 'No links', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash();

    const result = await getLinkCoverage(tc.ctx, 'no-links');
    expect(result.declared).toBe(0);
    expect(result.resolved).toBe(0);
    expect(result.broken).toBe(0);
    expect(result.coverage).toBe(1);
    expect(result.unreferenced).toHaveLength(0);
  });

  it('should handle searchSymbols returning non-array (error Result)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'err-search',
      summary: 'Error search',
      codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => ({ data: 'error', isErr: true }), // non-array
      getSymbolsByFile: () => [],
    });

    const result = await getLinkCoverage(tc.ctx, 'err-search');
    expect(result.broken).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('should handle getSymbolsByFile returning null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'null-syms',
      summary: 'Null symbols',
      codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'fn', filePath: 'src/x.ts', kind: 'function' }],
      getSymbolsByFile: () => null,
    });

    const result = await getLinkCoverage(tc.ctx, 'null-syms');
    expect(result.unreferenced).toHaveLength(0);
  });

  // ── CO ──

  it('should count all links as broken when none resolve', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'all-broken',
      summary: 'All broken',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'gone1' },
        { kind: 'function', file: 'src/b.ts', symbol: 'gone2' },
      ], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getSymbolsByFile: () => [],
    });

    const result = await getLinkCoverage(tc.ctx, 'all-broken');
    expect(result.declared).toBe(2);
    expect(result.broken).toBe(2);
    expect(result.coverage).toBe(0);
  });

  it('should call gildash.reindex() before calculating coverage', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'reindex-cov',
      summary: 'Reindex coverage',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    const mockReindex = mock(() => Promise.resolve());
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'fn', filePath: 'src/a.ts', kind: 'function' }],
      getSymbolsByFile: () => [],
    });
    (tc.ctx.gildash as any).reindex = mockReindex;

    await getLinkCoverage(tc.ctx, 'reindex-cov');
    expect(mockReindex).toHaveBeenCalledTimes(1);
  });
});
