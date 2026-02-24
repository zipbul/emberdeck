import { describe, it, expect, afterEach, mock } from 'bun:test';

import {
  createCard,
  updateCard,
  updateCardStatus,
  getCard,
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

  it('should return CardFile when card exists', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'q-exists', summary: 'Exists', body: 'My body' });
    // Act
    const card = await getCard(tc.ctx, 'q-exists');
    // Assert
    expect(card.frontmatter.key).toBe('q-exists');
    expect(card.frontmatter.summary).toBe('Exists');
    expect(card.body).toBe('My body');
  });

  it('should throw CardNotFoundError when card does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(getCard(tc.ctx, 'nonexistent')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should return correct frontmatter contents matching what was created', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'q-frontmatter',
      summary: 'Frontmatter test',
      keywords: ['kw1'],
      tags: ['tag1'],
    });
    // Act
    const card = await getCard(tc.ctx, 'q-frontmatter');
    // Assert
    expect(card.frontmatter.status).toBe('draft');
    expect(card.frontmatter.keywords).toContain('kw1');
    expect(card.frontmatter.tags).toContain('tag1');
  });
});

describe('listCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return all cards when no filter is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'list-a', summary: 'A' });
    await createCard(tc.ctx, { slug: 'list-b', summary: 'B' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only cards with matching status when filter.status is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'flt-draft', summary: 'Draft' });
    await createCard(tc.ctx, { slug: 'flt-acc', summary: 'Accepted' });
    await updateCardStatus(tc.ctx, 'flt-acc', 'accepted');
    // Act
    const rows = listCards(tc.ctx, { status: 'accepted' });
    // Assert
    expect(rows.every((r) => r.status === 'accepted')).toBe(true);
    expect(rows.some((r) => r.key === 'flt-acc')).toBe(true);
  });

  it('should return empty array when no cards exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should return empty array when filter status has no matching cards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'flt-none', summary: 'None' });
    // Act
    const rows = listCards(tc.ctx, { status: 'deprecated' });
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should reflect updated values after updateCard when listing', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lst-upd', summary: 'Old summary' });
    await updateCard(tc.ctx, 'lst-upd', { summary: 'New summary' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    const row = rows.find((r) => r.key === 'lst-upd');
    expect(row?.summary).toBe('New summary');
  });

  it('should return exactly one card after creating one card', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'one-card', summary: 'One' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(1);
  });

  it('should return correct count after creating multiple cards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'mc-1', summary: 'MC1' });
    await createCard(tc.ctx, { slug: 'mc-2', summary: 'MC2' });
    await createCard(tc.ctx, { slug: 'mc-3', summary: 'MC3' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(3);
  });

  it('should return identical results on repeated calls to listCards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-lst', summary: 'Idp' });
    // Act
    const rows1 = listCards(tc.ctx);
    const rows2 = listCards(tc.ctx);
    // Assert
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
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'srch-card', summary: 'Search me' });
    // Act
    const rows = searchCards(tc.ctx, 'Search');
    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('srch-card');
  });
});

describe('listCardRelations', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return relation list when card has relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lrel-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'lrel-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'lrel-src', {
      relations: [{ type: 'depends-on', target: 'lrel-dst' }],
    });
    // Act
    const rows = listCardRelations(tc.ctx, 'lrel-src');
    // Assert
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.dstCardKey === 'lrel-dst')).toBe(true);
  });

  it('should return empty array when card has no relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lrel-none', summary: 'No rel' });
    // Act
    const rows = listCardRelations(tc.ctx, 'lrel-none');
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should throw CardKeyError when key is invalid', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(() => listCardRelations(tc.ctx, '')).toThrow(CardKeyError);
  });
});

describe('getCardContext', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return empty codeLinks, upstream, downstream for isolated card when gildash not configured', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'gctx-a', summary: 'A' });
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-a');
    // Assert
    expect(result.card.frontmatter.key).toBe('gctx-a');
    expect(result.codeLinks).toHaveLength(0);
    expect(result.upstreamCards).toHaveLength(0);
    expect(result.downstreamCards).toHaveLength(0);
  });

  it('should include downstreamCards when card has outgoing depends-on relation', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'gctx-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'gctx-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'gctx-src', { relations: [{ type: 'depends-on', target: 'gctx-dst' }] });
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-src');
    // Assert
    expect(result.downstreamCards.some((r) => r.key === 'gctx-dst')).toBe(true);
    expect(result.upstreamCards).toHaveLength(0);
  });

  it('should include upstreamCards when another card depends-on this card', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'gctx-dep', summary: 'Dep' });
    await createCard(tc.ctx, { slug: 'gctx-tgt', summary: 'Tgt' });
    await updateCard(tc.ctx, 'gctx-dep', { relations: [{ type: 'depends-on', target: 'gctx-tgt' }] });
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-tgt');
    // Assert
    expect(result.upstreamCards.some((r) => r.key === 'gctx-dep')).toBe(true);
    expect(result.downstreamCards).toHaveLength(0);
  });

  it('should return both upstreamCards and downstreamCards when card is in middle of chain', async () => {
    // Arrange
    tc = await createTestContext();
    // upstream(gctx-up) → gctx-mid → gctx-dn(downstream)
    // Create leaf first so FK doesn't fail, then middle, then root
    await createCard(tc.ctx, { slug: 'gctx-dn', summary: 'Dn' });
    await createCard(tc.ctx, {
      slug: 'gctx-mid',
      summary: 'Mid',
      relations: [{ type: 'depends-on', target: 'gctx-dn' }],
    });
    await createCard(tc.ctx, {
      slug: 'gctx-up',
      summary: 'Up',
      relations: [{ type: 'depends-on', target: 'gctx-mid' }],
    });
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-mid');
    // Assert
    expect(result.upstreamCards.some((r) => r.key === 'gctx-up')).toBe(true);
    expect(result.downstreamCards.some((r) => r.key === 'gctx-dn')).toBe(true);
  });

  it('should return resolvedCodeLinks when gildash is configured and codeLinks exist', async () => {
    // Arrange
    tc = await createTestContext();
    const mockSymbol = {
      id: '1', name: 'myFunc', filePath: 'src/a.ts', kind: 'function' as any,
      span: { start: 0, end: 10 }, isExported: true, signature: 'myFunc()', fingerprint: 'abc', detail: '',
    };
    tc.ctx.gildash = { searchSymbols: mock(() => [mockSymbol]), close: mock(async () => {}) } as any;
    await createCard(tc.ctx, {
      slug: 'gctx-cl', summary: 'CL', codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
    });
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-cl');
    // Assert
    expect(result.codeLinks).toHaveLength(1);
    expect(result.codeLinks[0]!.link.symbol).toBe('myFunc');
    expect(result.codeLinks[0]!.symbol).not.toBeNull();
  });

  it('should throw CardNotFoundError when card file does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(getCardContext(tc.ctx, 'ghost-card')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should return empty codeLinks when gildash is not configured even if frontmatter has codeLinks', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'gctx-nogil', summary: 'No gildash', codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
    });
    // ctx.gildash is undefined by default
    // Act
    const result = await getCardContext(tc.ctx, 'gctx-nogil');
    // Assert
    expect(result.codeLinks).toHaveLength(0);
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

  // Helper: creates cards and a linear chain A→B→C
  async function buildLinearChain(tc: TestContext) {
    await createCard(tc.ctx, { slug: 'grg-c', summary: 'C' });
    await createCard(tc.ctx, {
      slug: 'grg-b',
      summary: 'B',
      relations: [{ type: 'depends-on', target: 'grg-c' }],
    });
    await createCard(tc.ctx, {
      slug: 'grg-a',
      summary: 'A',
      relations: [{ type: 'depends-on', target: 'grg-b' }],
    });
  }

  // [HP-1] 선형 A→B→C, maxDepth 미지정 → [B(d1), C(d2)]
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

  // [HP-2] root가 관계 없음 → []
  it('should return empty array when root card has no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'grg-solo', summary: 'Solo' });
    const nodes = getRelationGraph(tc.ctx, 'grg-solo');
    expect(nodes).toHaveLength(0);
  });

  // [HP-3] direction='forward' → backward relation 제외
  it('should exclude backward relations when direction is forward', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    // from grg-b: forward=grg-c, backward=grg-a (grg-a depends on grg-b)
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'forward' });
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(false);
  });

  // [HP-4] direction='backward' → forward relation 제외
  it('should exclude forward relations when direction is backward', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    // from grg-b: backward=grg-a
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'backward' });
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(false);
  });

  // [HP-5] direction='both' (기본값) → forward+backward 모두
  it('should include both forward and backward nodes when direction is both', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'both' });
    expect(nodes.some((n) => n.key === 'grg-a')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(true);
  });

  // [HP-6] maxDepth=1 → 1-depth만
  it('should return only depth-1 nodes when maxDepth is 1', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a', { maxDepth: 1 });
    expect(nodes.some((n) => n.key === 'grg-b')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(false);
  });

  // [HP-7] maxDepth=2 → 2-depth까지
  it('should return nodes up to depth 2 when maxDepth is 2', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a', { maxDepth: 2 });
    expect(nodes.some((n) => n.key === 'grg-b')).toBe(true);
    expect(nodes.some((n) => n.key === 'grg-c')).toBe(true);
  });

  // [HP-8] 다대다 A→B, A→C → B(d1), C(d1) 둘 다 포함
  it('should return all direct neighbors when card has multiple forward relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'fan-b', summary: 'B' });
    await createCard(tc.ctx, { slug: 'fan-c', summary: 'C' });
    await createCard(tc.ctx, {
      slug: 'fan-a',
      summary: 'A',
      relations: [
        { type: 'depends-on', target: 'fan-b' },
        { type: 'references', target: 'fan-c' },
      ],
    });
    const nodes = getRelationGraph(tc.ctx, 'fan-a', { direction: 'forward' });
    expect(nodes.some((n) => n.key === 'fan-b')).toBe(true);
    expect(nodes.some((n) => n.key === 'fan-c')).toBe(true);
    expect(nodes.every((n) => n.depth === 1)).toBe(true);
  });

  // [HP-9] B에서 backward 탐색 → A(d1)
  it('should return the upstream card at depth 1 when traversing backward from dependent', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-b', { direction: 'backward', maxDepth: 1 });
    expect(nodes.some((n) => n.key === 'grg-a' && n.depth === 1)).toBe(true);
  });

  // [HP-10] 여러 relation type 혼재 → relationType 필드 보존
  it('should preserve relationType field for each node', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rt-b', summary: 'B' });
    await createCard(tc.ctx, { slug: 'rt-c', summary: 'C' });
    await createCard(tc.ctx, {
      slug: 'rt-a',
      summary: 'A',
      relations: [
        { type: 'depends-on', target: 'rt-b' },
        { type: 'references', target: 'rt-c' },
      ],
    });
    const nodes = getRelationGraph(tc.ctx, 'rt-a', { direction: 'forward' });
    expect(nodes.find((n) => n.key === 'rt-b')?.relationType).toBe('depends-on');
    expect(nodes.find((n) => n.key === 'rt-c')?.relationType).toBe('references');
  });

  // [HP-11] maxDepth=0 → []
  it('should return empty array when maxDepth is 0', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const nodes = getRelationGraph(tc.ctx, 'grg-a', { maxDepth: 0 });
    expect(nodes).toHaveLength(0);
  });

  // [NE-1] root 카드 DB 없음 → []
  it('should return empty array when root card does not exist in DB', async () => {
    tc = await createTestContext();
    const nodes = getRelationGraph(tc.ctx, 'ghost-card');
    expect(nodes).toHaveLength(0);
  });

  // [NE-2] 잘못된 key 형식 → CardKeyError throw
  it('should throw CardKeyError when key format is invalid', async () => {
    tc = await createTestContext();
    expect(() => getRelationGraph(tc.ctx, '')).toThrow(CardKeyError);
  });

  // [NE-3] 관계 target 카드 DB 없음 → skip, 오류 없음
  it('should skip orphan relation targets and not throw', async () => {
    tc = await createTestContext();
    // Manually insert a row with a dangling filePath so cardRepo.findByKey works
    // but the relation target doesn't exist in card table
    await createCard(tc.ctx, { slug: 'grg-src-orphan', summary: 'Src' });
    // Update relations to a non-existent card — FK warns but skips
    // Since FK prevents insertion, the relation won't be in DB at all, so result is []
    await updateCard(tc.ctx, 'grg-src-orphan', {
      relations: [{ type: 'depends-on', target: 'nonexistent-dst' }],
    });
    const nodes = getRelationGraph(tc.ctx, 'grg-src-orphan', { direction: 'forward' });
    // Either empty (FK prevented) or skips invalid targets — must not throw
    expect(Array.isArray(nodes)).toBe(true);
  });

  // [NE-4] direction='forward'이고 backward relation만 존재 → []
  it('should return empty array when direction is forward but only backward relations exist', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    // grg-c has no forward relations, only backward (grg-b depends on it)
    const nodes = getRelationGraph(tc.ctx, 'grg-c', { direction: 'forward' });
    expect(nodes).toHaveLength(0);
  });

  // [CO-1] 다이아모드 A→B, A→C, B→D, C→D → D는 한 번만 반환
  it('should include a node only once when it is reachable via multiple paths (diamond)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'dia-d', summary: 'D' });
    await createCard(tc.ctx, {
      slug: 'dia-b',
      summary: 'B',
      relations: [{ type: 'depends-on', target: 'dia-d' }],
    });
    await createCard(tc.ctx, {
      slug: 'dia-c',
      summary: 'C',
      relations: [{ type: 'depends-on', target: 'dia-d' }],
    });
    await createCard(tc.ctx, {
      slug: 'dia-a',
      summary: 'A',
      relations: [
        { type: 'depends-on', target: 'dia-b' },
        { type: 'depends-on', target: 'dia-c' },
      ],
    });
    const nodes = getRelationGraph(tc.ctx, 'dia-a', { direction: 'forward' });
    const dNodes = nodes.filter((n) => n.key === 'dia-d');
    expect(dNodes).toHaveLength(1);
  });

  // [ID-1] 동일 호출 2회 → 동일 결과
  it('should return identical results on repeated calls with no changes', async () => {
    tc = await createTestContext();
    await buildLinearChain(tc);
    const r1 = getRelationGraph(tc.ctx, 'grg-a').map((n) => n.key).sort();
    const r2 = getRelationGraph(tc.ctx, 'grg-a').map((n) => n.key).sort();
    expect(r1).toEqual(r2);
  });
});