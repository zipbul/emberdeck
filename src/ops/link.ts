import { isErr } from '@zipbul/result';
import type { SymbolSearchResult } from '@zipbul/gildash';

import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { GildashNotConfiguredError, CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';

// ---- Public Types ----

export interface ResolvedCodeLink {
  link: CodeLink;
  /** Symbol found by gildash. null means symbol not found (broken link). */
  symbol: SymbolSearchResult | null;
}

export interface BrokenLink {
  link: CodeLink;
  reason: 'symbol-not-found' | 'file-not-indexed';
}

export interface ValidateCodeLinksResult {
  /** Total number of code links declared on the card. */
  declared: number;
  /** Number of links that resolved successfully. */
  valid: number;
  /** Links that could not be resolved (on active/drifted cards). */
  broken: BrokenLink[];
  /** Links that could not be resolved on draft cards (expected — code not yet written). */
  planned: BrokenLink[];
}

// ---- Helpers ----

async function readCard(ctx: EmberdeckContext, fullKey: string) {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) {
    throw new CardNotFoundError(key);
  }
  return readCardFile(filePath);
}

/**
 * Ensure gildash symbol index is up-to-date before operations that depend on it.
 * No-op if gildash is not configured or does not support reindex.
 */
export async function ensureReindexed(ctx: EmberdeckContext): Promise<void> {
  if (ctx.gildash && typeof ctx.gildash.reindex === 'function') {
    await ctx.gildash.reindex();
  }
}

// ---- Operations ----

/**
 * Resolves a card's codeLinks by looking them up in the gildash symbol index.
 * Throws GildashNotConfiguredError if gildash is not configured.
 */
export async function resolveCardCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ResolvedCodeLink[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const cardFile = await readCard(ctx, fullKey);
  const codeLinks = cardFile.frontmatter.codeLinks ?? [];
  if (codeLinks.length === 0) return [];

  const result: ResolvedCodeLink[] = [];
  for (const link of codeLinks) {
    const search = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (isErr(search)) {
      result.push({ link, symbol: null });
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file) ?? null;
    result.push({ link, symbol: found });
  }
  return result;
}

/**
 * Returns the list of cards that reference the given symbol name (+ optional file path).
 */
export async function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): Promise<CardRow[]> {
  await ensureReindexed(ctx);

  const rows = ctx.codeLinkRepo.findBySymbol(symbolName, filePath);
  const seen = new Set<string>();
  const result: CardRow[] = [];
  for (const row of rows) {
    if (seen.has(row.cardKey)) continue;
    seen.add(row.cardKey);
    const card = ctx.cardRepo.findByKey(row.cardKey);
    if (card) result.push(card);
  }
  return result;
}

/**
 * Given a list of changed files, returns the cards that reference symbols in those files via codeLinks.
 * Internal function — not part of the public API. Use preChangeCheck instead.
 */
export async function findAffectedCards(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<CardRow[]> {
  if (changedFiles.length === 0) return [];

  await ensureReindexed(ctx);

  const seen = new Set<string>();
  for (const file of changedFiles) {
    const rows = ctx.codeLinkRepo.findByFile(file);
    for (const row of rows) {
      seen.add(row.cardKey);
    }
  }

  const result: CardRow[] = [];
  for (const key of seen) {
    const card = ctx.cardRepo.findByKey(key);
    if (card) result.push(card);
  }
  return result;
}

/**
 * Validates that all of a card's codeLinks exist in the current symbol index.
 * Returns declared/valid/broken counts for unambiguous interpretation.
 *
 * When broken links are detected on an active card, the card is automatically
 * transitioned to 'drifted' status (DB + file).
 */
export async function validateCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ValidateCodeLinksResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const cardFile = await readCard(ctx, fullKey);
  const codeLinks = cardFile.frontmatter.codeLinks ?? [];
  if (codeLinks.length === 0) return { declared: 0, valid: 0, broken: [], planned: [] };

  const status = cardFile.frontmatter.status;
  const isPlanning = status === 'draft';

  const broken: BrokenLink[] = [];
  const planned: BrokenLink[] = [];
  let valid = 0;
  for (const link of codeLinks) {
    const search = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (isErr(search)) {
      const entry: BrokenLink = { link, reason: 'file-not-indexed' };
      if (isPlanning) planned.push(entry);
      else broken.push(entry);
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file);
    if (!found) {
      const entry: BrokenLink = { link, reason: 'symbol-not-found' };
      if (isPlanning) planned.push(entry);
      else broken.push(entry);
    } else {
      valid++;
    }
  }

  // Auto-transition: active card with broken links → drifted
  if (broken.length > 0 && status === 'active') {
    const key = parseFullKey(fullKey);
    const row = ctx.cardRepo.findByKey(key);
    if (row) {
      ctx.cardRepo.upsert({ ...row, status: 'drifted', updatedAt: new Date().toISOString() });
      try {
        cardFile.frontmatter.status = 'drifted';
        const filePath = buildCardPath(ctx.cardsDir, key);
        await writeCardFile(filePath, cardFile);
      } catch {
        // File update failed, DB already updated
      }
    }
  }

  return { declared: codeLinks.length, valid, broken, planned };
}
