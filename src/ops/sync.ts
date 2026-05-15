import { relative } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { CardNotFoundError } from '../card/errors';
import { buildSearchableText } from '../card/searchable-text';
import type { CardFile, CardFrontmatter, CardStatus, CardType } from '../card/types';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { txDb } from '../db/connection';
import { readGlossary } from '../glossary/io';
import { parseStringArrayJson, parseCrossDomainDependencies } from '../card/json-fields';
import { batchedAllSettled } from '../util/batch';

/**
 * Serialize the principle/domain/brief/spec namespace blocks from frontmatter for DB storage.
 * Returns null when the card has no namespace structures (typical for plain markdown cards).
 */
function serializeNamespaces(fm: CardFrontmatter): string | null {
  const ns: Record<string, unknown> = {};
  if (fm.principle) ns.principle = fm.principle;
  if (fm.domain) ns.domain = fm.domain;
  if (fm.brief) ns.brief = fm.brief;
  if (fm.spec) ns.spec = fm.spec;
  return Object.keys(ns).length === 0 ? null : JSON.stringify(ns);
}

/**
 * Recursively collect absolute paths of all `*.json` files under `targetDir`.
 */
async function listCardFiles(targetDir: string): Promise<string[]> {
  const glob = new Bun.Glob('**/*.md');
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    files.push(file);
  }
  return files;
}

/**
 * Type hierarchy rule (4-tier): principle/domain are root-only;
 * brief.parent must be domain; spec.parent must be brief or spec.
 * Returns null when the row is valid.
 */
function typeHierarchyViolationMessage(
  rowType: CardType,
  parentKey: string,
  parentType: CardType,
): string | null {
  if (rowType === 'principle') return `Principle card must be root-level, but has parent "${parentKey}"`;
  if (rowType === 'domain') return `Domain card must be root-level, but has parent "${parentKey}"`;
  if (rowType === 'brief' && parentType !== 'domain') return `Brief card parent must be domain, got "${parentKey}" (type: ${parentType})`;
  if (rowType === 'spec' && parentType !== 'brief' && parentType !== 'spec') return `Spec card parent must be brief or spec, got "${parentKey}" (type: ${parentType})`;
  return null;
}

function parseNamespaces(json: string | null): { principle?: unknown; domain?: unknown; brief?: unknown; spec?: unknown } {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
export interface BulkSyncResult {
  synced: number;
  errors: Array<{ filePath: string; error: unknown }>;
}

export interface ValidationWarning {
  type: string;
  cardKey: string;
  message: string;
}

export interface CardValidationResult {
  staleDbRows: CardRow[];
  orphanFiles: string[];
  keyMismatches: Array<{ row: CardRow; expectedKey: string }>;
  warnings: ValidationWarning[];
}

/**
 * Per-context cache: card files have already been synced to DB this invocation.
 * Mirrors `ensureReindexed` pattern — first call performs file→DB sync,
 * subsequent calls within the same CLI invocation are no-ops.
 */
const cardsSyncedContexts = new WeakMap<EmberdeckContext, CardSyncFailure[]>();

export interface CardSyncFailure {
  filePath: string;
  error: string;
}

/**
 * Guarantee DB reflects card files before reading from DB.
 *
 * Card files (.emberdeck/cards/**.md) are the SSOT; DB is a derived cache.
 * Read operations (check/validate/analyze/list/get/...) must call this before
 * querying the DB, otherwise externally edited card files would be invisible.
 *
 * On first call per context:
 *   - Removes DB rows whose filePath is no longer on disk (deleted files)
 *   - Upserts every existing card file via `syncCardFromFile`
 * Per-file failures are captured into the returned array (so the CLI runner
 * can surface them as envelope warnings); they do not abort the remaining files.
 * @spec card-storage/persistence/sync
 */
export async function ensureCardsSynced(ctx: EmberdeckContext): Promise<CardSyncFailure[]> {
  const cached = cardsSyncedContexts.get(ctx);
  if (cached) return [...cached];

  const failures: CardSyncFailure[] = [];
  cardsSyncedContexts.set(ctx, failures);

  // cardsDir may not exist yet during `ed init` or after `ed reset`. Nothing to sync.
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
 * parent → key edges declared in frontmatter. Pre-existing DB keys seed the
 * "already-inserted" set so incremental syncs work without re-walking.
 *
 * Robust against any on-disk layout (flat or nested) and any depth of spec
 * recursion. Shared by ensureCardsSynced and bulkSyncCards.
 *
 * `prereadFiles` is an optional Map of already-parsed CardFile values keyed
 * by filePath, so callers that already read the file (e.g. bulkSyncCards for
 * duplicate detection) can avoid a redundant disk read.
 *
 * Yields one entry per failed file (read failure or upsert failure). Per-file
 * failures do not abort the loop.
 * @spec card-storage/persistence/sync
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
      const err = result.reason;
      yield { filePath, error: err instanceof Error ? err.message : String(err) };
      continue;
    }
    parsed.set(filePath, {
      key: result.value.frontmatter.key,
      parent: result.value.frontmatter.parent ?? null,
    });
  }

  // Topological sort: emit files whose parent is null OR already in the
  // "satisfied" set (DB rows already present OR queued earlier in this run).
  const satisfied = new Set<string>(ctx.cardRepo.list().map((r) => r.key));
  const remaining = new Map(parsed);
  const ordered: string[] = [];
  const unsatisfiable = new Map<string, string>(); // filePath → missing parent key
  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const [filePath, info] of remaining) {
      if (info.parent === null || satisfied.has(info.parent)) wave.push(filePath);
    }
    if (wave.length === 0) {
      // Missing-parent or cycle. Record the missing parent so we can emit a
      // friendly error instead of letting SQLite surface a raw FK violation.
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
  // Emit a friendly error per unsatisfiable file BEFORE attempting any upsert,
  // so the raw SQLite "FOREIGN KEY constraint failed" never reaches the user.
  for (const [filePath, missingParent] of unsatisfiable) {
    yield { filePath, error: `parent card "${missingParent}" not found (neither in the DB nor in the current sync batch)` };
  }

  // Upsert wave-by-wave; within a wave there are no parent dependencies so
  // bounded parallelism is safe.
  let waveStart = 0;
  while (waveStart < ordered.length) {
    // Find the end of the current wave: a contiguous run whose parents are
    // all in the satisfied-before-wave set. We rebuild waves from `parsed`
    // to keep parallelism while preserving correctness.
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
        const err = result.reason;
        yield { filePath, error: err instanceof Error ? err.message : String(err) };
      }
    }
    waveStart += wave.length;
  }
}

/**
 * Syncs an externally modified card file to the DB.
 * Invoked by CLI sync commands (`ed sync`) and as the compensation step
 * for failed file writes in create/update operations.
  * @spec card-storage/persistence/sync
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  // Build searchable namespace text for FTS5 (no markdown body — cards are pure JSON).
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

  ctx.db.transaction((tx) => {
    const d = txDb(tx);
    const cardRepo = new DrizzleCardRepository(d);
    const relationRepo = new DrizzleRelationRepository(d);
    const classRepo = new DrizzleClassificationRepository(d);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    // codeLink rows are populated by `ed spec sync` from source @spec annotations,
    // not from card content. Card bulk-sync does not touch code_link.
  });
}

/**
 * Scans the entire cardsDir (or dirPath) and bulk-syncs all .json files to the DB.
 *
 * Detects duplicate keys across files and reports them as errors (data loss prevention).
 * File reads/writes are executed in bounded parallel batches via `batchedAllSettled`.
 * Each file's DB write is atomic, guaranteed by the transaction inside `syncCardFromFile`.
  * @spec card-storage/persistence/sync
 */
export async function bulkSyncCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<BulkSyncResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const cardFiles = await listCardFiles(targetDir);

  // Detect duplicate keys.
  // Parallelize file reads in batches — sequential await on N files becomes the
  // bottleneck for large card collections (jsdoc above mentioned parallelism but
  // this loop was actually serial).
  const keyToFile = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  const errors: BulkSyncResult['errors'] = [];
  const readFailures = new Set<string>();
  // Cache parsed CardFiles to avoid the second disk read inside the shared
  // tier-ordered upsert helper.
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

  // Report duplicates as errors
  for (const [key, files] of duplicates) {
    for (const filePath of files) {
      errors.push({
        filePath,
        error: new Error(`Duplicate key "${key}" found in multiple files: ${files.join(', ')}`),
      });
    }
  }

  // Only sync non-duplicate files
  const duplicateFiles = new Set<string>();
  for (const files of duplicates.values()) {
    for (const f of files) duplicateFiles.add(f);
  }

  // Exclude both duplicate-key files AND files that already failed to read;
  // either path already emitted an error[] entry above, so we must not
  // re-attempt upsert (would double-report the same root cause).
  const safeFiles = cardFiles.filter((f) => !duplicateFiles.has(f) && !readFailures.has(f));
  const failedFiles = new Set<string>();

  // Tier-ordered upsert via topological sort on parent → key edges; honors the
  // card.parent FK on any layout (flat / nested / arbitrary spec recursion).
  for await (const { filePath, error } of upsertCardsInTierOrder(ctx, safeFiles, prereadFiles)) {
    errors.push({ filePath, error: new Error(error) });
    failedFiles.add(filePath);
  }

  const synced = safeFiles.length - failedFiles.size;
  return { synced, errors };
}

/**
 * Cheap key-mismatch detection. Subset of validateCards that only reports
 * cards whose frontmatter key differs from the path-derived slug. Used by
 * `ed validate links` to skip mismatched cards without paying the full
 * validateCards cost (content-mismatch reads, relation walks, glossary).
 * @spec card-storage/persistence/sync
 */
export function detectKeyMismatches(
  ctx: EmberdeckContext,
  dirPath?: string,
): Array<{ row: CardRow; expectedKey: string }> {
  const targetDir = dirPath ?? ctx.cardsDir;
  return ctx.cardRepo
    .list()
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Validates consistency between the file list in cardsDir (or dirPath) and DB rows.
 * Performs read-only structural validation: hierarchy, relations, glossary,
 * orphans, key mismatches, content drift.
  * @spec card-storage/persistence/sync
 */
export async function validateCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<CardValidationResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const cardFiles = await listCardFiles(targetDir);

  const fileSet = new Set(cardFiles);
  const dbRows = ctx.cardRepo.list();
  const dbFilePaths = new Set(dbRows.map((r) => r.filePath));

  const staleDbRows = dbRows.filter((r) => !fileSet.has(r.filePath));
  const orphanFiles = cardFiles.filter((f) => !dbFilePaths.has(f));
  const keyMismatches = dbRows
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const cardByKey = new Map<string, CardRow>();
  for (const row of dbRows) {
    cardByKey.set(row.key, row);
  }

  // Pre-load all relations once to defeat the N+1 findByCardKey loop below.
  const relationsBySrc = new Map<string, RelationRow[]>();
  for (const rel of ctx.relationRepo.findAll()) {
    const list = relationsBySrc.get(rel.srcCardKey) ?? [];
    list.push(rel);
    relationsBySrc.set(rel.srcCardKey, list);
  }

  for (const row of dbRows) {
    // Orphan card: only principle and domain are root-allowed.
    // brief/spec require a parent (brief → domain, spec → brief|spec).
    if (!row.parent && row.type !== 'principle' && row.type !== 'domain') {
      warnings.push({
        type: 'orphan-card',
        cardKey: row.key,
        message: `${row.type} card has no parent`,
      });
    }

    // Broken parent: parent refers to non-existent card
    if (row.parent && !cardByKey.has(row.parent)) {
      warnings.push({
        type: 'broken-parent',
        cardKey: row.key,
        message: `Parent "${row.parent}" does not exist`,
      });
    }

    // Type hierarchy violation — mirrors validateParentType (creation-time rule).
    // 4-tier: principle/domain root, brief.parent=domain, spec.parent=brief|spec.
    if (row.parent && cardByKey.has(row.parent)) {
      const parent = cardByKey.get(row.parent)!;
      const violation = typeHierarchyViolationMessage(row.type as CardType, row.parent, parent.type as CardType);
      if (violation) {
        warnings.push({ type: 'type-hierarchy-violation', cardKey: row.key, message: violation });
      }
    }

    // Broken cross_domain_dependencies (domain-only): every dep target must
    // exist AND be type=domain. Activation guard catches this on activate, but
    // we surface it here too so that a dangling dep after rename/delete is
    // visible without waiting for the next activation.
    if (row.type === 'domain') {
      const deps = parseCrossDomainDependencies(row.namespacesJson);
      if (deps.length > 0) {
        for (const dep of deps) {
          const target = cardByKey.get(dep.domain);
          if (!target) {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies references unknown card "${dep.domain}"`,
            });
          } else if (target.type !== 'domain') {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies["${dep.domain}"] target is type "${target.type}", expected "domain"`,
            });
          } else if (dep.domain === row.key) {
            warnings.push({
              type: 'broken-cross-domain-dep',
              cardKey: row.key,
              message: `cross_domain_dependencies["${dep.domain}"] is a self-reference`,
            });
          }
        }
      }
    }

    // Broken relation: relation target does not exist
    const relations = relationsBySrc.get(row.key) ?? [];
    for (const rel of relations) {
      if (!rel.isReverse && !cardByKey.has(rel.dstCardKey)) {
        warnings.push({
          type: 'broken-relation',
          cardKey: row.key,
          message: `Relation target "${rel.dstCardKey}" does not exist`,
        });
      }
    }

    // Rework dependency: active card depends on draft card
    if (row.status === 'active') {
      for (const rel of relations) {
        if (!rel.isReverse) {
          const target = cardByKey.get(rel.dstCardKey);
          if (target && target.status === 'draft') {
            warnings.push({
              type: 'rework-dependency',
              cardKey: row.key,
              message: `Active card has relation to draft card "${rel.dstCardKey}"`,
            });
          }
        }
      }
    }
  }

  // Empty tree: brief or domain card with no children (skip draft).
  // Pre-build parent → has-children index to avoid full-scan inside the loop
  // (was O(N×M) — N briefs × M total).
  const hasChildren = new Set<string>();
  for (const row of dbRows) {
    if (row.parent) hasChildren.add(row.parent);
  }
  for (const row of dbRows) {
    if (row.status === 'draft') continue;
    if ((row.type === 'brief' || row.type === 'domain') && !hasChildren.has(row.key)) {
      warnings.push({
        type: 'empty-tree',
        cardKey: row.key,
        message: `Active ${row.type} card has no child cards`,
      });
    }
  }

  // Content mismatch: DB and file frontmatter diverged
  for (const row of dbRows) {
    if (!fileSet.has(row.filePath)) continue;
    try {
      const file = await readCardFile(row.filePath);
      if (file.frontmatter.status !== row.status) {
        warnings.push({
          type: 'content-mismatch',
          cardKey: row.key,
          message: `DB status="${row.status}" differs from file status="${file.frontmatter.status}"`,
        });
      }
      if (file.frontmatter.summary !== row.summary) {
        warnings.push({
          type: 'content-mismatch',
          cardKey: row.key,
          message: `DB summary differs from file summary`,
        });
      }
    } catch {
      // File unreadable — already caught by orphanFiles or staleDbRows
    }
  }

  // Glossary cross-validation
  const glossaryEntries = readGlossary(ctx);
  const glossaryWordSet = new Set(glossaryEntries.map((e) => e.word));
  const usedGlossaryWords = new Set<string>();

  for (const row of dbRows) {
    const cardGlossary = parseStringArrayJson(row.glossaryJson);
    if (cardGlossary.length > 0) {
      // Track usage for unused detection
      for (const w of cardGlossary) usedGlossaryWords.add(w);

      // Check each declared word exists in glossary
      for (const word of cardGlossary) {
        if (!glossaryWordSet.has(word)) {
          warnings.push({
            type: 'glossary-broken',
            cardKey: row.key,
            message: `Glossary word "${word}" not found in glossary.yaml`,
          });
        }
      }

      // Content-mismatch for glossary: DB vs file
      if (fileSet.has(row.filePath)) {
        try {
          const file = await readCardFile(row.filePath);
          const fileGlossary = file.frontmatter.glossary ?? [];
          const dbGlossaryStr = JSON.stringify(cardGlossary.sort());
          const fileGlossaryStr = JSON.stringify([...fileGlossary].sort());
          if (dbGlossaryStr !== fileGlossaryStr) {
            warnings.push({
              type: 'content-mismatch',
              cardKey: row.key,
              message: `DB glossary differs from file glossary`,
            });
          }
        } catch {
          // already handled
        }
      }

    }
  }

  // Unused glossary entries
  for (const entry of glossaryEntries) {
    if (!usedGlossaryWords.has(entry.word)) {
      warnings.push({
        type: 'glossary-unused',
        cardKey: '',
        message: `Glossary word "${entry.word}" is not referenced by any card`,
      });
    }
  }

  // Broken chain: spec card with no relation to any brief card.
  // Reuses the relationsBySrc prefetch built above (no extra DB round-trips).
  for (const row of dbRows) {
    if (row.type === 'spec') {
      const relations = relationsBySrc.get(row.key) ?? [];
      const forwardTargets = relations.filter((r) => !r.isReverse).map((r) => r.dstCardKey);
      const reverseTargets = relations.filter((r) => r.isReverse).map((r) => r.dstCardKey);
      const allRelated = [...forwardTargets, ...reverseTargets];
      const hasBriefRelation = allRelated.some((targetKey) => {
        const target = cardByKey.get(targetKey);
        return target && target.type === 'brief';
      });
      // Also consider parent chain: if parent is brief, chain is intact
      let hasBriefParent = false;
      let current = row.parent;
      while (current) {
        const p = cardByKey.get(current);
        if (p && p.type === 'brief') { hasBriefParent = true; break; }
        current = p?.parent ?? null;
      }
      if (!hasBriefRelation && !hasBriefParent) {
        warnings.push({
          type: 'broken-chain',
          cardKey: row.key,
          message: `Spec card has no relation or parent link to any brief card`,
        });
      }
    }
  }

  return { staleDbRows, orphanFiles, keyMismatches, warnings };
}

/**
 * Regenerates a card file from the DB state (reverse sync).
 * DB row + relations + tags + codeLinks -> constructs frontmatter -> Bun.write.
 * @returns Absolute path of the written file.
 */
/**
 * Build a CardFile from the DB row + auxiliary tables. Pure — does NOT touch the filesystem.
 * Used by both exportCardToFile (which writes to disk) and CLI `card export` (which renders to STDOUT).
  * @spec card-storage/persistence/sync
 */
export function buildCardFromDb(ctx: EmberdeckContext, fullKey: string): CardFile {
  const key = parseFullKey(fullKey);
  const row = ctx.cardRepo.findByKey(key);
  if (!row) throw new CardNotFoundError(key);

  const relations = ctx.relationRepo
    .findByCardKey(key)
    .filter((r) => !r.isReverse)
    .map((r) => r.dstCardKey);

  const tags = ctx.classificationRepo.findTagsByCard(key);

  const glossary = parseStringArrayJson(row.glossaryJson);

  const ns = parseNamespaces(row.namespacesJson);
  const fm: CardFrontmatter = {
    key: row.key,
    summary: row.summary,
    status: row.status as CardStatus,
    type: row.type as CardType,
    ...(row.parent ? { parent: row.parent } : {}),
    ...(relations.length ? { relations } : {}),
    ...(tags.length ? { tags } : {}),
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(ns.principle ? { principle: ns.principle as CardFrontmatter['principle'] } : {}),
    ...(ns.domain ? { domain: ns.domain as CardFrontmatter['domain'] } : {}),
    ...(ns.brief ? { brief: ns.brief as CardFrontmatter['brief'] } : {}),
    ...(ns.spec ? { spec: ns.spec as CardFrontmatter['spec'] } : {}),
  };

  return { frontmatter: fm, filePath: row.filePath };
}

/** @spec card-storage/persistence/sync */
export async function exportCardToFile(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string; bytes: number }> {
  const cardFile = buildCardFromDb(ctx, fullKey);
  const { serializeCard } = await import('../card/serialize');
  const content = serializeCard(cardFile.frontmatter);
  await writeCardFile(cardFile.filePath!, cardFile);
  return { filePath: cardFile.filePath!, bytes: Buffer.byteLength(content, 'utf-8') };
}

/**
 * Removes a card from the DB when its file has been externally deleted.
 * Invoked by CLI sync commands when a tracked card file is missing.
  * @spec card-storage/persistence/sync
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
    ctx.classificationRepo.pruneOrphans();
  }
}
