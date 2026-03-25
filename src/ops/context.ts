import { join } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CodeLinkRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { getRelationGraph } from './query';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';

// ── check_drift ──

export type DriftType = 'broken_link' | 'boundary_inactive' | 'symbol_changed';

export interface SymbolChangeDetail {
  changeType: string;
  symbolName: string;
  filePath: string;
}

export interface DriftCard {
  key: string;
  summary: string;
  status: 'active' | 'drifted';
  driftType?: DriftType;
  brokenLinks: number;
  totalLinks: number;
  /** Symbol changes detected in boundary files (only when driftType=symbol_changed). */
  symbolChanges?: SymbolChangeDetail[];
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

  // Collect symbol changes for symbol_changed detection (single gildash call)
  const symbolChangesByFile = await collectSymbolChanges(ctx, targetKeys);

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

    // Check code link health via gildash (batched by file)
    if (ctx.gildash && links.length > 0) {
      const linksByFile = new Map<string, typeof links>();
      for (const link of links) {
        const existing = linksByFile.get(link.file) ?? [];
        existing.push(link);
        linksByFile.set(link.file, existing);
      }

      for (const [file, fileLinks] of linksByFile) {
        // Try getSymbolsByFile first (single call per file), fall back to searchSymbols
        let fileSymbols = ctx.gildash.getSymbolsByFile(file);
        if ((!fileSymbols || fileSymbols.length === 0) && ctx.projectRoot) {
          fileSymbols = ctx.gildash.getSymbolsByFile(join(ctx.projectRoot, file));
        }

        if (fileSymbols && Array.isArray(fileSymbols) && fileSymbols.length > 0) {
          const symbolNames = new Set(fileSymbols.map((s) => s.name));
          for (const link of fileLinks) {
            if (!symbolNames.has(link.symbol)) brokenLinks++;
          }
        } else {
          // Fall back to searchSymbols per link
          for (const link of fileLinks) {
            const results = ctx.gildash!.searchSymbols({
              text: link.symbol,
              exact: true,
              filePath: link.file,
            });
            if (!Array.isArray(results)) {
              brokenLinks++;
            } else {
              const found = results.find((s) => s.name === link.symbol && s.filePath === link.file);
              if (!found) brokenLinks++;
            }
          }
        }
      }
    }

    // Determine drift type (first match wins: broken_link > boundary_inactive > symbol_changed)
    let driftType: DriftType | undefined;

    if (brokenLinks > 0) {
      driftType = 'broken_link';
    }

    // boundary_inactive: boundary globs match no files on disk
    if (!driftType && row.status === 'active' && ctx.projectRoot) {
      const boundary = parseBoundary(row.boundaryJson);
      if (boundary.length > 0) {
        let anyMatch = false;
        for (const pattern of boundary) {
          const glob = new Bun.Glob(pattern);
          for (const _ of glob.scanSync({ cwd: ctx.projectRoot })) {
            anyMatch = true;
            break;
          }
          if (anyMatch) break;
        }
        if (!anyMatch) {
          driftType = 'boundary_inactive';
        }
      }
    }

    // symbol_changed: symbols in boundary files changed after card's updatedAt
    let detectedSymbolChanges: SymbolChangeDetail[] | undefined;
    if (!driftType && row.status === 'active' && symbolChangesByFile) {
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
          driftType = 'symbol_changed';
          detectedSymbolChanges = collected;
        }
      }
    }

    const currentStatus = row.status as 'active' | 'drifted';
    const shouldTransition = !!driftType && currentStatus === 'active' && autoTransition;
    const finalStatus: 'active' | 'drifted' = shouldTransition ? 'drifted' : currentStatus;

    // Perform auto-transition
    if (shouldTransition) {
      ctx.cardRepo.upsert({ ...row, status: 'drifted', updatedAt: new Date().toISOString() });
      try {
        const cardFile = await readCardFile(row.filePath);
        cardFile.frontmatter.status = 'drifted';
        await writeCardFile(row.filePath, cardFile);
      } catch {
        // File update failed, DB already updated — acceptable for drift transition
      }
    }

    if (finalStatus === 'active') healthActive++;
    else healthDrifted++;

    driftCards.push({
      key,
      summary: row.summary,
      status: finalStatus,
      ...(driftType ? { driftType } : {}),
      brokenLinks,
      totalLinks,
      ...(detectedSymbolChanges ? { symbolChanges: detectedSymbolChanges } : {}),
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

function parseBoundary(boundaryJson: string | null): string[] {
  if (!boundaryJson) return [];
  try {
    const parsed = JSON.parse(boundaryJson);
    return Array.isArray(parsed) ? parsed : [];
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
    const changes = ctx.gildash.getSymbolChanges(oldestUpdatedAt, {
      changeTypes: ['added', 'modified', 'removed', 'renamed', 'moved'],
    });
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
export function checkInteractions(
  ctx: EmberdeckContext,
  cardKeys: string[],
): InteractionResult {
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

  // Build file sets for import dependency detection (codeLink files + boundary files)
  const cardFilesSets = new Map<string, Set<string>>();
  for (const key of keys) {
    const files = new Set((linkMap.get(key) ?? new Map()).keys());
    // Also add boundary-expanded files if projectRoot available
    if (ctx.projectRoot) {
      const row = ctx.cardRepo.findByKey(key);
      if (row?.boundaryJson) {
        try {
          const boundary: string[] = JSON.parse(row.boundaryJson);
          if (Array.isArray(boundary)) {
            for (const pattern of boundary) {
              const glob = new Bun.Glob(pattern);
              for (const file of glob.scanSync({ cwd: ctx.projectRoot })) {
                files.add(file);
              }
            }
          }
        } catch {
          // skip
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

      // Find shared symbols
      const sharedSymbols: SharedSymbol[] = [];
      const linksA = linkMap.get(keyA) ?? new Map();
      const linksB = linkMap.get(keyB) ?? new Map();

      for (const [file, aLinks] of linksA) {
        const bLinks = linksB.get(file);
        if (!bLinks) continue;
        for (const aLink of aLinks) {
          for (const bLink of bLinks) {
            if (aLink.symbol === bLink.symbol) {
              sharedSymbols.push({ file, symbol: aLink.symbol });
            }
          }
        }
      }

      // Find existing relation between this pair
      const relationsA = ctx.relationRepo.findByCardKey(keyA);
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
  if (!ctx.gildash || typeof (ctx.gildash as any).getDependencies !== 'function') {
    return [];
  }

  const deps: ImportDependency[] = [];
  const gildash = ctx.gildash as any;

  // Check A → B
  for (const fileA of filesA) {
    try {
      const fileDeps = gildash.getDependencies(fileA);
      if (!Array.isArray(fileDeps)) continue;
      for (const dep of fileDeps) {
        const depFile = typeof dep === 'string' ? dep : dep?.filePath;
        if (depFile && filesB.has(depFile)) {
          deps.push({ from: keyA, to: keyB, file: fileA });
          break;
        }
      }
    } catch {
      // graceful degradation
    }
  }

  // Check B → A
  for (const fileB of filesB) {
    try {
      const fileDeps = gildash.getDependencies(fileB);
      if (!Array.isArray(fileDeps)) continue;
      for (const dep of fileDeps) {
        const depFile = typeof dep === 'string' ? dep : dep?.filePath;
        if (depFile && filesA.has(depFile)) {
          deps.push({ from: keyB, to: keyA, file: fileB });
          break;
        }
      }
    } catch {
      // graceful degradation
    }
  }

  return deps;
}
