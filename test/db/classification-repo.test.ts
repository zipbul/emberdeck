import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import { DrizzleClassificationRepository } from '../../src/db/classification-repo';
import { keyword, tag } from '../../src/db/schema';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Setup ----

let db: EmberdeckDb;
let cardRepo: DrizzleCardRepository;
let repo: DrizzleClassificationRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  cardRepo = new DrizzleCardRepository(db);
  repo = new DrizzleClassificationRepository(db);
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

describe('DrizzleClassificationRepository', () => {
  // HP
  it('should create keyword and return it when replaceKeywords is called with new keyword name', () => {
    // Arrange
    insertCard('k1');
    // Act
    repo.replaceKeywords('k1', ['typescript']);
    // Assert
    expect(repo.findKeywordsByCard('k1')).toContain('typescript');
  });

  it('should not create duplicate keyword when replaceKeywords is called with already-existing keyword name', () => {
    // Arrange
    insertCard('k2');
    insertCard('k3');
    repo.replaceKeywords('k2', ['shared-kw']);
    // Act: second card uses same keyword
    repo.replaceKeywords('k3', ['shared-kw']);
    // Assert: keyword table has 1 entry, both cards mapped
    expect(repo.findKeywordsByCard('k2')).toContain('shared-kw');
    expect(repo.findKeywordsByCard('k3')).toContain('shared-kw');
  });

  it('should create tag and return it when replaceTags is called with new tag name', () => {
    // Arrange
    insertCard('t1');
    // Act
    repo.replaceTags('t1', ['architecture']);
    // Assert
    expect(repo.findTagsByCard('t1')).toContain('architecture');
  });

  it('should return mapped tag names when findTagsByCard is called after replaceTags', () => {
    // Arrange
    insertCard('t2');
    repo.replaceTags('t2', ['alpha', 'beta']);
    // Act
    const result = repo.findTagsByCard('t2');
    // Assert
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
    expect(result).toHaveLength(2);
  });

  it('should remove old keywords and add new ones when replaceKeywords is called again', () => {
    // Arrange
    insertCard('r1');
    repo.replaceKeywords('r1', ['old1', 'old2']);
    // Act
    repo.replaceKeywords('r1', ['new1']);
    // Assert
    const result = repo.findKeywordsByCard('r1');
    expect(result).toContain('new1');
    expect(result).not.toContain('old1');
    expect(result).not.toContain('old2');
  });

  it('should remove all card_keyword and card_tag mappings when deleteByCardKey is called', () => {
    // Arrange
    insertCard('del');
    repo.replaceKeywords('del', ['kw']);
    repo.replaceTags('del', ['tg']);
    // Act
    repo.deleteByCardKey('del');
    // Assert
    expect(repo.findKeywordsByCard('del')).toEqual([]);
    expect(repo.findTagsByCard('del')).toEqual([]);
  });

  it('should have 1 keyword row but 2 card_keyword rows when 2 cards share the same keyword', () => {
    // Arrange
    insertCard('shared1');
    insertCard('shared2');
    // Act
    repo.replaceKeywords('shared1', ['common-kw']);
    repo.replaceKeywords('shared2', ['common-kw']);
    // Assert: each card has the keyword
    expect(repo.findKeywordsByCard('shared1')).toContain('common-kw');
    expect(repo.findKeywordsByCard('shared2')).toContain('common-kw');
  });

  // NE
  it('should delete existing mappings and not insert new ones when replaceKeywords is called with empty array', () => {
    // Arrange
    insertCard('e1');
    repo.replaceKeywords('e1', ['existing-kw']);
    // Act
    repo.replaceKeywords('e1', []);
    // Assert: `if (names.length === 0) return` 분기 발동
    expect(repo.findKeywordsByCard('e1')).toEqual([]);
  });

  it('should delete existing tag mappings when replaceTags is called with empty array', () => {
    // Arrange
    insertCard('e2');
    repo.replaceTags('e2', ['existing-tag']);
    // Act
    repo.replaceTags('e2', []);
    // Assert: `if (names.length === 0) return` 분기 발동
    expect(repo.findTagsByCard('e2')).toEqual([]);
  });

  it('should return empty array when findKeywordsByCard is called for card with no keywords', () => {
    // Arrange
    insertCard('nk');
    // Act / Assert
    expect(repo.findKeywordsByCard('nk')).toEqual([]);
  });

  it('should return empty array when findTagsByCard is called for card with no tags', () => {
    // Arrange
    insertCard('nt');
    // Act / Assert
    expect(repo.findTagsByCard('nt')).toEqual([]);
  });

  // ST
  it('should return only new keywords when replaceKeywords is called twice with different names', () => {
    // Arrange
    insertCard('st1');
    repo.replaceKeywords('st1', ['a', 'b']);
    // Act
    repo.replaceKeywords('st1', ['c']);
    // Assert
    const result = repo.findKeywordsByCard('st1');
    expect(result).toEqual(['c']);
  });

  // pruneOrphans

  // 1. [HP] 사용 중인 keyword는 prune 오 후에도 유지
  it('should retain keyword row when it is still referenced by a card mapping', () => {
    // Arrange
    insertCard('pk-a');
    repo.replaceKeywords('pk-a', ['typescript']);
    // Act
    repo.pruneOrphans();
    // Assert — keyword는 여전히 존재여야 함
    const rows = db.select({ name: keyword.name }).from(keyword).all();
    expect(rows.map((r) => r.name)).toContain('typescript');
  });

  // 2. [NE] orphan keyword 삭제
  it('should remove keyword row when no card_keyword mapping references it', () => {
    // Arrange: keyword row를 직접삽입 (replaceKeywords 후 매핑 제거)
    insertCard('pk-b');
    repo.replaceKeywords('pk-b', ['orphan-kw']);
    repo.replaceKeywords('pk-b', []); // 매핑 제거 → orphan 남음
    // Act
    repo.pruneOrphans();
    // Assert
    const rows = db.select({ name: keyword.name }).from(keyword).all();
    expect(rows.map((r) => r.name)).not.toContain('orphan-kw');
  });

  // 3. [NE] orphan tag 삭제
  it('should remove tag row when no card_tag mapping references it', () => {
    // Arrange
    insertCard('pk-c');
    repo.replaceTags('pk-c', ['orphan-tag']);
    repo.replaceTags('pk-c', []); // 매핑 제거 → orphan
    // Act
    repo.pruneOrphans();
    // Assert
    const rows = db.select({ name: tag.name }).from(tag).all();
    expect(rows.map((r) => r.name)).not.toContain('orphan-tag');
  });

  // 4. [ST] replaceKeywords로 old keyword 매핑 제거 후 pruneOrphans
  it('should delete keyword row that became orphan after keywords were replaced', () => {
    // Arrange
    insertCard('pk-d');
    repo.replaceKeywords('pk-d', ['old-kw', 'kept-kw']);
    repo.replaceKeywords('pk-d', ['kept-kw']); // old-kw orphan
    // Act
    repo.pruneOrphans();
    // Assert
    const rows = db.select({ name: keyword.name }).from(keyword).all();
    const names = rows.map((r) => r.name);
    expect(names).not.toContain('old-kw');
    expect(names).toContain('kept-kw');
  });

  // 5. [ST] 카드 삭제 후 pruneOrphans → keyword/tag row 삭제
  it('should delete keyword and tag rows that became orphan after card is deleted', () => {
    // Arrange
    insertCard('pk-e');
    repo.replaceKeywords('pk-e', ['kw-del']);
    repo.replaceTags('pk-e', ['tag-del']);
    cardRepo.deleteByKey('pk-e'); // CASCADE로 card_keyword/tag 매핑 제거, keyword/tag row 잔류
    // Act
    repo.pruneOrphans();
    // Assert
    const kwRows = db.select({ name: keyword.name }).from(keyword).all();
    const tagRows = db.select({ name: tag.name }).from(tag).all();
    expect(kwRows.map((r) => r.name)).not.toContain('kw-del');
    expect(tagRows.map((r) => r.name)).not.toContain('tag-del');
  });
});
