import type { EmberdeckContext } from '../config';
import type { CodeLink, CardType } from '../card/types';
import { ensureReindexed, GILDASH_ANNOTATION_LIMIT, gildashProjectNames, makeSymbolFileCache, listAllIndexedFilesWithProject } from './link';
import { matchesAnyGlob } from '../util/glob';
import { readGlossary } from '../glossary/io';
import { buildGlossaryMatcher } from '../glossary/cross-validate';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';
import { join, relative, dirname } from 'node:path';

/**
 * Annotation tags scanned by `syncSpecAnnotations`. ONLY `@spec` binds code to
 * cards (`source-as-binding-sot`: spec cards are the only code-bound tier;
 * principle/brief/domain/vision govern the card graph, they do not bind to
 * source). A previous "@brief/@principle/@domain" multi-tier expansion was a
 * distortion of that core rule and has been removed.
 *
 * Exported so the CLI validate path uses the same single-source tag list.
 */
export const TRACKED_ANNOTATION_TAGS = ['spec'] as const;


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

// ── annotation sync (@\spec / @\brief / @\principle / @\domain) ──

export interface SpecSyncResult {
  /** Number of code links auto-created from @\spec annotations. */
  created: number;
  /** Number of @\spec annotations that matched an existing code link (skipped). */
  alreadyLinked: number;
  /** Annotations that could not be linked (no card found for the spec key). */
  unmatched: Array<{ cardKey: string; file: string; symbol: string }>;
  /**
   * Annotations naming an existing card of a non-spec type. Only spec cards
   * bind to code (@spec), so these are surfaced as violations and never linked.
   */
  nonSpecTargets: Array<{ cardKey: string; cardType: string; file: string; symbol: string }>;
  /** Code links that exist but have no corresponding @\spec annotation in source. */
  markerMissing: Array<{ cardKey: string; file: string; symbol: string }>;
  /** Annotations found but code link not registered (subset of created, informational). */
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

  await ensureReindexed(ctx);

  const annotations = collectTrackedAnnotations(ctx);
  const symbolCache = makeSymbolFileCache(ctx);
  let created = 0;
  let alreadyLinked = 0;
  const unmatched: SpecSyncResult['unmatched'] = [];
  const nonSpecTargets: SpecSyncResult['nonSpecTargets'] = [];
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
    // Doctrine gate: only spec cards bind to code. An annotation resolving to
    // any other card type is surfaced as a violation and never linked —
    // otherwise the link would attach to a non-spec card and stay invisible
    // to `validate links` (which iterates spec cards only) forever.
    if (card.type !== 'spec') {
      for (const ann of anns) {
        if (ann.symbolName) {
          nonSpecTargets.push({ cardKey, cardType: card.type, file: ann.filePath, symbol: ann.symbolName });
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
      ctx.db.transaction((tx) => {
        new DrizzleCodeLinkRepository(txDb(tx)).replaceForCard(cardKey, newLinks);
      });
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

  return { created, alreadyLinked, unmatched, nonSpecTargets, markerMissing, linkMissing };
}

// ── Symbol rename/move sync ──

export interface SymbolSyncResult {
  /** Code links updated due to renames/moves. */
  applied: Array<{
    cardKey: string;
    oldSymbol: string;
    newSymbol: string;
    file: string;
    changeType: 'renamed' | 'moved';
  }>;
  /** Changes that did not produce an update.
   *  `metadata-write-failed` is added by the CLI layer (op itself never emits it). */
  skipped: Array<{
    reason:
      | 'no-links-referencing-old-symbol'
      | 'symbol-removed-manual-review-required'
      | 'card-not-found';
    symbol?: string;
    file?: string;
    details?: Record<string, unknown>;
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

  await ensureReindexed(ctx);

  const changes = ctx.gildash.getSymbolChanges(since, {
    changeTypes: ['renamed', 'moved', 'removed'],
  });

  const applied: SymbolSyncResult['applied'] = [];
  const skipped: SymbolSyncResult['skipped'] = [];

  for (const change of changes) {
    // Find code links referencing the old symbol/file
    const oldName = change.oldName ?? change.symbolName;
    const oldFile = change.oldFilePath ?? change.filePath;
    const links = ctx.codeLinkRepo.findBySymbol(oldName, oldFile);

    if (links.length === 0) {
      skipped.push({
        reason: 'no-links-referencing-old-symbol',
        symbol: oldName,
        file: oldFile,
      });
      continue;
    }

    for (const link of links) {
      // Guard: card must still exist (FK may have been broken by an external delete).
      if (!ctx.cardRepo.findByKey(link.cardKey)) {
        skipped.push({
          reason: 'card-not-found',
          symbol: oldName,
          file: oldFile,
          details: { cardKey: link.cardKey },
        });
        continue;
      }

      if (change.changeType === 'renamed') {
        const allLinks = ctx.codeLinkRepo.findByCardKey(link.cardKey);
        const newLinks = allLinks.map((l) =>
          l.file === oldFile && l.symbol === oldName
            ? { kind: l.kind, file: l.file, symbol: change.symbolName }
            : { kind: l.kind, file: l.file, symbol: l.symbol },
        );
        ctx.db.transaction((tx) => {
          new DrizzleCodeLinkRepository(txDb(tx)).replaceForCard(link.cardKey, newLinks);
        });
        applied.push({
          cardKey: link.cardKey,
          oldSymbol: oldName,
          newSymbol: change.symbolName,
          file: oldFile,
          changeType: 'renamed',
        });
      } else if (change.changeType === 'moved') {
        const allLinks = ctx.codeLinkRepo.findByCardKey(link.cardKey);
        const newLinks = allLinks.map((l) =>
          l.file === oldFile && l.symbol === oldName
            ? { kind: l.kind, file: change.filePath, symbol: change.symbolName }
            : { kind: l.kind, file: l.file, symbol: l.symbol },
        );
        ctx.db.transaction((tx) => {
          new DrizzleCodeLinkRepository(txDb(tx)).replaceForCard(link.cardKey, newLinks);
        });
        applied.push({
          cardKey: link.cardKey,
          oldSymbol: oldName,
          newSymbol: change.symbolName,
          file: change.filePath,
          changeType: 'moved',
        });
      } else if (change.changeType === 'removed') {
        // Removed symbols are NOT auto-deleted from card links; the human
        // must decide whether the rename was intentional. Report only.
        skipped.push({
          reason: 'symbol-removed-manual-review-required',
          symbol: oldName,
          file: oldFile,
          details: { cardKey: link.cardKey },
        });
      }
    }
  }

  return { applied, skipped };
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

  await ensureReindexed(ctx);

  const links = ctx.codeLinkRepo.findByCardKey(fullKey);
  if (links.length === 0) {
    return { declared: 0, resolved: 0, broken: 0, coverage: 1, unreferenced: [] };
  }

  const coverageCache = makeSymbolFileCache(ctx);
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

  // Find unreferenced symbols in linked files (boundary globs were removed —
  // coverage is determined purely by code_link rows).
  const unreferenced: LinkCoverageResult['unreferenced'] = [];
  for (const file of linkedFiles) {
    if (matchesAnyGlob(file, ctx.ignorePatterns)) continue;

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
 * Find symbols not linked to any card via codeLinks.
 *
 * Returns all gildash-indexed symbols that are not covered by any card's
 * codeLinks (populated from source `@spec` annotations). Applies
 * ignorePatterns + excludePatterns to filter out files.
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

  // 3. Determine target files (caller-provided or all indexed)
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
 */
export async function suggestCardScope(
  ctx: EmberdeckContext,
  options?: SuggestCardScopeOptions,
): Promise<CardSuggestion[]> {

  const basePath = options?.path ?? '';
  const maxDepth = options?.maxDepth ?? 3;

  // Build glossary matcher for suggestedGlossary
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

  const suggestions: CardSuggestion[] = [];

  for (const [dir, symbols] of uncoveredByDir) {
    const depth = getDepth(dir);
    if (depth > maxDepth) continue;

    // Determine suggested key from directory name
    const keyParts = dir.split('/').filter(Boolean);
    const suggestedKey = keyParts.length > 0 ? keyParts.join('/') : 'root';

    // Skip if a card with this key already exists
    if (existingKeys.has(suggestedKey)) continue;

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
