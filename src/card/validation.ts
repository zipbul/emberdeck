import { CardValidationError } from './errors';

/**
 * Per-field maximum size constants applied by `validateCardInput`.
 * Shared across the operation layer (create, update) and tests.
 */
export const LIMITS = {
  /** Maximum length of summary (character count) */
  SUMMARY_MAX: 500,
  /** Maximum length of body (character count) */
  BODY_MAX: 100_000,
  /** Maximum item count for array fields (keywords, tags, relations, codeLinks) */
  ARRAY_MAX: 100,
  /** Maximum length of individual keywords/tags items */
  ITEM_MAX: 100,
  /** Maximum length of relations[].target */
  RELATION_TARGET_MAX: 200,
  /** Maximum length of codeLinks[].symbol */
  CODE_LINK_SYMBOL_MAX: 200,
  /** Maximum length of codeLinks[].file */
  CODE_LINK_FILE_MAX: 500,
} as const;

/**
 * Input interface passed to `validateCardInput`.
 * If a field is `undefined`, validation for that field is skipped.
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
 * Validates size limits of card input values.
 * Throws {@link CardValidationError} on violation.
 * Fields are checked in order (summary → body → keywords → tags → relations → codeLinks),
 * so only the first violation is reported even if multiple violations exist.
 *
 * @param input - The input object to validate. `undefined` fields are skipped.
 * @throws {CardValidationError} On size limit violation.
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
      if (kw.length === 0) {
        throw new CardValidationError('keyword item must not be empty');
      }
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
      if (tag.length === 0) {
        throw new CardValidationError('tag item must not be empty');
      }
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
