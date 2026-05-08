/**
 * Integration tests for code link automation (spec-sync, symbol-sync, coverage).
 *
 * Gildash is outside the SUT boundary → mocked via ctx.gildash.
 * Real DB + real file system inside SUT boundary.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createCard,
  syncSpecAnnotations,
  writeSpecAnnotations,
  syncSymbolChanges,
  getLinkCoverage,
} from '../../index';
import { createMockTestContext, type TestContext } from '../helpers';

// ── Mock Gildash Factory ──

import { mockGildash as createMockGildash } from '../fixtures/gildash';

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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'auth-token', summary: 'Auth token', type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'card-a', summary: 'A', type: 'spec' as const });
    await createCard(tc.ctx, { key: 'card-b', summary: 'B', type: 'spec' as const });
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

  it('should report unmatched when card does not exist for annotation', async () => {
    tc = await createMockTestContext();
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
    tc = await createMockTestContext();
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'orphan', summary: 'Orphan', type: 'spec' as const });
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'orphan', filePath: 'src/x.ts', symbolName: null, source: 'block' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
  });

  it('should return zero counts when no annotations found', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({ searchAnnotations: () => [] });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it('should not create duplicate link when link already exists', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'dup-link',
      summary: 'Dup',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'existing' }], type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'preserve',
      summary: 'Preserve',
      codeLinks: [{ kind: 'class', file: 'src/old.ts', symbol: 'OldClass' }], type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'err-sym', summary: 'Error symbol', type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'no-match', summary: 'No match', type: 'spec' as const });
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
    tc = await createMockTestContext();
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'idem', summary: 'Idempotent', type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'rename-card',
      summary: 'Rename',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'oldName' }], type: 'spec' as const });
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

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.changes[0]!.changeType).toBe('renamed');
    expect(result.changes[0]!.newSymbol).toBe('newName');

    const links = tc.ctx.codeLinkRepo.findByCardKey('rename-card');
    expect(links[0]!.symbol).toBe('newName');
  });

  it('should update file path on move', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'move-card',
      summary: 'Move',
      codeLinks: [{ kind: 'class', file: 'src/old-path.ts', symbol: 'MyClass' }], type: 'spec' as const });
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

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.changes[0]!.newFile).toBe('src/new-path.ts');

    const links = tc.ctx.codeLinkRepo.findByCardKey('move-card');
    expect(links[0]!.file).toBe('src/new-path.ts');
  });

  it('should report removed symbols as broken without deleting links', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'del-card',
      summary: 'Deleted',
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'deletedFn' }], type: 'spec' as const });
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

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.broken).toBe(1);
    expect(result.updated).toBe(0);

    // Link should still exist (not auto-deleted)
    const links = tc.ctx.codeLinkRepo.findByCardKey('del-card');
    expect(links).toHaveLength(1);
  });

  // ── ED ──

  it('should return zero counts when no changes detected', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = createMockGildash({ getSymbolChanges: () => [] });

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(0);
    expect(result.broken).toBe(0);
    expect(result.changes).toHaveLength(0);
  });

  it('should skip changes with no matching code links', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'unrelated',
      summary: 'Unrelated',
      codeLinks: [{ kind: 'function', file: 'src/other.ts', symbol: 'otherFn' }], type: 'spec' as const });
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

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(0);
    expect(result.broken).toBe(0);
  });

  // ── CO ──

  it('should handle rename where oldName is null (uses symbolName as fallback)', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'fallback',
      summary: 'Fallback',
      codeLinks: [{ kind: 'function', file: 'src/f.ts', symbol: 'sameName' }], type: 'spec' as const });
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
    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
  });

  it('should handle multiple changes affecting the same card', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'multi-change',
      summary: 'Multi',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
        { kind: 'function', file: 'src/b.ts', symbol: 'fnB' },
      ], type: 'spec' as const });
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

    const result = await syncSymbolChanges(tc.ctx, '2020-01-01');
    expect(result.updated).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.changes).toHaveLength(2);
  });

  // ── ID ──

  it('should be idempotent when called twice with same changes', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'idem-sync',
      summary: 'Idem',
      codeLinks: [{ kind: 'function', file: 'src/i.ts', symbol: 'old' }], type: 'spec' as const });
    const mockChanges = [{
      changeType: 'renamed' as const, symbolName: 'new', symbolKind: 'function',
      filePath: 'src/i.ts', oldName: 'old', oldFilePath: null,
      fingerprint: 'x', changedAt: new Date().toISOString(), isFullIndex: false, indexRunId: 'r',
    }];
    tc.ctx.gildash = createMockGildash({ getSymbolChanges: () => mockChanges });

    await syncSymbolChanges(tc.ctx, '2020-01-01');
    // Second call: oldName 'old' no longer exists in code links (now 'new')
    const r2 = await syncSymbolChanges(tc.ctx, '2020-01-01');
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'full-cov',
      summary: 'Full coverage',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
        { kind: 'class', file: 'src/b.ts', symbol: 'ClassB' },
      ], type: 'spec' as const });
    tc.ctx.gildash = createMockGildash({
      getSymbolsByFile: (file: any) => {
        if (file === 'src/a.ts') return [{ name: 'fnA', memberName: null, filePath: 'src/a.ts', kind: 'function' }];
        if (file === 'src/b.ts') return [{ name: 'ClassB', memberName: null, filePath: 'src/b.ts', kind: 'class' }];
        return [];
      },
    });

    const result = await getLinkCoverage(tc.ctx, 'full-cov');
    expect(result.declared).toBe(2);
    expect(result.resolved).toBe(2);
    expect(result.broken).toBe(0);
    expect(result.coverage).toBe(1);
  });

  it('should report broken links and reduced coverage', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'partial-cov',
      summary: 'Partial',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'exists' },
        { kind: 'function', file: 'src/b.ts', symbol: 'missing' },
      ], type: 'spec' as const });
    tc.ctx.gildash = createMockGildash({
      getSymbolsByFile: (file: any) => {
        if (file === 'src/a.ts') return [{ name: 'exists', memberName: null, filePath: 'src/a.ts', kind: 'function' }];
        return [];
      },
    });

    const result = await getLinkCoverage(tc.ctx, 'partial-cov');
    expect(result.declared).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.coverage).toBe(0.5);
  });

  it('should find unreferenced symbols in linked files', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'unref',
      summary: 'Unreferenced',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }], type: 'spec' as const });
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


  // ── ED ──

  it('should return coverage 1 and empty arrays for card with no code links', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'no-links', summary: 'No links', type: 'spec' as const });
    tc.ctx.gildash = createMockGildash();

    const result = await getLinkCoverage(tc.ctx, 'no-links');
    expect(result.declared).toBe(0);
    expect(result.resolved).toBe(0);
    expect(result.broken).toBe(0);
    expect(result.coverage).toBe(1);
    expect(result.unreferenced).toHaveLength(0);
  });

  it('should handle searchSymbols returning non-array (error Result)', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'err-search',
      summary: 'Error search',
      codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }], type: 'spec' as const });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => ({ data: 'error', isErr: true }), // non-array
      getSymbolsByFile: () => [],
    });

    const result = await getLinkCoverage(tc.ctx, 'err-search');
    expect(result.broken).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('should handle getSymbolsByFile returning null', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'null-syms',
      summary: 'Null symbols',
      codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }], type: 'spec' as const });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'fn', filePath: 'src/x.ts', kind: 'function' }],
      getSymbolsByFile: () => null,
    });

    const result = await getLinkCoverage(tc.ctx, 'null-syms');
    expect(result.unreferenced).toHaveLength(0);
  });

  // ── CO ──

  it('should count all links as broken when none resolve', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'all-broken',
      summary: 'All broken',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'gone1' },
        { kind: 'function', file: 'src/b.ts', symbol: 'gone2' },
      ], type: 'spec' as const });
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
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'reindex-cov',
      summary: 'Reindex coverage',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }], type: 'spec' as const });
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

// ════════════════════════════════════════
// writeSpecAnnotations
// ════════════════════════════════════════

describe('writeSpecAnnotations', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  /** Helper: create a source file inside the test project root and return its relative path. */
  async function writeSourceFile(projectRoot: string, relPath: string, content: string) {
    const absPath = join(projectRoot, relPath);
    const dir = absPath.substring(0, absPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await Bun.write(absPath, content);
    return relPath;
  }

  /** Helper: read a source file from the test project root. */
  async function readSourceFile(projectRoot: string, relPath: string) {
    return Bun.file(join(projectRoot, relPath)).text();
  }

  // ── HP: Happy Path ──

  it('should insert @spec annotation above a symbol with no existing comment', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/auth.ts';
    await writeSourceFile(projectRoot, relPath, 'export function generateToken() {\n  return "tok";\n}\n');

    await createCard(tc.ctx, {
      key: 'auth-token',
      summary: 'Auth token',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'generateToken' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'generateToken', filePath: relPath, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, 'auth-token');
    expect(result.annotated).toBe(1);
    expect(result.alreadyPresent).toBe(0);
    expect(result.symbolNotFound).toBe(0);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('/** @spec auth-token */');
    expect(content).toContain('export function generateToken()');
  });

  it('should add @spec tag inside existing multi-line JSDoc', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/utils.ts';
    const original = [
      '/**',
      ' * Generate a unique identifier.',
      ' */',
      'export function generateId() {',
      '  return "id";',
      '}',
      '',
    ].join('\n');
    await writeSourceFile(projectRoot, relPath, original);

    await createCard(tc.ctx, {
      key: 'util-id',
      summary: 'ID util',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'generateId' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'generateId', filePath: relPath, kind: 'function', span: { start: { line: 4, column: 0 }, end: { line: 6, column: 1 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, 'util-id');
    expect(result.annotated).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    // Should be inside the JSDoc block, not a separate comment
    expect(content).toContain(' * @spec util-id');
    expect(content).toContain(' * Generate a unique identifier.');
    // Should still have the closing */
    expect(content).toContain(' */');
  });

  it('should expand single-line JSDoc and add @spec tag', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/helper.ts';
    const original = '/** Short doc */\nexport function helper() {}\n';
    await writeSourceFile(projectRoot, relPath, original);

    await createCard(tc.ctx, {
      key: 'helper-card',
      summary: 'Helper',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'helper' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'helper', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 27 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, 'helper-card');
    expect(result.annotated).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('@spec helper-card');
    expect(content).toContain('Short doc');
  });

  // ── ED: Edge ──

  it('should not duplicate annotation when @spec already exists', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/dup.ts';
    const original = '/** @spec dup-card */\nexport function dupFn() {}\n';
    await writeSourceFile(projectRoot, relPath, original);

    await createCard(tc.ctx, {
      key: 'dup-card',
      summary: 'Dup',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'dupFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'dupFn', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 27 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, 'dup-card');
    expect(result.annotated).toBe(0);
    expect(result.alreadyPresent).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    // Should appear exactly once
    const matches = content.match(/@spec dup-card/g);
    expect(matches).toHaveLength(1);
  });

  it('should not duplicate @spec inside existing multi-line JSDoc', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/existing.ts';
    const original = [
      '/**',
      ' * Some doc.',
      ' * @spec existing-card',
      ' */',
      'export function existingFn() {}',
      '',
    ].join('\n');
    await writeSourceFile(projectRoot, relPath, original);

    await createCard(tc.ctx, {
      key: 'existing-card',
      summary: 'Existing',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'existingFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'existingFn', filePath: relPath, kind: 'function', span: { start: { line: 5, column: 0 }, end: { line: 5, column: 32 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, 'existing-card');
    expect(result.annotated).toBe(0);
    expect(result.alreadyPresent).toBe(1);
  });

  it('should count symbolNotFound when gildash returns no match', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    await createCard(tc.ctx, {
      key: 'ghost-card',
      summary: 'Ghost',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: 'src/ghost.ts', symbol: 'ghostFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [], // no match
    });

    const result = await writeSpecAnnotations(tc.ctx, 'ghost-card');
    expect(result.annotated).toBe(0);
    expect(result.symbolNotFound).toBe(1);
  });

  it('should process all cards when no key filter is provided', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPathA = 'src/a.ts';
    const relPathB = 'src/b.ts';
    await writeSourceFile(projectRoot, relPathA, 'export function fnA() {}\n');
    await writeSourceFile(projectRoot, relPathB, 'export function fnB() {}\n');

    await createCard(tc.ctx, {
      key: 'card-a',
      summary: 'A',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPathA, symbol: 'fnA' }],
    });
    await createCard(tc.ctx, {
      key: 'card-b',
      summary: 'B',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPathB, symbol: 'fnB' }],
    });

    tc.ctx.gildash = createMockGildash({
      getSymbolsByFile: (file: any) => {
        if (file === relPathA) return [{ name: 'fnA', memberName: null, filePath: relPathA, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } } }];
        if (file === relPathB) return [{ name: 'fnB', memberName: null, filePath: relPathB, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } } }];
        return [];
      },
    });

    const result = await writeSpecAnnotations(tc.ctx);
    expect(result.annotated).toBe(2);

    const contentA = await readSourceFile(projectRoot, relPathA);
    const contentB = await readSourceFile(projectRoot, relPathB);
    expect(contentA).toContain('@spec card-a');
    expect(contentB).toContain('@spec card-b');
  });

  // B-1: two cards referencing same symbol on same line
  it('should insert both @spec tags when two cards reference the same symbol', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/shared-sym.ts';
    await writeSourceFile(projectRoot, relPath, 'export function sharedFn() {}\n');

    await createCard(tc.ctx, {
      key: 'card-alpha',
      summary: 'Alpha',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'sharedFn' }],
    });
    await createCard(tc.ctx, {
      key: 'card-beta',
      summary: 'Beta',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'sharedFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'sharedFn', filePath: relPath, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx);
    expect(result.annotated).toBe(2);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('@spec card-alpha');
    expect(content).toContain('@spec card-beta');
    // Both tags should be in consecutive lines within same JSDoc block
    const lines = content.split('\n');
    const alphaIdx = lines.findIndex((l) => l.includes('@spec card-alpha'));
    const betaIdx = lines.findIndex((l) => l.includes('@spec card-beta'));
    expect(Math.abs(alphaIdx - betaIdx)).toBe(1);
  });

  it('should add both @spec tags inside existing JSDoc when two cards share same symbol', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/shared-jsdoc.ts';
    await writeSourceFile(projectRoot, relPath, [
      '/**',
      ' * Existing doc.',
      ' */',
      'export function sharedJsFn() {}',
      '',
    ].join('\n'));

    await createCard(tc.ctx, {
      key: 'jsdoc-a',
      summary: 'JA',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'sharedJsFn' }],
    });
    await createCard(tc.ctx, {
      key: 'jsdoc-b',
      summary: 'JB',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'sharedJsFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'sharedJsFn', filePath: relPath, kind: 'function', span: { start: { line: 4, column: 0 }, end: { line: 4, column: 35 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx);
    expect(result.annotated).toBe(2);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('@spec jsdoc-a');
    expect(content).toContain('@spec jsdoc-b');
    expect(content).toContain('Existing doc.');
    // All within same JSDoc block — verify closing */ comes after both tags
    const lines = content.split('\n');
    const closingIdx = lines.findIndex((l) => l.trim() === '*/');
    const aIdx = lines.findIndex((l) => l.includes('@spec jsdoc-a'));
    const bIdx = lines.findIndex((l) => l.includes('@spec jsdoc-b'));
    expect(aIdx).toBeLessThan(closingIdx);
    expect(bIdx).toBeLessThan(closingIdx);
  });

  it('should skip already-present card and insert only new card when same symbol shared', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/partial-dup.ts';
    await writeSourceFile(projectRoot, relPath, [
      '/** @spec existing-card */',
      'export function partialFn() {}',
      '',
    ].join('\n'));

    await createCard(tc.ctx, {
      key: 'existing-card',
      summary: 'Exists',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'partialFn' }],
    });
    await createCard(tc.ctx, {
      key: 'new-card',
      summary: 'New',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'partialFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'partialFn', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 35 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx);
    expect(result.annotated).toBe(1);
    expect(result.alreadyPresent).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('@spec existing-card');
    expect(content).toContain('@spec new-card');
    // existing-card should appear exactly once
    expect(content.match(/@spec existing-card/g)).toHaveLength(1);
  });

  // ── CO: Corner ──

  it('should return zero counts when card has no code links', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    await createCard(tc.ctx, {
      key: 'empty-links',
      summary: 'No links',
      type: 'spec' as const,
    });

    tc.ctx.gildash = createMockGildash();

    const result = await writeSpecAnnotations(tc.ctx, 'empty-links');
    expect(result.annotated).toBe(0);
    expect(result.alreadyPresent).toBe(0);
    expect(result.symbolNotFound).toBe(0);
  });

  it('should handle multiple code links to the same file', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/multi.ts';
    await writeSourceFile(projectRoot, relPath, 'export function fnX() {}\n\nexport function fnY() {}\n');

    await createCard(tc.ctx, {
      key: 'multi-link',
      summary: 'Multi',
      type: 'spec' as const,
      codeLinks: [
        { kind: 'function', file: relPath, symbol: 'fnX' },
        { kind: 'function', file: relPath, symbol: 'fnY' },
      ],
    });

    tc.ctx.gildash = createMockGildash({
      getSymbolsByFile: (file: any) => {
        if (file !== relPath) return [];
        return [
          { name: 'fnX', memberName: null, filePath: relPath, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } } },
          { name: 'fnY', memberName: null, filePath: relPath, kind: 'function', span: { start: { line: 3, column: 0 }, end: { line: 3, column: 25 } } },
        ];
      },
    });

    const result = await writeSpecAnnotations(tc.ctx, 'multi-link');
    expect(result.annotated).toBe(2);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).toContain('@spec multi-link');
    const matches = content.match(/@spec multi-link/g);
    expect(matches).toHaveLength(2);
  });

  // ── ID: Idempotency ──

  it('should be idempotent when called twice', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/idem.ts';
    await writeSourceFile(projectRoot, relPath, 'export function idemFn() {}\n');

    await createCard(tc.ctx, {
      key: 'idem-write',
      summary: 'Idempotent write',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'idemFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'idemFn', filePath: relPath, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 27 } } },
      ],
    });

    const r1 = await writeSpecAnnotations(tc.ctx, 'idem-write');
    expect(r1.annotated).toBe(1);

    // Second call: annotation already exists → should not insert again
    // Note: gildash line number shifts after first write, so we update the mock
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [
        { name: 'idemFn', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 27 } } },
      ],
    });

    const r2 = await writeSpecAnnotations(tc.ctx, 'idem-write');
    expect(r2.annotated).toBe(0);
    expect(r2.alreadyPresent).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    const matches = content.match(/@spec idem-write/g);
    expect(matches).toHaveLength(1);
  });

  // ── Reconciler: REMOVE orphan @spec ──

  it('should remove orphan @spec when card is deleted (standalone comment)', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/orphan.ts';
    // Source has @spec for a card that no longer exists in DB
    await writeSourceFile(projectRoot, relPath, '/** @spec deleted-card */\nexport function orphanFn() {}\n');

    // No cards in DB — desired set is empty
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'deleted-card', filePath: relPath, symbolName: 'orphanFn', source: 'jsdoc', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } } },
      ],
      searchSymbols: () => [],
    });

    const result = await writeSpecAnnotations(tc.ctx, undefined, { prune: true });
    expect(result.removed).toBe(1);
    expect(result.annotated).toBe(0);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).not.toContain('@spec deleted-card');
    expect(content).toContain('export function orphanFn()');
  });

  it('should remove orphan @spec line inside multi-line JSDoc', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/multi.ts';
    const original = [
      '/**',
      ' * Real documentation.',
      ' * @spec old-card',
      ' */',
      'export function multiFn() {}',
      '',
    ].join('\n');
    await writeSourceFile(projectRoot, relPath, original);

    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'old-card', filePath: relPath, symbolName: 'multiFn', source: 'jsdoc', span: { start: { line: 3, column: 0 }, end: { line: 3, column: 17 } } },
      ],
      searchSymbols: () => [],
    });

    const result = await writeSpecAnnotations(tc.ctx, undefined, { prune: true });
    expect(result.removed).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).not.toContain('@spec old-card');
    expect(content).toContain('Real documentation.');
    expect(content).toContain('export function multiFn()');
  });

  it('should remove entire JSDoc block when @spec was the only content', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/empty-jsdoc.ts';
    const original = [
      '/**',
      ' * @spec only-spec',
      ' */',
      'export function emptyJsdocFn() {}',
      '',
    ].join('\n');
    await writeSourceFile(projectRoot, relPath, original);

    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'only-spec', filePath: relPath, symbolName: 'emptyJsdocFn', source: 'jsdoc', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 18 } } },
      ],
      searchSymbols: () => [],
    });

    const result = await writeSpecAnnotations(tc.ctx, undefined, { prune: true });
    expect(result.removed).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).not.toContain('/**');
    expect(content).not.toContain('@spec');
    expect(content).toContain('export function emptyJsdocFn()');
  });

  it('should handle rename: remove old key + insert new key', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/rename.ts';
    // Source has @spec with old key
    await writeSourceFile(projectRoot, relPath, '/** @spec old-key */\nexport function renameFn() {}\n');

    // DB has card with new key
    await createCard(tc.ctx, {
      key: 'new-key',
      summary: 'Renamed card',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'renameFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'old-key', filePath: relPath, symbolName: 'renameFn', source: 'jsdoc', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } } },
      ],
      searchSymbols: () => [
        { name: 'renameFn', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 28 } } },
      ],
    });

    const result = await writeSpecAnnotations(tc.ctx, undefined, { prune: true });
    expect(result.removed).toBe(1);
    expect(result.annotated).toBe(1);

    const content = await readSourceFile(projectRoot, relPath);
    expect(content).not.toContain('@spec old-key');
    expect(content).toContain('@spec new-key');
  });

  it('should remove all @spec when DB is empty (reset scenario)', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    await writeSourceFile(projectRoot, 'src/a.ts', '/** @spec card-a */\nexport function fnA() {}\n');
    await writeSourceFile(projectRoot, 'src/b.ts', '/** @spec card-b */\nexport function fnB() {}\n');

    // DB is empty — no cards
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'card-a', filePath: 'src/a.ts', symbolName: 'fnA', source: 'jsdoc', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 19 } } },
        { tag: 'spec', value: 'card-b', filePath: 'src/b.ts', symbolName: 'fnB', source: 'jsdoc', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 19 } } },
      ],
      searchSymbols: () => [],
    });

    const result = await writeSpecAnnotations(tc.ctx, undefined, { prune: true });
    expect(result.removed).toBe(2);
    expect(result.annotated).toBe(0);

    const contentA = await readSourceFile(projectRoot, 'src/a.ts');
    const contentB = await readSourceFile(projectRoot, 'src/b.ts');
    expect(contentA).not.toContain('@spec');
    expect(contentB).not.toContain('@spec');
  });

  it('should be idempotent: removed=0, annotated=0 on second run', async () => {
    tc = await createMockTestContext();
    const projectRoot = tc.cardsDir.replace(/\/cards$/, '');
    tc.ctx.projectRoot = projectRoot;

    const relPath = 'src/idem2.ts';
    await writeSourceFile(projectRoot, relPath, 'export function idem2Fn() {}\n');

    await createCard(tc.ctx, {
      key: 'idem2-card',
      summary: 'Idempotent',
      type: 'spec' as const,
      codeLinks: [{ kind: 'function', file: relPath, symbol: 'idem2Fn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [],
      searchSymbols: () => [
        { name: 'idem2Fn', filePath: relPath, kind: 'function', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 28 } } },
      ],
    });

    // First run: should insert
    const r1 = await writeSpecAnnotations(tc.ctx, 'idem2-card');
    expect(r1.annotated).toBe(1);
    expect(r1.removed).toBe(0);

    // Mock now returns the annotation we just inserted
    tc.ctx.gildash = createMockGildash({
      searchAnnotations: () => [
        { tag: 'spec', value: 'idem2-card', filePath: relPath, symbolName: 'idem2Fn', source: 'jsdoc', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 23 } } },
      ],
      searchSymbols: () => [
        { name: 'idem2Fn', filePath: relPath, kind: 'function', span: { start: { line: 2, column: 0 }, end: { line: 2, column: 28 } } },
      ],
    });

    // Second run: should be no-op
    const r2 = await writeSpecAnnotations(tc.ctx, 'idem2-card');
    expect(r2.annotated).toBe(0);
    expect(r2.removed).toBe(0);
    expect(r2.alreadyPresent).toBe(1);
  });
});
