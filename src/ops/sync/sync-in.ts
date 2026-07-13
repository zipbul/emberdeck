import type { EmberdeckContext } from '../../config';
import type { CardRow } from '../../db/repository';
import type { CardFile } from '../../card/types';
import { parseFullKey } from '../../card/card-key';
import { readCardFile } from '../../fs/reader';
import { buildSearchableText } from '../../card/searchable-text';
import { DrizzleCardRepository } from '../../db/card-repo';
import { DrizzleRelationRepository } from '../../db/relation-repo';
import { DrizzleClassificationRepository } from '../../db/classification-repo';
import { txDb } from '../../db/connection';
import { serializeNamespaces } from '../../card/json-fields';
import { batchedAllSettled } from '../../util/batch';
import { errorMessage } from '../../util/error';
import type { BulkSyncResult, CardSyncFailure } from './types';

/**
 * Recursively collect absolute paths of every `*.md` card file under `targetDir`.
 * Exported so the validate submodule can reuse the same enumeration.
 */
export async function listCardFiles(targetDir: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.md');
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    files.push(file);
  }
  return files;
}

/**
 * Per-context cache: card files have already been synced to the indexed cache
 * during this invocation. Mirrors `ensureReindexed` — first call performs the
 * file → cache sync; subsequent calls within the same CLI invocation are
 * no-ops.
 */
const cardsSyncedContexts = new WeakMap<EmberdeckContext, CardSyncFailure[]>();

/**
 * Guarantee the indexed cache reflects the on-disk card files before any read
 * operation queries it. Card files (.emberdeck/cards/**.md) are the SSoT; the
 * cache is derived.
 *
 *  - Removes cache rows whose filePath is no longer on disk (deleted files).
 *  - Upserts every existing card file via `syncCardFromFile`.
 *
 * Per-file failures are captured and returned so the CLI runner can surface
 * them as JSON-line warnings; they do not abort the remaining files.
 */
export async function ensureCardsSynced(ctx: EmberdeckContext): Promise<CardSyncFailure[]> {
  const cached = cardsSyncedContexts.get(ctx);
  if (cached) return [...cached];

  const failures: CardSyncFailure[] = [];
  cardsSyncedContexts.set(ctx, failures);

  // cardsDir may not exist yet during `ed init` or after `ed reset`.
  let cardFiles: string[];
  try {
    cardFiles = await listCardFiles(ctx.cardsDir);
  } catch {
    return failures;
  }
  const fileSet = new Set(cardFiles);

  for (const row of ctx.cardRepo.list()) {
    if (!fileSet.has(row.filePath)) {
      ctx.cardRepo.deleteByKey(row.key);
    }
  }

  for await (const { filePath, error } of upsertCardsInTierOrder(ctx, cardFiles)) {
    failures.push({ filePath, error });
  }

  return failures;
}

/**
 * Upsert card files in parent-before-child order via topological sort on the
 * parent → key edges declared in frontmatter. Pre-existing cache keys seed
 * the "already-inserted" set so incremental syncs work without re-walking.
 *
 * Yields one entry per failed file (read failure or upsert failure); per-file
 * failures do not abort the loop.
 */
async function* upsertCardsInTierOrder(
  ctx: EmberdeckContext,
  cardFiles: string[],
  prereadFiles?: ReadonlyMap<string, CardFile>,
): AsyncGenerator<{ filePath: string; error: string }> {
  type Parsed = { key: string; parent: string | null };
  const parsed = new Map<string, Parsed>();
  const toRead = prereadFiles
    ? cardFiles.filter((f) => !prereadFiles.has(f))
    : cardFiles;
  if (prereadFiles) {
    for (const f of cardFiles) {
      const pre = prereadFiles.get(f);
      if (pre) parsed.set(f, { key: pre.frontmatter.key, parent: pre.frontmatter.parent ?? null });
    }
  }
  for await (const { item: filePath, result } of batchedAllSettled(toRead, 20, readCardFile)) {
    if (result.status === 'rejected') {
      yield { filePath, error: errorMessage(result.reason) };
      continue;
    }
    parsed.set(filePath, {
      key: result.value.frontmatter.key,
      parent: result.value.frontmatter.parent ?? null,
    });
  }

  // Topological sort: emit files whose parent is null OR already satisfied
  // (cache row already present, or queued earlier in this run).
  const satisfied = new Set<string>(ctx.cardRepo.list().map((r) => r.key));
  const remaining = new Map(parsed);
  const ordered: string[] = [];
  const unsatisfiable = new Map<string, string>();
  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const [filePath, info] of remaining) {
      if (info.parent === null || satisfied.has(info.parent)) wave.push(filePath);
    }
    if (wave.length === 0) {
      for (const [filePath, info] of remaining) {
        if (info.parent !== null) unsatisfiable.set(filePath, info.parent);
      }
      break;
    }
    for (const filePath of wave) {
      ordered.push(filePath);
      satisfied.add(remaining.get(filePath)!.key);
      remaining.delete(filePath);
    }
  }
  // §10 Phase 1.4: distinguish a genuine missing parent from a parent cycle.
  // If the unorderable parent IS a known key (indexed cache or this batch) yet
  // could not be satisfied, the chain forms a cycle (or descends from one) —
  // report that explicitly instead of misclassifying it as "parent not found".
  const knownKeys = new Set<string>([
    ...ctx.cardRepo.list().map((r) => r.key),
    ...[...parsed.values()].map((p) => p.key),
  ]);
  for (const [filePath, missingParent] of unsatisfiable) {
    if (knownKeys.has(missingParent)) {
      yield { filePath, error: `parent cycle detected: card cannot be ordered because its parent chain through "${missingParent}" forms a cycle (or descends from one)` };
    } else {
      yield { filePath, error: `parent card "${missingParent}" not found (neither in the indexed cache nor in the current sync batch)` };
    }
  }

  // Wave-by-wave upsert; within a wave there are no parent dependencies so
  // bounded parallelism is safe.
  let waveStart = 0;
  while (waveStart < ordered.length) {
    const waveSatisfied = new Set<string>(ctx.cardRepo.list().map((r) => r.key));
    for (let i = 0; i < waveStart; i++) {
      const p = parsed.get(ordered[i]!);
      if (p) waveSatisfied.add(p.key);
    }
    let waveEnd = waveStart;
    while (waveEnd < ordered.length) {
      const info = parsed.get(ordered[waveEnd]!);
      if (info && info.parent !== null && !waveSatisfied.has(info.parent)) break;
      waveEnd++;
    }
    const wave = ordered.slice(waveStart, waveEnd === waveStart ? waveStart + 1 : waveEnd);
    for await (const { item: filePath, result } of batchedAllSettled(wave, 20, (f) => syncCardFromFile(ctx, f))) {
      if (result.status === 'rejected') {
        yield { filePath, error: errorMessage(result.reason) };
      }
    }
    waveStart += wave.length;
  }
}

/**
 * Sync a single externally-modified card file into the indexed cache. Invoked
 * by CLI sync commands (`ed bulk sync <file>`) and as the compensation step
 * for failed file writes in create/update operations.
 *
 * Returns relation targets that failed to persist (FK violation under
 * concurrent contention); empty array on a clean sync.
 */
export async function syncCardFromFile(
  ctx: EmberdeckContext,
  filePath: string,
): Promise<{ partialRelations: string[] }> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  const namespaceText = buildSearchableText(cardFile.frontmatter);

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    type: cardFile.frontmatter.type,
    parent: cardFile.frontmatter.parent ?? null,
    namespacesJson: serializeNamespaces(cardFile.frontmatter),
    body: namespaceText,
    glossaryJson: cardFile.frontmatter.glossary
      ? JSON.stringify(cardFile.frontmatter.glossary)
      : '[]',
    filePath,
    updatedAt: now,
  };

  let partialRelations: string[] = [];
  ctx.db.transaction((tx) => {
    const d = txDb(tx);
    const cardRepo = new DrizzleCardRepository(d);
    const relationRepo = new DrizzleRelationRepository(d);
    const classRepo = new DrizzleClassificationRepository(d);

    cardRepo.upsert(row);
    partialRelations = relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    // codeLink rows are populated by `ed spec sync` from source @spec
    // annotations, not from card content. Card bulk-sync does not touch code_link.
  });
  return { partialRelations };
}

/**
 * Scan the entire cardsDir (or dirPath) and bulk-sync every `.md` card file
 * into the indexed cache. Duplicate keys across files are reported as errors
 * (data-loss prevention).
 */
export async function bulkSyncCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<BulkSyncResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const cardFiles = await listCardFiles(targetDir);

  const keyToFile = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  const errors: BulkSyncResult['errors'] = [];
  const readFailures = new Set<string>();
  const prereadFiles = new Map<string, CardFile>();
  for await (const { item: filePath, result } of batchedAllSettled(cardFiles, 20, readCardFile)) {
    if (result.status === 'rejected') {
      errors.push({ filePath, error: result.reason });
      readFailures.add(filePath);
      continue;
    }
    prereadFiles.set(filePath, result.value);
    const key = result.value.frontmatter.key;
    if (keyToFile.has(key)) {
      const existing = duplicates.get(key) ?? [keyToFile.get(key)!];
      existing.push(filePath);
      duplicates.set(key, existing);
    } else {
      keyToFile.set(key, filePath);
    }
  }

  for (const [key, files] of duplicates) {
    for (const filePath of files) {
      errors.push({
        filePath,
        error: new Error(`Duplicate key "${key}" found in multiple files: ${files.join(', ')}`),
      });
    }
  }

  const duplicateFiles = new Set<string>();
  for (const files of duplicates.values()) {
    for (const f of files) duplicateFiles.add(f);
  }

  const safeFiles = cardFiles.filter((f) => !duplicateFiles.has(f) && !readFailures.has(f));
  const failedFiles = new Set<string>();

  for await (const { filePath, error } of upsertCardsInTierOrder(ctx, safeFiles, prereadFiles)) {
    errors.push({ filePath, error: new Error(error) });
    failedFiles.add(filePath);
  }

  const synced = safeFiles.length - failedFiles.size;
  return { synced, errors };
}
