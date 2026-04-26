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
  /** Number of orphan @spec annotations removed from source files. */
  removed: number;
}

/**
 * Reconcile @spec annotations in source files with DB codeLinks.
 *
 * Four-step reconciler:
 *   STEP 1 — SCAN: collect all @spec annotations from source via gildash
 *   STEP 2 — BUILD: construct desired set from DB codeLinks
 *   STEP 3 — REMOVE: delete @spec annotations in source but not in desired
 *   STEP 4 — ADD: insert @spec annotations in desired but not in source
 *
 * When cardKey is provided, only that card's codeLinks are in the desired set,
 * and only that card's orphan @spec annotations are removed.
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
  let removed = 0;

  // ── STEP 1: SCAN — collect actual @spec annotations from source ──

  interface ActualEntry { cardKey: string; file: string; symbol: string }
  const actualEntries: ActualEntry[] = [];

  const annotations = ctx.gildash.searchAnnotations({ tag: 'spec', limit: 10000 });
  for (const ann of annotations) {
    const key = ann.value.trim();
    if (!key || !ann.symbolName) continue;
    // When scoped to a single card, only collect that card's annotations
    if (cardKey && key !== cardKey) continue;
    actualEntries.push({
      cardKey: key,
      file: ann.filePath,
      symbol: ann.symbolName,
    });
  }

  const actualSet = new Set(actualEntries.map((e) => `${e.cardKey}:${e.file}:${e.symbol}`));

  // ── STEP 2: BUILD — construct desired set from DB codeLinks ──

  interface DesiredEntry { cardKey: string; file: string; symbol: string }
  const desiredEntries: DesiredEntry[] = [];

  if (cardKey) {
    const links = ctx.codeLinkRepo.findByCardKey(cardKey);
    for (const link of links) {
      desiredEntries.push({ cardKey, file: link.file, symbol: link.symbol });
    }
  } else {
    const allCards = ctx.cardRepo.list();
    for (const card of allCards) {
      const links = ctx.codeLinkRepo.findByCardKey(card.key);
      for (const link of links) {
        desiredEntries.push({ cardKey: card.key, file: link.file, symbol: link.symbol });
      }
    }
  }

  const desiredSet = new Set(desiredEntries.map((e) => `${e.cardKey}:${e.file}:${e.symbol}`));

  // ── STEP 3: REMOVE — delete orphan @spec from source ──

  // Group orphans by file for batched removal
  const orphansByFile = new Map<string, Array<{ cardKey: string; symbol: string }>>();
  for (const actual of actualEntries) {
    const key = `${actual.cardKey}:${actual.file}:${actual.symbol}`;
    if (!desiredSet.has(key)) {
      const list = orphansByFile.get(actual.file) ?? [];
      list.push({ cardKey: actual.cardKey, symbol: actual.symbol });
      orphansByFile.set(actual.file, list);
    }
  }

  for (const [filePath, orphans] of orphansByFile) {
    const absPath = join(ctx.projectRoot!, filePath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      continue;
    }

    const lines = content.split('\n');
    let fileModified = false;
    const orphanPatterns = new Set(orphans.map((o) => `@spec ${o.cardKey}`));

    // Scan lines bottom-to-top to remove @spec lines without index shifting issues
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim();

      // Check if this line contains an orphan @spec
      let matchedPattern: string | undefined;
      for (const pattern of orphanPatterns) {
        if (trimmed.includes(pattern)) {
          matchedPattern = pattern;
          break;
        }
      }
      if (!matchedPattern) continue;

      // Case 1: standalone single-line JSDoc  /** @spec card-key */
      if (/^\/\*\*\s*@spec\s+\S+\s*\*\/$/.test(trimmed)) {
        lines.splice(i, 1);
        // Remove trailing blank line if it creates consecutive blanks
        if (i < lines.length && i > 0 && lines[i - 1]!.trim() === '' && lines[i]!.trim() === '') {
          lines.splice(i, 1);
        }
        fileModified = true;
        removed++;
        continue;
      }

      // Case 2: @spec line inside multi-line JSDoc  ( * @spec card-key)
      if (/^\*\s*@spec\s+\S+$/.test(trimmed)) {
        // Check if removing this line leaves a JSDoc block with no content
        // Find the JSDoc block boundaries
        let blockStart = i;
        while (blockStart > 0 && !lines[blockStart]!.trim().startsWith('/**')) {
          blockStart--;
        }
        let blockEnd = i;
        while (blockEnd < lines.length - 1 && !lines[blockEnd]!.trim().endsWith('*/')) {
          blockEnd++;
        }

        // Check if removing this line leaves the block empty (only /** and */)
        const remainingContent: string[] = [];
        for (let j = blockStart; j <= blockEnd; j++) {
          if (j === i) continue; // skip the line we're removing
          const t = lines[j]!.trim();
          if (t === '/**' || t === '*/' || t === '*' || t === '') continue;
          remainingContent.push(t);
        }

        if (remainingContent.length === 0) {
          // JSDoc block becomes empty — remove entire block
          lines.splice(blockStart, blockEnd - blockStart + 1);
          // Clean up consecutive blank lines
          if (blockStart < lines.length && blockStart > 0 &&
              lines[blockStart - 1]!.trim() === '' && lines[blockStart]?.trim() === '') {
            lines.splice(blockStart, 1);
          }
        } else {
          // Just remove the @spec line
          lines.splice(i, 1);
        }
        fileModified = true;
        removed++;
        continue;
      }
    }

    if (fileModified) {
      await Bun.write(absPath, lines.join('\n'));
    }
  }

  // ── STEP 4: ADD — insert missing @spec into source ──

  // Re-read source after removals and rebuild actual set
  // (removal may have changed line numbers, so we re-scan)
  if (removed > 0) {
    await ensureReindexed(ctx);
  }

  // Collect entries to add, count already-present
  const toAdd: DesiredEntry[] = [];
  for (const desired of desiredEntries) {
    const key = `${desired.cardKey}:${desired.file}:${desired.symbol}`;
    if (!actualSet.has(key) || orphansByFile.has(desired.file)) {
      // Need to re-check after removals, or was never present
      toAdd.push(desired);
    } else {
      // In desired AND in actual AND not in an orphan-modified file → already present
      alreadyPresent++;
    }
  }

  // Group by file
  const addByFile = new Map<string, DesiredEntry[]>();
  for (const entry of toAdd) {
    const list = addByFile.get(entry.file) ?? [];
    list.push(entry);
    addByFile.set(entry.file, list);
  }

  for (const [filePath, fileEntries] of addByFile) {
    interface InsertTarget { cardKey: string; line: number }
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

    const absPath = join(ctx.projectRoot!, filePath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      symbolNotFound += targets.length;
      continue;
    }

    const lines = content.split('\n');
    let modified = false;

    // Sort targets by line descending
    targets.sort((a, b) => b.line - a.line || a.cardKey.localeCompare(b.cardKey));

    // Group by line
    const groupedByLine = new Map<number, InsertTarget[]>();
    for (const target of targets) {
      const group = groupedByLine.get(target.line) ?? [];
      group.push(target);
      groupedByLine.set(target.line, group);
    }

    const sortedLines = [...groupedByLine.keys()].sort((a, b) => b - a);

    for (const lineNum of sortedLines) {
      const group = groupedByLine.get(lineNum)!;
      const symLineIdx = lineNum - 1;

      if (symLineIdx < 0 || symLineIdx >= lines.length) {
        symbolNotFound += group.length;
        continue;
      }

      const toInsert: InsertTarget[] = [];
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
        const symLine = lines[symLineIdx]!;
        const indentMatch = symLine.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        if (specTags.length === 1) {
          lines.splice(symLineIdx, 0, `${indent}/** ${specTags[0]} */`);
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

  return { annotated, alreadyPresent, symbolNotFound, removed };
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
  type: 'brief' | 'spec';
  parent?: string;
  files: string[];
  boundary: string[];
  symbols: Array<{ file: string; symbol: string; kind: string }>;
  reason: string;
  /** Glossary words from the project glossary that appear in this scope's symbols/paths. */
  suggestedGlossary?: string[];
}

export interface SuggestCardScopeOptions {
  path?: string;
  maxDepth?: number;
}

/**
 * Analyze directory structure and symbols to suggest card creation units.
 *
 * Looks at directories with symbols not covered by existing cards,
 * and suggests brief cards for directories or spec cards for modules.
 */
export async function suggestCardScope(
  ctx: EmberdeckContext,
  options?: SuggestCardScopeOptions,
): Promise<CardSuggestion[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  const basePath = options?.path ?? '';
  const maxDepth = options?.maxDepth ?? 3;

  // Build glossary matcher for suggestedGlossary
  const { readGlossary } = await import('../glossary/io');
  const { buildGlossaryMatcher } = await import('../glossary/cross-validate');
  const glossaryEntries = readGlossary(ctx);
  const glossaryMatcher = buildGlossaryMatcher(glossaryEntries);

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

    // Determine type: directory-level = brief, single-file/module = spec
    const isBrief = files.length > 1;

    // Find parent suggestion: nearest ancestor directory with a card
    let parent: string | undefined;
    for (let i = keyParts.length - 1; i >= 1; i--) {
      const ancestorKey = keyParts.slice(0, i).join('/');
      if (existingKeys.has(ancestorKey)) {
        parent = ancestorKey;
        break;
      }
    }

    // Match glossary words against symbol names and file paths in this scope
    const scopeText = [
      ...symbols.map((s) => s.symbol),
      ...files,
    ].join(' ');
    const matchedGlossary = glossaryMatcher(scopeText);

    suggestions.push({
      suggestedKey,
      type: isBrief ? 'brief' : 'spec',
      ...(parent ? { parent } : {}),
      files,
      boundary: [dir + '/**'],
      symbols: symbols.map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind })),
      reason: isBrief
        ? `Directory ${dir} has ${symbols.length} uncovered symbols across ${files.length} files`
        : `Module ${files[0]} has ${symbols.length} uncovered symbols`,
      ...(matchedGlossary.size > 0 ? { suggestedGlossary: [...matchedGlossary] } : {}),
    });
  }

  return suggestions;
}
