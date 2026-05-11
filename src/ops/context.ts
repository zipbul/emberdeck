import type { EmberdeckContext } from '../config';
import type { CodeLinkRow, RelationRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { getRelationGraph } from './query';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { readGlossary } from '../glossary/io';
import { ensureReindexed, gildashProjectNames, makeSymbolFileCache } from './link';
import { parseStringArrayJson } from '../card/json-fields';


// ── check_drift ──

export type DriftType = 'broken_link' | 'glossary_broken';

export interface DriftCard {
  key: string;
  summary: string;
  status: 'active' | 'drifted';
  /** Primary drift type. */
  driftType?: DriftType;
  /** All drift types detected for this card (includes `driftType` first). */
  driftTypes?: DriftType[];
  brokenLinks: number;
  totalLinks: number;
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

/**
 * Detect drift for cards in scope.
 *
 * For each non-draft card, determines whether it is drifted by checking:
 *   1. broken_link — code links that no longer resolve (source @spec annotations)
 *   2. glossary_broken — declared glossary words no longer in glossary.yaml
 *
 * When autoTransition=true (default), active cards found drifted are
 * automatically transitioned to 'drifted' status (DB + file).
 * Draft cards are excluded from drift analysis.
  * @spec analysis/drift-detection/check-drift
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

  // Shared per-file symbol cache for broken_link detection.
  const symbolCache = makeSymbolFileCache(ctx);

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
    if (links.length > 0) {
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

    // glossary_broken: card declares glossary words not in glossary.yaml
    {
      const cardGlossary = parseStringArrayJson(row.glossaryJson);
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
  * @spec analysis/impact-and-aggregate/interactions-and-analyze
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

  // Build file sets for import dependency detection (codeLink files only —
  // boundary globs were removed; bindings come from `@spec` annotations).
  const cardFilesSets = new Map<string, Set<string>>();
  for (const key of keys) {
    const files = new Set((linkMap.get(key) ?? new Map()).keys());
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
          const fileDeps = gildash.getDependencies(src, project);
          for (const dep of fileDeps) allDeps.add(dep);
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
