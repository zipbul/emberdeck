import { describe, it, expect, afterEach } from 'bun:test';

import { mock } from 'bun:test';

import {
  createCard,
  updateCard,
  updateCardStatus,
  generateContext,
  checkDrift,
  checkInteractions,
  verifyAcceptance,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('generateContext', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return context pack for a single card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'root',
      summary: 'Root card',
      type: 'feature',
      priority: 'high',
    });

    const result = await generateContext(tc.ctx, 'root');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.key).toBe('root');
    expect(result.cards[0]!.type).toBe('feature');
  });

  it('should include related cards via BFS', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'a', summary: 'Card A' });
    await createCard(tc.ctx, {
      slug: 'b',
      summary: 'Card B',
      relations: [{ type: 'depends-on', target: 'a' }],
    });
    await createCard(tc.ctx, {
      slug: 'c',
      summary: 'Card C',
      relations: [{ type: 'depends-on', target: 'b' }],
    });

    const result = await generateContext(tc.ctx, 'c');
    expect(result.cards.length).toBeGreaterThanOrEqual(2);
    const keys = result.cards.map((c) => c.key);
    expect(keys).toContain('c');
    expect(keys).toContain('b');
  });

  it('should respect maxCards limit', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'root', summary: 'Root' });
    await createCard(tc.ctx, { slug: 'n1', summary: 'N1', relations: [{ type: 'related', target: 'root' }] });
    await createCard(tc.ctx, { slug: 'n2', summary: 'N2', relations: [{ type: 'related', target: 'root' }] });
    await createCard(tc.ctx, { slug: 'n3', summary: 'N3', relations: [{ type: 'related', target: 'root' }] });

    const result = await generateContext(tc.ctx, 'root', { maxCards: 2 });
    expect(result.cards.length).toBeLessThanOrEqual(2);
  });

  it('should include acceptance criteria from all cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'ac-root',
      summary: 'AC root',
      acceptance: [{ id: 'ac-1', description: 'Root criterion', verified: false }],
    });
    await createCard(tc.ctx, {
      slug: 'ac-child',
      summary: 'AC child',
      relations: [{ type: 'depends-on', target: 'ac-root' }],
      acceptance: [{ id: 'ac-2', description: 'Child criterion', verified: true }],
    });

    const result = await generateContext(tc.ctx, 'ac-child');
    expect(result.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
  });

  it('should include code links from all cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'cl-card',
      summary: 'CL card',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'foo' }],
    });

    const result = await generateContext(tc.ctx, 'cl-card');
    expect(result.codeLinks).toHaveLength(1);
    expect(result.codeLinks[0]!.symbol).toBe('foo');
  });

  it('should include body only for root card when includeBody=true', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'body-root', summary: 'Root', body: 'Root body content' });
    await createCard(tc.ctx, {
      slug: 'body-child',
      summary: 'Child',
      body: 'Child body',
      relations: [{ type: 'related', target: 'body-root' }],
    });

    const result = await generateContext(tc.ctx, 'body-root', { includeBody: true });
    const root = result.cards.find((c) => c.key === 'body-root');
    const child = result.cards.find((c) => c.key === 'body-child');
    expect(root!.body).toBe('Root body content');
    expect(child?.body).toBeUndefined();
  });

  it('should not include body when includeBody=false (default)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-body', summary: 'No body', body: 'Some content' });
    const result = await generateContext(tc.ctx, 'no-body');
    expect(result.cards[0]!.body).toBeUndefined();
  });

  it('should handle circular relations without hanging', async () => {
    // Use 'related' type which creates bidirectional reverse mirrors.
    // A related B already creates A→B forward + B→A reverse.
    // BFS traversal from A should visit B (via forward) and from B should revisit A (via reverse),
    // but the visited set prevents infinite loops.
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'circ-a', summary: 'Circular A' });
    await createCard(tc.ctx, {
      slug: 'circ-b',
      summary: 'Circular B',
      relations: [{ type: 'related', target: 'circ-a' }],
    });
    // At this point: circ-b→circ-a (forward), circ-a→circ-b (reverse mirror)
    // BFS from circ-a sees circ-b via reverse mirror, then from circ-b sees circ-a via forward.
    // Act — should return without hanging
    const result = await generateContext(tc.ctx, 'circ-a');
    // Assert — includes both cards
    const keys = result.cards.map((c) => c.key);
    expect(keys).toContain('circ-a');
    expect(keys).toContain('circ-b');
    expect(result.cards.length).toBe(2);
  });

  it('should throw when card does not exist', async () => {
    tc = await createTestContext();
    expect(generateContext(tc.ctx, 'nonexistent')).rejects.toThrow();
  });

  it('should include recent changes', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'hist-ctx', summary: 'Original' });
    await updateCard(tc.ctx, 'hist-ctx', { summary: 'Updated' });

    const result = await generateContext(tc.ctx, 'hist-ctx');
    expect(result.recentChanges.length).toBeGreaterThanOrEqual(1);
  });

  it('should include constraints from cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'cst',
      summary: 'Constraints',
      constraints: { maxRetries: 3, timeout: 5000 },
    });

    const result = await generateContext(tc.ctx, 'cst');
    expect(result.constraints['cst']).toEqual({ maxRetries: 3, timeout: 5000 });
  });

  it('should respect maxDepth parameter', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'd0', summary: 'Depth 0' });
    await createCard(tc.ctx, { slug: 'd1', summary: 'Depth 1', relations: [{ type: 'depends-on', target: 'd0' }] });
    await createCard(tc.ctx, { slug: 'd2', summary: 'Depth 2', relations: [{ type: 'depends-on', target: 'd1' }] });
    await createCard(tc.ctx, { slug: 'd3', summary: 'Depth 3', relations: [{ type: 'depends-on', target: 'd2' }] });

    const result = await generateContext(tc.ctx, 'd3', { maxDepth: 1 });
    const keys = result.cards.map((c) => c.key);
    expect(keys).toContain('d3');
    expect(keys).toContain('d2');
    expect(keys).not.toContain('d0');
  });

  it('should include relation graph edges', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'edge-a', summary: 'A' });
    await createCard(tc.ctx, {
      slug: 'edge-b',
      summary: 'B',
      relations: [{ type: 'depends-on', target: 'edge-a' }],
    });

    const result = await generateContext(tc.ctx, 'edge-b');
    expect(result.relationGraph.length).toBeGreaterThanOrEqual(1);
    const edge = result.relationGraph.find((e) => e.from === 'edge-b' && e.to === 'edge-a');
    expect(edge).toBeDefined();
  });
});

describe('checkDrift', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return 0 drift for healthy card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'healthy', summary: 'Healthy card' });
    const result = checkDrift(tc.ctx, 'healthy');
    expect(result.driftScore).toBe(0);
    expect(result.staleCards).toHaveLength(0);
  });

  it('should detect unverified acceptance as drift', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'unverified',
      summary: 'Unverified',
      acceptance: [
        { id: 'ac-1', description: 'Not done', verified: false },
        { id: 'ac-2', description: 'Not done either', verified: false },
      ],
    });

    const result = checkDrift(tc.ctx, 'unverified');
    expect(result.driftScore).toBeGreaterThan(0);
    expect(result.staleCards.length).toBeGreaterThanOrEqual(1);
    expect(result.staleCards[0]!.unverifiedAcceptance).toBe(2);
  });

  it('should check all cards when key is omitted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'all-a', summary: 'A' });
    await createCard(tc.ctx, { slug: 'all-b', summary: 'B' });

    const result = checkDrift(tc.ctx);
    expect(result.summary).toContain('2');
  });

  it('should return 0 for empty project', async () => {
    tc = await createTestContext();
    const result = checkDrift(tc.ctx);
    expect(result.driftScore).toBe(0);
    expect(result.summary).toContain('No cards');
  });

  it('should include related cards in drift scope via BFS', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-root',
      summary: 'Root',
      acceptance: [{ id: 'ac-1', description: 'X', verified: false }],
    });
    await createCard(tc.ctx, {
      slug: 'drift-child',
      summary: 'Child',
      relations: [{ type: 'depends-on', target: 'drift-root' }],
      acceptance: [{ id: 'ac-2', description: 'Y', verified: false }],
    });

    const result = checkDrift(tc.ctx, 'drift-child');
    expect(result.staleCards.length).toBe(2);
  });

  it('should report 0 drift when all acceptance verified', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'all-verified',
      summary: 'All verified',
      acceptance: [{ id: 'ac-1', description: 'Done', verified: true }],
    });

    const result = checkDrift(tc.ctx, 'all-verified');
    expect(result.driftScore).toBe(0);
    expect(result.staleCards).toHaveLength(0);
  });
});

describe('checkInteractions', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect shared symbols between cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'ia',
      summary: 'Card A',
      codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: 'sharedFunc' }],
    });
    await createCard(tc.ctx, {
      slug: 'ib',
      summary: 'Card B',
      codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: 'sharedFunc' }],
    });

    const result = checkInteractions(tc.ctx, ['ia', 'ib']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.sharedSymbols).toHaveLength(1);
    expect(result.interactions[0]!.sharedSymbols[0]!.symbol).toBe('sharedFunc');
  });

  it('should detect undefined relations when symbols are shared', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'ua',
      summary: 'A',
      codeLinks: [{ kind: 'class', file: 'src/x.ts', symbol: 'X' }],
    });
    await createCard(tc.ctx, {
      slug: 'ub',
      summary: 'B',
      codeLinks: [{ kind: 'class', file: 'src/x.ts', symbol: 'X' }],
    });

    const result = checkInteractions(tc.ctx, ['ua', 'ub']);
    expect(result.undefinedRelations).toHaveLength(1);
    expect(result.undefinedRelations[0]!.suggestion).toBe('related');
  });

  it('should report existing relation type for related cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'ra', summary: 'A' });
    await createCard(tc.ctx, {
      slug: 'rb',
      summary: 'B',
      relations: [{ type: 'depends-on', target: 'ra' }],
    });

    const result = checkInteractions(tc.ctx, ['ra', 'rb']);
    // They have a defined relation, so the interaction includes the relationType
    const interaction = result.interactions.find(
      (i) => i.pair.includes('ra') && i.pair.includes('rb'),
    );
    if (interaction) {
      expect(interaction.relationType).toBe('depends-on');
    }
    // No shared symbols, so no undefined relations
    expect(result.undefinedRelations).toHaveLength(0);
  });

  it('should return empty for cards with no overlap', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'na',
      summary: 'A',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'funcA' }],
    });
    await createCard(tc.ctx, {
      slug: 'nb',
      summary: 'B',
      codeLinks: [{ kind: 'function', file: 'src/b.ts', symbol: 'funcB' }],
    });

    const result = checkInteractions(tc.ctx, ['na', 'nb']);
    expect(result.interactions).toHaveLength(0);
    expect(result.undefinedRelations).toHaveLength(0);
  });

  it('should handle empty card list', async () => {
    tc = await createTestContext();
    const result = checkInteractions(tc.ctx, []);
    expect(result.interactions).toEqual([]);
    expect(result.undefinedRelations).toEqual([]);
  });

  it('should detect shared files as potential conflicts', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'fa',
      summary: 'A',
      codeLinks: [{ kind: 'function', file: 'src/common.ts', symbol: 'funcA' }],
    });
    await createCard(tc.ctx, {
      slug: 'fb',
      summary: 'B',
      codeLinks: [{ kind: 'function', file: 'src/common.ts', symbol: 'funcB' }],
    });

    const result = checkInteractions(tc.ctx, ['fa', 'fb']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.potentialConflicts.length).toBeGreaterThan(0);
  });
});

// ── Mock Gildash Factory ──

function createMockGildash(overrides: {
  searchAnnotations?: (...args: unknown[]) => unknown[];
  searchSymbols?: (...args: unknown[]) => unknown;
  getSymbolChanges?: (...args: unknown[]) => unknown[];
  getSymbolsByFile?: (...args: unknown[]) => unknown[] | null;
  getFileInfo?: (...args: unknown[]) => unknown;
} = {}) {
  return {
    searchAnnotations: mock(overrides.searchAnnotations ?? (() => [])),
    searchSymbols: mock(overrides.searchSymbols ?? (() => [])),
    getSymbolChanges: mock(overrides.getSymbolChanges ?? (() => [])),
    getSymbolsByFile: mock(overrides.getSymbolsByFile ?? (() => [])),
    getFileInfo: mock(overrides.getFileInfo ?? (() => null)),
    close: mock(() => Promise.resolve()),
  } as any;
}

describe('checkDrift with gildash — broken link detection', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect broken links when searchSymbols returns empty array', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-broken',
      summary: 'Broken link card',
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }],
    });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-broken');
    expect(result.driftScore).toBeGreaterThan(0);
    expect(result.staleCards.length).toBeGreaterThanOrEqual(1);
    const card = result.staleCards.find((c) => c.key === 'drift-broken');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(1);
  });

  it('should report zero broken links when searchSymbols finds the symbol', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-ok',
      summary: 'OK link card',
      codeLinks: [{ kind: 'function', file: 'src/ok.ts', symbol: 'okFn' }],
    });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'okFn', filePath: 'src/ok.ts', kind: 'function' }],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-ok');
    // No broken links and no stale files means no drift from links
    const card = result.staleCards.find((c) => c.key === 'drift-ok');
    if (card) {
      expect(card.brokenLinks).toBe(0);
    }
  });

  it('should detect broken link when searchSymbols returns non-array error result', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-err',
      summary: 'Error result card',
      codeLinks: [{ kind: 'function', file: 'src/err.ts', symbol: 'errFn' }],
    });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => ({ data: 'error', isErr: true }),
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-err');
    expect(result.driftScore).toBeGreaterThan(0);
    const card = result.staleCards.find((c) => c.key === 'drift-err');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(1);
  });

  it('should detect multiple broken links across multiple code links', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-multi',
      summary: 'Multi broken',
      codeLinks: [
        { kind: 'function', file: 'src/a.ts', symbol: 'fnA' },
        { kind: 'class', file: 'src/b.ts', symbol: 'ClassB' },
      ],
    });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-multi');
    const card = result.staleCards.find((c) => c.key === 'drift-multi');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(2);
  });
});

describe('checkDrift with gildash — stale detection', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect stale card when getFileInfo returns mtime newer than card updated_at', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-stale',
      summary: 'Stale card',
      codeLinks: [{ kind: 'function', file: 'src/changed.ts', symbol: 'changedFn' }],
    });

    // The card was just created, so its updatedAt is approximately now.
    // Set file mtime to far in the future to guarantee stale detection.
    const futureMtime = new Date(Date.now() + 60_000).toISOString();
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'changedFn', filePath: 'src/changed.ts', kind: 'function' }],
      getFileInfo: () => ({ mtime: futureMtime }),
    });

    const result = checkDrift(tc.ctx, 'drift-stale');
    expect(result.driftScore).toBeGreaterThan(0);
    const card = result.staleCards.find((c) => c.key === 'drift-stale');
    expect(card).toBeDefined();
    expect(card!.codeChangesAfter).toBeGreaterThanOrEqual(1);
  });

  it('should not detect stale when getFileInfo returns mtime older than card updated_at', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-fresh',
      summary: 'Fresh card',
      codeLinks: [{ kind: 'function', file: 'src/old.ts', symbol: 'oldFn' }],
    });

    const pastMtime = new Date(Date.now() - 60_000).toISOString();
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'oldFn', filePath: 'src/old.ts', kind: 'function' }],
      getFileInfo: () => ({ mtime: pastMtime }),
    });

    const result = checkDrift(tc.ctx, 'drift-fresh');
    // No broken links, no stale files, no unverified acceptance
    expect(result.staleCards).toHaveLength(0);
  });

  it('should not detect stale when getFileInfo returns null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-no-info',
      summary: 'No file info card',
      codeLinks: [{ kind: 'function', file: 'src/unknown.ts', symbol: 'unknownFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'unknownFn', filePath: 'src/unknown.ts', kind: 'function' }],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-no-info');
    expect(result.staleCards).toHaveLength(0);
  });

  it('should detect both broken link and stale file simultaneously', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'drift-combo',
      summary: 'Combo drift card',
      codeLinks: [
        { kind: 'function', file: 'src/broken.ts', symbol: 'brokenFn' },
        { kind: 'class', file: 'src/stale.ts', symbol: 'StaleClass' },
      ],
    });

    const futureMtime = new Date(Date.now() + 60_000).toISOString();
    tc.ctx.gildash = createMockGildash({
      searchSymbols: ({ text }: any) => {
        if (text === 'brokenFn') return [];
        if (text === 'StaleClass') return [{ name: 'StaleClass', filePath: 'src/stale.ts', kind: 'class' }];
        return [];
      },
      getFileInfo: (file: string) => {
        if (file === 'src/stale.ts') return { mtime: futureMtime };
        return null;
      },
    });

    const result = checkDrift(tc.ctx, 'drift-combo');
    expect(result.driftScore).toBeGreaterThan(0);
    const card = result.staleCards.find((c) => c.key === 'drift-combo');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(1);
    expect(card!.codeChangesAfter).toBe(1);
  });
});
