import type { EmberdeckContext } from '../config';
import type { CardFile, CardFrontmatter, CardStatus, CardType } from '../card/types';
import type { CardRow, CardListFilter, ChangelogRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFileOrThrow } from '../fs/reader';
import { batchedAllSettled } from '../util/batch';
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

/** @spec card-storage/queries/tree-context */
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
  /** root → current-card-parent chain, in walked order. Empty when no parent. */
  parentChain: CardRow[];
  /** [§10 P3.3] navigable forward trace edges (parent/derives/case-of/invokes/cross_domain). */
  traceEdges: TraceEdge[];
  /** Cards at depth 2+ discovered by BFS. Only present when depth > 1. */
  related?: RelatedCard[];
  /** True when BFS traversal was cut short by the depth limit. */
  truncated?: boolean;
}

export interface GetCardContextOptions {
  /** BFS traversal depth. 1 = direct relations only (default). >1 = multi-hop BFS. */
  depth?: number;
}

/** @spec card-storage/queries/tree-context */
export async function getCardContext(
  ctx: EmberdeckContext,
  fullKey: string,
  options?: GetCardContextOptions,
): Promise<CardContext> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  const card = await readCardFileOrThrow(filePath, key);

  const codeLinks: ResolvedCodeLink[] = await resolveCardCodeLinks(ctx, fullKey);

  const relations = ctx.relationRepo.findByCardKey(key);
  const upstreamCards = relations
    .filter((r) => r.isReverse)
    .map((r) => ctx.cardRepo.findByKey(r.dstCardKey))
    .filter((r): r is CardRow => r !== null);
  const downstreamCards = relations
    .filter((r) => !r.isReverse)
    .map((r) => ctx.cardRepo.findByKey(r.dstCardKey))
    .filter((r): r is CardRow => r !== null);

  // Build parent chain (root → direct parent).
  const parentChain: CardRow[] = [];
  {
    const seen = new Set<string>([key]);
    let cur = card.frontmatter.parent ?? null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const row = ctx.cardRepo.findByKey(cur);
      if (!row) break;
      parentChain.unshift(row);
      cur = row.parent ?? null;
    }
  }

  const traceEdges = deriveTraceEdges(ctx, card.frontmatter);

  const depth = options?.depth ?? 1;
  if (depth <= 1) {
    return { card, codeLinks, upstreamCards, downstreamCards, parentChain, traceEdges };
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

  return { card, codeLinks, upstreamCards, downstreamCards, parentChain, traceEdges, related, truncated };
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
 * @spec card-storage/queries/get-list-search
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
 * @spec card-storage/queries/get-list-search
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
  for await (const { item: key, result } of batchedAllSettled(fullKeys, 20, (k) => getCard(ctx, k, options))) {
    if (result.status === 'fulfilled') cards.push(result.value);
    else if (result.reason instanceof CardNotFoundError) notFound.push(key);
    else throw result.reason;
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

/** @spec card-storage/queries/get-list-search */
export function listCards(ctx: EmberdeckContext, filter?: CardListFilter): CardSummaryRow[] {
  return ctx.cardRepo.list(filter).map(({ body, ...rest }) => rest);
}

export interface SearchCardsOptions {
  type?: CardType;
  status?: CardStatus;
  /** Push pagination to the DB so an unbounded ranked scan isn't materialized. */
  limit?: number;
  offset?: number;
}

/** Full-text search hit row from CardRepository.search — extends CardRow with FTS metadata. */
type SearchHitRow = CardRow & { snippet?: string; rank?: number };

/** FTS5 match metadata appended to each search hit. */
export interface SearchCardMatch extends CardSummaryRow {
  /** Short excerpt around the match (FTS5 `snippet()`). May be empty. */
  snippet: string;
  /** BM25 score; lower = stronger match. */
  rank: number;
}

/**
 * Searches cards using FTS5 full-text search, with optional type/status filters.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param query - Search query text. Returns an empty array if the query is empty.
 * @param options - Optional type and status filters.
 * @returns Array of match rows with `snippet` and `rank` for each hit.
 * @spec card-storage/queries/get-list-search
 */
export function searchCards(
  ctx: EmberdeckContext,
  query: string,
  options?: SearchCardsOptions,
): SearchCardMatch[] {
  // Push limit/offset down to the repo ONLY when no type/status post-filter
  // applies. Otherwise the DB would cap the ranked scan at `limit` rows BEFORE
  // type/status filtering removes some, returning fewer than `limit` matches
  // (or zero) even when matching rows exist further down the ranking.
  const hasPostFilter = Boolean(options?.type || options?.status);
  const repoOptions: { limit?: number; offset?: number } = {};
  if (!hasPostFilter) {
    if (options?.limit !== undefined) repoOptions.limit = options.limit;
    if (options?.offset !== undefined) repoOptions.offset = options.offset;
  }
  const results = ctx.cardRepo.search(query, repoOptions) as SearchHitRow[];
  const filtered = options
    ? results.filter((row) => {
        if (options.type && row.type !== options.type) return false;
        if (options.status && row.status !== options.status) return false;
        return true;
      })
    : results;

  // When DB pagination was bypassed, apply limit/offset in TS after filtering.
  const paged = hasPostFilter
    ? filtered.slice(
        options?.offset ?? 0,
        options?.limit !== undefined ? (options.offset ?? 0) + options.limit : undefined,
      )
    : filtered;

  return paged.map(({ body: _body, snippet, rank, ...rest }) => ({
    ...rest,
    snippet: snippet ?? '',
    rank: rank ?? 0,
  }));
}

/** Lightweight card view used by relation / context output shapes. */
export interface CardSummary {
  key: string;
  summary: string;
  type: string;
  status: string;
  parent: string | null;
}

export interface CardRelations {
  /** This card → other cards (forward declared in this card's `relations`). */
  forward: CardSummary[];
  /** Other cards → this card (reverse: those cards declared a relation to this one). */
  reverse: CardSummary[];
}

function toCardSummary(row: CardRow): CardSummary {
  return {
    key: row.key,
    summary: row.summary,
    type: row.type,
    status: row.status,
    parent: row.parent,
  };
}

/**
 * Resolve a card's direct relations into lightweight `CardSummary` shapes,
 * grouped by direction. Dead links (the relation row references a card that
 * no longer exists) are silently dropped — `ed validate cards` surfaces them.
 *
 * @spec card-storage/queries/get-list-search
 */
/** [§10 P3.3] Typed trace-edge kinds surfaced from a card's own namespace. */
export type TraceEdgeType = 'parent' | 'derives' | 'case-of' | 'invokes' | 'cross_domain';

export interface TraceEdge {
  type: TraceEdgeType;
  /** Target card key as declared (may not exist → dangling). */
  to: string;
  /** Item id carried by the reference (e.g. G-001 for derives, S-F-01 for case-of). */
  via?: string;
  /** Resolved target card, or null when the target does not exist (dangling). */
  target: CardSummary | null;
}

function parseRefKey(ref: string): { key: string; item: string } | null {
  const m = ref.match(/^([^#]+)#(.+)$/);
  return m ? { key: m[1]!, item: m[2]! } : null;
}

/**
 * Surface a card's *forward* typed trace edges (parent / derives → brief#goal /
 * case-of → brief#flow / invokes → spec / cross_domain → domain), each resolved
 * to its target card. Derived from the card's own namespace — no stored edges
 * (expose-don't-store). Makes "what does this card connect to" navigable beyond
 * the legacy `relations` field. §10 Phase 3.3
 *
 * @spec card-storage/queries/tree-context
 */
/** Derive forward trace edges from an already-parsed card frontmatter. */
function deriveTraceEdges(ctx: EmberdeckContext, fm: CardFrontmatter): TraceEdge[] {
  const edges: TraceEdge[] = [];
  const seen = new Set<string>();
  const add = (type: TraceEdgeType, to: string, via?: string): void => {
    const sig = `${type}:${to}:${via ?? ''}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const row = ctx.cardRepo.findByKey(to);
    edges.push({ type, to, ...(via ? { via } : {}), target: row ? toCardSummary(row) : null });
  };

  if (fm.parent) add('parent', fm.parent);
  if (fm.spec) {
    for (const p of fm.spec.preconditions) { const r = parseRefKey(p.derives); if (r) add('derives', r.key, r.item); }
    for (const p of fm.spec.postconditions) { const r = parseRefKey(p.derives); if (r) add('derives', r.key, r.item); }
    for (const f of fm.spec.failures) { if (f.case_of) { const r = parseRefKey(f.case_of); if (r) add('case-of', r.key, r.item); } }
    for (const iv of fm.spec.invokes ?? []) add('invokes', iv.to);
  }
  if (fm.domain?.cross_domain_dependencies) {
    for (const dep of fm.domain.cross_domain_dependencies) add('cross_domain', dep.domain);
  }
  return edges;
}

export async function listCardTraceEdges(ctx: EmberdeckContext, fullKey: string): Promise<TraceEdge[]> {
  const key = parseFullKey(fullKey);
  const card = await readCardFileOrThrow(buildCardPath(ctx.cardsDir, key), key);
  return deriveTraceEdges(ctx, card.frontmatter);
}

export function listCardRelations(ctx: EmberdeckContext, fullKey: string): CardRelations {
  const key = parseFullKey(fullKey);
  const rows = ctx.relationRepo.findByCardKey(key);
  const forward: CardSummary[] = [];
  const reverse: CardSummary[] = [];
  for (const rel of rows) {
    const target = ctx.cardRepo.findByKey(rel.dstCardKey);
    if (!target) continue;
    if (rel.isReverse) reverse.push(toCardSummary(target));
    else forward.push(toCardSummary(target));
  }
  return { forward, reverse };
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
 * @spec card-storage/queries/tree-context
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
