import type { EmberdeckContext } from '../config';
import type { CodeLinkRow, RelationRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { getRelationGraph } from './query';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { readGlossary } from '../glossary/io';
import { ensureReindexed, gildashProjectNames, makeSymbolFileCache } from './link';


// ── check_drift ──

export type DriftType =
  | 'broken_link'
  | 'boundary_inactive'
  | 'symbol_changed'
  | 'glossary_broken'
  | 'heritage_uncovered'
  | 'pattern_violation';

export interface SymbolChangeDetail {
  changeType: string;
  symbolName: string;
  filePath: string;
}

export interface DriftCard {
  key: string;
  summary: string;
  status: 'active' | 'drifted';
  /**
   * Primary drift type (first match in detection priority order). Kept as a
   * single field for backward compatibility with consumers that read one type.
   */
  driftType?: DriftType;
  /**
   * All drift types detected for this card (verified empirically with typeorm:
   * a single card can simultaneously have broken_link AND pattern_violation
   * etc.). Includes `driftType` as the first entry. New consumers should
   * iterate this; legacy consumers can keep reading `driftType`.
   */
  driftTypes?: DriftType[];
  brokenLinks: number;
  totalLinks: number;
  /** Symbol changes detected in boundary files (only when symbol_changed in driftTypes). */
  symbolChanges?: SymbolChangeDetail[];
  /**
   * Subclasses of a linked class that are not covered by any spec card.
   * Populated only when heritage_uncovered in driftTypes.
   */
  uncoveredSubclasses?: Array<{ file: string; symbol: string }>;
  /**
   * Pattern violations detected via spec.code_patterns + gildash.findPattern.
   * Populated only when pattern_violation in driftTypes.
   */
  patternViolations?: Array<{
    id: string;
    rule: 'forbidden' | 'required';
    /** Number of matches found ('forbidden': >0 ⇒ violation; 'required': 0 ⇒ violation). */
    matches: number;
  }>;
}

export interface DriftHealth {
  total: number;
  active: number;
  drifted: number;
  draft: number;
}

export interface DriftResult {
  cards: DriftCard[];
  health: DriftHealth;
}

export interface CheckDriftOptions {
  maxDepth?: number;
  autoTransition?: boolean;
}

interface SymbolChangeInfo {
  changeType: string;
  symbolName: string;
  filePath: string;
  changedAt: string;
}

/**
 * Detect drift for cards in scope.
 *
 * For each non-draft card, determines whether it is drifted by checking:
 *   1. broken_link — code links that no longer resolve
 *   2. boundary_inactive — boundary globs that match no files
 *   3. symbol_changed — symbols in boundary files changed after card was last updated
 *
 * When autoTransition=true (default), active cards found drifted are
 * automatically transitioned to 'drifted' status (DB + file).
 * Draft cards are excluded from drift analysis.
 */
export async function checkDrift(
  ctx: EmberdeckContext,
  fullKey?: string,
  options?: CheckDriftOptions,
): Promise<DriftResult> {
  const maxDepth = options?.maxDepth ?? 3;
  const autoTransition = options?.autoTransition ?? true;

  // Determine target cards
  let targetKeys: string[];
  if (fullKey) {
    const rootKey = parseFullKey(fullKey);
    const graphNodes = getRelationGraph(ctx, rootKey, { maxDepth, direction: 'both' });
    targetKeys = [rootKey, ...graphNodes.map((n) => n.key)];
  } else {
    targetKeys = ctx.cardRepo.list().map((r) => r.key);
  }

  if (targetKeys.length === 0) {
    return { cards: [], health: { total: 0, active: 0, drifted: 0, draft: 0 } };
  }

  // Ensure gildash index is fresh; subsequent gildash calls in this function
  // assume the index reflects the on-disk source state at this moment.
  await ensureReindexed(ctx);

  // Collect symbol changes for symbol_changed detection (single gildash call)
  const symbolChangesByFile = await collectSymbolChanges(ctx, targetKeys);

  // Index of files known to gildash (used for boundary_inactive checks below).
  // Lazy-initialized once per call so we don't pay listIndexedFiles cost when
  // no card needs the check.
  let indexedFilePaths: Set<string> | null = null;
  const getIndexedFilePaths = (): Set<string> => {
    if (indexedFilePaths === null) {
      const all: string[] = [];
      if (ctx.gildash && typeof ctx.gildash.listIndexedFiles === 'function') {
        for (const project of gildashProjectNames(ctx)) {
          try {
            const list = project ? ctx.gildash.listIndexedFiles(project) : ctx.gildash.listIndexedFiles();
            for (const f of list) all.push(f.filePath);
          } catch {
            // skip
          }
        }
      }
      indexedFilePaths = new Set(all);
    }
    return indexedFilePaths;
  };

  // Shared per-file symbol cache for broken_link detection.
  const symbolCache = ctx.gildash ? makeSymbolFileCache(ctx)! : null;

  // Build a set of (file:symbol) covered by *any* card's codeLinks. Used by
  // heritage_uncovered detection — a subclass of a linked class is "covered"
  // if some other card already links to it. Single bulk read avoids N×findByCardKey.
  const allCoveredSymbols = new Set<string>();
  if (ctx.gildash && typeof ctx.gildash.searchRelations === 'function') {
    for (const link of ctx.codeLinkRepo.findAll()) {
      allCoveredSymbols.add(`${link.file}:${link.symbol}`);
    }
  }

  const driftCards: DriftCard[] = [];
  let healthActive = 0;
  let healthDrifted = 0;
  let healthDraft = 0;

  for (const key of targetKeys) {
    const row = ctx.cardRepo.findByKey(key);
    if (!row) continue;

    if (row.status === 'draft') {
      healthDraft++;
      continue;
    }

    // Active or drifted card — analyze drift
    const links = ctx.codeLinkRepo.findByCardKey(key);
    const totalLinks = links.length;
    let brokenLinks = 0;

    // Check code link health via gildash (per-file symbol cache).
    // If gildash throws (transient failure), skip drift detection for this card.
    let gildashUnavailable = false;
    if (symbolCache && links.length > 0) {
      for (const link of links) {
        try {
          if (!symbolCache.find(link.file, link.symbol)) brokenLinks++;
        } catch {
          gildashUnavailable = true;
        }
      }
    }

    // Collect ALL applicable drift types (multi-detection). Empirically a
    // single card can have broken_link AND pattern_violation simultaneously;
    // first-match-wins forces a fix-and-recheck cycle. Iteration order here
    // becomes the priority order surfaced via `driftType` (primary).
    const driftTypesDetected: DriftType[] = [];
    const addDrift = (t: DriftType) => { if (!driftTypesDetected.includes(t)) driftTypesDetected.push(t); };

    if (brokenLinks > 0) {
      addDrift('broken_link');
    }

    // boundary_inactive: boundary globs match no files.
    // Prefer the gildash index (consistent with other queries, respects
    // ignorePatterns); fall back to scanning projectRoot when gildash is absent.
    // An empty index is treated as "no information" rather than "no matches"
    // — boundary_inactive only fires when we have a populated source of truth.
    if (row.status === 'active' && (ctx.gildash || ctx.projectRoot)) {
      const boundary = parseBoundary(row.boundaryJson);
      if (boundary.length > 0) {
        let anyMatch = false;
        let canDecide = false;
        if (ctx.gildash) {
          const indexedFiles = getIndexedFilePaths();
          if (indexedFiles.size > 0) {
            canDecide = true;
            for (const pattern of boundary) {
              const glob = new Bun.Glob(pattern);
              for (const filePath of indexedFiles) {
                if (glob.match(filePath)) { anyMatch = true; break; }
              }
              if (anyMatch) break;
            }
          }
        }
        if (!canDecide && ctx.projectRoot) {
          try {
            for (const pattern of boundary) {
              const glob = new Bun.Glob(pattern);
              for (const _ of glob.scanSync({ cwd: ctx.projectRoot })) {
                anyMatch = true;
                break;
              }
              if (anyMatch) break;
            }
            canDecide = true;
          } catch {
            // projectRoot inaccessible (test mocks, missing dir) — treat as
            // "no information" rather than asserting boundary_inactive.
          }
        }
        if (canDecide && !anyMatch) {
          addDrift('boundary_inactive');
        }
      }
    }

    // symbol_changed: symbols in boundary files changed after card's updatedAt
    let detectedSymbolChanges: SymbolChangeDetail[] | undefined;
    if (row.status === 'active' && symbolChangesByFile) {
      const boundary = parseBoundary(row.boundaryJson);
      if (boundary.length > 0) {
        const cardUpdatedAt = row.updatedAt;
        const collected: SymbolChangeDetail[] = [];
        for (const [filePath, changes] of symbolChangesByFile) {
          for (const pattern of boundary) {
            const glob = new Bun.Glob(pattern);
            if (glob.match(filePath)) {
              for (const change of changes) {
                if (change.changedAt > cardUpdatedAt) {
                  collected.push({
                    changeType: change.changeType,
                    symbolName: change.symbolName,
                    filePath: change.filePath,
                  });
                }
              }
            }
          }
        }
        if (collected.length > 0) {
          addDrift('symbol_changed');
          detectedSymbolChanges = collected;
        }
      }
    }

    // heritage_uncovered: a card links to a class whose subclasses are not
    // covered by any spec card. gildash's `getHeritageChain` walks UP the
    // inheritance (returns ancestors, not descendants) — to find subclasses we
    // query the `extends` relation graph and filter by dst = our linked class.
    let uncoveredSubclasses: Array<{ file: string; symbol: string }> | undefined;
    if (
      row.status === 'active' &&
      symbolCache &&
      ctx.gildash &&
      typeof ctx.gildash.searchRelations === 'function'
    ) {
      const collected: Array<{ file: string; symbol: string }> = [];
      const seen = new Set<string>();
      for (const link of links) {
        const sym = symbolCache.find(link.file, link.symbol);
        if (!sym || sym.kind !== 'class') continue;
        try {
          // Aggregate extends relations across all projects (monorepo support).
          const relations = [];
          for (const project of gildashProjectNames(ctx)) {
            try {
              const r = ctx.gildash.searchRelations(
                project
                  ? { type: 'extends', dstFilePath: link.file, project }
                  : { type: 'extends', dstFilePath: link.file },
              );
              relations.push(...r);
            } catch {
              // skip project on failure
            }
          }
          for (const rel of relations) {
            if (!rel.srcSymbolName || !rel.srcFilePath) continue;
            if (rel.dstSymbolName !== link.symbol && rel.dstSymbolName !== sym.name) continue;
            const subKey = `${rel.srcFilePath}:${rel.srcSymbolName}`;
            if (seen.has(subKey)) continue;
            seen.add(subKey);
            if (!allCoveredSymbols.has(subKey)) {
              collected.push({ file: rel.srcFilePath, symbol: rel.srcSymbolName });
            }
          }
        } catch {
          // best-effort; heritage is informational
        }
      }
      if (collected.length > 0) {
        addDrift('heritage_uncovered');
        uncoveredSubclasses = collected;
      }
    }

    // pattern_violation: spec.code_patterns runs through gildash.findPattern.
    // 'forbidden' patterns fail when matches exist; 'required' patterns fail
    // when zero matches. Boundary files limit the search scope when present.
    let patternViolations: DriftCard['patternViolations'];
    if (
      row.status === 'active' &&
      ctx.gildash &&
      typeof ctx.gildash.findPattern === 'function' &&
      row.namespacesJson
    ) {
      const patterns = parseSpecCodePatterns(row.namespacesJson);
      if (patterns.length > 0) {
        // Scope pattern search to this card's boundary when set — a card's
        // patterns are its own contract, not a project-wide rule. A spec for
        // `src/auth/**` shouldn't flag `console.log` in `src/ui/`.
        const boundary = parseBoundary(row.boundaryJson);
        let scopedFiles: string[] | undefined;
        if (boundary.length > 0) {
          const indexedFiles = getIndexedFilePaths();
          if (indexedFiles.size > 0) {
            scopedFiles = [];
            for (const pattern of boundary) {
              try {
                const glob = new Bun.Glob(pattern);
                for (const f of indexedFiles) if (glob.match(f)) scopedFiles.push(f);
              } catch { /* skip invalid */ }
            }
          }
        }
        const collected: NonNullable<DriftCard['patternViolations']> = [];
        for (const p of patterns) {
          try {
            // findPattern aggregates across all projects (monorepo support).
            let count = 0;
            for (const project of gildashProjectNames(ctx)) {
              try {
                const opts: { project?: string; filePaths?: string[] } = {};
                if (project) opts.project = project;
                if (scopedFiles) opts.filePaths = scopedFiles;
                const matches = await ctx.gildash.findPattern(p.pattern, opts);
                count += matches.length;
              } catch {
                // skip project on failure
              }
            }
            const violated =
              (p.rule === 'forbidden' && count > 0) ||
              (p.rule === 'required' && count === 0);
            if (violated) collected.push({ id: p.id, rule: p.rule, matches: count });
          } catch {
            // best-effort; pattern engine errors don't flip the card
          }
        }
        if (collected.length > 0) {
          addDrift('pattern_violation');
          patternViolations = collected;
        }
      }
    }

    // glossary_broken: card declares glossary words not in glossary.yaml
    {
      const cardGlossary = parseGlossaryJsonField(row);
      if (cardGlossary.length > 0) {
        const glossaryEntries = readGlossary(ctx);
        const glossaryWords = new Set(glossaryEntries.map((e) => e.word));
        for (const word of cardGlossary) {
          if (!glossaryWords.has(word)) {
            addDrift('glossary_broken');
            break;
          }
        }
      }
    }

    const driftType: DriftType | undefined = driftTypesDetected[0];

    const currentStatus = row.status as 'active' | 'drifted';
    // Skip auto-transition if gildash was unavailable — broken links may be false positives
    const shouldTransition = !!driftType && currentStatus === 'active' && autoTransition && !gildashUnavailable;
    let finalStatus: 'active' | 'drifted' = currentStatus;

    // Perform auto-transition (targeted UPDATE + file, compensate on file failure)
    if (shouldTransition) {
      const now = new Date().toISOString();
      try {
        const changed = ctx.db.$client
          .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ? AND status = ?')
          .run('drifted', now, key, 'active');
        if (changed.changes > 0) {
          try {
            const cardFile = await readCardFile(row.filePath);
            cardFile.frontmatter.status = 'drifted';
            await writeCardFile(row.filePath, cardFile);
            finalStatus = 'drifted';
          } catch {
            // File write failed — revert DB
            ctx.db.$client
              .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ?')
              .run(row.status, row.updatedAt, key);
          }
        }
      } catch {
        // Transition failed — DB reverted to previous state.
        // driftType is still reported so the caller knows drift was detected.
      }
    }

    if (finalStatus === 'active') healthActive++;
    else healthDrifted++;

    driftCards.push({
      key,
      summary: row.summary,
      status: finalStatus,
      ...(driftType ? { driftType } : {}),
      ...(driftTypesDetected.length > 0 ? { driftTypes: driftTypesDetected } : {}),
      brokenLinks,
      totalLinks,
      ...(detectedSymbolChanges ? { symbolChanges: detectedSymbolChanges } : {}),
      ...(uncoveredSubclasses ? { uncoveredSubclasses } : {}),
      ...(patternViolations ? { patternViolations } : {}),
    });
  }

  return {
    cards: driftCards,
    health: {
      total: targetKeys.length,
      active: healthActive,
      drifted: healthDrifted,
      draft: healthDraft,
    },
  };
}

// ── check_drift helpers ──

import { parseBoundaryJson, parseGlossaryJson } from '../card/json-fields';

function parseGlossaryJsonField(card: { glossaryJson?: string }): string[] {
  return parseGlossaryJson(card.glossaryJson);
}

function parseBoundary(boundaryJson: string | null): string[] {
  return parseBoundaryJson(boundaryJson);
}

interface SpecCodePatternRow {
  id: string;
  pattern: string;
  rule: 'forbidden' | 'required';
}

function parseSpecCodePatterns(namespacesJson: string): SpecCodePatternRow[] {
  try {
    const ns = JSON.parse(namespacesJson) as { spec?: { code_patterns?: SpecCodePatternRow[] } };
    const list = ns?.spec?.code_patterns;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is SpecCodePatternRow =>
        !!p && typeof p.id === 'string' && typeof p.pattern === 'string' &&
        (p.rule === 'forbidden' || p.rule === 'required'),
    );
  } catch {
    return [];
  }
}

async function collectSymbolChanges(
  ctx: EmberdeckContext,
  targetKeys: string[],
): Promise<Map<string, SymbolChangeInfo[]> | null> {
  if (!ctx.gildash || typeof ctx.gildash.getSymbolChanges !== 'function') return null;

  // Find oldest updatedAt among active cards with boundary
  let oldestUpdatedAt: string | null = null;
  for (const key of targetKeys) {
    const row = ctx.cardRepo.findByKey(key);
    if (!row || row.status !== 'active') continue;
    const boundary = parseBoundary(row.boundaryJson);
    if (boundary.length === 0) continue;
    if (!oldestUpdatedAt || row.updatedAt < oldestUpdatedAt) {
      oldestUpdatedAt = row.updatedAt;
    }
  }

  if (!oldestUpdatedAt) return null;

  try {
    // Aggregate symbol changes across all projects (monorepo support).
    const changes = [];
    for (const project of gildashProjectNames(ctx)) {
      try {
        const c = ctx.gildash.getSymbolChanges(oldestUpdatedAt, {
          changeTypes: ['added', 'modified', 'removed', 'renamed', 'moved'],
          ...(project ? { project } : {}),
        });
        changes.push(...c);
      } catch {
        // skip project on failure
      }
    }
    const map = new Map<string, SymbolChangeInfo[]>();
    for (const change of changes) {
      const file = change.filePath;
      const existing = map.get(file) ?? [];
      existing.push({
        changeType: change.changeType,
        symbolName: change.symbolName,
        filePath: change.filePath,
        changedAt: change.changedAt,
      });
      map.set(file, existing);
    }
    return map;
  } catch {
    return null;
  }
}

// ── check_interactions ──

export interface SharedSymbol {
  file: string;
  symbol: string;
}

export interface ImportDependency {
  from: string;
  to: string;
  file: string;
}

export interface CardInteraction {
  pair: [string, string];
  sharedSymbols: SharedSymbol[];
  /** Files that both cards have code links to (different symbols, same file). */
  sharedFiles: string[];
  /** Import-level dependencies between the two cards' files. */
  importDependencies: ImportDependency[];
  hasRelation: boolean;
  potentialConflicts: string[];
}

export interface UndefinedRelation {
  pair: [string, string];
  suggestion: string;
}

export interface InteractionResult {
  interactions: CardInteraction[];
  undefinedRelations: UndefinedRelation[];
}

/**
 * Analyze interactions between a set of cards.
 * Detects shared code symbols, shared files, import dependencies,
 * existing relations, and potential conflicts.
 */
export async function checkInteractions(
  ctx: EmberdeckContext,
  cardKeys: string[],
): Promise<InteractionResult> {
  await ensureReindexed(ctx);
  const keys = cardKeys.map(parseFullKey);
  const interactions: CardInteraction[] = [];
  const undefinedRelations: UndefinedRelation[] = [];

  // Build code link map: key -> Map<file, CodeLinkRow[]>
  const linkMap = new Map<string, Map<string, CodeLinkRow[]>>();
  for (const key of keys) {
    const links = ctx.codeLinkRepo.findByCardKey(key);
    const fileMap = new Map<string, CodeLinkRow[]>();
    for (const link of links) {
      const existing = fileMap.get(link.file) ?? [];
      existing.push(link);
      fileMap.set(link.file, existing);
    }
    linkMap.set(key, fileMap);
  }

  // Pre-fetch relations once per key — inner pair loop hit findByCardKey
  // O(N²/2) times for the same key set.
  const relationsByKey = new Map<string, RelationRow[]>();
  for (const key of keys) {
    relationsByKey.set(key, ctx.relationRepo.findByCardKey(key));
  }

  // Build file sets for import dependency detection (codeLink files + boundary
  // files). Boundary expansion is done against gildash's indexed file list so
  // results are consistent with other gildash queries (and respect ignorePatterns).
  // Aggregate across all gildash projects — monorepo support.
  const indexedFiles: string[] = [];
  if (ctx.gildash && typeof ctx.gildash.listIndexedFiles === 'function') {
    for (const project of gildashProjectNames(ctx)) {
      try {
        const list = project ? ctx.gildash.listIndexedFiles(project) : ctx.gildash.listIndexedFiles();
        for (const f of list) indexedFiles.push(f.filePath);
      } catch {
        // skip
      }
    }
  }
  const cardFilesSets = new Map<string, Set<string>>();
  for (const key of keys) {
    const files = new Set((linkMap.get(key) ?? new Map()).keys());
    if (indexedFiles.length > 0) {
      const row = ctx.cardRepo.findByKey(key);
      for (const pattern of parseBoundaryJson(row?.boundaryJson)) {
        try {
          const glob = new Bun.Glob(pattern);
          for (const file of indexedFiles) {
            if (glob.match(file)) files.add(file);
          }
        } catch {
          // skip invalid boundary
        }
      }
    }
    cardFilesSets.set(key, files);
  }

  // Check all pairs
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i]!;
      const keyB = keys[j]!;

      // Find shared symbols. Dedup by (file,symbol) — UNIQUE allows the same
      // pair across multiple kinds on a single card, which would otherwise
      // emit duplicate SharedSymbol entries.
      const sharedSymbolKeys = new Set<string>();
      const sharedSymbols: SharedSymbol[] = [];
      const linksA = linkMap.get(keyA) ?? new Map();
      const linksB = linkMap.get(keyB) ?? new Map();

      for (const [file, aLinks] of linksA) {
        const bLinks = linksB.get(file);
        if (!bLinks) continue;
        const bSymbols = new Set(bLinks.map((l: CodeLinkRow) => l.symbol));
        for (const aLink of aLinks) {
          if (!bSymbols.has(aLink.symbol)) continue;
          const k = `${file}\0${aLink.symbol}`;
          if (sharedSymbolKeys.has(k)) continue;
          sharedSymbolKeys.add(k);
          sharedSymbols.push({ file, symbol: aLink.symbol });
        }
      }

      // Find existing relation between this pair (use prefetched map)
      const relationsA = relationsByKey.get(keyA) ?? [];
      const directRelation = relationsA.find(
        (r) => !r.isReverse && r.dstCardKey === keyB,
      );
      const reverseRelation = relationsA.find(
        (r) => r.isReverse && r.dstCardKey === keyB,
      );
      const hasRelation = !!(directRelation || reverseRelation);

      // Detect shared files (both cards link to the same file)
      const sharedFileSet = new Set<string>();
      for (const [file] of linksA) {
        if (linksB.has(file)) sharedFileSet.add(file);
      }
      const sharedFiles = [...sharedFileSet];

      // Detect import dependencies via gildash
      const importDependencies = detectImportDependencies(
        ctx, keyA, keyB,
        cardFilesSets.get(keyA) ?? new Set(),
        cardFilesSets.get(keyB) ?? new Set(),
      );

      // Detect potential conflicts
      const potentialConflicts: string[] = [];
      if (sharedFiles.length > 0 && !hasRelation) {
        potentialConflicts.push(
          `Cards share ${sharedFiles.length} file(s) but have no defined relation.`,
        );
      }

      // Only include pairs with some interaction
      if (
        sharedSymbols.length > 0 ||
        sharedFiles.length > 0 ||
        importDependencies.length > 0 ||
        hasRelation ||
        potentialConflicts.length > 0
      ) {
        interactions.push({
          pair: [keyA, keyB],
          sharedSymbols,
          sharedFiles,
          importDependencies,
          hasRelation,
          potentialConflicts,
        });
      }

      // Track undefined relations (shared code links but no relation)
      if (sharedSymbols.length > 0 && !hasRelation) {
        undefinedRelations.push({
          pair: [keyA, keyB],
          suggestion: 'related',
        });
      }
    }
  }

  return { interactions, undefinedRelations };
}

/**
 * Detect import-level dependencies between two cards' file sets using gildash.
 * Returns empty array if gildash is not available or doesn't support getDependencies.
 */
function detectImportDependencies(
  ctx: EmberdeckContext,
  keyA: string,
  keyB: string,
  filesA: Set<string>,
  filesB: Set<string>,
): ImportDependency[] {
  if (!ctx.gildash || typeof ctx.gildash.getDependencies !== 'function') {
    return [];
  }

  const gildash = ctx.gildash;
  const projects = gildashProjectNames(ctx);
  const deps: ImportDependency[] = [];

  const collect = (
    sources: Set<string>,
    targets: Set<string>,
    fromKey: string,
    toKey: string,
  ) => {
    for (const src of sources) {
      // Union deps across all projects (a file may appear in multiple project
      // boundaries with different import lists). One emit per (src, dst) match.
      const allDeps = new Set<string>();
      for (const project of projects) {
        try {
          const fileDeps = project ? gildash.getDependencies(src, project) : gildash.getDependencies(src);
          if (!Array.isArray(fileDeps)) continue;
          for (const dep of fileDeps) if (typeof dep === 'string') allDeps.add(dep);
        } catch {
          // graceful degradation
        }
      }
      for (const dep of allDeps) {
        if (targets.has(dep)) {
          deps.push({ from: fromKey, to: toKey, file: src });
          break;
        }
      }
    }
  };

  collect(filesA, filesB, keyA, keyB);
  collect(filesB, filesA, keyB, keyA);

  return deps;
}
