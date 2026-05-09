import type { EmberdeckContext } from '../config';
import type { CodeLink, CardType } from '../card/types';
import { ensureReindexed, GILDASH_ANNOTATION_LIMIT, gildashProjectNames, makeSymbolFileCache, listAllIndexedFilesWithProject } from './link';
import { parseStringArrayJson } from '../card/json-fields';
import { matchesAnyGlob } from '../util/glob';
import { atomicWrite } from '../fs/writer';
import { join, relative, dirname } from 'node:path';

/**
 * Annotation tags scanned by `syncSpecAnnotations`. Originally only `@spec`
 * was tracked; expanding to all 4 tiers means any card type can be referenced
 * from source via the corresponding tag (e.g. `@brief auth/token`). The card
 * key in the annotation value resolves the target — emberdeck does not enforce
 * that the tag matches the card's type, so authors can use whichever tag fits
 * their narrative (a brief annotation linking to a spec card is allowed).
 */
const TRACKED_ANNOTATION_TAGS = ['spec', 'brief', 'principle', 'domain'] as const;


/**
 * Read all tracked annotation tags and dedupe by (filePath, symbolName, value).
 * Mock implementations sometimes return all annotations regardless of the tag
 * filter, so dedup keeps results stable in tests and harmless in production.
 */
function collectTrackedAnnotations(ctx: EmberdeckContext) {
  const gildash = ctx.gildash;
  const seen = new Set<string>();
  const out: Array<ReturnType<typeof gildash.searchAnnotations>[number]> = [];
  for (const project of gildashProjectNames(ctx)) {
    for (const tag of TRACKED_ANNOTATION_TAGS) {
      try {
        const batch = gildash.searchAnnotations({ tag, project, limit: GILDASH_ANNOTATION_LIMIT });
        for (const ann of batch) {
          const key = `${ann.tag}\0${ann.filePath}\0${ann.symbolName ?? ''}\0${ann.value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(ann);
        }
      } catch {
        // skip project on failure
      }
    }
  }
  return out;
}

// ── @spec/@brief/@principle/@domain annotation sync ──

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
  * @spec code-binding/annotation-roundtrip/annotate-and-sync
 */
export async function syncSpecAnnotations(ctx: EmberdeckContext): Promise<SpecSyncResult> {

  await ensureReindexed(ctx);

  const annotations = collectTrackedAnnotations(ctx);
  const symbolCache = makeSymbolFileCache(ctx)!;
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

  // Group annotations by cardKey so we can do a single replaceForCard per card.
  // Previously N annotations against the same card triggered N replaceForCard
  // calls, each one doing DELETE + INSERT for ALL links — O(N²) DB ops.
  const byCard = new Map<string, typeof annotations>();
  for (const ann of annotations) {
    const cardKey = ann.value.trim();
    if (!cardKey) continue;
    const list = byCard.get(cardKey) ?? [];
    list.push(ann);
    byCard.set(cardKey, list);
  }

  for (const [cardKey, anns] of byCard) {
    const card = ctx.cardRepo.findByKey(cardKey);
    if (!card) {
      for (const ann of anns) {
        if (ann.symbolName) {
          unmatched.push({ cardKey, file: ann.filePath, symbol: ann.symbolName });
        }
      }
      continue;
    }

    const existing = ctx.codeLinkRepo.findByCardKey(cardKey);
    const existingKeys = new Set(existing.map((l) => `${l.file}:${l.symbol}`));
    const additions: CodeLink[] = [];
    let cardCreated = 0;

    for (const ann of anns) {
      if (!ann.symbolName) continue;
      const annKey = `${ann.filePath}:${ann.symbolName}`;
      if (existingKeys.has(annKey)) {
        alreadyLinked++;
        continue;
      }
      // Don't double-add within the same batch (same card, same file/symbol from
      // duplicate annotations).
      if (additions.some((a) => a.file === ann.filePath && a.symbol === ann.symbolName)) {
        continue;
      }

      let kind = 'unknown';
      const match = symbolCache.find(ann.filePath, ann.symbolName);
      if (match) kind = match.kind;

      additions.push({ kind, file: ann.filePath, symbol: ann.symbolName });
      cardCreated++;
      linkMissing.push({ cardKey, file: ann.filePath, symbol: ann.symbolName });
    }

    if (additions.length > 0) {
      const newLinks: CodeLink[] = [
        ...existing.map((l) => ({ kind: l.kind, file: l.file, symbol: l.symbol })),
        ...additions,
      ];
      ctx.codeLinkRepo.replaceForCard(cardKey, newLinks);
      created += cardCreated;
    }
  }

  // Detect marker-missing: code links that have no @spec annotation.
  // Single findAll() instead of N findByCardKey() (was N+1 across cards).
  const markerMissing: SpecSyncResult['markerMissing'] = [];
  for (const link of ctx.codeLinkRepo.findAll()) {
    const annotKey = `${link.cardKey}:${link.file}:${link.symbol}`;
    if (!annotationKeys.has(annotKey)) {
      markerMissing.push({ cardKey: link.cardKey, file: link.file, symbol: link.symbol });
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
  * @spec code-binding/annotation-roundtrip/annotate-and-sync
 */
export async function writeSpecAnnotations(
  ctx: EmberdeckContext,
  cardKey?: string,
  options?: { prune?: boolean },
): Promise<WriteSpecResult> {

  await ensureReindexed(ctx);

  let annotated = 0;
  let alreadyPresent = 0;
  let symbolNotFound = 0;
  let removed = 0;

  // ── STEP 1: SCAN — collect actual @spec annotations from source ──

  interface ActualEntry { cardKey: string; file: string; symbol: string }
  const actualEntries: ActualEntry[] = [];

  const annotations = collectTrackedAnnotations(ctx);
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
    // Single findAll() instead of N findByCardKey() — for projects with many
    // cards this was the dominant cost in `spec annotate`.
    for (const link of ctx.codeLinkRepo.findAll()) {
      desiredEntries.push({ cardKey: link.cardKey, file: link.file, symbol: link.symbol });
    }
  }

  const desiredSet = new Set(desiredEntries.map((e) => `${e.cardKey}:${e.file}:${e.symbol}`));

  // ── STEP 3: REMOVE — delete orphan @spec from source ──
  //
  // Default (prune=false): NEVER remove. Only add missing annotations for
  // cards in DB. Author-written `@spec foo` hints for cards that don't exist
  // yet (fresh-project onboarding) stay intact.
  //
  // prune=true (explicit opt-in via `ed spec annotate --prune`): remove
  // annotations whose (cardKey, file, symbol) is not in the desired set.
  // Use after `ed card delete` / `ed reset` to clean up source.

  const orphansByFile = new Map<string, Array<{ cardKey: string; symbol: string }>>();
  if (options?.prune) {
    for (const actual of actualEntries) {
      const key = `${actual.cardKey}:${actual.file}:${actual.symbol}`;
      if (desiredSet.has(key)) continue;
      const list = orphansByFile.get(actual.file) ?? [];
      list.push({ cardKey: actual.cardKey, symbol: actual.symbol });
      orphansByFile.set(actual.file, list);
    }
  }

  for (const [filePath, orphans] of orphansByFile) {
    const absPath = join(ctx.projectRoot, filePath);
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
      await atomicWrite(absPath, lines.join('\n'));
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

  const writeCache = makeSymbolFileCache(ctx)!;
  for (const [filePath, fileEntries] of addByFile) {
    interface InsertTarget { cardKey: string; line: number }
    const targets: InsertTarget[] = [];

    for (const entry of fileEntries) {
      let match;
      try {
        match = writeCache.find(entry.file, entry.symbol);
      } catch {
        symbolNotFound++;
        continue;
      }
      if (!match) {
        symbolNotFound++;
        continue;
      }

      targets.push({ cardKey: entry.cardKey, line: match.span.start.line });
    }

    if (targets.length === 0) continue;

    const absPath = join(ctx.projectRoot, filePath);
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
      await atomicWrite(absPath, lines.join('\n'));
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
  * @spec code-binding/annotation-roundtrip/annotate-and-sync
 */
export async function syncSymbolChanges(
  ctx: EmberdeckContext,
  since: Date | string,
): Promise<SymbolSyncResult> {

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
  * @spec code-binding/link-and-coverage/coverage
 */
export async function getLinkCoverage(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<LinkCoverageResult> {

  await ensureReindexed(ctx);

  const links = ctx.codeLinkRepo.findByCardKey(fullKey);
  if (links.length === 0) {
    return { declared: 0, resolved: 0, broken: 0, coverage: 1, unreferenced: [] };
  }

  // Collect boundary-covered files for this card. Boundary expansion is done
  // against the gildash index aggregated across ALL projects (monorepo support).
  const indexedFiles = listAllIndexedFilesWithProject(ctx).map((f) => f.filePath);
  const boundaryFiles = new Set<string>();
  const row = ctx.cardRepo.findByKey(fullKey);
  for (const pattern of parseStringArrayJson(row?.boundaryJson)) {
    try {
      const glob = new Bun.Glob(pattern);
      for (const file of indexedFiles) {
        if (glob.match(file)) boundaryFiles.add(file);
      }
    } catch {
      // skip invalid boundary
    }
  }

  const coverageCache = makeSymbolFileCache(ctx)!;
  let resolved = 0;
  let broken = 0;
  const linkedFiles = new Set<string>();
  const linkedSymbols = new Set<string>();

  for (const link of links) {
    linkedFiles.add(link.file);
    linkedSymbols.add(`${link.file}:${link.symbol}`);

    try {
      if (coverageCache.find(link.file, link.symbol)) resolved++;
      else broken++;
    } catch {
      broken++;
    }
  }

  // Find unreferenced symbols in linked files
  // Symbols in boundary-matched files are considered covered (excluded from unreferenced)
  const unreferenced: LinkCoverageResult['unreferenced'] = [];
  for (const file of linkedFiles) {
    if (matchesAnyGlob(file, ctx.ignorePatterns)) continue;

    // Symbols in boundary-covered files are considered covered
    if (boundaryFiles.has(file)) continue;

    const fileSymbols = coverageCache.get(file);
    for (const sym of fileSymbols) {
      // Match by both qualified and unqualified names so class members linked
      // by their bare method name aren't reported as unreferenced.
      const qualifiedKey = `${file}:${sym.name}`;
      const memberKey = sym.memberName ? `${file}:${sym.memberName}` : null;
      if (linkedSymbols.has(qualifiedKey)) continue;
      if (memberKey && linkedSymbols.has(memberKey)) continue;
      unreferenced.push({ file, symbol: sym.name, kind: sym.kind });
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
}

export interface UncoveredResult {
  totalSymbols: number;
  coveredSymbols: number;
  uncovered: UncoveredSymbol[];
  /** `null` when there are no indexed symbols (no information). */
  coverageRatio: number | null;
}

export interface GetUncoveredSymbolsOptions {
  files?: string[];
  kinds?: string[];
  excludePatterns?: string[];
}

/**
 * Find symbols not linked to any card via codeLinks or boundary.
 *
 * Returns all gildash-indexed symbols that are not covered by any card's
 * codeLinks or boundary globs. Applies ignorePatterns + excludePatterns
 * to filter out files that should be excluded.
  * @spec code-binding/link-and-coverage/coverage
 */
export async function getUncoveredSymbols(
  ctx: EmberdeckContext,
  options?: GetUncoveredSymbolsOptions,
): Promise<UncoveredResult> {

  await ensureReindexed(ctx);

  const files = options?.files;
  const kinds = options?.kinds;
  const excludePatterns = options?.excludePatterns ?? [];

  // Merge ignorePatterns + excludePatterns
  const ignorePatterns = [...ctx.ignorePatterns, ...excludePatterns];

  // Build set of covered symbol keys: "file:symbol"
  const coveredKeys = new Set<string>();

  // 1. Collect all codeLink-covered symbols (single bulk read).
  for (const link of ctx.codeLinkRepo.findAll()) {
    coveredKeys.add(`${link.file}:${link.symbol}`);
  }
  const allCards = ctx.cardRepo.list();

  // 2. Indexed files aggregated across all gildash projects (monorepo support).
  // Carry project attribution so per-file getSymbolsByFile queries below route
  // to the correct project (gildash defaults to primary, missing 99% in monorepos).
  const toRelative = (p: string): string => {
    if (p.startsWith(ctx.projectRoot + '/')) {
      return p.slice(ctx.projectRoot.length + 1);
    }
    return p;
  };
  const indexedWithProject = listAllIndexedFilesWithProject(ctx).map((f) => ({
    filePath: toRelative(f.filePath),
    project: f.project,
  }));
  const indexedFilePaths = indexedWithProject.map((f) => f.filePath);
  // file → project lookup for routed getSymbolsByFile calls
  const fileToProject = new Map<string, string | undefined>();
  for (const f of indexedWithProject) fileToProject.set(f.filePath, f.project);

  // 3. Collect boundary-covered files (matched against the gildash index).
  const boundaryFiles = new Set<string>();
  for (const card of allCards) {
    for (const pattern of parseStringArrayJson(card.boundaryJson)) {
      try {
        const glob = new Bun.Glob(pattern);
        for (const file of indexedFilePaths) {
          if (glob.match(file)) boundaryFiles.add(file);
        }
      } catch {
        // skip invalid boundary
      }
    }
  }

  // 4. Determine target files (caller-provided or all indexed)
  let targetFiles: string[] = files ?? indexedFilePaths;

  // 5. Filter out ignored files
  targetFiles = targetFiles.filter((file) => !matchesAnyGlob(file, ignorePatterns));

  // 6. Collect uncovered symbols
  let totalSymbols = 0;
  const uncovered: UncoveredSymbol[] = [];

  for (const file of targetFiles) {
    // Route to the correct project (monorepo support); default-arg call only
    // sees primary project. Fallback to absolute path for mock fixtures.
    const project = fileToProject.get(file);
    const primary = project
      ? ctx.gildash.getSymbolsByFile(file, project)
      : ctx.gildash.getSymbolsByFile(file);
    const symbols = primary.length === 0
      ? ctx.gildash.getSymbolsByFile(join(ctx.projectRoot, file))
      : primary;
    if (symbols.length === 0) continue;

    for (const sym of symbols) {
      // Apply kind filter
      if (kinds && kinds.length > 0 && !kinds.includes(sym.kind)) continue;

      totalSymbols++;

      const symFile = toRelative(sym.filePath);

      // Check if covered by codeLink (qualified or unqualified name).
      if (coveredKeys.has(`${symFile}:${sym.name}`)) continue;
      if (sym.memberName && coveredKeys.has(`${symFile}:${sym.memberName}`)) continue;
      // Check if covered by boundary
      if (boundaryFiles.has(symFile)) continue;

      uncovered.push({
        file: symFile,
        symbol: sym.name,
        kind: sym.kind,
      });
    }
  }

  const coveredSymbols = totalSymbols - uncovered.length;

  return {
    totalSymbols,
    coveredSymbols,
    uncovered,
    // `null` distinguishes "no symbols yet" from "0% covered". Callers (analyze)
    // surface this so agents don't conflate "set up cards first" with "drift everywhere".
    coverageRatio: totalSymbols > 0 ? coveredSymbols / totalSymbols : null,
  };
}

// ── Suggest card scope ──

export interface CardSuggestion {
  suggestedKey: string;
  type: 'domain' | 'brief' | 'spec';
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
 * and suggests cards per 4-tier:
 *   - single-file scope                  → spec
 *   - directory + domain ancestor        → brief (parent=domain)
 *   - directory + no domain ancestor     → domain (new root-level bounded context)
  * @spec code-binding/link-and-coverage/coverage
 */
export async function suggestCardScope(
  ctx: EmberdeckContext,
  options?: SuggestCardScopeOptions,
): Promise<CardSuggestion[]> {

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
  const existingTypeByKey = new Map<string, CardType>(
    allCards.map((c) => [c.key, c.type as CardType]),
  );

  // Build existing boundary globs for overlap check
  const existingBoundaryGlobs: Bun.Glob[] = [];
  for (const card of allCards) {
    for (const pattern of parseStringArrayJson(card.boundaryJson)) {
      existingBoundaryGlobs.push(new Bun.Glob(pattern));
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

    // Find parent suggestion + its type: nearest ancestor directory with a card
    let parent: string | undefined;
    let parentType: CardType | undefined;
    for (let i = keyParts.length - 1; i >= 1; i--) {
      const ancestorKey = keyParts.slice(0, i).join('/');
      if (existingKeys.has(ancestorKey)) {
        parent = ancestorKey;
        parentType = existingTypeByKey.get(ancestorKey);
        break;
      }
    }

    // Determine type per 4-tier rules:
    //   - single-file scope                 → spec  (parent must be brief or spec)
    //   - directory scope, has domain parent → brief (brief.parent = domain)
    //   - directory scope, no card ancestor  → domain (root-level new bounded context)
    //   - directory scope, non-domain ancestor → still suggest domain at this dir
    //     (the existing brief/spec ancestor isn't a valid domain parent)
    let suggestedType: 'domain' | 'brief' | 'spec';
    if (files.length === 1) {
      suggestedType = 'spec';
    } else if (parentType === 'domain') {
      suggestedType = 'brief';
    } else {
      suggestedType = 'domain';
      // domain is root-level; clear any non-domain inferred parent
      parent = undefined;
    }

    // Match glossary words against symbol names and file paths in this scope
    const scopeText = [
      ...symbols.map((s) => s.symbol),
      ...files,
    ].join(' ');
    const matchedGlossary = glossaryMatcher(scopeText);

    suggestions.push({
      suggestedKey,
      type: suggestedType,
      ...(parent ? { parent } : {}),
      files,
      boundary: [dir + '/**'],
      symbols: symbols.map((s) => ({ file: s.file, symbol: s.symbol, kind: s.kind })),
      reason:
        suggestedType === 'spec'
          ? `Module ${files[0]} has ${symbols.length} uncovered symbols`
          : suggestedType === 'brief'
            ? `Directory ${dir} has ${symbols.length} uncovered symbols across ${files.length} files (parent domain: ${parent})`
            : `Top-level directory ${dir} has ${symbols.length} uncovered symbols across ${files.length} files (suggest as new domain)`,
      ...(matchedGlossary.size > 0 ? { suggestedGlossary: [...matchedGlossary] } : {}),
    });
  }

  return suggestions;
}
