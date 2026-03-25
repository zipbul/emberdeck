import { describe, it, expect, afterEach } from 'bun:test';

import { bulkCreateCards, createCard } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('bulkCreateCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──

  it('should create multiple cards and return correct counts', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'card-a', summary: 'Card A', type: 'spec' },
      { key: 'card-b', summary: 'Card B', type: 'spec' },
      { key: 'card-c', summary: 'Card C', type: 'spec' },
    ]);
    expect(result.created).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.keys).toEqual(['card-a', 'card-b', 'card-c']);
    expect(result.errors).toEqual([]);
  });

  it('should create cards with all optional fields', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        key: 'full-card',
        summary: 'Full card',
        type: 'spec',
        body: '# Body',
        tags: ['tag1'],
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }],
      },
    ]);
    expect(result.created).toBe(1);
    const row = tc.ctx.cardRepo.findByKey('full-card');
    expect(row).not.toBeNull();
  });

  it('should resolve intra-batch relations regardless of order', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        key: 'depends-first',
        summary: 'Depends on target',
        type: 'spec',
        relations: ['target-second'],
      },
      { key: 'target-second', summary: 'Target card', type: 'spec' },
    ]);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    const relations = tc.ctx.relationRepo.findByCardKey('depends-first');
    const forward = relations.find((r) => !r.isReverse && r.dstCardKey === 'target-second');
    expect(forward).not.toBeUndefined();
  });

  // ── Partial Success ──

  it('should skip failed items and continue creating the rest', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'existing', summary: 'Already exists', type: 'spec' });
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'new-card', summary: 'New card', type: 'spec' },
      { key: 'existing', summary: 'Duplicate', type: 'spec' },
      { key: 'another-new', summary: 'Another new', type: 'spec' },
    ]);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['new-card', 'another-new']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('existing');
  });

  it('should report error for invalid key', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: '../evil', summary: 'Bad key', type: 'spec' },
      { key: 'good-card', summary: 'Good card', type: 'spec' },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['good-card']);
    expect(result.errors[0]!.key).toBe('../evil');
  });

  // ── Edge Cases ──

  it('should return zero counts for empty input array', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, []);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.keys).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should handle single card input', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'solo', summary: 'Solo card', type: 'spec' },
    ]);
    expect(result.created).toBe(1);
    expect(result.keys).toEqual(['solo']);
  });

  // ── Mutual Relations ──

  it('should create both cards and succeed with mutual relations in same batch', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        key: 'a',
        summary: 'Card A',
        type: 'spec',
        relations: ['b'],
      },
      {
        key: 'b',
        summary: 'Card B',
        type: 'spec',
        relations: ['a'],
      },
    ]);
    expect(tc.ctx.cardRepo.findByKey('a')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('b')).not.toBeNull();
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    const aRelations = tc.ctx.relationRepo.findByCardKey('a');
    const aForward = aRelations.find((r) => !r.isReverse && r.dstCardKey === 'b');
    expect(aForward).not.toBeUndefined();
    const bRelations = tc.ctx.relationRepo.findByCardKey('b');
    const bForward = bRelations.find((r) => !r.isReverse && r.dstCardKey === 'a');
    expect(bForward).not.toBeUndefined();
  });

  // ── Duplicate Keys in Same Batch ──

  it('should fail second item when batch contains duplicate keys', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'dup', summary: 'A', type: 'spec' },
      { key: 'dup', summary: 'B', type: 'spec' },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['dup']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.key).toBe('dup');
    const row = tc.ctx.cardRepo.findByKey('dup');
    expect(row).not.toBeNull();
    expect(row!.summary).toBe('A');
  });

  // B-2: partialKeys tracking for Phase 2 relation failures
  it('should include partialKeys as empty array when all relations succeed', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-a', summary: 'A', type: 'spec' },
      { key: 'pk-b', summary: 'B', type: 'spec', relations: ['pk-a'] },
    ]);
    expect(result.partialKeys).toEqual([]);
    expect(result.created).toBe(2);
  });

  it('should report card in partialKeys when Phase 2 relation target does not exist', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-orphan', summary: 'Orphan', type: 'spec', relations: ['nonexistent-card'] },
    ]);
    expect(result.partialKeys).toContain('pk-orphan');
    expect(result.keys).not.toContain('pk-orphan');
    expect(result.errors.some((e) => e.key === 'pk-orphan' && e.message.includes('relation'))).toBe(true);
    // Card still exists in DB (created in Phase 1)
    expect(tc.ctx.cardRepo.findByKey('pk-orphan')).not.toBeNull();
  });

  it('should have partialKeys empty array when no cards have relations', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-no-rel', summary: 'No rel', type: 'spec' },
    ]);
    expect(result.partialKeys).toEqual([]);
  });
});
