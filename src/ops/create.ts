import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRelation, CardFile, CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError, RelationTypeError } from '../card/errors';
import { validateCardInput } from '../card/validation';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';

/**
 * `createCard`에 전달하는 입력 파라미터.
 */
export interface CreateCardInput {
  /** 카드 파일명이 될 slug. 영문/숫자/하이픈/언더스코어/점/슬래시만 허용. */
  slug: string;
  /** 카드 한줄 요약 (필수). */
  summary: string;
  /** 마크다운 본문 (선택). */
  body?: string;
  /** 검색용 키워드 목록 (선택). */
  keywords?: string[];
  /** 분류용 태그 목록 (선택). */
  tags?: string[];
  /** 다른 카드와의 관계 목록 (선택). 각 type은 allowedRelationTypes에 있어야 한다. */
  relations?: CardRelation[];
  /** 소스 코드 심볼 참조 목록 (선택). projectRoot 설정 시 gildash로 검증 가능. */
  codeLinks?: CodeLink[];
  /** 자유 형식 제약 조건 (선택). JSON 직렬화 가능해야 한다. */
  constraints?: unknown;
}

/**
 * `createCard` 성공 시 반환되는 결과.
 */
export interface CreateCardResult {
  /** 새로 생성된 카드 파일의 절대 경로. */
  filePath: string;
  /** 생성된 카드의 fullKey (= 정규화된 slug). */
  fullKey: string;
  /** 생성된 카드의 전체 데이터 (frontmatter + body). */
  card: CardFile;
}

/**
 * 새 설계 카드를 생성한다.
 *
 * 1. slug를 정규화하고 파일 경로를 계산한다.
 * 2. 관계 타입 유효성 검증 후 동일 key 중복 여부를 확인한다.
 * 3. DB 트랜잭션(카드·관계·분류·코드링크)과 파일 쓰기를 원자적으로 실행한다.
 * 4. 파일 쓰기 실패 시 DB를 롤백한다 (`safeWriteOperation`).
 *
 * 동일 ctx + key에 대한 동시 호출은 FIFO로 직렬화된다 (`withCardLock`).
 * SQLite BUSY 에러 시 지수 백오프로 재시도된다 (`withRetry`).
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param input - 생성할 카드 데이터.
 * @returns 생성 결과 (filePath, fullKey, card).
 * @throws {CardKeyError} slug가 유효하지 않을 때.
 * @throws {RelationTypeError} 허용되지 않는 관계 타입을 사용할 때.
 * @throws {CardAlreadyExistsError} 동일한 key의 카드가 이미 존재할 때.
 * @throws {CompensationError} DB 성공 후 파일 쓰기 실패 + 보상 실패 시.
 */
export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  validateCardInput({
    summary: input.summary,
    body: input.body,
    keywords: input.keywords,
    tags: input.tags,
    relations: input.relations,
    codeLinks: input.codeLinks,
  });
  const slug = normalizeSlug(input.slug);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);

  return withCardLock(ctx, fullKey, () =>
    withRetry(async () => {
      if (input.relations) {
        for (const rel of input.relations) {
          if (!ctx.allowedRelationTypes.includes(rel.type)) {
            throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
          }
        }
      }

      const exists = await Bun.file(filePath).exists();
      if (exists) {
        throw new CardAlreadyExistsError(fullKey);
      }

      const frontmatter = {
        key: fullKey,
        summary: input.summary,
        status: 'draft' as const,
        ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
        ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
        ...(input.codeLinks && input.codeLinks.length > 0 ? { codeLinks: input.codeLinks } : {}),
      };

      const body = input.body ?? '';
      const card: CardFile = { filePath, frontmatter, body };

      const now = new Date().toISOString();

      return safeWriteOperation({
        dbAction: () => {
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const cardRepo = new DrizzleCardRepository(d);
            const relationRepo = new DrizzleRelationRepository(d);
            const classRepo = new DrizzleClassificationRepository(d);
            const codeLinkRepo = new DrizzleCodeLinkRepository(d);

            const row: CardRow = {
              key: fullKey,
              summary: input.summary,
              status: 'draft',
              constraintsJson: input.constraints !== undefined ? JSON.stringify(input.constraints) : null,
              body,
              filePath,
              updatedAt: now,
            };

            cardRepo.upsert(row);
            if (input.relations && input.relations.length > 0) {
              relationRepo.replaceForCard(fullKey, input.relations);
            }
            if (input.keywords && input.keywords.length > 0) {
              classRepo.replaceKeywords(fullKey, input.keywords);
            }
            if (input.tags && input.tags.length > 0) {
              classRepo.replaceTags(fullKey, input.tags);
            }
            if (input.codeLinks && input.codeLinks.length > 0) {
              codeLinkRepo.replaceForCard(fullKey, input.codeLinks);
            }
          });
          return { filePath, fullKey, card } as CreateCardResult;
        },
        fileAction: async () => {
          await mkdir(dirname(filePath), { recursive: true });
          await writeCardFile(filePath, card);
        },
        compensate: () => {
          ctx.cardRepo.deleteByKey(fullKey);
        },
      });
    }),
  );
}
