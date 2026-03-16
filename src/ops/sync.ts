import { basename } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { serializeCardMarkdown } from '../card/markdown';
import { CardNotFoundError } from '../card/errors';
import type { CardFrontmatter, CardStatus, CardType, CardPriority, AcceptanceCriterion } from '../card/types';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';

export interface BulkSyncResult {
  synced: number;
  errors: Array<{ filePath: string; error: unknown }>;
}

export interface CardValidationResult {
  staleDbRows: CardRow[];
  orphanFiles: string[];
  keyMismatches: Array<{ row: CardRow; expectedKey: string }>;
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
    type: cardFile.frontmatter.type ?? null,
    priority: cardFile.frontmatter.priority ?? null,
    acceptanceJson: cardFile.frontmatter.acceptance
      ? JSON.stringify(cardFile.frontmatter.acceptance)
      : null,
    constraintsJson: cardFile.frontmatter.constraints !== undefined
      ? JSON.stringify(cardFile.frontmatter.constraints)
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
    classRepo.replaceKeywords(key, cardFile.frontmatter.keywords ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
  });
}

/**
 * Scans the entire cardsDir (or dirPath) and bulk-syncs all .card.md files to the DB.
 *
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

  const results = await Promise.allSettled(
    cardFiles.map((filePath) => syncCardFromFile(ctx, filePath)),
  );

  let synced = 0;
  const errors: BulkSyncResult['errors'] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === 'fulfilled') {
      synced++;
    } else {
      errors.push({ filePath: cardFiles[i]!, error: result.reason });
    }
  }

  return { synced, errors };
}

/**
 * Validates consistency between the file list in cardsDir (or dirPath) and DB rows.
 * Does not modify the DB (read-only).
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
      const expectedKey = basename(r.filePath, '.card.md');
      return expectedKey !== r.key ? { row: r, expectedKey } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { staleDbRows, orphanFiles, keyMismatches };
}

/**
 * Regenerates a card file from the DB state (reverse sync).
 * DB row + relations + keywords + tags + codeLinks -> constructs frontmatter -> Bun.write.
 * @returns Absolute path of the written file.
 */
export async function exportCardToFile(ctx: EmberdeckContext, fullKey: string): Promise<string> {
  const key = parseFullKey(fullKey);
  const row = ctx.cardRepo.findByKey(key);
  if (!row) throw new CardNotFoundError(key);

  const relations = ctx.relationRepo
    .findByCardKey(key)
    .filter((r) => !r.isReverse)
    .map((r) => ({ type: r.type, target: r.dstCardKey }));

  const keywords = ctx.classificationRepo.findKeywordsByCard(key);
  const tags = ctx.classificationRepo.findTagsByCard(key);
  const codeLinks = ctx.codeLinkRepo
    .findByCardKey(key)
    .map((r) => ({ kind: r.kind, file: r.file, symbol: r.symbol }));

  const fm: CardFrontmatter = {
    key: row.key,
    summary: row.summary,
    status: row.status as CardStatus,
    ...(row.type ? { type: row.type as CardType } : {}),
    ...(row.priority ? { priority: row.priority as CardPriority } : {}),
    ...(row.acceptanceJson ? { acceptance: JSON.parse(row.acceptanceJson) as AcceptanceCriterion[] } : {}),
    ...(row.constraintsJson ? { constraints: JSON.parse(row.constraintsJson) as Record<string, unknown> } : {}),
    ...(relations.length ? { relations } : {}),
    ...(keywords.length ? { keywords } : {}),
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
  }
}
