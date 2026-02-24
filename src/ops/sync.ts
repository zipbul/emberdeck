import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import type { EmberdeckDb } from '../db/connection';

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
 * 외부 변경된 카드 파일 → DB 동기화.
 * watcher 이벤트(생성/변경) 수신 시 CLI가 호출.
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    constraintsJson: cardFile.frontmatter.constraints
      ? JSON.stringify(cardFile.frontmatter.constraints)
      : null,
    body: cardFile.body,
    filePath,
    updatedAt: now,
  };

  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as unknown as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as unknown as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as unknown as EmberdeckDb);
    const codeLinkRepo = new DrizzleCodeLinkRepository(tx as unknown as EmberdeckDb);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceKeywords(key, cardFile.frontmatter.keywords ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
    codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
  });
}

/**
 * cardsDir(또는 dirPath) 전체를 스캔하여 모든 .card.md 파일을 DB에 일괄 동기화.
 */
export async function bulkSyncCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<BulkSyncResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const entries = await readdir(targetDir, { withFileTypes: true });
  let synced = 0;
  const errors: BulkSyncResult['errors'] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.card.md')) continue;
    const filePath = join(targetDir, entry.name);
    try {
      await syncCardFromFile(ctx, filePath);
      synced++;
    } catch (e) {
      errors.push({ filePath, error: e });
    }
  }

  return { synced, errors };
}

/**
 * cardsDir(또는 dirPath) 파일 목록과 DB rows의 일관성을 검증.
 * DB를 수정하지 않는다 (read-only).
 */
export async function validateCards(
  ctx: EmberdeckContext,
  dirPath?: string,
): Promise<CardValidationResult> {
  const targetDir = dirPath ?? ctx.cardsDir;
  const entries = await readdir(targetDir, { withFileTypes: true });

  const cardFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.card.md'))
    .map((e) => join(targetDir, e.name));

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
 * 외부 삭제된 카드 파일 → DB에서 제거.
 * watcher 이벤트(삭제) 수신 시 CLI가 호출.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
  }
}
