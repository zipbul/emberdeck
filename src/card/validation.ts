import { CardValidationError } from './errors';

/**
 * `validateCardInput`이 적용하는 필드별 최대 크기 상수.
 * 연산 계층(create, update)과 테스트에서 공유된다.
 */
export const LIMITS = {
  /** summary 최대 길이 (문자 수) */
  SUMMARY_MAX: 500,
  /** body 최대 길이 (문자 수) */
  BODY_MAX: 100_000,
  /** 배열 필드(keywords, tags, relations, codeLinks) 최대 항목 수 */
  ARRAY_MAX: 100,
  /** keywords/tags 개별 항목 최대 길이 */
  ITEM_MAX: 100,
  /** relations[].target 최대 길이 */
  RELATION_TARGET_MAX: 200,
  /** codeLinks[].symbol 최대 길이 */
  CODE_LINK_SYMBOL_MAX: 200,
  /** codeLinks[].file 최대 길이 */
  CODE_LINK_FILE_MAX: 500,
} as const;

/**
 * `validateCardInput`에 전달하는 입력 인터페이스.
 * 필드가 `undefined`이면 해당 필드 검사를 건너뛴다.
 */
export interface ValidationInput {
  summary?: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
  relations?: Array<{ type: string; target: string }>;
  codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
}

/**
 * 카드 입력값의 크기 제한을 검사한다.
 * 위반 시 {@link CardValidationError}를 throw한다.
 * 필드 순서대로 검사(summary → body → keywords → tags → relations → codeLinks)되므로
 * 복수 위반이 있어도 첫 번째 위반만 보고된다.
 *
 * @param input - 검사할 입력 객체. `undefined` 필드는 건너뛴다.
 * @throws {CardValidationError} 크기 제한 위반 시
 */
export function validateCardInput(input: ValidationInput): void {
  const { summary, body, keywords, tags, relations, codeLinks } = input;

  // ── summary ──────────────────────────────────────────────
  if (summary !== undefined) {
    if (summary.length === 0) {
      throw new CardValidationError('summary must not be empty');
    }
    if (summary.length > LIMITS.SUMMARY_MAX) {
      throw new CardValidationError(
        `summary exceeds maximum length of ${LIMITS.SUMMARY_MAX} characters (got ${summary.length})`,
      );
    }
  }

  // ── body ─────────────────────────────────────────────────
  if (body !== undefined && body.length > LIMITS.BODY_MAX) {
    throw new CardValidationError(
      `body exceeds maximum length of ${LIMITS.BODY_MAX} characters (got ${body.length})`,
    );
  }

  // ── keywords ─────────────────────────────────────────────
  if (keywords !== undefined) {
    if (keywords.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `keywords array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${keywords.length})`,
      );
    }
    for (const kw of keywords) {
      if (kw.length > LIMITS.ITEM_MAX) {
        throw new CardValidationError(
          `keyword item exceeds maximum length of ${LIMITS.ITEM_MAX} characters`,
        );
      }
    }
  }

  // ── tags ─────────────────────────────────────────────────
  if (tags !== undefined) {
    if (tags.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `tags array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${tags.length})`,
      );
    }
    for (const tag of tags) {
      if (tag.length > LIMITS.ITEM_MAX) {
        throw new CardValidationError(
          `tag item exceeds maximum length of ${LIMITS.ITEM_MAX} characters`,
        );
      }
    }
  }

  // ── relations ─────────────────────────────────────────────
  if (relations !== undefined) {
    if (relations.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `relations array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${relations.length})`,
      );
    }
    for (const rel of relations) {
      if (rel.target.length > LIMITS.RELATION_TARGET_MAX) {
        throw new CardValidationError(
          `relation target exceeds maximum length of ${LIMITS.RELATION_TARGET_MAX} characters`,
        );
      }
    }
  }

  // ── codeLinks ─────────────────────────────────────────────
  if (codeLinks !== undefined) {
    if (codeLinks.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `codeLinks array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${codeLinks.length})`,
      );
    }
    for (const link of codeLinks) {
      if (link.symbol.length > LIMITS.CODE_LINK_SYMBOL_MAX) {
        throw new CardValidationError(
          `codeLink symbol exceeds maximum length of ${LIMITS.CODE_LINK_SYMBOL_MAX} characters`,
        );
      }
      if (link.file.length > LIMITS.CODE_LINK_FILE_MAX) {
        throw new CardValidationError(
          `codeLink file path exceeds maximum length of ${LIMITS.CODE_LINK_FILE_MAX} characters`,
        );
      }
    }
  }
}
