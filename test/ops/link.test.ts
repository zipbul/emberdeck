import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Gildash, SymbolSearchResult } from '@zipbul/gildash';

import { createTestContext, type TestContext } from '../helpers';
import { writeCardFile } from '../../src/fs/writer';
import { buildCardPath, normalizeSlug } from '../../index';
import type { CardFile, CodeLink, CardRow } from '../../index';
import {
  resolveCardCodeLinks,
  findCardsBySymbol,
  validateCodeLinks,
} from '../../index';
import { findAffectedCards } from '../../src/ops/link';

// ---- Setup ----

let tc: TestContext;
let mockSearchSymbols: ReturnType<typeof mock>;

beforeEach(async () => {
  tc = await createTestContext();
  mockSearchSymbols = mock(() => [] as SymbolSearchResult[]);
  tc.ctx.gildash = {
    searchSymbols: mockSearchSymbols,
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
      ...(codeLinks !== undefined ? { codeLinks } : {}),
    },
    body: '',
  };
  await writeCardFile(filePath, cardFile);
}

function insertInDb(key: string): void {
  const slug = normalizeSlug(key);
  const row: CardRow = {
    key: slug,
    summary: `Card ${slug}`,
    status: 'draft',
    type: 'spec',
    parent: null,
    boundaryJson: null,
    body: null,
    filePath: buildCardPath(tc.ctx.cardsDir, slug),
    updatedAt: new Date().toISOString(),
  };
  tc.ctx.cardRepo.upsert(row);
}

const fakeSymbol: SymbolSearchResult = {
  id: 1,
  name: 'myFn',
  filePath: 'src/auth.ts',
  kind: 'function' as any,
  span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
  isExported: true,
  signature: 'function myFn(): void',
  fingerprint: null,
  detail: {},
};

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

  // 9. [HP] findAffectedCards: 1 file, 1 card → that card
  it('should return the card that references the changed file', async () => {
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'fn' },
    ]);
    const result = await findAffectedCards(tc.ctx, ['src/auth.ts']);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('spec/a');
  });

  // 10. [HP] findAffectedCards: 2 files same card → dedup (1 card returned)
  it('should return each card at most once when it references multiple changed files', async () => {
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
      { kind: 'class', file: 'src/b.ts', symbol: 'ClassB' },
    ]);
    const result = await findAffectedCards(tc.ctx, ['src/a.ts', 'src/b.ts']);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('spec/a');
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

  // 13. [NE] resolveCardCodeLinks: gildash undefined → GildashNotConfiguredError
  it('should throw GildashNotConfiguredError when ctx.gildash is not set in resolveCardCodeLinks', async () => {
    await createCard('auth/token', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.gildash = undefined;
    await expect(resolveCardCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'GildashNotConfiguredError',
    });
  });

  // 14. [NE] resolveCardCodeLinks: card file missing → CardNotFoundError
  it('should throw CardNotFoundError when card file does not exist in resolveCardCodeLinks', async () => {
    await expect(resolveCardCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'CardNotFoundError',
    });
  });

  // 15. [NE] validateCodeLinks: gildash undefined → GildashNotConfiguredError
  it('should throw GildashNotConfiguredError when ctx.gildash is not set in validateCodeLinks', async () => {
    await createCard('auth/token', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.gildash = undefined;
    await expect(validateCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'GildashNotConfiguredError',
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

  // 18. [NE] findAffectedCards: findByKey null → skip
  it('should skip cards where cardRepo has no matching row when findAffectedCards is called', async () => {
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
    ]);
    tc.ctx.cardRepo.deleteByKey('spec/a');
    const result = await findAffectedCards(tc.ctx, ['src/a.ts']);
    expect(result).toEqual([]);
  });

  // 19. [ED] findAffectedCards: changedFiles=[] → []
  it('should return empty array when changedFiles is empty', async () => {
    const result = await findAffectedCards(tc.ctx, []);
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

  // 32a. [HP] findCardsBySymbol: boundary glob match
  it('should find cards by boundary glob when filePath matches', async () => {
    // Create a card with boundary but no codeLinks
    const slug = normalizeSlug('boundary-card');
    const fp = buildCardPath(tc.ctx.cardsDir, slug);
    await mkdir(dirname(fp), { recursive: true });
    const cardFile: CardFile = {
      frontmatter: {
        key: slug,
        summary: 'Boundary card',
        status: 'draft',
        type: 'spec',
        boundary: ['src/services/**'],
      },
      body: '',
    };
    await writeCardFile(fp, cardFile);
    // Sync to DB so the card exists with boundaryJson
    const { syncCardFromFile } = await import('../../src/ops/sync');
    await syncCardFromFile(tc.ctx, fp);

    const result = await findCardsBySymbol(tc.ctx, 'SomeService', 'src/services/auth.ts');
    const match = result.find((r: any) => r.card.key === 'boundary-card');
    expect(match).toBeDefined();
    expect(match!.matchType).toBe('boundary');
  });

  // 32b. findCardsBySymbol: malformed boundaryJson should not crash
  it('should skip cards with malformed boundaryJson gracefully', async () => {
    // Insert a card with invalid boundaryJson directly in DB
    tc.ctx.cardRepo.upsert({
      key: 'bad-boundary',
      summary: 'Bad boundary',
      status: 'draft',
      type: 'spec',
      parent: null,
      boundaryJson: '{not-valid-json',
      body: null,
      filePath: buildCardPath(tc.ctx.cardsDir, 'bad-boundary'),
      updatedAt: new Date().toISOString(),
    });

    // Should not throw
    const result = await findCardsBySymbol(tc.ctx, 'anything', 'src/foo.ts');
    // The bad-boundary card should be skipped, not included
    expect(result.find((r: any) => r.card.key === 'bad-boundary')).toBeUndefined();
  });

  // 33. [HP] validateCodeLinks: active card with broken links → auto-transition to drifted
  it('should auto-transition active card to drifted when broken links detected', async () => {
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auto/trans', [link], 'active');
    insertInDb('auto/trans');
    tc.ctx.cardRepo.upsert({
      ...tc.ctx.cardRepo.findByKey('auto/trans')!,
      status: 'active',
    });
    mockSearchSymbols.mockReturnValue([]);
    await validateCodeLinks(tc.ctx, 'auto/trans');
    const row = tc.ctx.cardRepo.findByKey('auto/trans');
    expect(row?.status).toBe('drifted');
  });
});
