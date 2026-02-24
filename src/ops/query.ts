import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus } from '../card/types';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { resolveCardCodeLinks, type ResolvedCodeLink } from './link';

/**
 * 카드 고유 식별자와 DB에서의 위치 정보를 담는 관계 그래프 노드.
 */
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

/**
 * 카드를 파일에서 읽어 반환한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 조회할 카드의 fullKey.
 * @returns frontmatter + body 전체.
 * @throws {CardNotFoundError} 파일이 존재하지 않을 때.
 */
export async function getCard(ctx: EmberdeckContext, fullKey: string): Promise<CardFile> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  return readCardFile(filePath);
}

/**
 * DB에서 카드 목록을 조회한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param filter - 선택적 필터. `status`로 상태를 필터링한다.
 * @returns DB row 배열 (파일 미읽기, 경량 조회).
 */
export function listCards(ctx: EmberdeckContext, filter?: { status?: CardStatus }): CardRow[] {
  return ctx.cardRepo.list(filter);
}

/**
 * FTS5 전문 검색으로 카드를 조회한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param query - 검색어. 빈 문자열이면 빈 배열 반환.
 * @returns 검색에 매칭된 DB row 배열.
 */
export function searchCards(ctx: EmberdeckContext, query: string): CardRow[] {
  return ctx.cardRepo.search(query);
}

/**
 * 카드의 관계 목록을 반환한다 (forward + reverse 모두 포함).
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 조회할 카드의 fullKey.
 * @returns `isReverse=false`이면 outgoing, `isReverse=true`이면 incoming 관계.
 */
export function listCardRelations(ctx: EmberdeckContext, fullKey: string): RelationRow[] {
  const key = parseFullKey(fullKey);
  return ctx.relationRepo.findByCardKey(key);
}
