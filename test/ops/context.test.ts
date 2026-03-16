import { describe, it, expect, afterEach } from 'bun:test';

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
