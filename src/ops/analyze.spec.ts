import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { EmberdeckContext } from '../config';
import { setupEmberdeck, teardownEmberdeck } from '../setup';
import { analyze } from './analyze';
import { makeCardRow as makeCard } from '../../test/fixtures/card-row';

const tmpDirs: string[] = [];
async function createTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'emberdeck-test-'));
  tmpDirs.push(dir);
  return dir;
}

let ctx: EmberdeckContext;

beforeEach(async () => {
  const tmp = await createTmpDir();
  await mkdir(join(tmp, 'cards'), { recursive: true });
  // Project shape gildash expects (package.json + tsconfig.json + a TS source).
  await writeFile(join(tmp, 'package.json'), JSON.stringify({ name: 'analyze-spec', version: '0.0.0' }), 'utf8');
  await writeFile(join(tmp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext' }, include: ['src.ts'] }), 'utf8');
  await writeFile(join(tmp, 'src.ts'), 'export const x = 1;\n', 'utf8');
  ctx = await setupEmberdeck({
    cardsDir: join(tmp, 'cards'),
    dbPath: ':memory:',
    projectRoot: tmp,
  });
});

afterEach(async () => {
  await teardownEmberdeck(ctx);
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

// ── analyze ──────────────────────────────────────────────────────────────────

describe('analyze', () => {
  it('returns zeroed health when no cards exist', async () => {
    const result = await analyze(ctx);

    expect(result.health.total).toBe(0);
    expect(result.health.active).toBe(0);
    expect(result.health.drifted).toBe(0);
    expect(result.health.draft).toBe(0);
    expect(result.health.brokenLinks).toBe(0);
    expect(result.health.staleBoundary).toBe(0);
    expect(result.driftedCards).toEqual([]);
    expect(result.driftedCardsTotal).toBe(0);
  });

  it('counts all draft cards correctly', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'd1', status: 'draft', filePath: 'cards/d1.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'd2', status: 'draft', filePath: 'cards/d2.card.md' }));

    const result = await analyze(ctx);

    expect(result.health.total).toBe(2);
    expect(result.health.draft).toBe(2);
    expect(result.health.active).toBe(0);
    expect(result.health.drifted).toBe(0);
  });

  it('counts active cards with no drift', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'a1', status: 'active', filePath: 'cards/a1.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'a2', status: 'active', filePath: 'cards/a2.card.md' }));

    const result = await analyze(ctx);

    expect(result.health.total).toBe(2);
    expect(result.health.active).toBe(2);
    expect(result.health.drifted).toBe(0);
    expect(result.driftedCards).toEqual([]);
  });

  it('counts drifted cards from DB status and includes in driftedCards array', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'dr1', status: 'drifted', filePath: 'cards/dr1.card.md' }));

    const result = await analyze(ctx);

    expect(result.health.drifted).toBe(1);
    expect(result.health.active).toBe(0);
    // Issue 2 fix: DB-drifted cards are now included in driftedCards array
    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCardsTotal).toBe(1);
    expect(result.driftedCards[0]!.key).toBe('dr1');
    expect(result.driftedCards[0]!.driftType).toBeUndefined();
  });

  it('returns coverage with totalSymbols when source is indexed', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'c1', status: 'active', filePath: 'cards/c1.card.md' }));

    const result = await analyze(ctx);

    expect(result.coverage.totalSymbols).toBeGreaterThanOrEqual(0);
  });

  it('handles mixed draft/active/drifted cards', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'draft', status: 'draft', filePath: 'cards/draft.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'active', status: 'active', filePath: 'cards/active.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'drifted', status: 'drifted', filePath: 'cards/drifted.card.md' }));

    const result = await analyze(ctx);

    expect(result.health.total).toBe(3);
    expect(result.health.draft).toBe(1);
    expect(result.health.active).toBe(1);
    expect(result.health.drifted).toBe(1);
  });

  it('health.drifted always equals driftedCardsTotal', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'dr1', status: 'drifted', filePath: 'cards/dr1.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'dr2', status: 'drifted', filePath: 'cards/dr2.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'a1', status: 'active', filePath: 'cards/a1.card.md' }));

    const result = await analyze(ctx);

    expect(result.health.drifted).toBe(result.driftedCardsTotal);
  });

  it('paginates driftedCards with offset and limit', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'dr-a', status: 'drifted', summary: 'A', filePath: 'cards/dr-a.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'dr-b', status: 'drifted', summary: 'B', filePath: 'cards/dr-b.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'dr-c', status: 'drifted', summary: 'C', filePath: 'cards/dr-c.card.md' }));

    const result = await analyze(ctx, { offset: 1, limit: 1 });

    expect(result.driftedCardsTotal).toBe(3);
    expect(result.driftedCards).toHaveLength(1);
    expect(result.health.drifted).toBe(3);
  });

  it('offset beyond driftedCards returns empty array', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'dr1', status: 'drifted', filePath: 'cards/dr1.card.md' }));

    const result = await analyze(ctx, { offset: 10 });

    expect(result.driftedCardsTotal).toBe(1);
    expect(result.driftedCards).toHaveLength(0);
    expect(result.health.drifted).toBe(1);
  });

  it('includeBody attaches body to drifted card entries', async () => {
    ctx.cardRepo.upsert(makeCard({
      key: 'dr-body',
      status: 'drifted',
      body: '## Contracts\n- WHEN x THEN y',
      filePath: 'cards/dr-body.card.md',
    }));

    const result = await analyze(ctx, { includeBody: true });

    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCards[0]!.body).toBe('## Contracts\n- WHEN x THEN y');
  });

  it('includeBody=false omits body field', async () => {
    ctx.cardRepo.upsert(makeCard({
      key: 'dr-nobody',
      status: 'drifted',
      body: 'some body',
      filePath: 'cards/dr-nobody.card.md',
    }));

    const result = await analyze(ctx, { includeBody: false });

    expect(result.driftedCards).toHaveLength(1);
    expect(result.driftedCards[0]!.body).toBeUndefined();
  });

  it('counts staleBoundary when boundary matches no indexed files', async () => {
    ctx.cardRepo.upsert(makeCard({
      key: 'stale-boundary',
      status: 'active',
      boundaryJson: JSON.stringify(['nonexistent-dir/**/*.ts']),
      filePath: 'cards/stale-boundary.card.md',
    }));
    ctx.cardRepo.upsert(makeCard({
      key: 'no-boundary',
      status: 'active',
      boundaryJson: null,
      namespacesJson: null,
      filePath: 'cards/no-boundary.card.md',
    }));

    const result = await analyze(ctx);

    expect(result.health.staleBoundary).toBe(1);
  });
});
