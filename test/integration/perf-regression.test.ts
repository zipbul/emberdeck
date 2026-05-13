/**
 * Performance regression guard: 100-card project + analyze should complete
 * within a wall-clock budget. The threshold is generous (5×) over current
 * actual to absorb CI jitter, but tight enough to catch O(N²) regressions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../../index';
import { createCard } from '../../src/ops/create';
import { listCards, getCardContext } from '../../src/ops/query';
import { analyze } from '../../src/ops/analyze';
import { checkDrift } from '../../src/ops/context';
import { ensureCardsSynced } from '../../src/ops/sync';

let ctx: EmberdeckContext;
let cleanup: () => Promise<void>;

const N_CARDS = 100;

beforeAll(async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ed-perf-'));
  const cardsDir = join(tmp, 'cards');
  await mkdir(cardsDir, { recursive: true });
  ctx = await setupEmberdeck({ cardsDir, dbPath: ':memory:', projectRoot: tmp });
  cleanup = async () => {
    await teardownEmberdeck(ctx);
    await rm(tmp, { recursive: true, force: true });
  };

  // Seed N_CARDS cards in a hierarchy: 5 domain roots, each with 19 children.
  for (let d = 0; d < 5; d++) {
    await createCard(ctx, {
      key: `domain-${d}`,
      type: 'domain',
      summary: `domain ${d}`,
      status: 'draft',
    });
  }
  for (let i = 0; i < N_CARDS - 5; i++) {
    const parentDomain = `domain-${i % 5}`;
    await createCard(ctx, {
      key: `brief-${i}`,
      type: 'brief',
      summary: `brief ${i}`,
      status: 'draft',
      parent: parentDomain,
    });
  }
});

afterAll(async () => { await cleanup(); });

describe('performance regression guard', () => {
  it(`listCards on ${N_CARDS} cards completes under 500ms`, () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      const list = listCards(ctx);
      expect(list.length).toBe(N_CARDS);
    }
    const avg = (Date.now() - start) / 10;
    // Per-call cost: 10 calls / total time. Should be under ~50ms each.
    expect(avg).toBeLessThan(500);
  });

  it(`analyze on ${N_CARDS} cards completes under 5s`, async () => {
    const start = Date.now();
    const result = await analyze(ctx);
    const elapsed = Date.now() - start;
    expect(result.health.total).toBe(N_CARDS);
    expect(elapsed).toBeLessThan(5_000);
  });

  it(`checkDrift on ${N_CARDS} cards completes under 5s`, async () => {
    const start = Date.now();
    const result = await checkDrift(ctx, undefined);
    const elapsed = Date.now() - start;
    // checkDrift skips draft → result.cards may be 0 but health.draft = 100
    expect(result.health.draft).toBe(N_CARDS);
    expect(elapsed).toBeLessThan(5_000);
  });

  it(`getCardContext on a hub card completes under 200ms`, async () => {
    const start = Date.now();
    const ctxResult = await getCardContext(ctx, 'domain-0');
    const elapsed = Date.now() - start;
    expect(ctxResult.card.frontmatter.key).toBe('domain-0');
    expect(elapsed).toBeLessThan(200);
  });

  it(`ensureCardsSynced on ${N_CARDS} files completes under 5s on a fresh context`, async () => {
    // Use the same cards directory but a fresh context so the WeakMap cache misses.
    const freshCtx = await setupEmberdeck({
      cardsDir: ctx.cardsDir,
      dbPath: ':memory:',
      projectRoot: ctx.projectRoot,
    });
    try {
      const start = Date.now();
      const failures = await ensureCardsSynced(freshCtx);
      const elapsed = Date.now() - start;
      expect(failures).toHaveLength(0);
      expect(elapsed).toBeLessThan(5_000);
      expect(freshCtx.cardRepo.list().length).toBe(N_CARDS);
    } finally {
      await teardownEmberdeck(freshCtx);
    }
  });
});
