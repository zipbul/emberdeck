/**
 * Large-scale benchmark: 1000 cards, 100K symbols.
 *
 * Measures:
 * - DB query performance (list, findByKey, findBySymbol)
 * - Link validation throughput
 * - Analyze response time
 * - checkDrift response time
 *
 * Run: bun run bench/large-scale.bench.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupEmberdeck, teardownEmberdeck } from '../src/setup';
import type { EmberdeckContext } from '../src/config';
import { analyze } from '../src/ops/analyze';
import { checkDrift } from '../src/ops/context';

// ── Config ──

const CARD_COUNT = 1000;
const SYMBOLS_PER_CARD = 100; // 1000 * 100 = 100K symbol references
const RELATION_DENSITY = 3; // avg relations per card

// ── Helpers ──

function time(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return ms;
}

async function timeAsync(label: string, fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return ms;
}

// ── Setup ──

console.log(`\nBenchmark: ${CARD_COUNT} cards, ${CARD_COUNT * SYMBOLS_PER_CARD} code links\n`);

const tmpRoot = mkdtempSync(join(tmpdir(), 'ed-bench-'));
mkdirSync(join(tmpRoot, 'cards'), { recursive: true });
writeFileSync(join(tmpRoot, 'src.ts'), '', 'utf8');
const ctx: EmberdeckContext = await setupEmberdeck({
  cardsDir: join(tmpRoot, 'cards'),
  dbPath: ':memory:',
  projectRoot: tmpRoot,
});

// ── Seed ──

console.log('Seeding data...');

const seedStart = performance.now();

// Insert cards in 4-tier shape: 5% domain (root) → 20% brief (parent=domain) →
// rest spec (parent=brief|spec). Bypassing validation via direct upsert is fine
// for a synthetic perf benchmark — the rows still satisfy the FK shape.
const DOMAIN_COUNT = Math.max(1, Math.floor(CARD_COUNT * 0.05));
const BRIEF_COUNT = Math.floor(CARD_COUNT * 0.20);
const SPEC_COUNT = CARD_COUNT - DOMAIN_COUNT - BRIEF_COUNT;

for (let i = 0; i < CARD_COUNT; i++) {
  const key = `card-${String(i).padStart(4, '0')}`;
  let type: 'domain' | 'brief' | 'spec';
  let parent: string | null;
  if (i < DOMAIN_COUNT) {
    type = 'domain';
    parent = null;
  } else if (i < DOMAIN_COUNT + BRIEF_COUNT) {
    type = 'brief';
    const dIdx = (i - DOMAIN_COUNT) % DOMAIN_COUNT;
    parent = `card-${String(dIdx).padStart(4, '0')}`;
  } else {
    type = 'spec';
    // parent is a brief or earlier spec
    const briefStart = DOMAIN_COUNT;
    const candidatePool = i - briefStart;
    const pIdx = briefStart + Math.floor(Math.random() * candidatePool);
    parent = `card-${String(pIdx).padStart(4, '0')}`;
  }

  ctx.cardRepo.upsert({
    key,
    summary: `Card ${i} summary`,
    status: i % 10 === 0 ? 'draft' : i % 5 === 0 ? 'drifted' : 'active',
    type,
    parent,
    namespacesJson: null,
    body: `Body content for card ${i}. This simulates a real card body with contracts and design rationale.`,
    glossaryJson: '[]',
    filePath: `.emberdeck/cards/${key}.card.md`,
    updatedAt: new Date().toISOString(),
  });
}
void SPEC_COUNT; // counted for clarity, unused at runtime

// Insert code links
for (let i = 0; i < CARD_COUNT; i++) {
  const key = `card-${String(i).padStart(4, '0')}`;
  const links: Array<{ kind: string; file: string; symbol: string }> = [];
  for (let j = 0; j < SYMBOLS_PER_CARD; j++) {
    links.push({
      kind: j % 3 === 0 ? 'function' : j % 3 === 1 ? 'class' : 'variable',
      file: `src/module-${j % 50}/file-${j % 20}.ts`,
      symbol: `symbol_${i}_${j}`,
    });
  }
  ctx.codeLinkRepo.replaceForCard(key, links);
}

// Insert relations
for (let i = 0; i < CARD_COUNT; i++) {
  const key = `card-${String(i).padStart(4, '0')}`;
  const targetSet = new Set<string>();
  for (let r = 0; r < RELATION_DENSITY; r++) {
    const target = Math.floor(Math.random() * CARD_COUNT);
    if (target !== i) {
      targetSet.add(`card-${String(target).padStart(4, '0')}`);
    }
  }
  if (targetSet.size > 0) {
    ctx.relationRepo.replaceForCard(key, [...targetSet]);
  }
}

console.log(`  Seed complete: ${(performance.now() - seedStart).toFixed(0)}ms\n`);

// ── Benchmarks ──

console.log('Running benchmarks...\n');

// 1. DB query: list all cards
time('ctx.cardRepo.list()', () => {
  ctx.cardRepo.list();
});

// 2. DB query: findByKey (random access)
time('ctx.cardRepo.findByKey() x1000', () => {
  for (let i = 0; i < CARD_COUNT; i++) {
    ctx.cardRepo.findByKey(`card-${String(i).padStart(4, '0')}`);
  }
});

// 3. DB query: findBySymbol
time('ctx.codeLinkRepo.findBySymbol() x100', () => {
  for (let i = 0; i < 100; i++) {
    ctx.codeLinkRepo.findBySymbol(`symbol_${i}_0`);
  }
});

// 4. DB query: findByFile
time('ctx.codeLinkRepo.findByFile() x50', () => {
  for (let i = 0; i < 50; i++) {
    ctx.codeLinkRepo.findByFile(`src/module-${i}/file-0.ts`);
  }
});

// 5. Relation queries
time('ctx.relationRepo.findByCardKey() x1000', () => {
  for (let i = 0; i < CARD_COUNT; i++) {
    ctx.relationRepo.findByCardKey(`card-${String(i).padStart(4, '0')}`);
  }
});

// 6. checkDrift (no gildash — skips symbol checks)
await timeAsync('checkDrift (no gildash)', async () => {
  await checkDrift(ctx);
});

// 7. analyze (no gildash)
await timeAsync('analyze (no gildash)', async () => {
  await analyze(ctx);
});

// 8. analyze with pagination
await timeAsync('analyze (offset=500, limit=10)', async () => {
  await analyze(ctx, { offset: 500, limit: 10 });
});

// 9. findChildren
time('ctx.cardRepo.findChildren() x100', () => {
  for (let i = 0; i < 100; i++) {
    ctx.cardRepo.findChildren(`card-${String(i).padStart(4, '0')}`);
  }
});

console.log('\nDone.');

await teardownEmberdeck(ctx);
rmSync(tmpRoot, { recursive: true, force: true });
