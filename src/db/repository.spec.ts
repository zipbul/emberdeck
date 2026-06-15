import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from './connection';
import { DrizzleCardRepository } from './card-repo';
import { DrizzleRelationRepository } from './relation-repo';
import { DrizzleClassificationRepository } from './classification-repo';
import type { EmberdeckDb } from './connection';
import { makeCardRow as makeCard } from '../../test/fixtures/card-row';
import { FtsSyntaxError } from '../card/errors';

let db: EmberdeckDb;
let cardRepo: DrizzleCardRepository;
let relationRepo: DrizzleRelationRepository;
let classificationRepo: DrizzleClassificationRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  cardRepo = new DrizzleCardRepository(db);
  relationRepo = new DrizzleRelationRepository(db);
  classificationRepo = new DrizzleClassificationRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ── CardRepository ──────────────────────────────────────────────────────────

describe('CardRepository', () => {
  it('upsert + findByKey: insert a card with parent, read back all fields', () => {
    // Arrange
    const parent = makeCard({
      key: 'parent-arch',
      type: 'brief',
      filePath: '.emberdeck/cards/parent-arch.md',
    });
    cardRepo.upsert(parent);

    const card = makeCard({
      key: 'child-spec',
      summary: 'Child spec card',
      status: 'active',
      type: 'spec',
      parent: 'parent-arch',
            filePath: '.emberdeck/cards/child-spec.md',
      updatedAt: '2026-03-15T12:00:00Z',
    });

    // Act
    cardRepo.upsert(card);
    const result = cardRepo.findByKey('child-spec');

    // Assert
    expect(result).not.toBeNull();
    expect(result!.key).toBe('child-spec');
    expect(result!.summary).toBe('Child spec card');
    expect(result!.status).toBe('active');
    expect(result!.type).toBe('spec');
    expect(result!.parent).toBe('parent-arch');
    expect(result!.filePath).toBe('.emberdeck/cards/child-spec.md');
    expect(result!.updatedAt).toBe('2026-03-15T12:00:00Z');
  });

  it('upsert update: modify parent on existing card', () => {
    // Arrange
    const archA = makeCard({
      key: 'arch-a',
      type: 'brief',
      filePath: '.emberdeck/cards/arch-a.md',
    });
    const archB = makeCard({
      key: 'arch-b',
      type: 'brief',
      filePath: '.emberdeck/cards/arch-b.md',
    });
    cardRepo.upsert(archA);
    cardRepo.upsert(archB);

    const card = makeCard({
      key: 'my-spec',
      parent: 'arch-a',
      filePath: '.emberdeck/cards/my-spec.md',
    });
    cardRepo.upsert(card);

    // Act
    cardRepo.upsert(
      makeCard({
        key: 'my-spec',
        parent: 'arch-b',
        filePath: '.emberdeck/cards/my-spec.md',
        updatedAt: '2026-03-20T00:00:00Z',
      }),
    );
    const result = cardRepo.findByKey('my-spec');

    // Assert
    expect(result!.parent).toBe('arch-b');
    expect(result!.updatedAt).toBe('2026-03-20T00:00:00Z');
  });

  it('list with parent filter: returns only children of the given parent', () => {
    // Arrange
    const parent = makeCard({
      key: 'parent-card',
      type: 'brief',
      filePath: '.emberdeck/cards/parent-card.md',
    });
    const child = makeCard({
      key: 'child-card',
      parent: 'parent-card',
      filePath: '.emberdeck/cards/child-card.md',
    });
    const unrelated = makeCard({
      key: 'unrelated',
      filePath: '.emberdeck/cards/unrelated.md',
    });
    cardRepo.upsert(parent);
    cardRepo.upsert(child);
    cardRepo.upsert(unrelated);

    // Act
    const result = cardRepo.list({ parent: 'parent-card' });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('child-card');
  });

  it('list with tag filter: returns cards tagged with the given tag', () => {
    // Arrange
    const card = makeCard({
      key: 'tagged-card',
      filePath: '.emberdeck/cards/tagged-card.md',
    });
    const untagged = makeCard({
      key: 'untagged-card',
      filePath: '.emberdeck/cards/untagged-card.md',
    });
    cardRepo.upsert(card);
    cardRepo.upsert(untagged);
    classificationRepo.replaceTags('tagged-card', ['mytag', 'other']);

    // Act
    const result = cardRepo.list({ tag: 'mytag' });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('tagged-card');
  });

  it('list with roots filter: returns only cards with parent=null', () => {
    // Arrange
    const root = makeCard({
      key: 'root-card',
      type: 'brief',
      parent: null,
      filePath: '.emberdeck/cards/root-card.md',
    });
    const child = makeCard({
      key: 'child-card',
      parent: 'root-card',
      filePath: '.emberdeck/cards/child-card.md',
    });
    cardRepo.upsert(root);
    cardRepo.upsert(child);

    // Act
    const result = cardRepo.list({ roots: true });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('root-card');
  });

  it('list with updatedSince filter: returns only cards updated after the given timestamp', () => {
    // Arrange
    const old = makeCard({
      key: 'old-card',
      updatedAt: '2026-01-01T00:00:00Z',
      filePath: '.emberdeck/cards/old-card.md',
    });
    const recent = makeCard({
      key: 'recent-card',
      updatedAt: '2026-03-15T00:00:00Z',
      filePath: '.emberdeck/cards/recent-card.md',
    });
    cardRepo.upsert(old);
    cardRepo.upsert(recent);

    // Act
    const result = cardRepo.list({ updatedSince: '2026-02-01T00:00:00Z' });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('recent-card');
  });

  it('list with sortBy updated_at: returns cards ordered by updatedAt descending', () => {
    // Arrange
    const earlier = makeCard({
      key: 'earlier',
      updatedAt: '2026-01-01T00:00:00Z',
      filePath: '.emberdeck/cards/earlier.md',
    });
    const later = makeCard({
      key: 'later',
      updatedAt: '2026-06-01T00:00:00Z',
      filePath: '.emberdeck/cards/later.md',
    });
    cardRepo.upsert(earlier);
    cardRepo.upsert(later);

    // Act
    const result = cardRepo.list({ sortBy: 'updated_at' });

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]!.key).toBe('later');
    expect(result[1]!.key).toBe('earlier');
  });

  it('list with tag + parent combined filter: returns only matching cards', () => {
    // Arrange
    const arch = makeCard({ key: 'arch', type: 'brief', filePath: '.emberdeck/cards/arch.md' });
    const childA = makeCard({ key: 'child-a', parent: 'arch', filePath: '.emberdeck/cards/child-a.md' });
    const childB = makeCard({ key: 'child-b', parent: 'arch', filePath: '.emberdeck/cards/child-b.md' });
    const other = makeCard({ key: 'other', parent: null, filePath: '.emberdeck/cards/other.md' });
    cardRepo.upsert(arch);
    cardRepo.upsert(childA);
    cardRepo.upsert(childB);
    cardRepo.upsert(other);
    classificationRepo.replaceTags('child-a', ['security']);
    classificationRepo.replaceTags('other', ['security']);

    // Act — tag=security AND parent=arch → only child-a
    const result = cardRepo.list({ tag: 'security', parent: 'arch' });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('child-a');
  });

  it('findByKey: returns null when card does not exist', () => {
    expect(cardRepo.findByKey('nonexistent')).toBeNull();
  });

  it('existsByKey: returns true for existing card, false for missing', () => {
    cardRepo.upsert(makeCard({ key: 'exists' }));
    expect(cardRepo.existsByKey('exists')).toBe(true);
    expect(cardRepo.existsByKey('missing')).toBe(false);
  });

  it('deleteByKey: removes the card', () => {
    cardRepo.upsert(makeCard({ key: 'to-delete' }));
    expect(cardRepo.existsByKey('to-delete')).toBe(true);
    cardRepo.deleteByKey('to-delete');
    expect(cardRepo.existsByKey('to-delete')).toBe(false);
  });

  it('findChildren: returns children of the given parent', () => {
    // Arrange
    const parent = makeCard({
      key: 'parent',
      type: 'brief',
      filePath: '.emberdeck/cards/parent.md',
    });
    const childA = makeCard({
      key: 'child-a',
      parent: 'parent',
      filePath: '.emberdeck/cards/child-a.md',
    });
    const childB = makeCard({
      key: 'child-b',
      parent: 'parent',
      filePath: '.emberdeck/cards/child-b.md',
    });
    cardRepo.upsert(parent);
    cardRepo.upsert(childA);
    cardRepo.upsert(childB);

    // Act
    const result = cardRepo.findChildren('parent');

    // Assert
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.key).sort();
    expect(keys).toEqual(['child-a', 'child-b']);
  });

  it('findChildren: returns empty array when no children exist', () => {
    // Arrange
    const card = makeCard({ key: 'lonely' });
    cardRepo.upsert(card);

    // Act
    const result = cardRepo.findChildren('lonely');

    // Assert
    expect(result).toEqual([]);
  });

  it('search: matches cards by key and summary via FTS', () => {
    // Arrange
    const card = makeCard({
      key: 'auth-module',
      summary: 'Authentication module design',
            filePath: '.emberdeck/cards/auth-module.md',
    });
    cardRepo.upsert(card);

    // Act / Assert — match by key content
    const byKey = cardRepo.search('auth');
    expect(byKey.length).toBeGreaterThanOrEqual(1);
    expect(byKey[0]!.key).toBe('auth-module');

    // match by summary content
    const bySummary = cardRepo.search('authentication');
    expect(bySummary.length).toBeGreaterThanOrEqual(1);
  });

  it('search: a column-filter-shaped query (FTS5 "no such column") is reported as FtsSyntaxError, not a generic error', () => {
    // Arrange — a card whose content contains the bare term that the query's
    // suffix collides with as a column name.
    cardRepo.upsert(makeCard({ key: 'hierarchy-card', summary: 'four-tier hierarchy and tier rules' }));

    // Act / Assert — FTS5 parses '4-tier' as the column filter `tier:` and
    // raises "no such column: tier". This is a query-syntax failure and the
    // card-search contract (POST-002) requires it to surface as
    // fts-syntax-error (exit 2), i.e. an FtsSyntaxError — not a generic error
    // that the CLI maps to internal-error/exit 1.
    expect(() => cardRepo.search('4-tier')).toThrow(FtsSyntaxError);
  });
});

// ── RelationRepository ──────────────────────────────────────────────────────

describe('RelationRepository', () => {
  it('replaceForCard: creates forward and reverse relation rows', () => {
    // Arrange
    const cardA = makeCard({
      key: 'card-a',
      filePath: '.emberdeck/cards/card-a.md',
    });
    const cardB = makeCard({
      key: 'card-b',
      filePath: '.emberdeck/cards/card-b.md',
    });
    cardRepo.upsert(cardA);
    cardRepo.upsert(cardB);

    // Act
    relationRepo.replaceForCard('card-a', ['card-b']);

    // Assert — forward row on card-a
    const forwardRows = relationRepo.findByCardKey('card-a');
    const forward = forwardRows.find((r) => r.dstCardKey === 'card-b' && !r.isReverse);
    expect(forward).toBeDefined();

    // Assert — reverse row on card-b
    const reverseRows = relationRepo.findByCardKey('card-b');
    const reverse = reverseRows.find((r) => r.dstCardKey === 'card-a' && r.isReverse);
    expect(reverse).toBeDefined();
  });

  it('replaceForCard: replaces existing relations with new targets', () => {
    // Arrange
    const cardA = makeCard({ key: 'card-a', filePath: '.emberdeck/cards/card-a.md' });
    const cardB = makeCard({ key: 'card-b', filePath: '.emberdeck/cards/card-b.md' });
    const cardC = makeCard({ key: 'card-c', filePath: '.emberdeck/cards/card-c.md' });
    cardRepo.upsert(cardA);
    cardRepo.upsert(cardB);
    cardRepo.upsert(cardC);

    relationRepo.replaceForCard('card-a', ['card-b']);

    // Act — replace with card-c
    relationRepo.replaceForCard('card-a', ['card-c']);

    // Assert
    const rows = relationRepo.findByCardKey('card-a');
    const targets = rows.filter((r) => !r.isReverse).map((r) => r.dstCardKey);
    expect(targets).toEqual(['card-c']);

    // card-b should no longer have a reverse row
    const bRows = relationRepo.findByCardKey('card-b');
    expect(bRows.filter((r) => r.isReverse && r.dstCardKey === 'card-a')).toHaveLength(0);
  });

  it('replaceForCard with empty array: clears all relations', () => {
    // Arrange
    const cardA = makeCard({ key: 'card-a', filePath: '.emberdeck/cards/card-a.md' });
    const cardB = makeCard({ key: 'card-b', filePath: '.emberdeck/cards/card-b.md' });
    cardRepo.upsert(cardA);
    cardRepo.upsert(cardB);
    relationRepo.replaceForCard('card-a', ['card-b']);
    expect(relationRepo.findByCardKey('card-a').length).toBeGreaterThan(0);

    // Act
    relationRepo.replaceForCard('card-a', []);

    // Assert
    expect(relationRepo.findByCardKey('card-a').filter(r => !r.isReverse)).toHaveLength(0);
  });

  it('replaceForCard: silently skips when target card does not exist (FK violation)', () => {
    // Arrange
    const cardA = makeCard({ key: 'card-a', filePath: '.emberdeck/cards/card-a.md' });
    cardRepo.upsert(cardA);

    // Act — target 'ghost' does not exist
    expect(() => relationRepo.replaceForCard('card-a', ['ghost'])).not.toThrow();

    // Assert — no forward rows created
    const rows = relationRepo.findByCardKey('card-a');
    expect(rows.filter(r => !r.isReverse)).toHaveLength(0);
  });

  it('findByCardKey: returns RelationRow with id, srcCardKey, dstCardKey, isReverse', () => {
    // Arrange
    const cardA = makeCard({ key: 'card-a', filePath: '.emberdeck/cards/card-a.md' });
    const cardB = makeCard({ key: 'card-b', filePath: '.emberdeck/cards/card-b.md' });
    cardRepo.upsert(cardA);
    cardRepo.upsert(cardB);
    relationRepo.replaceForCard('card-a', ['card-b']);

    // Act
    const rows = relationRepo.findByCardKey('card-a');

    // Assert — verify shape has expected fields and no type/metaJson
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('srcCardKey');
    expect(row).toHaveProperty('dstCardKey');
    expect(row).toHaveProperty('isReverse');
    expect(row).not.toHaveProperty('type');
    expect(row).not.toHaveProperty('metaJson');
  });
});

// ── ClassificationRepository ────────────────────────────────────────────────

describe('ClassificationRepository', () => {
  it('replaceTags + findTagsByCard: round-trips tags correctly', () => {
    // Arrange
    const card = makeCard({ key: 'tagged', filePath: '.emberdeck/cards/tagged.md' });
    cardRepo.upsert(card);

    // Act
    classificationRepo.replaceTags('tagged', ['alpha', 'beta']);
    const tags = classificationRepo.findTagsByCard('tagged');

    // Assert
    expect(tags.sort()).toEqual(['alpha', 'beta']);
  });

  it('pruneOrphans: removes tags not linked to any card', () => {
    // Arrange
    const card = makeCard({ key: 'temp', filePath: '.emberdeck/cards/temp.md' });
    cardRepo.upsert(card);
    classificationRepo.replaceTags('temp', ['orphan-tag']);

    // Remove the tag mapping but leave the tag row behind
    classificationRepo.replaceTags('temp', []);

    // Act
    classificationRepo.pruneOrphans();

    // Assert — tag should be gone; re-adding it should work without collision
    classificationRepo.replaceTags('temp', ['orphan-tag']);
    const tags = classificationRepo.findTagsByCard('temp');
    expect(tags).toEqual(['orphan-tag']);
  });
});

