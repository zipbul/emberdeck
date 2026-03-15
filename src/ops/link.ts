import { isErr } from '@zipbul/result';
import type { SymbolSearchResult } from '@zipbul/gildash';

import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { GildashNotConfiguredError, CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';

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

// ---- Helpers ----

async function readCard(ctx: EmberdeckContext, fullKey: string) {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) {
    throw new CardNotFoundError(key);
  }
  return readCardFile(filePath);
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
export function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): CardRow[] {
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
 */
export async function findAffectedCards(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<CardRow[]> {
  if (changedFiles.length === 0) return [];

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
 * Returns a list of broken links. An empty array means all links are valid.
 */
export async function validateCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<BrokenLink[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  const cardFile = await readCard(ctx, fullKey);
  const codeLinks = cardFile.frontmatter.codeLinks ?? [];
  if (codeLinks.length === 0) return [];

  const broken: BrokenLink[] = [];
  for (const link of codeLinks) {
    const search = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (isErr(search)) {
      broken.push({ link, reason: 'file-not-indexed' });
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file);
    if (!found) {
      broken.push({ link, reason: 'symbol-not-found' });
    }
  }
  return broken;
}
