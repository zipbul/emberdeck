import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus, CardType } from '../card/types';
import type { CardRow, CardListFilter, RelationRow, ChangelogRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
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

export interface CardContext {
  card: CardFile;
  codeLinks: ResolvedCodeLink[];
  upstreamCards: CardRow[];
  downstreamCards: CardRow[];
}

export async function getCardContext(ctx: EmberdeckContext, fullKey: string): Promise<CardContext> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  const card = await readCardFile(filePath);

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

  return { card, codeLinks, upstreamCards, downstreamCards };
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
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  const card = await readCardFile(filePath);

  const result: GetCardResult = { card };
  if (options?.includeHistory) {
    result.history = ctx.changelogRepo.findByCardKey(key);
  }
  return result;
}

/**
 * Lists cards from the DB.
 *
 * @param ctx - Context created by `setupEmberdeck()`.
 * @param filter - Optional filter. Supports status, type, parent, tag, roots, updatedSince, sortBy.
 * @returns Array of DB rows (no file reads, lightweight query).
 */
export function listCards(ctx: EmberdeckContext, filter?: CardListFilter): CardRow[] {
  return ctx.cardRepo.list(filter);
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
): CardRow[] {
  const results = ctx.cardRepo.search(query);
  if (!options) return results;

  return results.filter((row) => {
    if (options.type && row.type !== options.type) return false;
    if (options.status && row.status !== options.status) return false;
    return true;
  });
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
