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
  reason: 'symbol-not-found' | 'file-not-indexed' | 'gildash-unavailable';
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
    try {
      const search = ctx.gildash.searchSymbols({
        text: link.symbol,
        exact: true,
        filePath: link.file,
      });

      const found = search.find((s) => s.name === link.symbol && s.filePath === link.file) ?? null;
      result.push({ link, symbol: found });
    } catch {
      // Gildash unavailable — symbol resolution not possible
      result.push({ link, symbol: null });
    }
  }
  return result;
}

export interface SymbolMatchResult {
  card: CardRow;
  matchType: 'codeLink' | 'boundary';
}

/**
 * Returns the list of cards that reference the given symbol name (+ optional file path).
 * Matches via codeLinks first, then via boundary glob patterns.
 */
export async function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): Promise<SymbolMatchResult[]> {
  await ensureReindexed(ctx);

  const seen = new Set<string>();
  const result: SymbolMatchResult[] = [];

  // 1. codeLink-based matches
  const rows = ctx.codeLinkRepo.findBySymbol(symbolName, filePath);
  for (const row of rows) {
    if (seen.has(row.cardKey)) continue;
    seen.add(row.cardKey);
    const card = ctx.cardRepo.findByKey(row.cardKey);
    if (card) result.push({ card, matchType: 'codeLink' });
  }

  // 2. boundary glob matches (only when filePath is provided)
  if (filePath) {
    const allCards = ctx.cardRepo.list();
    for (const card of allCards) {
      if (seen.has(card.key)) continue;
      if (!card.boundaryJson) continue;
      let boundaries: string[];
      try {
        const parsed = JSON.parse(card.boundaryJson);
        if (!Array.isArray(parsed)) continue;
        boundaries = parsed;
      } catch {
        continue;
      }
      for (const pattern of boundaries) {
        const glob = new Bun.Glob(pattern);
        if (glob.match(filePath)) {
          seen.add(card.key);
          result.push({ card, matchType: 'boundary' });
          break;
        }
      }
    }
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
  let gildashUnavailable = false;
  for (const link of codeLinks) {
    let search: SymbolSearchResult[];
    try {
      search = ctx.gildash.searchSymbols({
        text: link.symbol,
        exact: true,
        filePath: link.file,
      });
    } catch {
      // Gildash transient failure — do not count as broken link
      gildashUnavailable = true;
      const entry: BrokenLink = { link, reason: 'gildash-unavailable' };
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

  // Auto-transition: active card with broken links → drifted (targeted UPDATE)
  // Skip transition if gildash was unavailable — broken links may be false positives
  if (broken.length > 0 && status === 'active' && !gildashUnavailable) {
    const key = parseFullKey(fullKey);
    const row = ctx.cardRepo.findByKey(key);
    if (row) {
      const now = new Date().toISOString();
      try {
        const changed = ctx.db.$client
          .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ? AND status = ?')
          .run('drifted', now, key, 'active');
        if (changed.changes > 0) {
          try {
            cardFile.frontmatter.status = 'drifted';
            const filePath = buildCardPath(ctx.cardsDir, key);
            await writeCardFile(filePath, cardFile);
          } catch {
            // File write failed — revert DB
            ctx.db.$client
              .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ?')
              .run(row.status, row.updatedAt, key);
          }
        }
      } catch {
        // Transition failed — DB reverted to previous state
      }
    }
  }

  return { declared: codeLinks.length, valid, broken, planned };
}
