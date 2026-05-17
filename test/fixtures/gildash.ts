/**
 * Shared Gildash mock factories for tests.
 *
 * Two variants:
 *
 * 1. `mockGildash(overrides)` — minimal stub. Every method defaults to "empty
 *    result"; pass `overrides` to control specific methods. Used by tests that
 *    drive Gildash through individual method returns.
 *
 * 2. `mockGildashFromSymbols(symbols, overrides?)` — populates `searchSymbols`,
 *    `getSymbolsByFile`, and `listIndexedFiles` from a `{filePath: Symbol[]}`
 *    map. Used by tests that need a populated index.
 *
 * Both return `as any` because the real Gildash interface is large and tests
 * only need a subset; tightening this would require duplicating Gildash's full
 * type surface in the fixture.
 */
import { mock } from 'bun:test';

interface SymbolShape {
  name: string;
  kind: string;
  filePath?: string;
  memberName?: string | null;
}

// `AnyFn` lets tests supply a callback typed however the call site is
// convenient (e.g. `({ tag }: { tag: string }) => ...`) without forcing
// every test to cast to `(...args: unknown[]) => unknown`. Param type is
// `any[]` (not `unknown[]` or `never[]`) so the bivariance accepts both
// the structured-arg callbacks tests supply AND the loosely-typed internal
// calls the fixture itself makes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAsyncFn = (...args: any[]) => Promise<unknown>;

export interface MockGildashOverrides {
  searchAnnotations?: AnyFn;
  searchSymbols?: AnyFn;
  getSymbolChanges?: AnyFn;
  getSymbolsByFile?: AnyFn;
  getFileInfo?: AnyFn;
  getDependencies?: AnyFn;
  listIndexedFiles?: AnyFn;
  reindex?: () => Promise<void>;
  // Cycle / fan / heritage / pattern surface — used by analyze, impact, etc.
  hasCycle?: AnyAsyncFn;
  getCyclePaths?: AnyAsyncFn;
  getFanMetrics?: AnyAsyncFn;
  getHeritageChain?: AnyAsyncFn;
  searchRelations?: AnyFn;
  findPattern?: AnyAsyncFn;
  getDependents?: AnyFn;
}

/**
 * Minimal Gildash stub. Every method defaults to returning empty/no-op.
 * Pass `overrides` to control specific methods.
 *
 * `getSymbolsByFile` defaults to deriving from `searchSymbols` so tests that
 * only configure `searchSymbols` still get consistent file-cache results.
 */
export function mockGildash(overrides: MockGildashOverrides = {}) {
  const searchSymbols = overrides.searchSymbols ?? (() => []);
  const defaultGetSymbolsByFile = (file: string) => {
    const result = searchSymbols({ filePath: file, exact: false }) as Array<{ filePath?: string }>;
    return Array.isArray(result) ? result.filter((s) => !s.filePath || s.filePath === file) : [];
  };
  return {
    searchAnnotations: mock(overrides.searchAnnotations ?? (() => [])),
    searchSymbols: mock(searchSymbols),
    getSymbolChanges: mock(overrides.getSymbolChanges ?? (() => [])),
    getSymbolsByFile: mock(overrides.getSymbolsByFile ?? defaultGetSymbolsByFile),
    listIndexedFiles: mock(overrides.listIndexedFiles ?? (() => [])),
    getFileInfo: mock(overrides.getFileInfo ?? (() => null)),
    getDependencies: overrides.getDependencies ? mock(overrides.getDependencies) : undefined,
    hasCycle: mock(overrides.hasCycle ?? (async () => false)),
    getCyclePaths: mock(overrides.getCyclePaths ?? (async () => [])),
    getFanMetrics: mock(overrides.getFanMetrics ?? (async () => ({ filePath: '', fanIn: 0, fanOut: 0 }))),
    getHeritageChain: mock(overrides.getHeritageChain ?? (async () => ({ symbolName: '', filePath: '', children: [] }))),
    searchRelations: mock(overrides.searchRelations ?? (() => [])),
    findPattern: mock(overrides.findPattern ?? (async () => [])),
    getDependents: mock(overrides.getDependents ?? (() => [])),
    reindex: mock(overrides.reindex ?? (() => Promise.resolve())),
    close: mock(() => Promise.resolve()),
  } as any;
}

/**
 * Gildash stub built from a `{filePath: SymbolShape[]}` map.
 *
 * Populates `searchSymbols`, `getSymbolsByFile`, and `listIndexedFiles` so
 * coverage / link / scope tests can declare their fixture data once and have
 * the index respond consistently. Accepts both absolute and relative path
 * lookups (real gildash 0.26 stores project-root-relative paths).
 */
export function mockGildashFromSymbols(
  symbols: Record<string, SymbolShape[]>,
  overrides?: { searchAnnotations?: (...args: unknown[]) => unknown[] },
) {
  const fileSymbols = new Map<string, Array<SymbolShape>>();
  const indexedFiles: Array<{
    project: string;
    filePath: string;
    mtimeMs: number;
    size: number;
    contentHash: string;
    updatedAt: string;
    lineCount: number;
  }> = [];

  for (const [filePath, syms] of Object.entries(symbols)) {
    fileSymbols.set(
      filePath,
      syms.map((s) => ({
        ...s,
        filePath,
        id: 0,
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        signature: null,
        fingerprint: null,
        detail: {},
      } as any)),
    );
    indexedFiles.push({
      project: 'default',
      filePath,
      mtimeMs: Date.now(),
      size: 100,
      contentHash: 'abc',
      updatedAt: new Date().toISOString(),
      lineCount: 10,
    });
  }

  return {
    reindex: async () => {},
    close: async () => {},
    listIndexedFiles: () => indexedFiles,
    getSymbolsByFile: (fp: string) => {
      const direct = fileSymbols.get(fp);
      if (direct) return direct;
      for (const [key, syms] of fileSymbols) {
        if (key === fp || key.endsWith('/' + fp)) return syms;
      }
      return [];
    },
    searchSymbols: (query: { text?: string; exact?: boolean; filePath?: string }) => {
      const results: any[] = [];
      for (const [fp, syms] of fileSymbols) {
        if (query.filePath) {
          const matches = fp === query.filePath || fp.endsWith('/' + query.filePath);
          if (!matches) continue;
        }
        for (const s of syms) {
          if (query.exact && query.text && s.name !== query.text) continue;
          if (!query.exact && query.text && !s.name.includes(query.text)) continue;
          results.push(query.filePath ? { ...s, filePath: query.filePath } : s);
        }
      }
      return results;
    },
    getSymbolChanges: () => [],
    searchAnnotations: overrides?.searchAnnotations ?? (() => []),
    getDependencies: () => [],
  } as any;
}
