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
    boundaryJson: null,
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
  for await (const { item: filePath, result } of batchedAllSettled(cardFiles, 20, readCardFile)) {
    if (result.status === 'rejected') {
      errors.push({ filePath, error: result.reason });
      continue;
    }
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

  let synced = 0;
  const safeFiles = cardFiles.filter((f) => !duplicateFiles.has(f));

  for await (const { item: filePath, result } of batchedAllSettled(safeFiles, 20, (f) => syncCardFromFile(ctx, f))) {
    if (result.status === 'fulfilled') synced++;
    else errors.push({ filePath, error: result.reason });
  }

  return { synced, errors };
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
export async function exportCardToFile(ctx: EmberdeckContext, fullKey: string): Promise<string> {
  const cardFile = buildCardFromDb(ctx, fullKey);
  await writeCardFile(cardFile.filePath!, cardFile);
  return cardFile.filePath!;
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
