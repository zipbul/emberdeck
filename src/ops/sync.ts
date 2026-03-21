import { relative } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { serializeCardMarkdown } from '../card/markdown';
import { CardNotFoundError } from '../card/errors';
import type { CardFrontmatter, CardStatus, CardType } from '../card/types';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';

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
 * Called by the CLI when a watcher event (create/change) is received.
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    type: cardFile.frontmatter.type,
    parent: cardFile.frontmatter.parent ?? null,
    boundaryJson: cardFile.frontmatter.boundary
      ? JSON.stringify(cardFile.frontmatter.boundary)
      : null,
    body: cardFile.body,
    filePath,
    updatedAt: now,
  };

  ctx.db.transaction((tx) => {
    const d = txDb(tx);
    const cardRepo = new DrizzleCardRepository(d);
    const relationRepo = new DrizzleRelationRepository(d);
    const classRepo = new DrizzleClassificationRepository(d);
    const codeLinkRepo = new DrizzleCodeLinkRepository(d);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
  });
}

/**
 * Scans the entire cardsDir (or dirPath) and bulk-syncs all .card.md files to the DB.
 *
 * Detects duplicate keys across files and reports them as errors (data loss prevention).
 * File reads are executed in parallel via `Promise.allSettled` to minimize I/O wait time.
 * Each file's DB write is atomic, guaranteed by the transaction inside `syncCardFromFile`.
 */
export async function bulkSyncCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<BulkSyncResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const glob = new Bun.Glob('**/*.card.md');
  const cardFiles: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    cardFiles.push(file);
  }

  // Detect duplicate keys
  const keyToFile = new Map<string, string>();
  const duplicates = new Map<string, string[]>();
  const errors: BulkSyncResult['errors'] = [];

  for (const filePath of cardFiles) {
    try {
      const cardFile = await readCardFile(filePath);
      const key = cardFile.frontmatter.key;
      if (keyToFile.has(key)) {
        const existing = duplicates.get(key) ?? [keyToFile.get(key)!];
        existing.push(filePath);
        duplicates.set(key, existing);
      } else {
        keyToFile.set(key, filePath);
      }
    } catch (err) {
      errors.push({ filePath, error: err });
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
  const BATCH_SIZE = 20;
  const safeFiles = cardFiles.filter((f) => !duplicateFiles.has(f));

  for (let i = 0; i < safeFiles.length; i += BATCH_SIZE) {
    const batch = safeFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((filePath) => syncCardFromFile(ctx, filePath)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      if (result.status === 'fulfilled') {
        synced++;
      } else {
        errors.push({ filePath: batch[j]!, error: result.reason });
      }
    }
  }

  return { synced, errors };
}

/**
 * Validates consistency between the file list in cardsDir (or dirPath) and DB rows.
 * Performs read-only structural validation including hierarchy, relations, and boundary checks.
 */
export async function validateCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<CardValidationResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const glob = new Bun.Glob('**/*.card.md');
  const cardFiles: string[] = [];
  for await (const file of glob.scan({ cwd: targetDir, absolute: true })) {
    cardFiles.push(file);
  }

  const fileSet = new Set(cardFiles);
  const dbRows = ctx.cardRepo.list();
  const dbFilePaths = new Set(dbRows.map((r) => r.filePath));

  const staleDbRows = dbRows.filter((r) => !fileSet.has(r.filePath));
  const orphanFiles = cardFiles.filter((f) => !dbFilePaths.has(f));
  const keyMismatches = dbRows
    .map((r) => {
      const expectedKey = relative(targetDir, r.filePath).replace(/\.card\.md$/, '');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const warnings: ValidationWarning[] = [];

  // Build lookup maps
  const cardByKey = new Map<string, CardRow>();
  for (const row of dbRows) {
    cardByKey.set(row.key, row);
  }

  for (const row of dbRows) {
    // Orphan card: parent=null + type is not architecture
    if (!row.parent && row.type !== 'architecture') {
      warnings.push({
        type: 'orphan-card',
        cardKey: row.key,
        message: `Non-architecture card has no parent`,
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

    // Type hierarchy violation
    if (row.parent && cardByKey.has(row.parent)) {
      const parent = cardByKey.get(row.parent)!;
      if (row.type === 'architecture' && parent.type !== 'architecture') {
        warnings.push({
          type: 'type-hierarchy-violation',
          cardKey: row.key,
          message: `Architecture card has non-architecture parent "${row.parent}" (type: ${parent.type})`,
        });
      }
    }

    // Broken relation: relation target does not exist
    const relations = ctx.relationRepo.findByCardKey(row.key);
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

  // Empty tree: architecture card with no child specs (skip draft architecture)
  for (const row of dbRows) {
    if (row.type === 'architecture' && row.status !== 'draft') {
      const children = dbRows.filter((r) => r.parent === row.key);
      if (children.length === 0) {
        warnings.push({
          type: 'empty-tree',
          cardKey: row.key,
          message: `Active architecture card has no child cards`,
        });
      }
    }
  }

  // Boundary overlap: two cards with overlapping boundaries (parent-child allowed)
  // Detects overlaps by checking if any pattern from one card matches any pattern from the other
  // (glob A matches path B, or glob B matches path A, or identical patterns).
  const cardsWithBoundary = dbRows.filter((r) => r.boundaryJson);
  for (let i = 0; i < cardsWithBoundary.length; i++) {
    for (let j = i + 1; j < cardsWithBoundary.length; j++) {
      const a = cardsWithBoundary[i]!;
      const b = cardsWithBoundary[j]!;

      // Skip parent-child pairs
      if (a.parent === b.key || b.parent === a.key) continue;

      const aBoundary = JSON.parse(a.boundaryJson!) as string[];
      const bBoundary = JSON.parse(b.boundaryJson!) as string[];

      const overlapping: string[] = [];
      for (const pa of aBoundary) {
        for (const pb of bBoundary) {
          if (pa === pb) {
            overlapping.push(pa);
          } else {
            // Check if one pattern is a sub-path of the other
            // e.g. "src/**" matches "src/auth/token.ts" and "src/auth/**" also matches it
            try {
              const globA = new Bun.Glob(pa);
              const globB = new Bun.Glob(pb);
              // If pattern A matches pattern B as a path (or vice versa), they overlap
              if (globA.match(pb) || globB.match(pa)) {
                overlapping.push(`${pa} ∩ ${pb}`);
              }
            } catch {
              // Invalid glob — skip
            }
          }
        }
      }

      if (overlapping.length > 0) {
        warnings.push({
          type: 'boundary-overlap',
          cardKey: a.key,
          message: `Boundary overlaps with "${b.key}": ${overlapping.join(', ')}`,
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
export async function exportCardToFile(ctx: EmberdeckContext, fullKey: string): Promise<string> {
  const key = parseFullKey(fullKey);
  const row = ctx.cardRepo.findByKey(key);
  if (!row) throw new CardNotFoundError(key);

  const relations = ctx.relationRepo
    .findByCardKey(key)
    .filter((r) => !r.isReverse)
    .map((r) => r.dstCardKey);

  const tags = ctx.classificationRepo.findTagsByCard(key);
  const codeLinks = ctx.codeLinkRepo
    .findByCardKey(key)
    .map((r) => ({ kind: r.kind, file: r.file, symbol: r.symbol }));

  const fm: CardFrontmatter = {
    key: row.key,
    summary: row.summary,
    status: row.status as CardStatus,
    type: row.type as CardType,
    ...(row.parent ? { parent: row.parent } : {}),
    ...(row.boundaryJson ? { boundary: JSON.parse(row.boundaryJson) as string[] } : {}),
    ...(relations.length ? { relations } : {}),
    ...(tags.length ? { tags } : {}),
    ...(codeLinks.length ? { codeLinks } : {}),
  };

  const content = serializeCardMarkdown(fm, row.body ?? '');
  await Bun.write(row.filePath, content);
  return row.filePath;
}

/**
 * Removes a card from the DB when its file has been externally deleted.
 * Called by the CLI when a watcher event (delete) is received.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
    ctx.classificationRepo.pruneOrphans();
  }
}
