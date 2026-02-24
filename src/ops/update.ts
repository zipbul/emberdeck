import type { EmberdeckContext } from '../config';
import type { CardFile, CardFrontmatter, CardRelation, CardStatus, CodeLink } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, RelationTypeError } from '../card/errors';
import { validateCardInput } from '../card/validation';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { txDb } from '../db/connection';
import { withCardLock, withRetry, safeWriteOperation } from './safe';
import { syncCardFromFile } from './sync';

/**
 * `updateCard`에 전달하는 부분 업데이트 필드.
 * `undefined`인 필드는 변경하지 않는다. `null`은 해당 필드를 삭제한다.
 */
export interface UpdateCardFields {
  /** 새 요약. undefined이면 유지. */
  summary?: string;
  /** 새 본문. undefined이면 유지. */
  body?: string;
  /** 키워드. null 또는 빈 배열은 필드 삭제. */
  keywords?: string[] | null;
  /** 태그. null 또는 빈 배열은 필드 삭제. */
  tags?: string[] | null;
  /** 제약 조건. undefined이면 유지. */
  constraints?: unknown;
  /** 관계 목록. null 또는 빈 배열은 필드 삭제. */
  relations?: CardRelation[] | null;
  /** 코드 링크 목록. null 또는 빈 배열은 필드 삭제. */
  codeLinks?: CodeLink[] | null;
}

/**
 * `updateCard` 성공 시 반환되는 결과.
 */
export interface UpdateCardResult {
  /** 업데이트된 카드 파일의 절대 경로. */
  filePath: string;
  /** 업데이트된 전체 카드 데이터. */
  card: CardFile;
}

/**
 * 기존 카드를 부분 업데이트한다.
 *
 * - `undefined`인 `fields` 항목은 변경하지 않는다.
 * - `null` 또는 빈 배열로 설정하면 해당 frontmatter 필드를 삭제한다.
 * - 파일 쓰기 실패 시 `syncCardFromFile`로 DB를 보상한다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 업데이트할 카드의 fullKey.
 * @param fields - 변경할 필드들. 지정하지 않은 카드는 유지된다.
 * @returns 업데이트된 결과 (filePath, card).
 * @throws {CardKeyError} fullKey가 유효하지 않을 때.
 * @throws {CardNotFoundError} 해당 key의 카드가 없었을 때.
 * @throws {RelationTypeError} 허용되지 않는 관계 타입을 사용할 때.
 */
export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  validateCardInput({
    summary: fields.summary,
    body: fields.body,
    keywords: fields.keywords ?? undefined,
    tags: fields.tags ?? undefined,
    relations: fields.relations ?? undefined,
    codeLinks: fields.codeLinks ?? undefined,
  });
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      if (!(await Bun.file(filePath).exists())) {
        throw new CardNotFoundError(key);
      }

      const current = await readCardFile(filePath);
      if (current.frontmatter.key !== key) {
        throw new CardNotFoundError(key);
      }

      if (fields.relations && fields.relations !== null) {
        for (const rel of fields.relations) {
          if (!ctx.allowedRelationTypes.includes(rel.type)) {
            throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
          }
        }
      }

      const next: CardFrontmatter = { ...current.frontmatter };
      if (fields.summary !== undefined) next.summary = fields.summary;
      if (fields.keywords !== undefined) {
        if (fields.keywords === null || fields.keywords.length === 0) delete next.keywords;
        else next.keywords = fields.keywords;
      }
      if (fields.tags !== undefined) {
        if (fields.tags === null || fields.tags.length === 0) delete next.tags;
        else next.tags = fields.tags;
      }
      if (fields.constraints !== undefined) next.constraints = fields.constraints;
      if (fields.relations !== undefined) {
        if (fields.relations === null || fields.relations.length === 0) delete next.relations;
        else next.relations = fields.relations;
      }
      if (fields.codeLinks !== undefined) {
        if (fields.codeLinks === null || fields.codeLinks.length === 0) delete next.codeLinks;
        else next.codeLinks = fields.codeLinks;
      }

      const nextBody = fields.body !== undefined ? fields.body : current.body;
      const card: CardFile = { filePath, frontmatter: next, body: nextBody };

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
              key,
              summary: next.summary,
              status: next.status,
              constraintsJson: next.constraints ? JSON.stringify(next.constraints) : null,
              body: nextBody,
              filePath,
              updatedAt: now,
            };
            cardRepo.upsert(row);

            if (fields.relations !== undefined) relationRepo.replaceForCard(key, next.relations ?? []);
            if (fields.keywords !== undefined) classRepo.replaceKeywords(key, next.keywords ?? []);
            if (fields.tags !== undefined) classRepo.replaceTags(key, next.tags ?? []);
            if (fields.codeLinks !== undefined) codeLinkRepo.replaceForCard(key, next.codeLinks ?? []);
          });
          return { filePath, card } as UpdateCardResult;
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}

/**
 * 카드 상태만 변경한다.
 *
 * `updateCard`의 상태 전용 단축 헬퍼. 다른 필드는 변경하지 않는다.
 *
 * @param ctx - `setupEmberdeck()`으로 생성된 컨텍스트.
 * @param fullKey - 업데이트할 카드의 fullKey.
 * @param status - 새 상태 값.
 * @returns 업데이트된 결과 (filePath, card).
 * @throws {CardNotFoundError} 해당 key의 카드가 없었을 때.
 */
export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  return withCardLock(ctx, key, () =>
    withRetry(async () => {
      if (!(await Bun.file(filePath).exists())) {
        throw new CardNotFoundError(key);
      }

      const current = await readCardFile(filePath);
      if (current.frontmatter.key !== key) {
        throw new CardNotFoundError(key);
      }

      const card: CardFile = {
        filePath,
        frontmatter: { ...current.frontmatter, status },
        body: current.body,
      };

      const now = new Date().toISOString();

      return safeWriteOperation({
        dbAction: () => {
          const existing = ctx.cardRepo.findByKey(key);
          const row: CardRow = existing
            ? { ...existing, status, updatedAt: now }
            : {
                key,
                summary: current.frontmatter.summary,
                status,
                constraintsJson: current.frontmatter.constraints
                  ? JSON.stringify(current.frontmatter.constraints)
                  : null,
                body: current.body,
                filePath,
                updatedAt: now,
              };
          ctx.cardRepo.upsert(row);
          return { filePath, card } as UpdateCardResult;
        },
        fileAction: async () => {
          await writeCardFile(filePath, card);
        },
        compensate: async () => {
          await syncCardFromFile(ctx, filePath);
        },
      });
    }),
  );
}
