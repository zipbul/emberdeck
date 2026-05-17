import { describe, it, expect, afterEach } from 'bun:test';

import { analyze, createCard } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('analyze — coverage field names (canonical kebab/camel per §1.7)', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('coverage shape uses coveredSymbols + coverageRatio (not covered/ratio)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'k', summary: 'S', type: 'spec' });
    const r = await analyze(tc.ctx);
    expect(r.coverage).toHaveProperty('totalSymbols');
    expect(r.coverage).toHaveProperty('coveredSymbols');
    expect(r.coverage).toHaveProperty('coverageRatio');
    // The old field names must not exist on the new shape.
    expect((r.coverage as unknown as Record<string, unknown>).covered).toBeUndefined();
    expect((r.coverage as unknown as Record<string, unknown>).ratio).toBeUndefined();
  });

  // Contract from §1.7 (not fixture state):
  //   totalSymbols >= 0
  //   coveredSymbols >= 0 AND <= totalSymbols
  //   coverageRatio  === null   iff totalSymbols === 0   (avoids 0/0 = NaN)
  //   coverageRatio  is number  iff totalSymbols > 0    AND in [0, 1]
  //
  // Asserting the contract (not the fixture's current symbol count) keeps the
  // test stable across Gildash version bumps that may or may not start
  // indexing tsconfig/package.json metadata symbols.
  it('coverage shape obeys §1.7 invariants regardless of indexed-symbol count', async () => {
    tc = await createTestContext();
    const r = await analyze(tc.ctx);
    expect(r.coverage.totalSymbols).toBeGreaterThanOrEqual(0);
    expect(r.coverage.coveredSymbols).toBeGreaterThanOrEqual(0);
    expect(r.coverage.coveredSymbols).toBeLessThanOrEqual(r.coverage.totalSymbols);
    if (r.coverage.totalSymbols === 0) {
      expect(r.coverage.coverageRatio).toBeNull();
    } else {
      expect(typeof r.coverage.coverageRatio).toBe('number');
      expect(r.coverage.coverageRatio).toBeGreaterThanOrEqual(0);
      expect(r.coverage.coverageRatio).toBeLessThanOrEqual(1);
    }
  });
});
