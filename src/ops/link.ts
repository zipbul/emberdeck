import type { Gildash, SymbolSearchResult } from '@zipbul/gildash';

import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { readCardFileOrThrow } from '../fs/reader';

/**
 * `searchAnnotations` page-size cap. Gildash default is unbounded; pin to
 * keep memory predictable when an annotation tag has many call sites.
 */
export const GILDASH_ANNOTATION_LIMIT = 10000;

/**
 * Per-file symbol cache backed by `getSymbolsByFile`. Project-aware: in a
 * monorepo (gildash discovered multiple projects), `getSymbolsByFile(file)`
 * with no `project` arg defaults to the primary project — files from other
 * projects return `[]` and every codeLink referencing them looks broken.
 *
 * The cache iterates `gildash.projects` on first lookup, finds which project
 * owns the file, and routes the call. Subsequent lookups hit the cache.
 *
 * Callers create a fresh instance per operation.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export class SymbolFileCache {
  private readonly cache = new Map<string, SymbolSearchResult[]>();
  private readonly projectNames: Array<string | undefined>;

  constructor(
    private readonly gildash: Gildash,
    projectNames?: Array<string | undefined>,
  ) {
    this.projectNames = projectNames && projectNames.length > 0 ? projectNames : [undefined];
  }

  get(file: string): SymbolSearchResult[] {
    let symbols = this.cache.get(file);
    if (symbols !== undefined) return symbols;
    // Union across all projects, dedup by symbol identity within the file.
    // For a single file, two symbols with the same (name, memberName, span.start)
    // tuple are the same symbol regardless of project (project boundaries can
    // overlap, gildash returns the same row twice). Distinct overloads/members
    // differ in span.start.line so they remain separate entries.
    // If EVERY project query throws, propagate so callers can distinguish
    // "gildash-unavailable" from "symbol-not-found".
    const seen = new Set<string>();
    const merged: SymbolSearchResult[] = [];
    let lastError: unknown;
    let anySucceeded = false;
    for (const project of this.projectNames) {
      try {
        const result = project
          ? this.gildash.getSymbolsByFile(file, project)
          : this.gildash.getSymbolsByFile(file);
        anySucceeded = true;
        for (const s of result) {
          const key = `${s.name}\0${s.memberName ?? ''}\0${s.span?.start?.line ?? 0}\0${s.span?.start?.column ?? 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(s);
        }
      } catch (e) {
        lastError = e;
      }
    }
    if (!anySucceeded && lastError) throw lastError;
    this.cache.set(file, merged);
    return merged;
  }

  find(file: string, symbolName: string): SymbolSearchResult | undefined {
    // Symbols come from getSymbolsByFile(file), so file is implicit; only
    // match the (qualified or member) name. Cards typically store the
    // unqualified form, so we accept either form returned by gildash 0.26.
    return this.get(file).find(
      (s) => s.name === symbolName || s.memberName === symbolName,
    );
  }
}

/**
 * Build a `SymbolFileCache` configured with all gildash project names.
 * Use at every site that constructs the cache so monorepos work transparently.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export function makeSymbolFileCache(ctx: EmberdeckContext): SymbolFileCache {
  return new SymbolFileCache(ctx.gildash, gildashProjectNames(ctx));
}


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
  return readCardFileOrThrow(filePath, key);
}

/**
 * Ensure gildash symbol index is up-to-date before operations that depend on it.
 *
 * Reindex is performed at most once per EmberdeckContext lifetime — repeated
 * callers within the same CLI invocation share the first reindex's result.
 * `watchMode: false` means the index is otherwise frozen at `Gildash.open()`,
 * so a single reindex is the freshest state we can offer for the invocation.
 */
const reindexedContexts = new WeakSet<EmberdeckContext>();

/** @spec code-binding/link-and-coverage/resolve-and-validate */
export async function ensureReindexed(ctx: EmberdeckContext): Promise<void> {
  if (reindexedContexts.has(ctx)) return;
  reindexedContexts.add(ctx);
  await ctx.gildash.reindex();
}

/**
 * List every project name gildash discovered under the configured projectRoot.
 * Falls back to `[undefined]` (default project) when no projects are surfaced,
 * so callers can iterate uniformly.
 *
 * In monorepos (e.g. nestjs has 51 sub-projects), gildash's default-project
 * accessors (`listIndexedFiles()`, `getStats()`, `getCyclePaths()` without
 * `project` arg) only see one project's data — usually the alphabetically-first
 * sample app. Iterating all projects is the only way to cover the whole repo.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export function gildashProjectNames(ctx: EmberdeckContext): Array<string | undefined> {
  if (!Array.isArray(ctx.gildash.projects)) return [undefined];
  const names = ctx.gildash.projects.map((p) => p.project).filter(Boolean);
  return names.length > 0 ? names : [undefined];
}

/**
 * Aggregate `listIndexedFiles` across all gildash projects with project
 * attribution. Default-arg `listIndexedFiles()` only sees the alphabetically-
 * first project — in monorepos that misses most of the code. Returning project
 * names lets callers route per-file queries (`getSymbolsByFile`) to the right
 * project. Dedupes by filePath — gildash project boundaries can overlap.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export function listAllIndexedFilesWithProject(
  ctx: EmberdeckContext,
): Array<{ filePath: string; project: string | undefined }> {
  const gildash = ctx.gildash;
  const seen = new Map<string, string | undefined>();
  for (const project of gildashProjectNames(ctx)) {
    try {
      for (const f of gildash.listIndexedFiles(project)) {
        if (!seen.has(f.filePath)) seen.set(f.filePath, project);
      }
    } catch {
      // skip project on failure
    }
  }
  return [...seen.entries()].map(([filePath, project]) => ({ filePath, project }));
}

// ---- Operations ----

/**
 * Resolves a card's codeLinks by looking them up in the gildash symbol index.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export async function resolveCardCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ResolvedCodeLink[]> {
  await ensureReindexed(ctx);

  const key = parseFullKey(fullKey);
  // Existence check — emit CardNotFoundError when the card has neither a
  // file on disk nor a DB row. Keeps the contract symmetric with prior
  // behavior even though source @spec annotations now feed code_link.
  await readCard(ctx, fullKey);
  const codeLinks = ctx.codeLinkRepo.findByCardKey(key);
  if (codeLinks.length === 0) return [];

  const cache = makeSymbolFileCache(ctx)!;
  const result: ResolvedCodeLink[] = [];
  for (const link of codeLinks) {
    const lk: CodeLink = { kind: link.kind, file: link.file, symbol: link.symbol };
    try {
      const found = cache.find(link.file, link.symbol) ?? null;
      result.push({ link: lk, symbol: found });
    } catch {
      result.push({ link: lk, symbol: null });
    }
  }
  return result;
}

export interface SymbolMatchResult {
  card: CardRow;
  matchType: 'codeLink';
}

/**
 * Returns the list of cards bound (via `@spec` source annotations populated
 * into code_link) to the given symbol name. Optional file filter narrows the
 * match. Source bindings are the only SoT — boundary globs no longer exist.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export async function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): Promise<SymbolMatchResult[]> {
  await ensureReindexed(ctx);

  const seen = new Set<string>();
  const result: SymbolMatchResult[] = [];

  const rows = ctx.codeLinkRepo.findBySymbol(symbolName, filePath);
  for (const row of rows) {
    if (seen.has(row.cardKey)) continue;
    seen.add(row.cardKey);
    const card = ctx.cardRepo.findByKey(row.cardKey);
    if (card) result.push({ card, matchType: 'codeLink' });
  }

  return result;
}

/**
 * Expand a set of changed files to include every file transitively affected
 * via the import graph (gildash `getAffected`).
 *
 * Returns the original list when gildash is not configured or the call fails.
 * The returned list is deduplicated and contains the original input.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export async function expandAffectedFiles(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<string[]> {
  if (changedFiles.length === 0) return [];
  await ensureReindexed(ctx);
  // Aggregate across all projects (monorepo support).
  const out = new Set<string>(changedFiles);
  for (const project of gildashProjectNames(ctx)) {
    try {
      const affected = await ctx.gildash.getAffected(changedFiles, project);
      for (const f of affected) out.add(f);
    } catch {
      // skip project
    }
  }
  return [...out];
}

/**
 * Given a list of changed files, returns the cards that reference symbols in
 * those files via codeLinks. Expands the input through the import graph so a
 * change to `foo.ts` also flags cards that link to importers of `foo.ts`.
 * Internal function — not part of the public API. Use preChangeCheck instead.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export async function findAffectedCards(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<CardRow[]> {
  if (changedFiles.length === 0) return [];

  await ensureReindexed(ctx);

  const expanded = await expandAffectedFiles(ctx, changedFiles);
  const seen = new Set<string>();
  for (const file of expanded) {
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
 * Read-only: detects broken links but never mutates card status. Use
 * `ed card set-status <key> drifted` to transition explicitly.
  * @spec code-binding/link-and-coverage/resolve-and-validate
 */
export async function validateCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ValidateCodeLinksResult> {
  await ensureReindexed(ctx);

  const key = parseFullKey(fullKey);
  const cardFile = await readCard(ctx, fullKey);
  const dbLinks = ctx.codeLinkRepo.findByCardKey(key);
  if (dbLinks.length === 0) return { declared: 0, valid: 0, broken: [], planned: [] };
  const status = cardFile.frontmatter.status;
  const isPlanning = status === 'draft';

  const cache = makeSymbolFileCache(ctx)!;
  const broken: BrokenLink[] = [];
  const planned: BrokenLink[] = [];

  let valid = 0;
  for (const row of dbLinks) {
    const link: CodeLink = { kind: row.kind, file: row.file, symbol: row.symbol };
    let found: SymbolSearchResult | undefined;
    try {
      found = cache.find(link.file, link.symbol);
    } catch {
      const entry: BrokenLink = { link, reason: 'gildash-unavailable' };
      if (isPlanning) planned.push(entry);
      else broken.push(entry);
      continue;
    }

    if (!found) {
      const entry: BrokenLink = { link, reason: 'symbol-not-found' };
      if (isPlanning) planned.push(entry);
      else broken.push(entry);
    } else {
      valid++;
    }
  }

  return {
    declared: dbLinks.length,
    valid,
    broken,
    planned,
  };
}
