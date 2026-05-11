/**
 * preChangeCheck ignorePatterns + validateCodeLinks CLI batch tests.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mockGildash as createMockGildash } from '../fixtures/gildash';

import { createCard, preChangeCheck } from '../../index';
import { createMockTestContext, setCardCodeLinks, type TestContext } from '../helpers';

describe('preChangeCheck — ignorePatterns', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should exclude ignorePatterns-matched files from newUncoveredFiles', async () => {
    tc = await createMockTestContext();
    // Set ignorePatterns patterns
    tc.ctx.ignorePatterns = ['test/**', '*.test.ts'];

    const result = await preChangeCheck(tc.ctx, ['src/uncovered.ts', 'test/helper.ts', 'foo.test.ts']);
    // src/uncovered.ts: not covered, not ignored → should appear
    expect(result.newUncoveredFiles).toContain('src/uncovered.ts');
    // test/helper.ts: not covered, but matches ignorePatterns 'test/**' → excluded
    expect(result.newUncoveredFiles).not.toContain('test/helper.ts');
    // foo.test.ts: not covered, but matches '*.test.ts' → excluded
    expect(result.newUncoveredFiles).not.toContain('foo.test.ts');
  });

  it('should not exclude non-matching files from newUncoveredFiles', async () => {
    tc = await createMockTestContext();
    tc.ctx.ignorePatterns = ['vendor/**'];

    const result = await preChangeCheck(tc.ctx, ['src/new-feature.ts']);
    // src/new-feature.ts doesn't match 'vendor/**' → should appear
    expect(result.newUncoveredFiles).toContain('src/new-feature.ts');
  });
});

// ════════════════════════════════════════
// 8. validateCodeLinks — batch mode (used by `ed validate links`)
// ════════════════════════════════════════

describe('validateCodeLinks — batch mode (CLI layer)', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should validate all cards when key is omitted (batch pattern)', async () => {
    tc = await createMockTestContext();
    const { validateCodeLinks } = await import('../../index');

    // Create two cards with codeLinks (populated via DB-direct helper)
    await createCard(tc.ctx, { key: 'batch-a', summary: 'A', type: 'spec' });
    setCardCodeLinks(tc.ctx, 'batch-a', [{ kind: 'function', file: 'src/a.ts', symbol: 'a' }]);
    await createCard(tc.ctx, { key: 'batch-b', summary: 'B', type: 'spec' });
    setCardCodeLinks(tc.ctx, 'batch-b', [{ kind: 'function', file: 'src/b.ts', symbol: 'b' }]);

    tc.ctx.gildash = createMockGildash({
      searchSymbols: () => [], // all links broken → planned (draft cards)
    });

    // CLI batch pattern: iterate all cards
    const allCards = tc.ctx.cardRepo.list();
    const results: Record<string, any> = {};
    for (const card of allCards) {
      try {
        results[card.key] = await validateCodeLinks(tc.ctx, card.key);
      } catch {
        // skip
      }
    }

    expect(Object.keys(results)).toHaveLength(2);
    expect(results['batch-a']).toBeDefined();
    expect(results['batch-b']).toBeDefined();
    expect(results['batch-a'].declared).toBe(1);
    expect(results['batch-b'].declared).toBe(1);
    // Both are draft, so broken → planned
    expect(results['batch-a'].planned).toHaveLength(1);
    expect(results['batch-b'].planned).toHaveLength(1);
  });
});
