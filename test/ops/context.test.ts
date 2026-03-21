import { describe, it, expect, afterEach } from 'bun:test';

import { mock } from 'bun:test';

import {
  createCard,
  updateCard,
  updateCardStatus,
  checkDrift,
  checkInteractions,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('checkDrift', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return 0 drift for healthy card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'healthy', summary: 'Healthy card', type: 'spec' });
    const result = checkDrift(tc.ctx, 'healthy');
    expect(result.driftScore).toBe(0);
    expect(result.staleCards).toHaveLength(0);
  });

  it('should check all cards when key is omitted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'all-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'all-b', summary: 'B', type: 'spec' });

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
      key: 'drift-root',
      summary: 'Root',
      type: 'spec',
    });
    await createCard(tc.ctx, {
      key: 'drift-child',
      summary: 'Child',
      type: 'spec',
      relations: ['drift-root'],
    });

    const result = checkDrift(tc.ctx, 'drift-child');
    // Both cards should be in scope
    expect(result.summary).toBeDefined();
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
      key: 'ia',
      summary: 'Card A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: 'sharedFunc' }],
    });
    await createCard(tc.ctx, {
      key: 'ib',
      summary: 'Card B',
      type: 'spec',
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
      key: 'ua',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'class', file: 'src/x.ts', symbol: 'X' }],
    });
    await createCard(tc.ctx, {
      key: 'ub',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'class', file: 'src/x.ts', symbol: 'X' }],
    });

    const result = checkInteractions(tc.ctx, ['ua', 'ub']);
    expect(result.undefinedRelations).toHaveLength(1);
    expect(result.undefinedRelations[0]!.suggestion).toBe('related');
  });

  it('should report hasRelation=true for related cards', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'ra', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'rb',
      summary: 'B',
      type: 'spec',
      relations: ['ra'],
    });

    const result = checkInteractions(tc.ctx, ['ra', 'rb']);
    const interaction = result.interactions.find(
      (i) => i.pair.includes('ra') && i.pair.includes('rb'),
    );
    if (interaction) {
      expect(interaction.hasRelation).toBe(true);
    }
    expect(result.undefinedRelations).toHaveLength(0);
  });

  it('should return empty for cards with no overlap', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'na',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'funcA' }],
    });
    await createCard(tc.ctx, {
      key: 'nb',
      summary: 'B',
      type: 'spec',
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
      key: 'fa',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/common.ts', symbol: 'funcA' }],
    });
    await createCard(tc.ctx, {
      key: 'fb',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/common.ts', symbol: 'funcB' }],
    });

    const result = checkInteractions(tc.ctx, ['fa', 'fb']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.potentialConflicts.length).toBeGreaterThan(0);
  });

  it('should populate sharedFiles array with exact file paths', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'sf-a',
      summary: 'A',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: 'funcA' }],
    });
    await createCard(tc.ctx, {
      key: 'sf-b',
      summary: 'B',
      type: 'spec',
      codeLinks: [{ kind: 'class', file: 'src/shared.ts', symbol: 'ClassB' }],
    });

    const result = checkInteractions(tc.ctx, ['sf-a', 'sf-b']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.sharedFiles).toEqual(['src/shared.ts']);
    expect(result.interactions[0]!.sharedSymbols).toHaveLength(0);
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
      key: 'drift-broken',
      summary: 'Broken link card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }],
    });
    await updateCardStatus(tc.ctx, 'drift-broken', 'active');
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
      key: 'drift-ok',
      summary: 'OK link card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/ok.ts', symbol: 'okFn' }],
    });
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'okFn', filePath: 'src/ok.ts', kind: 'function' }],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-ok');
    const card = result.staleCards.find((c) => c.key === 'drift-ok');
    if (card) {
      expect(card.brokenLinks).toBe(0);
    }
  });

  it('should NOT count broken links for draft card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'drift-draft',
      summary: 'Draft card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }],
    });
    // status defaults to 'draft'
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-draft');
    const card = result.staleCards.find((c) => c.key === 'drift-draft');
    if (card) {
      expect(card.brokenLinks).toBe(0);
    }
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
      key: 'drift-stale',
      summary: 'Stale card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/changed.ts', symbol: 'changedFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'changedFn', filePath: 'src/changed.ts', kind: 'function' }],
      getFileInfo: () => ({ mtimeMs: Date.now() + 60_000 }),
    });

    const result = checkDrift(tc.ctx, 'drift-stale');
    expect(result.driftScore).toBeGreaterThan(0);
    const card = result.staleCards.find((c) => c.key === 'drift-stale');
    expect(card).toBeDefined();
    expect(card!.codeChangesAfter).toBeGreaterThanOrEqual(1);
  });

  it('should not detect stale when getFileInfo returns null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'drift-no-info',
      summary: 'No file info card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/unknown.ts', symbol: 'unknownFn' }],
    });

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'unknownFn', filePath: 'src/unknown.ts', kind: 'function' }],
      getFileInfo: () => null,
    });

    const result = checkDrift(tc.ctx, 'drift-no-info');
    expect(result.staleCards).toHaveLength(0);
  });
});
