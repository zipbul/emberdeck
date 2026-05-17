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
    // Empty project ⇒ Gildash indexes zero TS symbols (the tmp dir has only
    // package.json + tsconfig.json + an empty src.ts) ⇒ totalSymbols === 0
    // and ratio is null per §1.7. The previous if/else accepted either
    // outcome, hiding any regression that started indexing the empty file.
    expect(r.coverage.totalSymbols).toBe(0);
    expect(r.coverage.coverageRatio).toBeNull();
    expect(r.coverage.coveredSymbols).toBe(0);
  });
});
