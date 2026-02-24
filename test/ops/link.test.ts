import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Gildash, SymbolSearchResult, GildashError } from '@zipbul/gildash';
import { err } from '@zipbul/result';

import { createTestContext, type TestContext } from '../helpers';
import { writeCardFile } from '../../src/fs/writer';
import { buildCardPath, normalizeSlug } from '../../src/card/card-key';
import type { CardFile, CodeLink } from '../../src/card/types';
import type { CardRow } from '../../src/db/repository';
import {
  resolveCardCodeLinks,
  findCardsBySymbol,
  findAffectedCards,
  validateCodeLinks,
} from '../../index';

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
): Promise<void> {
  const slug = normalizeSlug(key);
  const filePath = buildCardPath(tc.ctx.cardsDir, slug);
  await mkdir(dirname(filePath), { recursive: true });
  const cardFile: CardFile = {
    frontmatter: {
      key: slug,
      summary: `Card ${slug}`,
      status: 'draft',
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
    constraintsJson: null,
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

const gildashErr = () =>
  err<GildashError>({ type: 'search', message: 'search failed', cause: undefined });

// ---- Tests ----

describe('ops/link', () => {
  // 1. [HP] resolveCardCodeLinks: gildash + codeLink → symbol found
  it('should return resolved code link with symbol when gildash finds the symbol', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].link).toEqual(link);
    expect(result[0].symbol).toBe(fakeSymbol);
  });

  // 2. [HP] resolveCardCodeLinks: codeLinks undefined in frontmatter → []
  it('should return empty array when card has no codeLinks field', async () => {
    // Arrange
    await createCard('auth/token');
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toEqual([]);
  });

  // 3. [HP] resolveCardCodeLinks: codeLinks=[] → []
  it('should return empty array when card has empty codeLinks array', async () => {
    // Arrange
    await createCard('auth/token', []);
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toEqual([]);
  });

  // 4. [HP] resolveCardCodeLinks: searchSymbols Err → {link, symbol: null}
  it('should return resolved link with null symbol when searchSymbols returns Err', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue(gildashErr());
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].link).toEqual(link);
    expect(result[0].symbol).toBeNull();
  });

  // 5. [HP] resolveCardCodeLinks: symbol not in results → {link, symbol: null}
  it('should return null symbol when searchSymbols returns results that do not match', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    // searchSymbols returns result for different symbol/file
    mockSearchSymbols.mockReturnValue([{ ...fakeSymbol, name: 'otherFn' }]);
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result[0].symbol).toBeNull();
  });

  // 6. [HP] findCardsBySymbol: no filePath → all cards with that symbol
  it('should return all cards referencing the symbol when no filePath is provided', async () => {
    // Arrange
    insertInDb('spec/a');
    insertInDb('spec/b');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.codeLinkRepo.replaceForCard('spec/b', [{ kind: 'function', file: 'src/b.ts', symbol: 'fn' }]);
    // Act
    const result = findCardsBySymbol(tc.ctx, 'fn');
    // Assert
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.key);
    expect(keys).toContain('spec/a');
    expect(keys).toContain('spec/b');
  });

  // 7. [HP] findCardsBySymbol: filePath → filtered
  it('should return only cards referencing the symbol in the given file when filePath is provided', async () => {
    // Arrange
    insertInDb('spec/a');
    insertInDb('spec/b');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.codeLinkRepo.replaceForCard('spec/b', [{ kind: 'function', file: 'src/b.ts', symbol: 'fn' }]);
    // Act
    const result = findCardsBySymbol(tc.ctx, 'fn', 'src/a.ts');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('spec/a');
  });

  // 8. [HP] findCardsBySymbol: multiple links same card → deduplicated
  it('should return each card at most once even if it has multiple matching links', async () => {
    // Arrange
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
      { kind: 'function', file: 'src/b.ts', symbol: 'fn' },
    ]);
    // Act
    const result = findCardsBySymbol(tc.ctx, 'fn');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('spec/a');
  });

  // 9. [HP] findAffectedCards: 1 file, 1 card → that card
  it('should return the card that references the changed file', async () => {
    // Arrange
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'fn' },
    ]);
    // Act
    const result = await findAffectedCards(tc.ctx, ['src/auth.ts']);
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('spec/a');
  });

  // 10. [HP] findAffectedCards: 2 files same card → dedup (1 card returned)
  it('should return each card at most once when it references multiple changed files', async () => {
    // Arrange
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
      { kind: 'class', file: 'src/b.ts', symbol: 'ClassB' },
    ]);
    // Act
    const result = await findAffectedCards(tc.ctx, ['src/a.ts', 'src/b.ts']);
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('spec/a');
  });

  // 11. [HP] validateCodeLinks: all valid → []
  it('should return empty array when all code links resolve to existing symbols', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([fakeSymbol]);
    // Act
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toEqual([]);
  });

  // 12. [HP] validateCodeLinks: broken symbol → BrokenLink 'symbol-not-found'
  it('should return BrokenLink with symbol-not-found when searchSymbols returns empty results', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue([]);
    // Act
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].link).toEqual(link);
    expect(result[0].reason).toBe('symbol-not-found');
  });

  // 13. [NE] resolveCardCodeLinks: gildash undefined → GildashNotConfiguredError
  it('should throw GildashNotConfiguredError when ctx.gildash is not set in resolveCardCodeLinks', async () => {
    // Arrange
    await createCard('auth/token', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.gildash = undefined;
    // Act / Assert
    await expect(resolveCardCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'GildashNotConfiguredError',
    });
  });

  // 14. [NE] resolveCardCodeLinks: card file missing → CardNotFoundError
  it('should throw CardNotFoundError when card file does not exist in resolveCardCodeLinks', async () => {
    // Arrange (card file NOT created)
    // Act / Assert
    await expect(resolveCardCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'CardNotFoundError',
    });
  });

  // 15. [NE] validateCodeLinks: gildash undefined → GildashNotConfiguredError
  it('should throw GildashNotConfiguredError when ctx.gildash is not set in validateCodeLinks', async () => {
    // Arrange
    await createCard('auth/token', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    tc.ctx.gildash = undefined;
    // Act / Assert
    await expect(validateCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'GildashNotConfiguredError',
    });
  });

  // 16. [NE] validateCodeLinks: card file missing → CardNotFoundError
  it('should throw CardNotFoundError when card file does not exist in validateCodeLinks', async () => {
    // Arrange (card NOT created)
    // Act / Assert
    await expect(validateCodeLinks(tc.ctx, 'auth/token')).rejects.toMatchObject({
      name: 'CardNotFoundError',
    });
  });

  // 17. [NE] findCardsBySymbol: findByKey null → skip that card
  it('should skip cards where cardRepo has no matching row when findCardsBySymbol is called', async () => {
    // Arrange: codeLink in DB but no card row
    tc.ctx.codeLinkRepo.replaceForCard('orphan/key', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
    ]);
    // Act
    const result = findCardsBySymbol(tc.ctx, 'fn');
    // Assert
    expect(result).toEqual([]);
  });

  // 18. [NE] findAffectedCards: findByKey null → skip
  it('should skip cards where cardRepo has no matching row when findAffectedCards is called', async () => {
    // Arrange: foreign key off → insert link for nonexistent card
    // (codeLinkRepo.replaceForCard with nonexistent key → FK violation → no link stored)
    // Instead, we test that findAffectedCards handles null findByKey results
    // by using a card that is in DB but its key was manually deleted
    insertInDb('spec/a');
    tc.ctx.codeLinkRepo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
    ]);
    // Remove card from DB to simulate orphan link
    tc.ctx.cardRepo.deleteByKey('spec/a');
    // Act
    const result = await findAffectedCards(tc.ctx, ['src/a.ts']);
    // Assert
    expect(result).toEqual([]);
  });

  // 19. [ED] findAffectedCards: changedFiles=[] → []
  it('should return empty array when changedFiles is empty', async () => {
    // Arrange / Act
    const result = await findAffectedCards(tc.ctx, []);
    // Assert
    expect(result).toEqual([]);
  });

  // 20. [ED] findCardsBySymbol: no links matching → []
  it('should return empty array when no cards reference the symbol', async () => {
    // Arrange (no links stored)
    // Act
    const result = findCardsBySymbol(tc.ctx, 'nonExistentFn');
    // Assert
    expect(result).toEqual([]);
  });

  // 21. [ED] validateCodeLinks: codeLinks=[] → []
  it('should return empty array when card has empty codeLinks array in validateCodeLinks', async () => {
    // Arrange
    await createCard('auth/token', []);
    // Act
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toEqual([]);
  });

  // 22. [CO] resolveCardCodeLinks: codeLinks=[] + gildash present → []
  it('should return empty array when codeLinks is empty even with gildash configured', async () => {
    // Arrange
    await createCard('auth/token', []);
    // gildash is configured (set in beforeEach)
    // Act
    const result = await resolveCardCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toEqual([]);
    expect(mockSearchSymbols).not.toHaveBeenCalled();
  });

  // 23. [CO] validateCodeLinks: searchSymbols Err → BrokenLink 'file-not-indexed'
  it('should return BrokenLink with file-not-indexed when searchSymbols returns an Err', async () => {
    // Arrange
    const link: CodeLink = { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' };
    await createCard('auth/token', [link]);
    mockSearchSymbols.mockReturnValue(gildashErr());
    // Act
    const result = await validateCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('file-not-indexed');
  });

  // 24. [ST] DB state set up manually → findCardsBySymbol returns correct result
  it('should return card when DB has card row and code link matching the symbol', async () => {
    // Arrange
    insertInDb('spec/feature');
    tc.ctx.codeLinkRepo.replaceForCard('spec/feature', [
      { kind: 'class', file: 'src/feature.ts', symbol: 'FeatureService' },
    ]);
    // Act
    const result = findCardsBySymbol(tc.ctx, 'FeatureService');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('spec/feature');
  });

  // 25. [ID] validateCodeLinks twice → identical result
  it('should return the same result when validateCodeLinks is called twice', async () => {
    // Arrange
    await createCard('auth/token', []);
    // Act
    const result1 = await validateCodeLinks(tc.ctx, 'auth/token');
    const result2 = await validateCodeLinks(tc.ctx, 'auth/token');
    // Assert
    expect(result1).toEqual(result2);
  });
});
