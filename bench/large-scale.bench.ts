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

import { createEmberdeckDb, closeDb } from '../src/db/connection';
import { DrizzleCardRepository } from '../src/db/card-repo';
import { DrizzleRelationRepository } from '../src/db/relation-repo';
import { DrizzleClassificationRepository } from '../src/db/classification-repo';
import { DrizzleCodeLinkRepository } from '../src/db/code-link-repo';
import { DrizzleChangelogRepository } from '../src/db/changelog-repo';
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

const db = createEmberdeckDb(':memory:');
const cardRepo = new DrizzleCardRepository(db);
const relationRepo = new DrizzleRelationRepository(db);
const classificationRepo = new DrizzleClassificationRepository(db);
const codeLinkRepo = new DrizzleCodeLinkRepository(db);
const changelogRepo = new DrizzleChangelogRepository(db);

const ctx: EmberdeckContext = {
  cardsDir: '/tmp/bench-cards',
  db,
  cardRepo,
  relationRepo,
  classificationRepo,
  codeLinkRepo,
  changelogRepo,
  ignorePatterns: [],
  regressionThreshold: 0,
  gildash: undefined,
};

// ── Seed ──

console.log('Seeding data...');

const seedStart = performance.now();

// Insert cards
for (let i = 0; i < CARD_COUNT; i++) {
  const key = `card-${String(i).padStart(4, '0')}`;
  const parentIdx = i > 0 ? Math.floor(Math.random() * i) : null;
  const parent = parentIdx !== null ? `card-${String(parentIdx).padStart(4, '0')}` : null;

  cardRepo.upsert({
    key,
    summary: `Card ${i} summary`,
    status: i % 10 === 0 ? 'draft' : i % 5 === 0 ? 'drifted' : 'active',
    type: i % 4 === 0 ? 'intent' : 'spec',
    parent,
    boundaryJson: null,
    body: `Body content for card ${i}. This simulates a real card body with contracts and design rationale.`,
    filePath: `.emberdeck/cards/${key}.card.md`,
    updatedAt: new Date().toISOString(),
  });
}

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
  codeLinkRepo.replaceForCard(key, links);
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
    relationRepo.replaceForCard(key, [...targetSet]);
  }
}

console.log(`  Seed complete: ${(performance.now() - seedStart).toFixed(0)}ms\n`);

// ── Benchmarks ──

console.log('Running benchmarks...\n');

// 1. DB query: list all cards
time('cardRepo.list()', () => {
  cardRepo.list();
});

// 2. DB query: findByKey (random access)
time('cardRepo.findByKey() x1000', () => {
  for (let i = 0; i < CARD_COUNT; i++) {
    cardRepo.findByKey(`card-${String(i).padStart(4, '0')}`);
  }
});

// 3. DB query: findBySymbol
time('codeLinkRepo.findBySymbol() x100', () => {
  for (let i = 0; i < 100; i++) {
    codeLinkRepo.findBySymbol(`symbol_${i}_0`);
  }
});

// 4. DB query: findByFile
time('codeLinkRepo.findByFile() x50', () => {
  for (let i = 0; i < 50; i++) {
    codeLinkRepo.findByFile(`src/module-${i}/file-0.ts`);
  }
});

// 5. Relation queries
time('relationRepo.findByCardKey() x1000', () => {
  for (let i = 0; i < CARD_COUNT; i++) {
    relationRepo.findByCardKey(`card-${String(i).padStart(4, '0')}`);
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
time('cardRepo.findChildren() x100', () => {
  for (let i = 0; i < 100; i++) {
    cardRepo.findChildren(`card-${String(i).padStart(4, '0')}`);
  }
});

console.log('\nDone.');

closeDb(db);
