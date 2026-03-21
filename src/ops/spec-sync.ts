import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import { GildashNotConfiguredError } from '../card/errors';
import { ensureReindexed } from './link';
import { join, relative, dirname } from 'node:path';

// ── @spec annotation sync ──

export interface SpecSyncResult {
  /** Number of code links auto-created from @spec annotations. */
  created: number;
  /** Number of @spec annotations that matched an existing code link (skipped). */
  alreadyLinked: number;
  /** Annotations that could not be linked (no card found for the spec key). */
  unmatched: Array<{ cardKey: string; file: string; symbol: string }>;
  /** Code links that exist but have no corresponding @spec annotation in source. */
  markerMissing: Array<{ cardKey: string; file: string; symbol: string }>;
  /** @spec annotations found but code link not registered (subset of created, informational). */
  linkMissing: Array<{ cardKey: string; file: string; symbol: string }>;
}

/**
 * Scan @spec annotations from gildash and auto-create code links for matching cards.
 *
 * Only creates links that don't already exist (manual links are preserved).
 * Annotations without a matching card key are reported as unmatched.
 *
 * Also detects:
 * - markerMissing: code links that have no @spec annotation in source
 * - linkMissing: @spec annotations that were just created as new links
 */
export async function syncSpecAnnotations(ctx: EmberdeckContext): Promise<SpecSyncResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const annotations = ctx.gildash.searchAnnotations({ tag: 'spec', limit: 10000 });
  let created = 0;
  let alreadyLinked = 0;
  const unmatched: SpecSyncResult['unmatched'] = [];
  const linkMissing: SpecSyncResult['linkMissing'] = [];

  // Build a set of annotation keys for marker-missing detection
  const annotationKeys = new Set<string>();
  for (const ann of annotations) {
    if (ann.symbolName && ann.value.trim()) {
      annotationKeys.add(`${ann.value.trim()}:${ann.filePath}:${ann.symbolName}`);
    }
  }

  for (const ann of annotations) {
    const cardKey = ann.value.trim();
    if (!cardKey) continue;

    // Check if card exists
    const card = ctx.cardRepo.findByKey(cardKey);
    if (!card) {
      if (ann.symbolName) {
        unmatched.push({ cardKey, file: ann.filePath, symbol: ann.symbolName });
      }
      continue;
    }

    // Skip if no symbol linked
    if (!ann.symbolName) continue;

    // Check if link already exists
    const existing = ctx.codeLinkRepo.findByCardKey(cardKey);
    const alreadyExists = existing.some(
      (l) => l.file === ann.filePath && l.symbol === ann.symbolName,
    );
    if (alreadyExists) {
      alreadyLinked++;
      continue;
    }

    // Determine kind from gildash symbol search
    let kind = 'unknown';
    const symbols = ctx.gildash!.searchSymbols({
      text: ann.symbolName,
      exact: true,
      filePath: ann.filePath,
    });
    if (!Array.isArray(symbols)) {
      // searchSymbols returned an error Result
      kind = 'unknown';
    } else {
      const match = symbols.find(
        (s) => s.name === ann.symbolName && s.filePath === ann.filePath,
      );
      if (match) kind = match.kind;
    }

    // Create the code link
    const newLinks: CodeLink[] = [
      ...existing.map((l) => ({ kind: l.kind, file: l.file, symbol: l.symbol })),
      { kind, file: ann.filePath, symbol: ann.symbolName },
    ];
    ctx.codeLinkRepo.replaceForCard(cardKey, newLinks);
    created++;
    linkMissing.push({ cardKey, file: ann.filePath, symbol: ann.symbolName });
  }

  // Detect marker-missing: code links that have no @spec annotation
  const markerMissing: SpecSyncResult['markerMissing'] = [];
  const allCards = ctx.cardRepo.list();
  for (const card of allCards) {
    const links = ctx.codeLinkRepo.findByCardKey(card.key);
    for (const link of links) {
      const annotKey = `${card.key}:${link.file}:${link.symbol}`;
      if (!annotationKeys.has(annotKey)) {
        markerMissing.push({ cardKey: card.key, file: link.file, symbol: link.symbol });
      }
    }
  }

  return { created, alreadyLinked, unmatched, markerMissing, linkMissing };
}

// ── Symbol rename/move sync ──

export interface SymbolSyncResult {
  /** Number of code links updated due to renames/moves. */
  updated: number;
  /** Number of code links marked as broken due to symbol deletion. */
  broken: number;
  /** Details of each change applied. */
  changes: Array<{
    cardKey: string;
    oldFile: string;
    oldSymbol: string;
    newFile: string | null;
    newSymbol: string | null;
    changeType: string;
  }>;
}

/**
 * Sync code links with symbol changes (renames, moves, deletions) from gildash.
 *
 * - Renamed symbols: update the symbol name in code links.
 * - Moved symbols: update the file path in code links.
 * - Deleted symbols: no auto-delete — reported for manual review.
 */
export async function syncSymbolChanges(
  ctx: EmberdeckContext,
  since: Date | string,
): Promise<SymbolSyncResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const changes = ctx.gildash.getSymbolChanges(since, {
    changeTypes: ['renamed', 'moved', 'removed'],
  });

  let updated = 0;
  let broken = 0;
  const details: SymbolSyncResult['changes'] = [];

  for (const change of changes) {
    // Find code links referencing the old symbol/file
    const oldName = change.oldName ?? change.symbolName;
    const oldFile = change.oldFilePath ?? change.filePath;
    const links = ctx.codeLinkRepo.findBySymbol(oldName, oldFile);

    if (links.length === 0) continue;

    for (const link of links) {
      if (change.changeType === 'renamed') {
        // Update symbol name
        const allLinks = ctx.codeLinkRepo.findByCardKey(link.cardKey);
        const updated_links = allLinks.map((l) => {
          if (l.file === oldFile && l.symbol === oldName) {
            return { kind: l.kind, file: l.file, symbol: change.symbolName };
          }
          return { kind: l.kind, file: l.file, symbol: l.symbol };
        });
        ctx.codeLinkRepo.replaceForCard(link.cardKey, updated_links);
        updated++;
        details.push({
          cardKey: link.cardKey,
          oldFile,
          oldSymbol: oldName,
          newFile: oldFile,
          newSymbol: change.symbolName,
          changeType: 'renamed',
        });
      } else if (change.changeType === 'moved') {
        // Update file path
        const allLinks = ctx.codeLinkRepo.findByCardKey(link.cardKey);
        const updated_links = allLinks.map((l) => {
          if (l.file === oldFile && l.symbol === oldName) {
            return { kind: l.kind, file: change.filePath, symbol: change.symbolName };
          }
          return { kind: l.kind, file: l.file, symbol: l.symbol };
        });
        ctx.codeLinkRepo.replaceForCard(link.cardKey, updated_links);
        updated++;
        details.push({
          cardKey: link.cardKey,
          oldFile,
          oldSymbol: oldName,
          newFile: change.filePath,
          newSymbol: change.symbolName,
          changeType: 'moved',
        });
      } else if (change.changeType === 'removed') {
        broken++;
        details.push({
          cardKey: link.cardKey,
          oldFile,
          oldSymbol: oldName,
          newFile: null,
          newSymbol: null,
          changeType: 'removed',
        });
      }
    }
  }

  return { updated, broken, changes: details };
}

// ── Code link coverage ──

export interface LinkCoverageResult {
  /** Number of declared code links. */
  declared: number;
  /** Number of links resolved in gildash. */
  resolved: number;
  /** Number of broken links. */
  broken: number;
  /** Coverage ratio (resolved / declared). */
  coverage: number;
  /** Symbols in the same files that are not linked to this card. */
  unreferenced: Array<{ file: string; symbol: string; kind: string }>;
}

/**
 * Calculate code link coverage for a card.
 *
 * Checks how many declared links resolve in gildash, and finds
 * unreferenced symbols in the same files. Applies coverageIgnore
 * patterns to exclude symbols from unreferenced list.
 */
export async function getLinkCoverage(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<LinkCoverageResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const links = ctx.codeLinkRepo.findByCardKey(fullKey);
  if (links.length === 0) {
    return { declared: 0, resolved: 0, broken: 0, coverage: 1, unreferenced: [] };
  }

  // Collect boundary-covered files for this card
  const boundaryFiles = new Set<string>();
  const row = ctx.cardRepo.findByKey(fullKey);
  if (row?.boundaryJson && ctx.projectRoot) {
    try {
      const boundary: string[] = JSON.parse(row.boundaryJson);
      if (Array.isArray(boundary)) {
        for (const pattern of boundary) {
          const glob = new Bun.Glob(pattern);
          for (const file of glob.scanSync({ cwd: ctx.projectRoot })) {
            boundaryFiles.add(file);
          }
        }
      }
    } catch {
      // skip invalid boundary
    }
  }

  let resolved = 0;
  let broken = 0;
  const linkedFiles = new Set<string>();
  const linkedSymbols = new Set<string>();

  for (const link of links) {
    linkedFiles.add(link.file);
    linkedSymbols.add(`${link.file}:${link.symbol}`);

    const search = ctx.gildash!.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (!Array.isArray(search)) {
      broken++;
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file);
    if (found) resolved++;
    else broken++;
  }

  // Find unreferenced symbols in linked files
  // Symbols in boundary-matched files are considered covered (excluded from unreferenced)
  const unreferenced: LinkCoverageResult['unreferenced'] = [];
  for (const file of linkedFiles) {
    // Skip files matching coverageIgnore patterns
    let ignored = false;
    for (const pattern of ctx.coverageIgnore) {
      const glob = new Bun.Glob(pattern);
      if (glob.match(file)) {
        ignored = true;
        break;
      }
    }
    if (ignored) continue;

    // Symbols in boundary-covered files are considered covered
    if (boundaryFiles.has(file)) continue;

    const fileSymbols = ctx.gildash!.getSymbolsByFile(file);
    if (!fileSymbols) continue;
    for (const sym of fileSymbols) {
      const key = `${file}:${sym.name}`;
      if (!linkedSymbols.has(key)) {
        unreferenced.push({ file, symbol: sym.name, kind: sym.kind });
      }
    }
  }

  return {
    declared: links.length,
    resolved,
    broken,
    coverage: links.length > 0 ? resolved / links.length : 1,
    unreferenced,
  };
}

// ── Uncovered symbols ──

export interface UncoveredSymbol {
  file: string;
  symbol: string;
  kind: string;
  exportType: string;
}

export interface UncoveredResult {
  totalSymbols: number;
  coveredSymbols: number;
  uncovered: UncoveredSymbol[];
  coverageRatio: number;
}

export interface GetUncoveredSymbolsOptions {
  files?: string[];
  kinds?: string[];
  exportedOnly?: boolean;
  excludePatterns?: string[];
}

/**
 * Find symbols not linked to any card via codeLinks or boundary.
 *
 * Returns all gildash-indexed symbols that are not covered by any card's
 * codeLinks or boundary globs. Applies coverageIgnore + excludePatterns
 * to filter out files that should be excluded.
 */
export async function getUncoveredSymbols(
  ctx: EmberdeckContext,
  options?: GetUncoveredSymbolsOptions,
): Promise<UncoveredResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  const files = options?.files;
  const kinds = options?.kinds;
  const exportedOnly = options?.exportedOnly ?? false;
  const excludePatterns = options?.excludePatterns ?? [];

  // Merge coverageIgnore + excludePatterns
  const ignorePatterns = [...ctx.coverageIgnore, ...excludePatterns];

  // Build set of covered symbol keys: "file:symbol"
  const coveredKeys = new Set<string>();

  // 1. Collect all codeLink-covered symbols
  const allCards = ctx.cardRepo.list();
  for (const card of allCards) {
    const links = ctx.codeLinkRepo.findByCardKey(card.key);
    for (const link of links) {
      coveredKeys.add(`${link.file}:${link.symbol}`);
    }
  }

  // 2. Collect boundary-covered files
  const boundaryFiles = new Set<string>();
  if (ctx.projectRoot) {
    for (const card of allCards) {
      if (!card.boundaryJson) continue;
      try {
        const boundary: string[] = JSON.parse(card.boundaryJson);
        if (!Array.isArray(boundary)) continue;
        for (const pattern of boundary) {
          const glob = new Bun.Glob(pattern);
          for (const file of glob.scanSync({ cwd: ctx.projectRoot })) {
            boundaryFiles.add(file);
          }
        }
      } catch {
        // skip invalid boundary
      }
    }
  }

  // 3. Determine target files
  let targetFiles: string[];
  if (files) {
    targetFiles = files;
  } else {
    const indexed = ctx.gildash.listIndexedFiles();
    targetFiles = indexed.map((f) => {
      if (ctx.projectRoot && f.filePath.startsWith(ctx.projectRoot)) {
        return relative(ctx.projectRoot, f.filePath);
      }
      return f.filePath;
    });
  }

  // 4. Filter out ignored files
  targetFiles = targetFiles.filter((file) => {
    for (const pattern of ignorePatterns) {
      const glob = new Bun.Glob(pattern);
      if (glob.match(file)) return false;
    }
    return true;
  });

  // 5. Collect uncovered symbols
  let totalSymbols = 0;
  const uncovered: UncoveredSymbol[] = [];

  for (const file of targetFiles) {
    const absPath = ctx.projectRoot ? join(ctx.projectRoot, file) : file;
    const symbols = ctx.gildash.getSymbolsByFile(absPath);
    if (!symbols || !Array.isArray(symbols)) continue;

    for (const sym of symbols) {
      // Apply kind filter
      if (kinds && kinds.length > 0 && !kinds.includes(sym.kind)) continue;
      // Apply export filter
      if (exportedOnly && !sym.isExported) continue;

      totalSymbols++;

      const symFile = ctx.projectRoot && sym.filePath.startsWith(ctx.projectRoot)
        ? relative(ctx.projectRoot, sym.filePath)
        : sym.filePath;

      // Check if covered by codeLink
      if (coveredKeys.has(`${symFile}:${sym.name}`)) continue;
      // Check if covered by boundary
      if (boundaryFiles.has(symFile)) continue;

      uncovered.push({
        file: symFile,
        symbol: sym.name,
        kind: sym.kind,
        exportType: sym.isExported ? 'exported' : 'internal',
      });
    }
  }

  const coveredSymbols = totalSymbols - uncovered.length;

  return {
    totalSymbols,
    coveredSymbols,
    uncovered,
    coverageRatio: totalSymbols > 0 ? coveredSymbols / totalSymbols : 1,
  };
}

// ── Suggest card scope ──

export interface CardSuggestion {
  suggestedKey: string;
  type: 'architecture' | 'spec';
  parent?: string;
  files: string[];
  boundary: string[];
  symbols: Array<{ file: string; symbol: string; kind: string }>;
  reason: string;
}

export interface SuggestCardScopeOptions {
  path?: string;
  maxDepth?: number;
}

/**
 * Analyze directory structure and symbols to suggest card creation units.
 *
 * Looks at directories with symbols not covered by existing cards,
 * and suggests architecture cards for directories or spec cards for modules.
 */
export async function suggestCardScope(
  ctx: EmberdeckContext,
  options?: SuggestCardScopeOptions,
): Promise<CardSuggestion[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  const basePath = options?.path ?? '';
  const maxDepth = options?.maxDepth ?? 3;

  // Get uncovered symbols (handles ensureReindexed internally)
  const uncoveredResult = await getUncoveredSymbols(ctx);
  const uncoveredByDir = new Map<string, UncoveredSymbol[]>();

  // Normalize basePath for prefix matching (ensure trailing /)
  const basePrefix = basePath ? (basePath.endsWith('/') ? basePath : basePath + '/') : '';

  for (const sym of uncoveredResult.uncovered) {
    // Filter by basePath: file must be under basePath directory
    if (basePrefix && !sym.file.startsWith(basePrefix)) continue;

    const dir = dirname(sym.file);
    const existing = uncoveredByDir.get(dir) ?? [];
    existing.push(sym);
    uncoveredByDir.set(dir, existing);
  }

  // Check depth relative to basePath
  function getDepth(dir: string): number {
    const rel = basePath ? relative(basePath, dir) : dir;
    if (rel === '' || rel === '.') return 0;
    return rel.split('/').length;
  }

  // Cache card list (single query)
  const allCards = ctx.cardRepo.list();
  const existingKeys = new Set(allCards.map((c) => c.key));

  // Build existing boundary globs for overlap check
  const existingBoundaryGlobs: Bun.Glob[] = [];
  for (const card of allCards) {
    if (!card.boundaryJson) continue;
    try {
      const boundary: string[] = JSON.parse(card.boundaryJson);
      if (Array.isArray(boundary)) {
        for (const pattern of boundary) {
          existingBoundaryGlobs.push(new Bun.Glob(pattern));
        }
      }
    } catch {
      // skip
    }
  }

  const suggestions: CardSuggestion[] = [];

  for (const [dir, symbols] of uncoveredByDir) {
    const depth = getDepth(dir);
    if (depth > maxDepth) continue;

    // Determine suggested key from directory name
    const keyParts = dir.split('/').filter(Boolean);
    const suggestedKey = keyParts.length > 0 ? keyParts.join('/') : 'root';

    // Skip if a card with this key already exists
    if (existingKeys.has(suggestedKey)) continue;

    // Skip if this directory is already covered by an existing boundary glob
    // (check a representative file from the dir against all boundary patterns)
    const sampleFile = symbols[0]?.file;
    if (sampleFile) {
      let covered = false;
      for (const glob of existingBoundaryGlobs) {
        if (glob.match(sampleFile)) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
    }

    // Collect unique files in this directory
    const files = [...new Set(symbols.map((s) => s.file))];

    // Determine type: directory-level = architecture, single-file/module = spec
    const isArchitecture = files.length > 1;

    // Find parent suggestion: nearest ancestor directory with a card
    let parent: string | undefined;
    for (let i = keyParts.length - 1; i >= 1; i--) {
      const ancestorKey = keyParts.slice(0, i).join('/');
      if (existingKeys.has(ancestorKey)) {
        parent = ancestorKey;
        break;
      }
    }

    suggestions.push({
      suggestedKey,
      type: isArchitecture ? 'architecture' : 'spec',
      ...(parent ? { parent } : {}),
      files,
      boundary: [dir + '/**'],
      symbols: symbols.map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind })),
      reason: isArchitecture
        ? `Directory ${dir} has ${symbols.length} uncovered symbols across ${files.length} files`
        : `Module ${files[0]} has ${symbols.length} uncovered symbols`,
    });
  }

  return suggestions;
}
