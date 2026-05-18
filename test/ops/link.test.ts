import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Gildash, SymbolSearchResult } from '@zipbul/gildash';

import { createMockTestContext, type TestContext } from '../helpers';
import { makeFakeSymbol } from '../fixtures/gildash';
import { writeCardFile } from '../../src/fs/writer';
import { buildCardPath, normalizeSlug } from '../../index';
import type { CardFile, CodeLink, CardRow } from '../../index';
import {
  resolveCardCodeLinks,
  findCardsBySymbol,
  validateCodeLinks,
} from '../../index';

// ---- Setup ----

let tc: TestContext;
let mockSearchSymbols: ReturnType<typeof mock>;

beforeEach(async () => {
  tc = await createMockTestContext();
  mockSearchSymbols = mock(() => [] as SymbolSearchResult[]);
  // SymbolFileCache uses getSymbolsByFile; route it through the same mock
  // so existing test cases that configure searchSymbols still drive results.
  const mockGetSymbolsByFile = (file: string) =>
    (mockSearchSymbols({ filePath: file, text: '', exact: true }) as SymbolSearchResult[])
      .filter((s) => s.filePath === file);
  tc.ctx.gildash = {
    searchSymbols: mockSearchSymbols,
    getSymbolsByFile: mockGetSymbolsByFile,
    reindex: async () => ({ filesProcessed: 0, symbolsExtracted: 0, relationsExtracted: 0 }),
    close: mock(async () => undefined),
  } as unknown as Gildash;
});

afterEach(async () => {
  await tc.cleanup();
});

// ---- Helpers ----

async function createCard(
  key: string,
  codeLinks?: CodeLink[],
  status: 'draft' | 'active' | 'drifted' = 'draft',
): Promise<void> {
  const slug = normalizeSlug(key);
  const filePath = buildCardPath(tc.ctx.cardsDir, slug);
  await mkdir(dirname(filePath), { recursive: true });
  const cardFile: CardFile = {
    frontmatter: {
      key: slug,
      summary: `Card ${slug}`,
      status,
      type: 'spec',
    },
  };
  await writeCardFile(filePath, cardFile);
  // Persist a DB card row so validateCodeLinks can read its status.
  insertInDb(key);
  if (codeLinks && codeLinks.length > 0) {
    tc.ctx.codeLinkRepo.replaceForCard(slug, codeLinks);
  }
  // Re-write status field on the DB row to match what was passed in.
  if (status !== 'draft') {
    const existing = tc.ctx.cardRepo.findByKey(slug)!;
    tc.ctx.cardRepo.upsert({ ...existing, status });
  }
}

function insertInDb(key: string): void {
  const slug = normalizeSlug(key);
  const row: CardRow = {
    key: slug,
    summary: `Card ${slug}`,
    status: 'draft',
    type: 'spec',
    parent: null,
    namespacesJson: null,
    body: null,
    glossaryJson: '[]',
    filePath: buildCardPath(tc.ctx.cardsDir, slug),
    updatedAt: new Date().toISOString(),
  };
  tc.ctx.cardRepo.upsert(row);
}

const fakeSymbol = makeFakeSymbol() as SymbolSearchResult;

const throwGildashErr = () => {
  throw Object.assign(new Error('search failed'), { type: 'search', name: 'GildashError' });
};

// ---- Tests ----

describe('ops/link', () => {
  // 1. [HP] resolveCardCodeLinks: gildash + codeLink → symbol found
  it('should return resolved code link with symbol when gildash finds the symbol', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result).toHaveLength(1);
    expect(result[0]!.link).toEqual(link);
    expect(result[0]!.symbol).toBe(fakeSymbol);
  });

  // 2. [HP] resolveCardCodeLinks: codeLinks undefined in frontmatter → []
  it('should return empty array when card has no codeLinks field', async () => {
    await createCard('auth/token');
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result).toEqual([]);
  });

  // 3. [HP] resolveCardCodeLinks: codeLinks=[] → []
  it('should return empty array when card has empty codeLinks array', async () => {
    await createCard('auth/token', []);
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result).toEqual([]);
  });

  // 4. [HP] resolveCardCodeLinks: searchSymbols Err → {link, symbol: null}
  it('should return resolved link with null symbol when searchSymbols throws', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockImplementation(throwGildashErr);
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result).toHaveLength(1);
    expect(result[0]!.link).toEqual(link);
    expect(result[0]!.symbol).toBeNull();
  });

  // 5. [HP] resolveCardCodeLinks: symbol not in results → {link, symbol: null}
  it('should return null symbol when searchSymbols returns results that do not match', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([{ ...fakeSymbol, name: 'otherFn' }]);
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result[0]!.symbol).toBeNull();
  });

  // 6. [HP] findCardsBySymbol: no filePath → all cards with that symbol
  it('should return all cards referencing the symbol when no filePath is provided', async () => {
    insertInDb('spec/a');
    insertInDb('spec/b');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.codeLinkRepo.replaceForCard('spec/b', [{ kind: 'function', file: 'src/b.ts', symbol: 'fn' }]);
    const result = await findCardsBySymbol(tc.ctx, 'fn');
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.card.key);
    expect(keys).toContain('spec/a');
    expect(keys).toContain('spec/b');
    expect(result.every((r) => r.matchType === 'codeLink')).toBe(true);
  });

  // 7. [HP] findCardsBySymbol: filePath → filtered
  it('should return only cards referencing the symbol in the given file when filePath is provided', async () => {
    insertInDb('spec/a');
    insertInDb('spec/b');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.codeLinkRepo.replaceForCard('spec/b', [{ kind: 'function', file: 'src/b.ts', symbol: 'fn' }]);
    const result = await findCardsBySymbol(tc.ctx, 'fn', 'src/a.ts');
    expect(result).toHaveLength(1);
    expect(result[0]!.card.key).toBe('spec/a');
    expect(result[0]!.matchType).toBe('codeLink');
  });

  // 8. [HP] findCardsBySymbol: multiple links same card → deduplicated
  it('should return each card at most once even if it has multiple matching links', async () => {
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
      { kind: 'function', file: 'src/b.ts', symbol: 'fn' },
    ]);
    const result = await findCardsBySymbol(tc.ctx, 'fn');
    expect(result).toHaveLength(1);
    expect(result[0]!.card.key).toBe('spec/a');
  });

  // 11. [HP] validateCodeLinks: all valid → declared=1, valid=1, broken=[]
  it('should return empty array when all code links resolve to existing symbols', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    expect(result.declared).toBe(1);
    expect(result.valid).toBe(1);
    expect(result.broken).toEqual([]);
  });

  // 12. [HP] validateCodeLinks: broken symbol → BrokenLink 'symbol-not-found'
  it('should return BrokenLink with symbol-not-found when searchSymbols returns empty results', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([]);
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // draft card, so broken links go to planned
    expect(result.declared).toBe(1);
    expect(result.valid).toBe(0);
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]!.link).toEqual(link);
    expect(result.planned[0]!.reason).toBe('symbol-not-found');
  });

  // 14. [NE] resolveCardCodeLinks: card file missing → CardNotFoundError
  it('should throw CardNotFoundError when card file does not exist in resolveCardCodeLinks', async () => {
    await expect(resolveCardCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'CardNotFoundError',
    });
  });

  // 16. [NE] validateCodeLinks: card file missing → CardNotFoundError
  it('should throw CardNotFoundError when card file does not exist in validateCodeLinks', async () => {
    await expect(validateCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'CardNotFoundError',
    });
  });

  // 17. [NE] findCardsBySymbol: findByKey null → skip that card
  it('should skip cards where cardRepo has no matching row when findCardsBySymbol is called', async () => {
    tc.ctx.codeLinkRepo.replaceForCard('orphan/key', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
    ]);
    const result = await findCardsBySymbol(tc.ctx, 'fn');
    expect(result).toEqual([]);
  });


  // 20. [ED] findCardsBySymbol: no links matching → []
  it('should return empty array when no cards reference the symbol', async () => {
    const result = await findCardsBySymbol(tc.ctx, 'nonExistentFn');
    expect(result).toEqual([]);
  });

  // 21. [ED] validateCodeLinks: codeLinks=[] → declared=0
  it('should return empty result when card has empty codeLinks array in validateCodeLinks', async () => {
    await createCard('auth/token', []);
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    expect(result.declared).toBe(0);
    expect(result.valid).toBe(0);
    expect(result.broken).toEqual([]);
    expect(result.planned).toEqual([]);
  });

  // 22. [CO] resolveCardCodeLinks: codeLinks=[] + gildash present → []
  it('should return empty array when codeLinks is empty even with gildash configured', async () => {
    await createCard('auth/token', []);
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    expect(result).toEqual([]);
    expect(mockSearchSymbols).not.toHaveBeenCalled();
  });

  // 23. [CO] validateCodeLinks: searchSymbols throws → BrokenLink 'gildash-unavailable'
  it('should return BrokenLink with gildash-unavailable when searchSymbols throws', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockImplementation(throwGildashErr);
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // draft card, so goes to planned
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]!.reason).toBe('gildash-unavailable');
  });

  // 24. [ST] DB state set up manually → findCardsBySymbol returns correct result
  it('should return card when DB has card row and code link matching the symbol', async () => {
    insertInDb('spec/feature');
    tc.ctx.codeLinkRepo.replaceForCard('spec/feature', [
      { kind: 'class', file: 'src/feature.ts', symbol: 'FeatureService' },
    ]);
    const result = await findCardsBySymbol(tc.ctx, 'FeatureService');
    expect(result).toHaveLength(1);
    expect(result[0]!.card.key).toBe('spec/feature');
  });

  // 25. [ID] validateCodeLinks twice → identical result
  it('should return the same result when validateCodeLinks is called twice', async () => {
    await createCard('auth/token', []);
    const result1 = await validateCodeLinks(tc.ctx, 'auth/token');
    const result2 = await validateCodeLinks(tc.ctx, 'auth/token');
    expect(result1).toEqual(result2);
    expect(result1.declared).toBe(0);
  });

  // 26. [HP] validateCodeLinks: implementing card with broken link → broken (not planned)
  it('should put broken links in broken array for implementing card', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('impl/card', [link], 'active');
    mockSearchSymbols.mockReturnValue([]);
    const result = await validateCodeLinks(tc.ctx, 'impl/card');
    expect(result.declared).toBe(1);
    expect(result.valid).toBe(0);
    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.reason).toBe('symbol-not-found');
    expect(result.planned).toHaveLength(0);
  });

  // 27. [HP] validateCodeLinks: drifted card with broken link -> broken (not planned)
  it('should put broken links in broken array for drifted card', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('drf/card', [link], 'drifted');
    mockSearchSymbols.mockReturnValue([]);
    const result = await validateCodeLinks(tc.ctx, 'drf/card');
    expect(result.declared).toBe(1);
    expect(result.valid).toBe(0);
    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.reason).toBe('symbol-not-found');
    expect(result.planned).toHaveLength(0);
  });

  // 28. [HP] validateCodeLinks: draft card with gildash-unavailable -> planned
  it('should put gildash-unavailable links in planned array for draft card', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('draft/err', [link], 'draft');
    mockSearchSymbols.mockImplementation(throwGildashErr);
    const result = await validateCodeLinks(tc.ctx, 'draft/err');
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]!.reason).toBe('gildash-unavailable');
    expect(result.broken).toHaveLength(0);
  });

  // 29. [HP] validateCodeLinks: implementing card with valid links → all valid, empty broken/planned
  it('should return valid count and empty broken/planned for implementing card with valid links', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('impl/ok', [link], 'active');
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    const result = await validateCodeLinks(tc.ctx, 'impl/ok');
    expect(result.declared).toBe(1);
    expect(result.valid).toBe(1);
    expect(result.broken).toHaveLength(0);
    expect(result.planned).toHaveLength(0);
  });

  // 30. [HP] resolveCardCodeLinks should call reindex before searching
  it('should call gildash.reindex() before resolving code links', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('reindex/test', [link]);
    const mockReindex = mock(() => Promise.resolve());
    (tc.ctx.gildash as any).reindex = mockReindex;
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    await resolveCardCodeLinks(tc.ctx, 'reindex/test');
    expect(mockReindex).toHaveBeenCalledTimes(1);
  });

  // 31. [HP] validateCodeLinks should call reindex before validating
  it('should call gildash.reindex() before validating code links', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('reindex/val', [link]);
    const mockReindex = mock(() => Promise.resolve());
    (tc.ctx.gildash as any).reindex = mockReindex;
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    await validateCodeLinks(tc.ctx, 'reindex/val');
    expect(mockReindex).toHaveBeenCalledTimes(1);
  });

  // 33. [HP] validateCodeLinks is read-only: never mutates card status
  it('should NOT mutate status when broken links detected on active card', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('no/mutate', [link], 'active');
    insertInDb('no/mutate');
    tc.ctx.cardRepo.upsert({
      ...tc.ctx.cardRepo.findByKey('no/mutate')!,
      status: 'active',
    });
    mockSearchSymbols.mockReturnValue([]);
    const result = await validateCodeLinks(tc.ctx, 'no/mutate');
    expect(result.broken.length).toBe(1);
    const row = tc.ctx.cardRepo.findByKey('no/mutate');
    expect(row?.status).toBe('active');
  });
});
