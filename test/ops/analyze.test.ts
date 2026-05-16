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

  it('coverageRatio is null when totalSymbols is 0 (no indexed code)', async () => {
    tc = await createTestContext();
    const r = await analyze(tc.ctx);
    // Empty project ⇒ no covered symbols and ratio = null (per §1.7).
    if (r.coverage.totalSymbols === 0) {
      expect(r.coverage.coverageRatio).toBeNull();
    } else {
      expect(typeof r.coverage.coverageRatio).toBe('number');
    }
    expect(typeof r.coverage.coveredSymbols).toBe('number');
  });
});
