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
      { slug: 'card-a', summary: 'Card A' },
      { slug: 'card-b', summary: 'Card B' },
      { slug: 'card-c', summary: 'Card C' },
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
        slug: 'full-card',
        summary: 'Full card',
        body: '# Body',
        keywords: ['kw1'],
        tags: ['tag1'],
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }],
      },
    ]);
    expect(result.created).toBe(1);
    const row = tc.ctx.cardRepo.findByKey('full-card');
    expect(row).not.toBeNull();
    expect(tc.ctx.classificationRepo.findKeywordsByCard('full-card')).toContain('kw1');
  });

  it('should resolve intra-batch relations regardless of order', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        slug: 'depends-first',
        summary: 'Depends on target',
        relations: [{ type: 'depends-on', target: 'target-second' }],
      },
      { slug: 'target-second', summary: 'Target card' },
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
    await createCard(tc.ctx, { slug: 'existing', summary: 'Already exists' });
    const result = await bulkCreateCards(tc.ctx, [
      { slug: 'new-card', summary: 'New card' },
      { slug: 'existing', summary: 'Duplicate' },
      { slug: 'another-new', summary: 'Another new' },
    ]);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['new-card', 'another-new']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.slug).toBe('existing');
  });

  it('should report error for invalid slug', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { slug: '../evil', summary: 'Bad slug' },
      { slug: 'good-card', summary: 'Good card' },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['good-card']);
    expect(result.errors[0]!.slug).toBe('../evil');
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
      { slug: 'solo', summary: 'Solo card' },
    ]);
    expect(result.created).toBe(1);
    expect(result.keys).toEqual(['solo']);
  });

  it('should report relation error when relation type is not allowed', async () => {
    tc = await createTestContext({ allowedRelationTypes: [] });
    const result = await bulkCreateCards(tc.ctx, [
      { slug: 'card-a', summary: 'A' },
      {
        slug: 'card-b',
        summary: 'B',
        relations: [{ type: 'depends-on', target: 'card-a' }],
      },
    ]);
    // card-b created without relations, but relation update fails
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const relError = result.errors.find((e) => e.slug === 'card-b');
    expect(relError).toBeDefined();
  });
});
