import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus, CardType } from '../card/types';
import type { CardRow, CardListFilter, RelationRow, ChangelogRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFileOrThrow } from '../fs/reader';
import { resolveCardCodeLinks, type ResolvedCodeLink } from './link';

/**
 * A relation graph node containing the card's unique identifier and its position info in the graph.
 */
export interface RelationGraphNode {
  key: string;
  depth: number;
  direction: 'forward' | 'backward';
}

export interface RelationGraphOptions {
  maxDepth?: number;
  direction?: 'forward' | 'backward' | 'both';
}

export function getRelationGraph(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: RelationGraphOptions,
): RelationGraphNode[] {
  const rootKey = parseFullKey(fullKey);
  const maxDepth = options?.maxDepth ?? 3;
  const direction = options?.direction ?? 'both';

  if (!ctx.cardRepo.existsByKey(rootKey)) return [];

  const result: RelationGraphNode[] = [];
  const visited = new Set<string>([rootKey]);
  // Queue: [cardKey, depth]
  const queue: Array<[string, number]> = [[rootKey, 0]];

  while (queue.length > 0) {
    const [currentKey, currentDepth] = queue.shift()!;
    if (currentDepth >= maxDepth) continue;

    const relations = ctx.relationRepo.findByCardKey(currentKey);

    for (const rel of relations) {
      const isForward = !rel.isReverse;
      const isBackward = rel.isReverse;
      if (direction === 'forward' && !isForward) continue;
      if (direction === 'backward' && !isBackward) continue;

      const neighborKey = rel.dstCardKey;
      if (visited.has(neighborKey)) continue;
      if (!ctx.cardRepo.existsByKey(neighborKey)) continue;

      visited.add(neighborKey);
      result.push({
        key: neighborKey,
        depth: currentDepth + 1,
        direction: isForward ? 'forward' : 'backward',
      });
      queue.push([neighborKey, currentDepth + 1]);
    }
  }

  return result;
}

export interface RelatedCard {
  card: CardRow;
  depth: number;
  direction: 'forward' | 'backward';
}

export interface CardContext {
  card: CardFile;
  codeLinks: ResolvedCodeLink[];
  upstreamCards: CardRow[];
  downstreamCards: CardRow[];
  /** Cards at depth 2+ discovered by BFS. Only present when depth > 1. */
  related?: RelatedCard[];
  /** True when BFS traversal was cut short by the depth limit. */
  truncated?: boolean;
}

export interface GetCardContextOptions {
  /** BFS traversal depth. 1 = direct relations only (default). >1 = multi-hop BFS. */
  depth?: number;
}

export async function getCardContext(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: GetCardContextOptions,
): Promise<CardContext> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  const card = await readCardFileOrThrow(filePath, key);

  let codeLinks: ResolvedCodeLink[] = [];
  if (ctx.gildash) {
    codeLinks = await resolveCardCodeLinks(ctx, fullKey);
  }

  const relations = ctx.relationRepo.findByCardKey(key);
  const upstreamCards = relations
    .filter((r) => r.isReverse)
    .map((r) => ctx.cardRepo.findByKey(r.dstCardKey))
    .filter((r): r is CardRow => r !== null);
  const downstreamCards = relations
    .filter((r) => !r.isReverse)
    .map((r) => ctx.cardRepo.findByKey(r.dstCardKey))
    .filter((r): r is CardRow => r !== null);

  const depth = options?.depth ?? 1;
  if (depth <= 1) {
    return { card, codeLinks, upstreamCards, downstreamCards };
  }

  // BFS traversal for depth > 1
  const graphNodes = getRelationGraph(ctx, fullKey, { maxDepth: depth, direction: 'both' });

  // Depth-1 nodes are already in upstream/downstream. Collect depth-2+ with full card data.
  const related: RelatedCard[] = [];
  for (const node of graphNodes) {
    if (node.depth <= 1) continue;
    const row = ctx.cardRepo.findByKey(node.key);
    if (row) related.push({ card: row, depth: node.depth, direction: node.direction });
  }

  // Check truncation: any node at maxDepth that still has unvisited neighbors
  const visited = new Set([key, ...graphNodes.map((n) => n.key)]);
  let truncated = false;
  for (const node of graphNodes) {
    if (node.depth !== depth) continue;
    const neighbors = ctx.relationRepo.findByCardKey(node.key);
    if (neighbors.some((r) => !visited.has(r.dstCardKey) && ctx.cardRepo.existsByKey(r.dstCardKey))) {
      truncated = true;
      break;
    }
  }

  return { card, codeLinks, upstreamCards, downstreamCards, related, truncated };
}

/**
 * Extended result for getCard with optional history.
 */
export interface GetCardResult {
  card: CardFile;
  history?: ChangelogRow[];
}

/**
 * Reads a card from its file and returns it, optionally with changelog history.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to retrieve.
 * @param options - Optional: includeHistory to get changelog.
 * @returns The complete frontmatter + body, optionally with history.
 * @throws {CardNotFoundError} When the file does not exist.
 */
export async function getCard(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: { includeHistory?: boolean },
): Promise<GetCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  const card = await readCardFileOrThrow(filePath, key);

  const result: GetCardResult = { card };
  if (options?.includeHistory) {
    result.history = ctx.changelogRepo.findByCardKey(key);
  }
  return result;
}

/**
 * Result for batch card read.
 */
export interface GetCardsResult {
  cards: GetCardResult[];
  notFound: string[];
}

/**
 * Reads multiple cards in one call. Keys that do not exist are collected
 * in the `notFound` array instead of throwing.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKeys - Array of card keys to retrieve.
 * @param options - Optional: includeHistory to get changelog for each card.
 * @returns Cards that were found and a list of keys that were not found.
 */
export async function getCards(
  ctx: EmberdeckContext,
  fullKeys: string[],
  options?: { includeHistory?: boolean },
): Promise<GetCardsResult> {
  const cards: GetCardResult[] = [];
  const notFound: string[] = [];

  // Parallelize file reads in batches — sequential await per key was the
  // bottleneck for callers that pass dozens of keys at once.
  const BATCH = 20;
  for (let i = 0; i < fullKeys.length; i += BATCH) {
    const batch = fullKeys.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((k) => getCard(ctx, k, options)),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === 'fulfilled') {
        cards.push(r.value);
      } else if (r.reason instanceof CardNotFoundError) {
        notFound.push(batch[j]!);
      } else {
        throw r.reason;
      }
    }
  }

  return { cards, notFound };
}

/**
 * Lists cards from the DB.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param filter - Optional filter. Supports status, type, parent, tag, roots, updatedSince, sortBy.
 * @returns Array of DB rows (no file reads, lightweight query).
 */
export type CardSummaryRow = Omit<CardRow, 'body'>;

export function listCards(ctx: EmberdeckContext, filter?: CardListFilter): CardSummaryRow[] {
  return ctx.cardRepo.list(filter).map(({ body, ...rest }) => rest);
}

export interface SearchCardsOptions {
  type?: CardType;
  status?: CardStatus;
}

/**
 * Searches cards using FTS5 full-text search, with optional type/status filters.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param query - Search query text. Returns an empty array if the query is empty.
 * @param options - Optional type and status filters.
 * @returns Array of DB rows matching the search.
 */
export function searchCards(
  ctx: EmberdeckContext,
  query: string,
  options?: SearchCardsOptions,
): CardSummaryRow[] {
  const results = ctx.cardRepo.search(query);
  const filtered = options
    ? results.filter((row) => {
        if (options.type && row.type !== options.type) return false;
        if (options.status && row.status !== options.status) return false;
        return true;
      })
    : results;

  return filtered.map(({ body, ...rest }) => rest);
}

/**
 * Returns the list of relations for a card (both forward and reverse).
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - fullKey of the card to query.
 * @returns `isReverse=false` for outgoing relations, `isReverse=true` for incoming relations.
 */
export function listCardRelations(ctx: EmberdeckContext, fullKey: string): RelationRow[] {
  const key = parseFullKey(fullKey);
  return ctx.relationRepo.findByCardKey(key);
}

// ---- Card Tree ----

export interface CardTreeNode {
  key: string;
  summary: string;
  type: string;
  status: string;
  depth: number;
  children: CardTreeNode[];
  /** True when this node has children beyond maxDepth. */
  truncated?: boolean;
}

/**
 * Builds a parent/child hierarchy tree starting from the given card.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param fullKey - Root card key.
 * @param maxDepth - Maximum tree depth (default 10, capped at 20).
 * @returns Recursive tree structure.
 * @throws {CardNotFoundError} When the root card does not exist.
 */
export function getCardTree(
  ctx: EmberdeckContext,
  fullKey: string,
  maxDepth?: number,
): CardTreeNode {
  const key = parseFullKey(fullKey);
  const root = ctx.cardRepo.findByKey(key);
  if (!root) throw new CardNotFoundError(key);

  const effectiveMaxDepth = Math.min(maxDepth ?? 10, 20);

  function buildNode(row: CardRow, depth: number): CardTreeNode {
    const childRows = ctx.cardRepo.findChildren(row.key);
    const atLimit = depth >= effectiveMaxDepth;

    return {
      key: row.key,
      summary: row.summary,
      type: row.type,
      status: row.status,
      depth,
      children: atLimit ? [] : childRows.map((c) => buildNode(c, depth + 1)),
      ...(atLimit && childRows.length > 0 ? { truncated: true } : {}),
    };
  }

  return buildNode(root, 0);
}
