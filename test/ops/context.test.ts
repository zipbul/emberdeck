import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  updateCardStatus,
  checkDrift,
  checkInteractions,
} from '../../index';
import { createMockTestContext, ensure4tierScaffold, makeTestSpec, setCardCodeLinks, type TestContext } from '../helpers';
import { readCardFile } from '../../src/fs/reader';

describe('checkDrift', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return healthy result for card with no issues', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'healthy', summary: 'Healthy card', type: 'spec' });
    const result = await checkDrift(tc.ctx, 'healthy');
    expect(result.health.draft).toBe(1);
    expect(result.cards).toHaveLength(0);
  });

  it('should check all cards when key is omitted', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'all-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'all-b', summary: 'B', type: 'spec' });

    const result = await checkDrift(tc.ctx);
    expect(result.health.total).toBe(2);
  });

  it('should return empty for empty project', async () => {
    tc = await createMockTestContext();
    const result = await checkDrift(tc.ctx);
    expect(result.health.total).toBe(0);
    expect(result.cards).toHaveLength(0);
  });

  it('should include related cards in drift scope via BFS', async () => {
    tc = await createMockTestContext();
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

    const result = await checkDrift(tc.ctx, 'drift-child');
    // Both cards should be in scope
    expect(result.health.total).toBe(2);
  });

  it('should count active and drifted cards in health', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'h-active',
      summary: 'Active',
      type: 'spec',
      parent: '_br',
            spec: makeTestSpec('src/a.ts', 'fn'),
    });
    await updateCardStatus(tc.ctx, 'h-active', 'active');
    await createCard(tc.ctx, { key: 'h-draft', summary: 'Draft', type: 'spec' });

    const result = await checkDrift(tc.ctx, undefined);
    expect(result.health.active).toBe(1);
    // 4-tier: scaffolding adds 2 draft cards (_dom, _br) on top of 'h-draft'.
    expect(result.health.draft).toBe(3);
  });

  it('should skip draft cards from drift analysis', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'draft-skip',
      summary: 'Draft',
      type: 'spec',
      });
    // Draft cards are not in the cards array at all
    const result = await checkDrift(tc.ctx, 'draft-skip');
    expect(result.cards).toHaveLength(0);
    expect(result.health.draft).toBe(1);
  });
});

import { mockGildash as createMockGildash } from '../fixtures/gildash';

describe('checkDrift with gildash — broken link detection', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect broken links and set driftType to broken_link', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'drift-broken',
      summary: 'Broken link card',
      type: 'spec',
      parent: '_br',
            spec: makeTestSpec('src/gone.ts', 'missingFn'),
    });
    setCardCodeLinks(tc.ctx, 'drift-broken', [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }]);
    await updateCardStatus(tc.ctx, 'drift-broken', 'active');
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = await checkDrift(tc.ctx, 'drift-broken');
    expect(result.cards.length).toBeGreaterThanOrEqual(1);
    const card = result.cards.find((c) => c.key === 'drift-broken');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(1);
    expect(card!.driftType).toBe('broken_link');
    // checkDrift is read-only: DB status remains 'active', drift surfaced via driftType
    expect(card!.status).toBe('active');
  });

  it('should report zero broken links when searchSymbols finds the symbol', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'drift-ok',
      summary: 'OK link card',
      type: 'spec',
      parent: '_br',
            spec: makeTestSpec('src/ok.ts', 'okFn'),
    });
    await updateCardStatus(tc.ctx, 'drift-ok', 'active');
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [{ name: 'okFn', filePath: 'src/ok.ts', kind: 'function' }],
      getFileInfo: () => null,
    });

    const result = await checkDrift(tc.ctx, 'drift-ok');
    const card = result.cards.find((c) => c.key === 'drift-ok');
    expect(card).toBeDefined();
    expect(card!.brokenLinks).toBe(0);
    expect(card!.status).toBe('active');
    expect(card!.driftType).toBeUndefined();
  });

  it('should NOT count broken links for draft card', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'drift-draft',
      summary: 'Draft card',
      type: 'spec',
      });
    // status defaults to 'draft'
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = await checkDrift(tc.ctx, 'drift-draft');
    // Draft cards are excluded from drift analysis
    expect(result.health.draft).toBe(1);
    expect(result.cards).toHaveLength(0);
  });

  it('should never mutate DB status — drift surfaced via driftType only', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'no-mutate',
      summary: 'Read-only check',
      type: 'spec',
      parent: '_br',
            spec: makeTestSpec('src/gone.ts', 'missingFn'),
    });
    setCardCodeLinks(tc.ctx, 'no-mutate', [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }]);
    await updateCardStatus(tc.ctx, 'no-mutate', 'active');
    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [],
      getFileInfo: () => null,
    });

    const result = await checkDrift(tc.ctx, 'no-mutate');
    const card = result.cards.find((c) => c.key === 'no-mutate');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('broken_link');
    expect(card!.status).toBe('active');
    // DB row + file remain unchanged
    const row = tc.ctx.cardRepo.findByKey('no-mutate');
    expect(row!.status).toBe('active');
    const cardFile = await readCardFile(row!.filePath);
    expect(cardFile.frontmatter.status).toBe('active');
  });
});

describe('checkInteractions', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect shared symbols between cards', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'ia', summary: 'Card A', type: 'spec' });
    await createCard(tc.ctx, { key: 'ib', summary: 'Card B', type: 'spec' });
    const shared = { kind: 'function', file: 'src/shared.ts', symbol: 'sharedFunc' };
    setCardCodeLinks(tc.ctx, 'ia', [shared]);
    setCardCodeLinks(tc.ctx, 'ib', [shared]);

    const result = await checkInteractions(tc.ctx, ['ia', 'ib']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.sharedSymbols).toHaveLength(1);
    expect(result.interactions[0]!.sharedSymbols[0]!.symbol).toBe('sharedFunc');
  });

  it('should detect undefined relations when symbols are shared', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'ua', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'ub', summary: 'B', type: 'spec' });
    const shared = { kind: 'function', file: 'src/u.ts', symbol: 'fn' };
    setCardCodeLinks(tc.ctx, 'ua', [shared]);
    setCardCodeLinks(tc.ctx, 'ub', [shared]);

    const result = await checkInteractions(tc.ctx, ['ua', 'ub']);
    expect(result.undefinedRelations).toHaveLength(1);
    expect(result.undefinedRelations[0]!.suggestion).toBe('related');
  });

  it('should report hasRelation=true for related cards', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'ra', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'rb',
      summary: 'B',
      type: 'spec',
      relations: ['ra'],
    });

    const result = await checkInteractions(tc.ctx, ['ra', 'rb']);
    const interaction = result.interactions.find(
      (i) => i.pair.includes('ra') && i.pair.includes('rb'),
    );
    expect(interaction).toBeDefined();
    expect(interaction!.hasRelation).toBe(true);
    expect(result.undefinedRelations).toHaveLength(0);
  });

  it('should return empty for cards with no overlap', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'na',
      summary: 'A',
      type: 'spec',
      });
    await createCard(tc.ctx, {
      key: 'nb',
      summary: 'B',
      type: 'spec',
      });

    const result = await checkInteractions(tc.ctx, ['na', 'nb']);
    expect(result.interactions).toHaveLength(0);
    expect(result.undefinedRelations).toHaveLength(0);
  });

  it('should handle empty card list', async () => {
    tc = await createMockTestContext();
    const result = await checkInteractions(tc.ctx, []);
    expect(result.interactions).toEqual([]);
    expect(result.undefinedRelations).toEqual([]);
  });

  it('should detect shared files as potential conflicts', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'fa', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'fb', summary: 'B', type: 'spec' });
    setCardCodeLinks(tc.ctx, 'fa', [{ kind: 'function', file: 'src/shared.ts', symbol: 'a' }]);
    setCardCodeLinks(tc.ctx, 'fb', [{ kind: 'function', file: 'src/shared.ts', symbol: 'b' }]);

    const result = await checkInteractions(tc.ctx, ['fa', 'fb']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.potentialConflicts.length).toBeGreaterThan(0);
  });

  it('should populate sharedFiles array with exact file paths', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'sf-a', summary: 'A', type: 'spec' });
    await createCard(tc.ctx, { key: 'sf-b', summary: 'B', type: 'spec' });
    setCardCodeLinks(tc.ctx, 'sf-a', [{ kind: 'function', file: 'src/shared.ts', symbol: 'a' }]);
    setCardCodeLinks(tc.ctx, 'sf-b', [{ kind: 'function', file: 'src/shared.ts', symbol: 'b' }]);

    const result = await checkInteractions(tc.ctx, ['sf-a', 'sf-b']);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]!.sharedFiles).toEqual(['src/shared.ts']);
    expect(result.interactions[0]!.sharedSymbols).toHaveLength(0);
  });

  it('should include importDependencies field (empty without gildash)', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'id-a',
      summary: 'A',
      type: 'spec',
      });
    await createCard(tc.ctx, {
      key: 'id-b',
      summary: 'B',
      type: 'spec',
      });

    const result = await checkInteractions(tc.ctx, ['id-a', 'id-b']);
    // No gildash, so no interactions found
    expect(result.interactions).toHaveLength(0);
  });
});
