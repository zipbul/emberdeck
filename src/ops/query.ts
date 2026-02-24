import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus } from '../card/types';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { resolveCardCodeLinks, type ResolvedCodeLink } from './link';

export interface RelationGraphNode {
  key: string;
  depth: number;
  relationType: string;
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
  const maxDepth = options?.maxDepth ?? Infinity;
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
        relationType: rel.type,
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

export async function getCard(ctx: EmberdeckContext, fullKey: string): Promise<CardFile> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  return readCardFile(filePath);
}

export function listCards(ctx: EmberdeckContext, filter?: { status?: CardStatus }): CardRow[] {
  return ctx.cardRepo.list(filter);
}

export function searchCards(ctx: EmberdeckContext, query: string): CardRow[] {
  return ctx.cardRepo.search(query);
}

export function listCardRelations(ctx: EmberdeckContext, fullKey: string): RelationRow[] {
  const key = parseFullKey(fullKey);
  return ctx.relationRepo.findByCardKey(key);
}
