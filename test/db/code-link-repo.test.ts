import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import { DrizzleCodeLinkRepository } from '../../src/db/code-link-repo';
import { codeLink } from '../../src/db/schema';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Setup ----

let db: EmberdeckDb;
let cardRepo: DrizzleCardRepository;
let repo: DrizzleCodeLinkRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  cardRepo = new DrizzleCardRepository(db);
  repo = new DrizzleCodeLinkRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ---- Helpers ----

function insertCard(key: string): void {
  const row: CardRow = {
    key,
    summary: `Card ${key}`,
    status: 'draft',
    constraintsJson: null,
    body: null,
    filePath: `/cards/${key}.card.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  cardRepo.upsert(row);
}

// ---- Tests ----

describe('DrizzleCodeLinkRepository', () => {
  // 1. [HP] replaceForCard: 단일 link → kind/file/symbol 값 보존
  it('should store single link and return it with correct fields when replaceForCard called with one link', () => {
    // Arrange
    insertCard('auth/token');
    // Act
    repo.replaceForCard('auth/token', [
      { kind: 'function', file: 'src/auth/token.ts', symbol: 'refreshToken' },
    ]);
    const result = repo.findByCardKey('auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.cardKey).toBe('auth/token');
    expect(result[0]!.kind).toBe('function');
    expect(result[0]!.file).toBe('src/auth/token.ts');
    expect(result[0]!.symbol).toBe('refreshToken');
  });

  // 2. [HP] replaceForCard: 복수 links → 모두 반환
  it('should store all links when replaceForCard called with multiple links', () => {
    // Arrange
    insertCard('auth/token');
    const links = [
      { kind: 'function', file: 'src/auth/token.ts', symbol: 'refreshToken' },
      { kind: 'class', file: 'src/auth/TokenService.ts', symbol: 'TokenService' },
      { kind: 'type', file: 'src/auth/types.ts', symbol: 'TokenPayload' },
    ];
    // Act
    repo.replaceForCard('auth/token', links);
    const result = repo.findByCardKey('auth/token');
    // Assert
    expect(result).toHaveLength(3);
  });

  // 3. [HP] replaceForCard: 두 번 호출 → 두 번째 결과만 남음
  it('should replace previous links when replaceForCard called twice with different links', () => {
    // Arrange
    insertCard('auth/token');
    repo.replaceForCard('auth/token', [
      { kind: 'function', file: 'src/old.ts', symbol: 'oldFn' },
    ]);
    // Act
    repo.replaceForCard('auth/token', [
      { kind: 'class', file: 'src/new.ts', symbol: 'NewClass' },
    ]);
    const result = repo.findByCardKey('auth/token');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe('NewClass');
  });

  // 4. [ED] replaceForCard: 빈 배열 → []
  it('should return empty array when replaceForCard called with empty array', () => {
    // Arrange
    insertCard('auth/token');
    repo.replaceForCard('auth/token', [
      { kind: 'function', file: 'src/a.ts', symbol: 'foo' },
    ]);
    // Act
    repo.replaceForCard('auth/token', []);
    const result = repo.findByCardKey('auth/token');
    // Assert
    expect(result).toHaveLength(0);
  });

  // 5. [NE] replaceForCard: 존재하지 않는 cardKey → FK violation 스킵, 에러 없음
  it('should not throw when replaceForCard called for non-existent card key', () => {
    // Arrange / Act / Assert
    expect(() => {
      repo.replaceForCard('non/existent', [
        { kind: 'function', file: 'src/a.ts', symbol: 'foo' },
      ]);
    }).not.toThrow();
  });

  // 6. [HP] findByCardKey: 링크 있는 카드 → 반환
  it('should return stored links when findByCardKey called for card with links', () => {
    // Arrange
    insertCard('spec/design');
    repo.replaceForCard('spec/design', [
      { kind: 'interface', file: 'src/design.ts', symbol: 'IDesign' },
    ]);
    // Act
    const result = repo.findByCardKey('spec/design');
    // Assert
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.symbol).toBe('IDesign');
  });

  // 7. [HP] findByCardKey: 미존재 카드 → []
  it('should return empty array when findByCardKey called for card with no links', () => {
    // Arrange
    insertCard('no/links');
    // Act
    const result = repo.findByCardKey('no/links');
    // Assert
    expect(result).toEqual([]);
  });

  // 8. [HP] findBySymbol: symbolName만 지정 → 해당 symbol 모든 링크 반환
  it('should return all links for symbol when findBySymbol called without filePath', () => {
    // Arrange
    insertCard('spec/a');
    insertCard('spec/b');
    repo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' },
    ]);
    repo.replaceForCard('spec/b', [
      { kind: 'function', file: 'src/other.ts', symbol: 'myFn' },
    ]);
    // Act
    const result = repo.findBySymbol('myFn');
    // Assert
    expect(result).toHaveLength(2);
  });

  // 9. [HP] findBySymbol: symbolName + filePath 지정 → 필터링
  it('should return only matching file links when findBySymbol called with filePath', () => {
    // Arrange
    insertCard('spec/a');
    repo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' },
      { kind: 'function', file: 'src/other.ts', symbol: 'myFn' },
    ]);
    // Act
    const result = repo.findBySymbol('myFn', 'src/auth.ts');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe('src/auth.ts');
  });

  // 10. [HP] findBySymbol: symbolName + filePath 지정, 해당 파일 없음 → []
  it('should return empty array when findBySymbol called with filePath that has no matching symbol', () => {
    // Arrange
    insertCard('spec/a');
    repo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'myFn' },
    ]);
    // Act
    const result = repo.findBySymbol('myFn', 'src/nonexistent.ts');
    // Assert
    expect(result).toHaveLength(0);
  });

  // 11. [HP] findBySymbol: 다른 카드가 동일 symbol → 둘 다 반환
  it('should return links from all cards when multiple cards reference same symbol', () => {
    // Arrange
    insertCard('spec/x');
    insertCard('spec/y');
    repo.replaceForCard('spec/x', [{ kind: 'class', file: 'src/a.ts', symbol: 'SharedClass' }]);
    repo.replaceForCard('spec/y', [{ kind: 'class', file: 'src/a.ts', symbol: 'SharedClass' }]);
    // Act
    const result = repo.findBySymbol('SharedClass');
    // Assert
    expect(result).toHaveLength(2);
  });

  // 12. [HP] findBySymbol: filePath 지정 시 다른 파일 제외
  it('should exclude links from other files when findBySymbol called with specific filePath', () => {
    // Arrange
    insertCard('spec/a');
    repo.replaceForCard('spec/a', [
      { kind: 'function', file: 'src/a.ts', symbol: 'fn' },
      { kind: 'function', file: 'src/b.ts', symbol: 'fn' },
    ]);
    // Act
    const result = repo.findBySymbol('fn', 'src/a.ts');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe('src/a.ts');
  });

  // 13. [HP] deleteByCardKey: 존재하는 링크 삭제 → []
  it('should delete all links when deleteByCardKey called for card with links', () => {
    // Arrange
    insertCard('spec/del');
    repo.replaceForCard('spec/del', [
      { kind: 'function', file: 'src/a.ts', symbol: 'foo' },
    ]);
    // Act
    repo.deleteByCardKey('spec/del');
    const result = repo.findByCardKey('spec/del');
    // Assert
    expect(result).toHaveLength(0);
  });

  // 14. [ED] deleteByCardKey: 미존재 cardKey → 에러 없음
  it('should not throw when deleteByCardKey called for non-existent card key', () => {
    // Arrange / Act / Assert
    expect(() => repo.deleteByCardKey('never/existed')).not.toThrow();
  });

  // 15. [ST] replaceForCard → deleteByCardKey → findByCardKey → []
  it('should return empty array after replaceForCard then deleteByCardKey', () => {
    // Arrange
    insertCard('state/test');
    repo.replaceForCard('state/test', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    // Act
    repo.deleteByCardKey('state/test');
    // Assert
    expect(repo.findByCardKey('state/test')).toHaveLength(0);
  });

  // 16. [ST] card CASCADE DELETE → code_link 자동 삭제
  it('should cascade delete code_links when referenced card is deleted', () => {
    // Arrange
    insertCard('cascade/test');
    repo.replaceForCard('cascade/test', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    // Act
    cardRepo.deleteByKey('cascade/test');
    // Assert
    expect(repo.findByCardKey('cascade/test')).toHaveLength(0);
  });

  // 17. [HP] 두 카드가 독립 링크 저장
  it('should store links independently for two different cards', () => {
    // Arrange
    insertCard('spec/one');
    insertCard('spec/two');
    repo.replaceForCard('spec/one', [{ kind: 'function', file: 'src/a.ts', symbol: 'fnA' }]);
    repo.replaceForCard('spec/two', [{ kind: 'class', file: 'src/b.ts', symbol: 'ClassB' }]);
    // Act / Assert
    expect(repo.findByCardKey('spec/one')).toHaveLength(1);
    expect(repo.findByCardKey('spec/two')).toHaveLength(1);
    expect(repo.findByCardKey('spec/one')[0]!.symbol).toBe('fnA');
    expect(repo.findByCardKey('spec/two')[0]!.symbol).toBe('ClassB');
  });

  // 18. [ID] deleteByCardKey 두 번 → 에러 없음
  it('should not throw when deleteByCardKey called twice', () => {
    // Arrange
    insertCard('idempotent/test');
    repo.replaceForCard('idempotent/test', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    repo.deleteByCardKey('idempotent/test');
    // Act / Assert
    expect(() => repo.deleteByCardKey('idempotent/test')).not.toThrow();
  });

  // 19. [NE] non-FK re-throw
  it('should re-throw non-FK error when insert throws a non-FOREIGN-KEY error in replaceForCard', () => {
    // Arrange
    const nonFkError = new Error('disk I/O error');
    const fakeDb = {
      delete: () => ({ where: () => ({ run: () => {} }) }),
      insert: () => ({ values: () => ({ run: () => { throw nonFkError; } }) }),
    } as unknown as EmberdeckDb;
    const testRepo = new DrizzleCodeLinkRepository(fakeDb);
    // Act & Assert
    expect(() =>
      testRepo.replaceForCard('my-card', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]),
    ).toThrow('disk I/O error');
  });

  // [NE] FK violation warn
  it('should call console.warn when FK violation occurs in replaceForCard', () => {
    // Arrange
    const warnSpy = spyOn(console, 'warn');
    // cardKey가 card 테이블에 없으면 insert 시 FK violation 발생
    // Act
    repo.replaceForCard('nonexistent-card', [{ kind: 'function', file: 'src/a.ts', symbol: 'fn' }]);
    // Assert
    expect(warnSpy).toHaveBeenCalled();
    // Cleanup
    warnSpy.mockRestore();
  });

  // [NE] UNIQUE constraint
  it('should throw UNIQUE constraint error when duplicate (card_key, kind, file, symbol) is inserted directly', () => {
    // Arrange
    insertCard('link-card');
    db.insert(codeLink).values({ cardKey: 'link-card', kind: 'function', file: 'src/a.ts', symbol: 'fn' }).run();
    // Act & Assert
    expect(() =>
      db.insert(codeLink).values({ cardKey: 'link-card', kind: 'function', file: 'src/a.ts', symbol: 'fn' }).run(),
    ).toThrow();
  });
});
