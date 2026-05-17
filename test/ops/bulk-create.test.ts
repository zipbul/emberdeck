import { describe, it, expect, afterEach } from 'bun:test';

import { bulkCreateCards, createCard } from '../../index';
import { createMockTestContext, type TestContext } from '../helpers';

describe('bulkCreateCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──

  it('should create multiple cards and return correct arrays', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'card-a', summary: 'Card A', type: 'spec' },
      { key: 'card-b', summary: 'Card B', type: 'spec' },
      { key: 'card-c', summary: 'Card C', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.created.map((c) => c.key)).toEqual(['card-a', 'card-b', 'card-c']);
    expect(result.created.every((c, i) => c.inputIndex === i)).toBe(true);
  });

  it('should create cards with all optional fields', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'full-card', summary: 'Full card', type: 'spec', tags: ['tag1'] },
    ]);
    expect(result.created).toHaveLength(1);
    const row = tc.ctx.cardRepo.findByKey('full-card');
    expect(row).not.toBeNull();
  });

  it('should resolve intra-batch relations regardless of order', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        key: 'depends-first',
        summary: 'Depends on target',
        type: 'spec',
        relations: ['target-second'],
      },
      { key: 'target-second', summary: 'Target card', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    const relations = tc.ctx.relationRepo.findByCardKey('depends-first');
    const forward = relations.find((r) => !r.isReverse && r.dstCardKey === 'target-second');
    expect(forward).not.toBeUndefined();
  });

  // ── Partial Success ──

  it('should skip failed items and continue creating the rest', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'existing', summary: 'Already exists', type: 'spec' });
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'new-card', summary: 'New card', type: 'spec' },
      { key: 'existing', summary: 'Duplicate', type: 'spec' },
      { key: 'another-new', summary: 'Another new', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.created.map((c) => c.key)).toEqual(['new-card', 'another-new']);
    expect(result.errors[0]!.key).toBe('existing');
    expect(result.errors[0]!.inputIndex).toBe(1);
  });

  it('should report error for invalid key', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: '../evil', summary: 'Bad key', type: 'spec' },
      { key: 'good-card', summary: 'Good card', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.created[0]!.key).toBe('good-card');
    expect(result.errors[0]!.key).toBe('../evil');
  });

  // ── Edge Cases ──

  it('should return empty arrays for empty input array', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, []);
    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle single card input', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'solo', summary: 'Solo card', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.key).toBe('solo');
  });

  // ── Mutual Relations ──

  it('should create both cards and succeed with mutual relations in same batch', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'a', summary: 'Card A', type: 'spec', relations: ['b'] },
      { key: 'b', summary: 'Card B', type: 'spec', relations: ['a'] },
    ]);
    expect(tc.ctx.cardRepo.findByKey('a')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('b')).not.toBeNull();
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    const aForward = tc.ctx.relationRepo.findByCardKey('a').find((r) => !r.isReverse && r.dstCardKey === 'b');
    expect(aForward).not.toBeUndefined();
    const bForward = tc.ctx.relationRepo.findByCardKey('b').find((r) => !r.isReverse && r.dstCardKey === 'a');
    expect(bForward).not.toBeUndefined();
  });

  // ── Duplicate Keys in Same Batch ──

  it('should fail second item when batch contains duplicate keys', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'dup', summary: 'A', type: 'spec' },
      { key: 'dup', summary: 'B', type: 'spec' },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    // inputIndex preserved: first won (index 0), second failed (index 1)
    expect(result.created[0]!.inputIndex).toBe(0);
    expect(result.errors[0]!.inputIndex).toBe(1);
    expect(result.errors[0]!.key).toBe('dup');
    const row = tc.ctx.cardRepo.findByKey('dup');
    expect(row).not.toBeNull();
    expect(row!.summary).toBe('A');
  });

  // partialKeys for Phase 2 relation failures
  it('should include partialKeys as empty array when all relations succeed', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-a', summary: 'A', type: 'spec' },
      { key: 'pk-b', summary: 'B', type: 'spec', relations: ['pk-a'] },
    ]);
    expect(result.partialKeys).toEqual([]);
    expect(result.created).toHaveLength(2);
  });

  it('should report card in partialKeys when Phase 2 relation target does not exist', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-orphan', summary: 'Orphan', type: 'spec', relations: ['nonexistent-card'] },
    ]);
    // The phase-1 row is committed and stays in created[]; partialKeys[]
    // flags it as "row exists but its relations did not land", and errors[]
    // carries the relation-update message.
    expect(result.partialKeys).toContain('pk-orphan');
    expect(result.created.find((c) => c.key === 'pk-orphan')).toBeDefined();
    expect(result.errors.some((e) => e.key === 'pk-orphan' && e.message.includes('relation'))).toBe(true);
    expect(tc.ctx.cardRepo.findByKey('pk-orphan')).not.toBeNull();
  });

  it('should have partialKeys empty array when no cards have relations', async () => {
    tc = await createMockTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { key: 'pk-no-rel', summary: 'No rel', type: 'spec' },
    ]);
    expect(result.partialKeys).toEqual([]);
  });
});
