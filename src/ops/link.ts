import { isErr } from '@zipbul/result';
import type { SymbolSearchResult } from '@zipbul/gildash';

import type { EmberdeckContext } from '../config';
import type { CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { GildashNotConfiguredError, CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';

// ---- Public Types ----

export interface ResolvedCodeLink {
  link: CodeLink;
  /** gildash에서 찾은 심볼. null이면 심볼 없음 (깨진 링크). */
  symbol: SymbolSearchResult | null;
}

export interface BrokenLink {
  link: CodeLink;
  reason: 'symbol-not-found' | 'file-not-indexed';
}

// ---- Helpers ----

async function readCard(ctx: EmberdeckContext, fullKey: string) {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) {
    throw new CardNotFoundError(key);
  }
  return readCardFile(filePath);
}

// ---- Operations ----

/**
 * 카드의 codeLinks를 gildash 심볼 인덱스에서 조회하여 반환.
 * gildash 미설정 시 GildashNotConfiguredError throw.
 */
export async function resolveCardCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ResolvedCodeLink[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  const cardFile = await readCard(ctx, fullKey);
  const codeLinks = cardFile.frontmatter.codeLinks ?? [];
  if (codeLinks.length === 0) return [];

  const result: ResolvedCodeLink[] = [];
  for (const link of codeLinks) {
    const search = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (isErr(search)) {
      result.push({ link, symbol: null });
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file) ?? null;
    result.push({ link, symbol: found });
  }
  return result;
}

/**
 * 심볼 이름(+ 선택적 파일 경로)으로 해당 심볼을 참조하는 카드 목록 반환.
 */
export function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): CardRow[] {
  const rows = ctx.codeLinkRepo.findBySymbol(symbolName, filePath);
  const seen = new Set<string>();
  const result: CardRow[] = [];
  for (const row of rows) {
    if (seen.has(row.cardKey)) continue;
    seen.add(row.cardKey);
    const card = ctx.cardRepo.findByKey(row.cardKey);
    if (card) result.push(card);
  }
  return result;
}

/**
 * 변경된 파일 목록 → 해당 파일의 심볼을 codeLink로 참조하는 카드 목록 반환.
 */
export async function findAffectedCards(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<CardRow[]> {
  if (changedFiles.length === 0) return [];

  const seen = new Set<string>();
  for (const file of changedFiles) {
    const rows = ctx.codeLinkRepo.findByFile(file);
    for (const row of rows) {
      seen.add(row.cardKey);
    }
  }

  const result: CardRow[] = [];
  for (const key of seen) {
    const card = ctx.cardRepo.findByKey(key);
    if (card) result.push(card);
  }
  return result;
}

/**
 * 카드의 모든 codeLink가 현재 심볼 인덱스에 존재하는지 검증.
 * 깨진 링크 목록을 반환. 빈 배열이면 전부 유효.
 */
export async function validateCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<BrokenLink[]> {
  if (!ctx.gildash) throw new GildashNotConfiguredError();

  const cardFile = await readCard(ctx, fullKey);
  const codeLinks = cardFile.frontmatter.codeLinks ?? [];
  if (codeLinks.length === 0) return [];

  const broken: BrokenLink[] = [];
  for (const link of codeLinks) {
    const search = ctx.gildash.searchSymbols({
      text: link.symbol,
      exact: true,
      filePath: link.file,
    });

    if (isErr(search)) {
      broken.push({ link, reason: 'file-not-indexed' });
      continue;
    }

    const found = search.find((s) => s.name === link.symbol && s.filePath === link.file);
    if (!found) {
      broken.push({ link, reason: 'symbol-not-found' });
    }
  }
  return broken;
}
