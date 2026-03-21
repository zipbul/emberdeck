import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import { GildashNotConfiguredError } from '../card/errors';
import { ensureReindexed } from './link';

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
