import type { Gildash, SymbolSearchResult } from '@zipbul/gildash';

import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { GildashNotConfiguredError, CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { parseStringArrayJson } from '../card/json-fields';
import { matchesAnyGlob } from '../util/glob';

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
 */
export function makeSymbolFileCache(ctx: EmberdeckContext): SymbolFileCache | null {
  if (!ctx.gildash) return null;
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
  /**
   * Resolved links that target non-exported (module-internal) symbols.
   * Informational — links to internal symbols are allowed but flagged so reviewers
   * can decide whether the documented contract really needs internal coupling.
   * Populated only when gildash exposes `getModuleInterface`.
   */
  internalLinks?: Array<{ file: string; symbol: string }>;
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
 *
 * Reindex is performed at most once per EmberdeckContext lifetime — repeated
 * callers within the same CLI invocation share the first reindex's result.
 * `watchMode: false` means the index is otherwise frozen at `Gildash.open()`,
 * so a single reindex is the freshest state we can offer for the invocation.
 */
const reindexedContexts = new WeakSet<EmberdeckContext>();

export async function ensureReindexed(ctx: EmberdeckContext): Promise<void> {
  if (!ctx.gildash || typeof ctx.gildash.reindex !== 'function') return;
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
 */
export function gildashProjectNames(ctx: EmberdeckContext): Array<string | undefined> {
  // Array.isArray guard tolerates test mocks that omit the `projects` accessor.
  if (!ctx.gildash || !Array.isArray(ctx.gildash.projects)) return [undefined];
  const names = ctx.gildash.projects.map((p) => p.project).filter(Boolean);
  return names.length > 0 ? names : [undefined];
}

/**
 * Aggregate `listIndexedFiles` across all gildash projects with project
 * attribution. Default-arg `listIndexedFiles()` only sees the alphabetically-
 * first project — in monorepos that misses most of the code. Returning project
 * names lets callers route per-file queries (`getSymbolsByFile`) to the right
 * project. Dedupes by filePath — gildash project boundaries can overlap.
 */
export function listAllIndexedFilesWithProject(
  ctx: EmberdeckContext,
): Array<{ filePath: string; project: string | undefined }> {
  const gildash = ctx.gildash;
  if (!gildash || typeof gildash.listIndexedFiles !== 'function') return [];
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

  const cache = makeSymbolFileCache(ctx)!;
  const result: ResolvedCodeLink[] = [];
  for (const link of codeLinks) {
    try {
      const found = cache.find(link.file, link.symbol) ?? null;
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
      const boundaries = parseStringArrayJson(card.boundaryJson);
      if (boundaries.length > 0 && matchesAnyGlob(filePath, boundaries)) {
        seen.add(card.key);
        result.push({ card, matchType: 'boundary' });
      }
    }
  }

  return result;
}

/**
 * Expand a set of changed files to include every file transitively affected
 * via the import graph (gildash `getAffected`).
 *
 * Returns the original list when gildash is not configured or the call fails.
 * The returned list is deduplicated and contains the original input.
 */
export async function expandAffectedFiles(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<string[]> {
  if (changedFiles.length === 0) return [];
  if (!ctx.gildash || typeof ctx.gildash.getAffected !== 'function') {
    return [...new Set(changedFiles)];
  }
  await ensureReindexed(ctx);
  // Aggregate across all projects (monorepo support).
  const out = new Set<string>(changedFiles);
  for (const project of gildashProjectNames(ctx)) {
    try {
      const affected = project
        ? await ctx.gildash.getAffected(changedFiles, project)
        : await ctx.gildash.getAffected(changedFiles);
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

  const cache = makeSymbolFileCache(ctx)!;
  const broken: BrokenLink[] = [];
  const planned: BrokenLink[] = [];
  const internalLinks: Array<{ file: string; symbol: string }> = [];

  // Cache module interfaces per file so we don't recompute the export set for
  // every link in the same file.
  const interfaceCache = new Map<string, Set<string>>();
  const supportsModuleInterface =
    typeof ctx.gildash.getModuleInterface === 'function';
  const getExportNames = (file: string): Set<string> | null => {
    if (!supportsModuleInterface) return null;
    let names = interfaceCache.get(file);
    if (names === undefined) {
      try {
        const mod = ctx.gildash!.getModuleInterface(file);
        names = new Set(mod?.exports?.map((e) => e.name) ?? []);
      } catch {
        names = new Set();
      }
      interfaceCache.set(file, names);
    }
    return names;
  };

  let valid = 0;
  let gildashUnavailable = false;
  for (const link of codeLinks) {
    let found: SymbolSearchResult | undefined;
    try {
      found = cache.find(link.file, link.symbol);
    } catch {
      // Gildash transient failure — do not count as broken link
      gildashUnavailable = true;
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
      // Flag non-exported symbols (informational only — does not affect status).
      const exports = getExportNames(link.file);
      if (exports && !exports.has(link.symbol) && !exports.has(found.name)) {
        internalLinks.push({ file: link.file, symbol: link.symbol });
      }
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

  return {
    declared: codeLinks.length,
    valid,
    broken,
    planned,
    ...(internalLinks.length > 0 ? { internalLinks } : {}),
  };
}
