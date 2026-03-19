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
      { slug: 'card-a', summary: 'Card A', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'card-b', summary: 'Card B', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'card-c', summary: 'Card C', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
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
        acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }],
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
        acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }],
      },
      { slug: 'target-second', summary: 'Target card', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
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
    await createCard(tc.ctx, { slug: 'existing', summary: 'Already exists', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    const result = await bulkCreateCards(tc.ctx, [
      { slug: 'new-card', summary: 'New card', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'existing', summary: 'Duplicate', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'another-new', summary: 'Another new', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
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
      { slug: '../evil', summary: 'Bad slug', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'good-card', summary: 'Good card', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
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
      { slug: 'solo', summary: 'Solo card', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
    ]);
    expect(result.created).toBe(1);
    expect(result.keys).toEqual(['solo']);
  });

  // ── Mutual Relations ──

  it('should create both cards and succeed with mutual relations in same batch', async () => {
    // Mutual relations (a depends-on b AND b depends-on a) in the same batch.
    // The unique constraint now includes is_reverse, so the reverse mirror row
    // (b→a, isReverse=true) and b's forward relation (b→a, isReverse=false) do not collide.
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      {
        slug: 'a',
        summary: 'Card A',
        relations: [{ type: 'depends-on', target: 'b' }],
        acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }],
      },
      {
        slug: 'b',
        summary: 'Card B',
        relations: [{ type: 'depends-on', target: 'a' }],
        acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }],
      },
    ]);
    // Both cards exist in DB
    expect(tc.ctx.cardRepo.findByKey('a')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('b')).not.toBeNull();
    // Both cards created, both relations applied, zero errors
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    // a depends-on b (forward)
    const aRelations = tc.ctx.relationRepo.findByCardKey('a');
    const aForward = aRelations.find((r) => !r.isReverse && r.dstCardKey === 'b');
    expect(aForward).not.toBeUndefined();
    // b depends-on a (forward)
    const bRelations = tc.ctx.relationRepo.findByCardKey('b');
    const bForward = bRelations.find((r) => !r.isReverse && r.dstCardKey === 'a');
    expect(bForward).not.toBeUndefined();
  });

  // ── Duplicate Slugs in Same Batch ──

  it('should fail second item when batch contains duplicate slugs', async () => {
    tc = await createTestContext();
    const result = await bulkCreateCards(tc.ctx, [
      { slug: 'dup', summary: 'A', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'dup', summary: 'B', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.keys).toEqual(['dup']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.slug).toBe('dup');
    // Verify the first card's summary persists
    const row = tc.ctx.cardRepo.findByKey('dup');
    expect(row).not.toBeNull();
    expect(row!.summary).toBe('A');
  });

  it('should report relation error when relation type is not allowed', async () => {
    tc = await createTestContext({ allowedRelationTypes: [] });
    const result = await bulkCreateCards(tc.ctx, [
      { slug: 'card-a', summary: 'A', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      {
        slug: 'card-b',
        summary: 'B',
        relations: [{ type: 'depends-on', target: 'card-a' }],
        acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }],
      },
    ]);
    // card-b created without relations, but relation update fails
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const relError = result.errors.find((e) => e.slug === 'card-b');
    expect(relError).toBeDefined();
  });
});
