import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  updateCard,
  getCardContext,
  getCardTree,
  findCardsBySymbol,
  CardNotFoundError,
  type CardRow,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

// ---------------------------------------------------------------------------
// getCardContext — depth parameter
// ---------------------------------------------------------------------------

describe('getCardContext depth', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // Forward chain: A -> B -> C -> D
  async function buildForwardChain(tc: TestContext) {
    await createCard(tc.ctx, { key: 'ctx-d', summary: 'D', type: 'spec' });
    await createCard(tc.ctx, { key: 'ctx-c', summary: 'C', type: 'spec', relations: ['ctx-d'] });
    await createCard(tc.ctx, { key: 'ctx-b', summary: 'B', type: 'spec', relations: ['ctx-c'] });
    await createCard(tc.ctx, { key: 'ctx-a', summary: 'A', type: 'spec', relations: ['ctx-b'] });
  }

  it('depth=1 (default): returns only direct relations, no related/truncated', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a');
    expect(result.downstreamCards.some((r) => r.key === 'ctx-b')).toBe(true);
    expect(result.related).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it('depth=1 explicit: same as default', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a', { depth: 1 });
    expect(result.related).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it('depth=3: includes BFS nodes at depth 2+ with full card data', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a', { depth: 3 });
    expect(result.downstreamCards.some((r) => r.key === 'ctx-b')).toBe(true);
    expect(result.related).toBeDefined();
    expect(result.related!.length).toBe(2);

    const relC = result.related!.find((r) => r.card.key === 'ctx-c');
    const relD = result.related!.find((r) => r.card.key === 'ctx-d');
    expect(relC).toBeDefined();
    expect(relC!.depth).toBe(2);
    expect(relC!.card.summary).toBe('C');
    expect(relD).toBeDefined();
    expect(relD!.depth).toBe(3);
    expect(relD!.card.summary).toBe('D');
  });

  it('depth=3: related nodes have correct direction', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a', { depth: 3 });
    // A→B→C→D is all forward
    for (const r of result.related!) {
      expect(r.direction).toBe('forward');
    }
  });

  it('depth=2: truncated=true when further nodes exist beyond depth', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a', { depth: 2 });
    expect(result.related).toBeDefined();
    expect(result.related!.some((r) => r.card.key === 'ctx-c')).toBe(true);
    expect(result.related!.some((r) => r.card.key === 'ctx-d')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it('depth=10 with short chain: truncated=false', async () => {
    tc = await createTestContext();
    await buildForwardChain(tc);
    const result = await getCardContext(tc.ctx, 'ctx-a', { depth: 10 });
    expect(result.truncated).toBe(false);
  });

  it('depth>1 with backward relations: discovers upstream path', async () => {
    tc = await createTestContext();
    // C→B→A: from A's perspective, B and C are upstream
    await createCard(tc.ctx, { key: 'bk-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'bk-b', summary: 'B', type: 'spec', relations: ['bk-a'] });
    await createCard(tc.ctx, { key: 'bk-c', summary: 'C', type: 'spec', relations: ['bk-b'] });

    const result = await getCardContext(tc.ctx, 'bk-a', { depth: 3 });
    // B is upstream at depth 1
    expect(result.upstreamCards.some((r) => r.key === 'bk-b')).toBe(true);
    // C is at depth 2, backward direction
    expect(result.related).toBeDefined();
    const relC = result.related!.find((r) => r.card.key === 'bk-c');
    expect(relC).toBeDefined();
    expect(relC!.depth).toBe(2);
    expect(relC!.direction).toBe('backward');
  });

  it('depth>1 diamond: each card appears once', async () => {
    tc = await createTestContext();
    // A→B, A→C, B→D, C→D
    await createCard(tc.ctx, { key: 'dia-d', summary: 'D', type: 'spec' });
    await createCard(tc.ctx, { key: 'dia-b', summary: 'B', type: 'spec', relations: ['dia-d'] });
    await createCard(tc.ctx, { key: 'dia-c', summary: 'C', type: 'spec', relations: ['dia-d'] });
    await createCard(tc.ctx, { key: 'dia-a', summary: 'A', type: 'spec', relations: ['dia-b', 'dia-c'] });

    const result = await getCardContext(tc.ctx, 'dia-a', { depth: 3 });
    // B, C at depth 1 (downstream). D at depth 2 (related).
    expect(result.downstreamCards).toHaveLength(2);
    expect(result.related).toBeDefined();
    expect(result.related!.filter((r) => r.card.key === 'dia-d')).toHaveLength(1);
  });

  it('depth>1 with no nodes beyond depth 1: related is empty', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sh-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'sh-b', summary: 'B', type: 'spec', relations: ['sh-a'] });

    const result = await getCardContext(tc.ctx, 'sh-a', { depth: 3 });
    expect(result.upstreamCards.some((r) => r.key === 'sh-b')).toBe(true);
    expect(result.related).toBeDefined();
    expect(result.related!).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCardTree
// ---------------------------------------------------------------------------

describe('getCardTree', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('builds a 3-level tree with correct structure', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'root', summary: 'Root', type: 'brief' });
    await createCard(tc.ctx, { key: 'child-a', summary: 'Child A', type: 'spec', parent: 'root' });
    await createCard(tc.ctx, { key: 'child-b', summary: 'Child B', type: 'spec', parent: 'root' });
    await createCard(tc.ctx, { key: 'grandchild', summary: 'Grandchild', type: 'spec', parent: 'child-a' });

    const tree = getCardTree(tc.ctx, 'root');
    expect(tree.key).toBe('root');
    expect(tree.depth).toBe(0);
    expect(tree.children).toHaveLength(2);

    const childA = tree.children.find((c) => c.key === 'child-a')!;
    expect(childA.depth).toBe(1);
    expect(childA.children).toHaveLength(1);
    expect(childA.children[0]!.key).toBe('grandchild');
    expect(childA.children[0]!.depth).toBe(2);
    expect(childA.children[0]!.children).toHaveLength(0);

    const childB = tree.children.find((c) => c.key === 'child-b')!;
    expect(childB.children).toHaveLength(0);
  });

  it('truncates at maxDepth and sets truncated=true only when children exist', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'r', summary: 'Root', type: 'brief' });
    await createCard(tc.ctx, { key: 'l1', summary: 'Level 1', type: 'spec', parent: 'r' });
    await createCard(tc.ctx, { key: 'l2', summary: 'Level 2', type: 'spec', parent: 'l1' });

    const tree = getCardTree(tc.ctx, 'r', 1);
    expect(tree.children).toHaveLength(1);
    const l1 = tree.children[0]!;
    expect(l1.key).toBe('l1');
    expect(l1.children).toHaveLength(0);
    expect(l1.truncated).toBe(true);
  });

  it('leaf nodes: empty children, no truncated flag', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'leaf-root', summary: 'Root', type: 'brief' });
    await createCard(tc.ctx, { key: 'leaf-child', summary: 'Leaf', type: 'spec', parent: 'leaf-root' });

    const tree = getCardTree(tc.ctx, 'leaf-root');
    const leaf = tree.children[0]!;
    expect(leaf.children).toHaveLength(0);
    expect(leaf.truncated).toBeUndefined();
  });

  it('throws CardNotFoundError for non-existent key', async () => {
    tc = await createTestContext();
    expect(() => getCardTree(tc.ctx, 'nonexistent')).toThrow(CardNotFoundError);
  });

  it('caps maxDepth at 20', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cap-root', summary: 'Root', type: 'brief' });
    const tree = getCardTree(tc.ctx, 'cap-root', 100);
    expect(tree.key).toBe('cap-root');
    expect(tree.children).toHaveLength(0);
  });

  it('includes type and status in tree nodes', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'typed-root', summary: 'Root', type: 'brief' });
    const tree = getCardTree(tc.ctx, 'typed-root');
    expect(tree.type).toBe('brief');
    expect(tree.status).toBe('draft');
    expect(tree.summary).toBe('Root');
  });

  it('starting from a non-root (middle) node shows only its subtree', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'top', summary: 'Top', type: 'brief' });
    await createCard(tc.ctx, { key: 'mid', summary: 'Mid', type: 'spec', parent: 'top' });
    await createCard(tc.ctx, { key: 'bot', summary: 'Bot', type: 'spec', parent: 'mid' });

    const tree = getCardTree(tc.ctx, 'mid');
    expect(tree.key).toBe('mid');
    expect(tree.depth).toBe(0);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.key).toBe('bot');
    // 'top' should NOT appear — tree only goes downward
  });

  it('relations are not traversed, only parent/child hierarchy', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'tr-root', summary: 'Root', type: 'brief' });
    await createCard(tc.ctx, { key: 'tr-child', summary: 'Child', type: 'spec', parent: 'tr-root' });
    // rel-target is related via relation, NOT a child
    await createCard(tc.ctx, { key: 'rel-target', summary: 'RelTarget', type: 'spec' });
    await updateCard(tc.ctx, 'tr-root', { relations: ['rel-target'] });

    const tree = getCardTree(tc.ctx, 'tr-root');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.key).toBe('tr-child');
    // rel-target should NOT appear in tree
  });
});

// ---------------------------------------------------------------------------
// findCardsBySymbol — boundary matching
// ---------------------------------------------------------------------------

describe('findCardsBySymbol boundary matching', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  function insertCard(key: string): void {
    const row: CardRow = {
      key,
      summary: `Card ${key}`,
      status: 'active',
      type: 'spec',
      parent: null,
      namespacesJson: null,
      body: null,
      glossaryJson: '[]',
      filePath: `cards/${key}.md`,
      updatedAt: new Date().toISOString(),
    };
    tc.ctx.cardRepo.upsert(row);
  }

  it('codeLink match: matchType="codeLink"', async () => {
    tc = await createTestContext();
    insertCard('spec/auth');
    tc.ctx.codeLinkRepo.replaceForCard('spec/auth', [
      { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
    ]);
    const result = await findCardsBySymbol(tc.ctx, 'login', 'src/auth.ts');
    expect(result).toHaveLength(1);
    expect(result[0]!.matchType).toBe('codeLink');
    expect(result[0]!.card.key).toBe('spec/auth');
  });

});
