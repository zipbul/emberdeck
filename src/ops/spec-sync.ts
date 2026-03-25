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

// ── Write @spec annotations into source files ──

export interface WriteSpecResult {
  /** Number of annotations inserted into source files. */
  annotated: number;
  /** Number of symbols that already had the @spec annotation. */
  alreadyPresent: number;
  /** Number of code links whose symbol could not be found in gildash. */
  symbolNotFound: number;
}

/**
 * Write `@spec card-key` annotations into source files for code links that lack them.
 *
 * For each code link, looks up the symbol position via gildash, reads the source file,
 * and inserts a `/** @spec card-key *​/` comment above the symbol declaration — or adds
 * an `@spec card-key` tag inside an existing JSDoc block.
 */
export async function writeSpecAnnotations(
  ctx: EmberdeckContext,
  cardKey?: string,
): Promise<WriteSpecResult> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();
  if (!ctx.projectRoot) throw new GildashNotConfiguredError();

  await ensureReindexed(ctx);

  let annotated = 0;
  let alreadyPresent = 0;
  let symbolNotFound = 0;

  // Collect code links to process
  interface LinkEntry { cardKey: string; file: string; symbol: string }
  const entries: LinkEntry[] = [];

  if (cardKey) {
    const links = ctx.codeLinkRepo.findByCardKey(cardKey);
    for (const link of links) {
      entries.push({ cardKey, file: link.file, symbol: link.symbol });
    }
  } else {
    const allCards = ctx.cardRepo.list();
    for (const card of allCards) {
      const links = ctx.codeLinkRepo.findByCardKey(card.key);
      for (const link of links) {
        entries.push({ cardKey: card.key, file: link.file, symbol: link.symbol });
      }
    }
  }

  // Group entries by file to batch reads/writes
  const byFile = new Map<string, LinkEntry[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }

  for (const [filePath, fileEntries] of byFile) {
    // Resolve symbol positions and collect insert targets
    interface InsertTarget {
      cardKey: string;
      line: number; // 1-based line of the symbol declaration
    }
    const targets: InsertTarget[] = [];

    for (const entry of fileEntries) {
      const results = ctx.gildash!.searchSymbols({
        text: entry.symbol,
        exact: true,
        filePath: entry.file,
      });

      if (!Array.isArray(results)) {
        symbolNotFound++;
        continue;
      }

      const match = results.find(
        (s) => s.name === entry.symbol && s.filePath === entry.file,
      );
      if (!match) {
        symbolNotFound++;
        continue;
      }

      targets.push({ cardKey: entry.cardKey, line: match.span.start.line });
    }

    if (targets.length === 0) continue;

    // Read the source file
    const absPath = join(ctx.projectRoot!, filePath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      // File not readable — count all targets as not found
      symbolNotFound += targets.length;
      continue;
    }

    const lines = content.split('\n');
    let modified = false;

    // Sort targets by line descending, stable sort by cardKey for same line
    targets.sort((a, b) => b.line - a.line || a.cardKey.localeCompare(b.cardKey));

    // Group targets by line so same-line targets are inserted in a single splice
    const groupedByLine = new Map<number, typeof targets>();
    for (const target of targets) {
      const group = groupedByLine.get(target.line) ?? [];
      group.push(target);
      groupedByLine.set(target.line, group);
    }

    // Process groups in descending line order
    const sortedLines = [...groupedByLine.keys()].sort((a, b) => b - a);

    for (const lineNum of sortedLines) {
      const group = groupedByLine.get(lineNum)!;
      const symLineIdx = lineNum - 1; // 0-based

      if (symLineIdx < 0 || symLineIdx >= lines.length) {
        symbolNotFound += group.length;
        continue;
      }

      // Filter out already-present specs and capture jsdocRange from first non-present scan
      const toInsert: typeof targets = [];
      let jsdocRange: { start: number; end: number } | null = null;
      let jsdocRangeDetected = false;
      for (const target of group) {
        const result = scanAbove(lines, symLineIdx, target.cardKey);
        if (result.hasSpec) {
          alreadyPresent++;
        } else {
          toInsert.push(target);
          if (!jsdocRangeDetected) {
            jsdocRange = result.jsdocRange;
            jsdocRangeDetected = true;
          }
        }
      }
      if (toInsert.length === 0) continue;

      const specTags = toInsert.map((t) => `@spec ${t.cardKey}`);

      if (jsdocRange) {
        if (jsdocRange.start === jsdocRange.end) {
          // Single-line JSDoc: /** some doc */ → expand to multi-line with all @spec tags
          const oldLine = lines[jsdocRange.start]!;
          const indentMatch = oldLine.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : '';
          const innerMatch = oldLine.match(/\/\*\*\s*(.*?)\s*\*\//);
          const inner = innerMatch ? innerMatch[1] : '';
          const expanded = [
            `${indent}/**`,
            ...(inner ? [`${indent} * ${inner}`] : []),
            ...specTags.map((tag) => `${indent} * ${tag}`),
            `${indent} */`,
          ];
          lines.splice(jsdocRange.start, 1, ...expanded);
        } else {
          // Multi-line JSDoc: insert all @spec tags before closing */
          const closingIdx = jsdocRange.end;
          const closingLine = lines[closingIdx]!;
          const indentMatch = closingLine.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : '';
          const newTags = specTags.map((tag) => `${indent} * ${tag}`);
          lines.splice(closingIdx, 0, ...newTags);
        }
        modified = true;
        annotated += toInsert.length;
      } else {
        // Insert a standalone multi-spec comment above the symbol
        const symLine = lines[symLineIdx]!;
        const indentMatch = symLine.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        if (specTags.length === 1) {
          const comment = `${indent}/** ${specTags[0]} */`;
          lines.splice(symLineIdx, 0, comment);
        } else {
          const comment = [
            `${indent}/**`,
            ...specTags.map((tag) => `${indent} * ${tag}`),
            `${indent} */`,
          ];
          lines.splice(symLineIdx, 0, ...comment);
        }
        modified = true;
        annotated += toInsert.length;
      }
    }

    if (modified) {
      await Bun.write(absPath, lines.join('\n'));
    }
  }

  return { annotated, alreadyPresent, symbolNotFound };
}

/**
 * Scan lines above a symbol declaration for JSDoc blocks and existing @spec annotations.
 *
 * Returns whether a matching @spec tag already exists, and the range (start/end 0-based
 * line indices) of an existing JSDoc block if one is found directly above the symbol.
 */
function scanAbove(
  lines: string[],
  symLineIdx: number,
  cardKey: string,
): { hasSpec: boolean; jsdocRange: { start: number; end: number } | null } {
  const specPattern = `@spec ${cardKey}`;

  // Walk upward from the line before the symbol
  let idx = symLineIdx - 1;

  // Skip blank lines between symbol and potential comment
  while (idx >= 0 && lines[idx]!.trim() === '') {
    idx--;
  }

  if (idx < 0) return { hasSpec: false, jsdocRange: null };

  const line = lines[idx]!.trim();

  // Case 1: Single-line JSDoc  /** ... */
  if (line.startsWith('/**') && line.endsWith('*/')) {
    if (line.includes(specPattern)) {
      return { hasSpec: true, jsdocRange: null };
    }
    // There is a single-line JSDoc but no @spec — we need to expand it to multi-line
    // or insert before it. Treat it as a JSDoc range for insertion.
    return { hasSpec: false, jsdocRange: { start: idx, end: idx } };
  }

  // Case 2: Multi-line JSDoc ending with */
  if (line.endsWith('*/')) {
    const endIdx = idx;
    // Find the opening /**
    while (idx >= 0) {
      if (lines[idx]!.trim().startsWith('/**')) {
        break;
      }
      idx--;
    }

    if (idx >= 0 && lines[idx]!.trim().startsWith('/**')) {
      // Check if @spec already exists in this block
      for (let i = idx; i <= endIdx; i++) {
        if (lines[i]!.includes(specPattern)) {
          return { hasSpec: true, jsdocRange: null };
        }
      }
      return { hasSpec: false, jsdocRange: { start: idx, end: endIdx } };
    }
  }

  // Case 3: Standalone // @spec comment or /** @spec */ on the line above
  if (line.includes(specPattern)) {
    return { hasSpec: true, jsdocRange: null };
  }

  return { hasSpec: false, jsdocRange: null };
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
 * unreferenced symbols in the same files. Applies ignorePatterns
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
    // Skip files matching ignorePatterns patterns
    let ignored = false;
    for (const pattern of ctx.ignorePatterns) {
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
 * codeLinks or boundary globs. Applies ignorePatterns + excludePatterns
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

  // Merge ignorePatterns + excludePatterns
  const ignorePatterns = [...ctx.ignorePatterns, ...excludePatterns];

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
    // Try relative path first (gildash stores by relative path), fall back to absolute
    let symbols = ctx.gildash.getSymbolsByFile(file);
    if ((!symbols || symbols.length === 0) && ctx.projectRoot) {
      symbols = ctx.gildash.getSymbolsByFile(join(ctx.projectRoot, file));
    }
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
  type: 'intent' | 'spec';
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
 * and suggests intent cards for directories or spec cards for modules.
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

    // Determine type: directory-level = intent, single-file/module = spec
    const isIntent = files.length > 1;

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
      type: isIntent ? 'intent' : 'spec',
      ...(parent ? { parent } : {}),
      files,
      boundary: [dir + '/**'],
      symbols: symbols.map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind })),
      reason: isIntent
        ? `Directory ${dir} has ${symbols.length} uncovered symbols across ${files.length} files`
        : `Module ${files[0]} has ${symbols.length} uncovered symbols`,
    });
  }

  return suggestions;
}
