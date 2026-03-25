import { describe, it, expect, afterEach, mock } from 'bun:test';

import {
  createCard,
  updateCard,
  updateCardStatus,
  getCard,
  getCards,
  listCards,
  searchCards,
  listCardRelations,
  getRelationGraph,
} from '../../index';
import { CardKeyError, CardNotFoundError } from '../../index';
import { getCardContext } from '../../src/ops/query';
import { createTestContext, type TestContext } from '../helpers';

describe('getCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return GetCardResult with card when card exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'q-exists', summary: 'Exists', type: 'spec', body: 'My body' });
    const result = await getCard(tc.ctx, 'q-exists');
    expect(result.card.frontmatter.key).toBe('q-exists');
    expect(result.card.frontmatter.summary).toBe('Exists');
    expect(result.card.body).toBe('My body');
  });

  it('should throw CardNotFoundError when card does not exist', async () => {
    tc = await createTestContext();
    expect(getCard(tc.ctx, 'nonexistent')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should return correct frontmatter contents matching what was created', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'q-frontmatter',
      summary: 'Frontmatter test',
      type: 'spec',
      tags: ['tag1'],
    });
    const result = await getCard(tc.ctx, 'q-frontmatter');
    expect(result.card.frontmatter.status).toBe('draft');
    expect(result.card.frontmatter.tags).toContain('tag1');
  });

  it('should include history when includeHistory is true', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'q-hist', summary: 'History', type: 'intent' });
    await updateCardStatus(tc.ctx, 'q-hist', 'active');
    const result = await getCard(tc.ctx, 'q-hist', { includeHistory: true });
    expect(result.history).toBeDefined();
    expect(result.history!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return all cards when all keys exist', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gc-a', summary: 'A', type: 'spec', body: 'Body A' });
    await createCard(tc.ctx, { key: 'gc-b', summary: 'B', type: 'intent', body: 'Body B' });
    const result = await getCards(tc.ctx, ['gc-a', 'gc-b']);
    expect(result.cards).toHaveLength(2);
    expect(result.notFound).toHaveLength(0);
    expect(result.cards[0]!.card.frontmatter.key).toBe('gc-a');
    expect(result.cards[1]!.card.frontmatter.key).toBe('gc-b');
  });

  it('should put missing keys in notFound', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gc-exists', summary: 'Exists', type: 'spec' });
    const result = await getCards(tc.ctx, ['gc-exists', 'gc-ghost']);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.card.frontmatter.key).toBe('gc-exists');
    expect(result.notFound).toEqual(['gc-ghost']);
  });

  it('should return empty cards and all keys in notFound when none exist', async () => {
    tc = await createTestContext();
    const result = await getCards(tc.ctx, ['ghost-x', 'ghost-y']);
    expect(result.cards).toHaveLength(0);
    expect(result.notFound).toEqual(['ghost-x', 'ghost-y']);
  });

  it('should return empty result for empty keys array', async () => {
    tc = await createTestContext();
    const result = await getCards(tc.ctx, []);
    expect(result.cards).toHaveLength(0);
    expect(result.notFound).toHaveLength(0);
  });

  it('should include history when includeHistory is true', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gc-hist', summary: 'Hist', type: 'intent' });
    await updateCardStatus(tc.ctx, 'gc-hist', 'active');
    const result = await getCards(tc.ctx, ['gc-hist'], { includeHistory: true });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.history).toBeDefined();
    expect(result.cards[0]!.history!.length).toBeGreaterThanOrEqual(1);
  });

  it('should preserve card order matching input key order', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gc-z', summary: 'Z', type: 'spec' });
    await createCard(tc.ctx, { key: 'gc-a', summary: 'A', type: 'spec' });
    const result = await getCards(tc.ctx, ['gc-z', 'gc-a']);
    expect(result.cards[0]!.card.frontmatter.key).toBe('gc-z');
    expect(result.cards[1]!.card.frontmatter.key).toBe('gc-a');
  });

  it('should throw on invalid key format (not CardNotFoundError)', async () => {
    tc = await createTestContext();
    expect(getCards(tc.ctx, [''])).rejects.toThrow(CardKeyError);
  });
});

describe('listCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return all cards when no filter is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'list-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'list-b', summary: 'B', type: 'spec' });
    const rows = listCards(tc.ctx);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only cards with matching status when filter.status is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'flt-draft', summary: 'Draft', type: 'spec' });
    await createCard(tc.ctx, { key: 'flt-acc', summary: 'Active', type: 'intent' });
    await updateCardStatus(tc.ctx, 'flt-acc', 'active');
    const rows = listCards(tc.ctx, { status: 'active' });
    expect(rows.every((r) => r.status === 'active')).toBe(true);
    expect(rows.some((r) => r.key === 'flt-acc')).toBe(true);
  });

  it('should return empty array when no cards exist', async () => {
    tc = await createTestContext();
    const rows = listCards(tc.ctx);
    expect(rows).toHaveLength(0);
  });

  it('should return empty array when filter status has no matching cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'flt-none', summary: 'None', type: 'spec' });
    const rows = listCards(tc.ctx, { status: 'drifted' });
    expect(rows).toHaveLength(0);
  });

  it('should reflect updated values after updateCard when listing', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'lst-upd', summary: 'Old summary', type: 'spec' });
    await updateCard(tc.ctx, 'lst-upd', { summary: 'New summary' });
    const rows = listCards(tc.ctx);
    const row = rows.find((r) => r.key === 'lst-upd');
    expect(row?.summary).toBe('New summary');
  });

  it('should return exactly one card after creating one card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'one-card', summary: 'One', type: 'spec' });
    const rows = listCards(tc.ctx);
    expect(rows).toHaveLength(1);
  });

  it('should return correct count after creating multiple cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'mc-1', summary: 'MC1', type: 'spec' });
    await createCard(tc.ctx, { key: 'mc-2', summary: 'MC2', type: 'spec' });
    await createCard(tc.ctx, { key: 'mc-3', summary: 'MC3', type: 'spec' });
    const rows = listCards(tc.ctx);
    expect(rows).toHaveLength(3);
  });

  // P-2: body field stripped from listCards results
  it('should not include body field in listCards results', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'nobody', summary: 'NB', type: 'spec', body: 'This body should not appear' });
    const rows = listCards(tc.ctx);
    const row = rows.find((r) => r.key === 'nobody');
    expect(row).toBeDefined();
    expect('body' in row!).toBe(false);
  });

  it('should include all non-body fields in listCards results', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'fields-check', summary: 'FC', type: 'spec' });
    const rows = listCards(tc.ctx);
    const row = rows.find((r) => r.key === 'fields-check')!;
    expect(row.key).toBe('fields-check');
    expect(row.summary).toBe('FC');
    expect(row.status).toBe('draft');
    expect(row.type).toBe('spec');
    expect(typeof row.filePath).toBe('string');
    expect(typeof row.updatedAt).toBe('string');
  });

  it('should return identical results on repeated calls to listCards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'idp-lst', summary: 'Idp', type: 'spec' });
    const rows1 = listCards(tc.ctx);
    const rows2 = listCards(tc.ctx);
    expect(rows1.length).toBe(rows2.length);
    expect(rows1[0]?.key).toBe(rows2[0]?.key);
  });
});

describe('searchCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return matching card when FTS query matches card summary', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'srch-card', summary: 'Search me', type: 'spec' });
    const rows = searchCards(tc.ctx, 'Search');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('srch-card');
  });

  // P-2: body field stripped from searchCards results
  it('should not include body field in searchCards results', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'srch-nobody', summary: 'Searchable', type: 'spec', body: 'Hidden body' });
    const rows = searchCards(tc.ctx, 'Searchable');
    expect(rows).toHaveLength(1);
    expect('body' in rows[0]!).toBe(false);
  });

  it('should return all non-body fields in searchCards results', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'srch-fields', summary: 'FieldCheck', type: 'intent' });
    const rows = searchCards(tc.ctx, 'FieldCheck');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('srch-fields');
    expect(rows[0]!.summary).toBe('FieldCheck');
    expect(typeof rows[0]!.filePath).toBe('string');
  });
});

describe('listCardRelations', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return relation list when card has relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'lrel-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'lrel-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'lrel-src', {
      relations: ['lrel-dst'],
    });
    const rows = listCardRelations(tc.ctx, 'lrel-src');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.dstCardKey === 'lrel-dst')).toBe(true);
  });

  it('should return empty array when card has no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'lrel-none', summary: 'No rel', type: 'spec' });
    const rows = listCardRelations(tc.ctx, 'lrel-none');
    expect(rows).toHaveLength(0);
  });

  it('should throw CardKeyError when key is invalid', async () => {
    tc = await createTestContext();
    expect(() => listCardRelations(tc.ctx, '')).toThrow(CardKeyError);
  });
});

describe('getCardContext', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return empty codeLinks, upstream, downstream for isolated card when gildash not configured', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gctx-a', summary: 'A', type: 'spec' });
    const result = await getCardContext(tc.ctx, 'gctx-a');
    expect(result.card.frontmatter.key).toBe('gctx-a');
    expect(result.codeLinks).toHaveLength(0);
    expect(result.upstreamCards).toHaveLength(0);
    expect(result.downstreamCards).toHaveLength(0);
  });

  it('should include downstreamCards when card has outgoing relation', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gctx-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'gctx-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'gctx-src', { relations: ['gctx-dst'] });
    const result = await getCardContext(tc.ctx, 'gctx-src');
    expect(result.downstreamCards.some((r) => r.key === 'gctx-dst')).toBe(true);
    expect(result.upstreamCards).toHaveLength(0);
  });

  it('should include upstreamCards when another card relates to this card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gctx-dep', summary: 'Dep', type: 'spec' });
    await createCard(tc.ctx, { key: 'gctx-tgt', summary: 'Tgt', type: 'spec' });
    await updateCard(tc.ctx, 'gctx-dep', { relations: ['gctx-tgt'] });
    const result = await getCardContext(tc.ctx, 'gctx-tgt');
    expect(result.upstreamCards.some((r) => r.key === 'gctx-dep')).toBe(true);
    expect(result.downstreamCards).toHaveLength(0);
  });

  it('should throw CardNotFoundError when card file does not exist', async () => {
    tc = await createTestContext();
    expect(getCardContext(tc.ctx, 'ghost-card')).rejects.toBeInstanceOf(CardNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getRelationGraph
// ---------------------------------------------------------------------------

describe('getRelationGraph', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // Helper: creates cards and a linear chain A->B->C
  async function buildLinearChain(tc: TestContext) {
    await createCard(tc.ctx, { key: 'grg-c', summary: 'C', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'grg-b',
      summary: 'B',
      type: 'spec',
      relations: ['grg-c'],
    });
    await createCard(tc.ctx, {
      key: 'grg-a',
      summary: 'A',
      type: 'spec',
      relations: ['grg-b'],
    });
  }

  // [HP-1] Linear A->B->C, maxDepth unset -> [B(d1), C(d2)]
  it('should return transitive forward nodes for a linear chain when maxDepth is unset', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a');
    const keys = nodes.map((n) => n.key);
    expect(keys).toContain('grg-b');
    expect(keys).toContain('grg-c');
    expect(nodes.find((n) => n.key === 'grg-b')?.depth).toBe(1);
    expect(nodes.find((n) => n.key === 'grg-c')?.depth).toBe(2);
  });

  // [HP-2] Root has no relations -> []
  it('should return empty array when root card has no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'grg-solo', summary: 'Solo', type: 'spec' });
    const nodes = getRelationGraph(tc.ctx, 'grg-solo');
    expect(nodes).toHaveLength(0);
  });

  // [HP-3] direction='forward' -> backward relations excluded
  it('should exclude backward relations when direction is forward', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'forward' });
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(false);
  });

  // [HP-4] direction='backward' -> forward relations excluded
  it('should exclude forward relations when direction is backward', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'backward' });
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(false);
  });

  // [HP-5] direction='both' (default) -> both forward+backward
  it('should include both forward and backward nodes when direction is both', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'both' });
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(true);
  });

  // [HP-6] maxDepth=1 -> depth-1 only
  it('should return only depth-1 nodes when maxDepth is 1', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a', { maxDepth: 1 });
    expect(nodes.some((n) => n.key === 'grg-b')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(false);
  });

  // [HP-11] maxDepth=0 -> []
  it('should return empty array when maxDepth is 0', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a', { maxDepth: 0 });
    expect(nodes).toHaveLength(0);
  });

  // [NE-1] Root card not in DB -> []
  it('should return empty array when root card does not exist in DB', async () => {
    tc = await createTestContext();
    const nodes = getRelationGraph(tc.ctx, 'ghost-card');
    expect(nodes).toHaveLength(0);
  });

  // [NE-2] Invalid key format -> CardKeyError throw
  it('should throw CardKeyError when key format is invalid', async () => {
    tc = await createTestContext();
    expect(() => getRelationGraph(tc.ctx, '')).toThrow(CardKeyError);
  });

  // [CO-1] Diamond A->B, A->C, B->D, C->D -> D returned only once
  it('should include a node only once when it is reachable via multiple paths (diamond)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'dia-d', summary: 'D', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'dia-b',
      summary: 'B',
      type: 'spec',
      relations: ['dia-d'],
    });
    await createCard(tc.ctx, {
      key: 'dia-c',
      summary: 'C',
      type: 'spec',
      relations: ['dia-d'],
    });
    await createCard(tc.ctx, {
      key: 'dia-a',
      summary: 'A',
      type: 'spec',
      relations: ['dia-b', 'dia-c'],
    });
    const nodes = getRelationGraph(tc.ctx, 'dia-a', { direction: 'forward' });
    const dNodes = nodes.filter((n) => n.key === 'dia-d');
    expect(dNodes).toHaveLength(1);
  });

  // [ID-1] Same call twice -> identical results
  it('should return identical results on repeated calls with no changes', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const r1 = getRelationGraph(tc.ctx, 'grg-a').map((n) => n.key).sort();
    const r2 = getRelationGraph(tc.ctx, 'grg-a').map((n) => n.key).sort();
    expect(r1).toEqual(r2);
  });

  // [T2] Cyclic relations: A->B->A should not cause infinite loop
  it('should handle cyclic relations without infinite loop', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cyc-a', summary: 'Cycle A', type: 'spec' });
    await createCard(tc.ctx, { key: 'cyc-b', summary: 'Cycle B', type: 'spec', relations: ['cyc-a'] });
    // Add reverse relation to create cycle: A->B->A
    await updateCard(tc.ctx, 'cyc-a', { relations: ['cyc-b'] });

    const nodes = getRelationGraph(tc.ctx, 'cyc-a');
    // Should find cyc-b but not revisit cyc-a (visited set prevents cycle)
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.key).toBe('cyc-b');
  });
});
