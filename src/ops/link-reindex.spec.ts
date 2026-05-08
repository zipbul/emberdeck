/**
 * `ensureReindexed` caches the reindex call per-context (WeakSet) so repeated
 * callers within a single CLI invocation share the first reindex's result.
 * Without the cache, every op (`syncSpecAnnotations`, `validateCodeLinks`,
 * `getUncoveredSymbols`, …) would trigger its own reindex — quadratic in the
 * number of ops invoked from `analyze` / `bulk sync`.
 */
import { describe, it, expect } from 'bun:test';
import type { EmberdeckContext } from '../config';
import { ensureReindexed } from './link';
import { mockGildash } from '../../test/fixtures/gildash';

function makeCtx(reindexFn: () => Promise<void>): EmberdeckContext {
  return {
    gildash: mockGildash({ reindex: reindexFn }),
  } as unknown as EmberdeckContext;
}

describe('ensureReindexed', () => {
  it('calls gildash.reindex once for a fresh context', async () => {
    let calls = 0;
    const ctx = makeCtx(async () => { calls++; });
    await ensureReindexed(ctx);
    expect(calls).toBe(1);
  });

  it('does not call gildash.reindex twice on the same context', async () => {
    let calls = 0;
    const ctx = makeCtx(async () => { calls++; });
    await ensureReindexed(ctx);
    await ensureReindexed(ctx);
    await ensureReindexed(ctx);
    expect(calls).toBe(1);
  });

  it('reindexes once per distinct context (cache is per-ctx, not global)', async () => {
    let callsA = 0;
    let callsB = 0;
    const ctxA = makeCtx(async () => { callsA++; });
    const ctxB = makeCtx(async () => { callsB++; });
    await ensureReindexed(ctxA);
    await ensureReindexed(ctxB);
    await ensureReindexed(ctxA);
    await ensureReindexed(ctxB);
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
  });
});
