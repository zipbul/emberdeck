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
  /** Maximum item count for array fields (tags, relations, codeLinks) */
  ARRAY_MAX: 100,
  /** Maximum length of individual tag items */
  ITEM_MAX: 100,
  /** Maximum length of relations[] items (card keys) */
  RELATION_TARGET_MAX: 200,
  /** Maximum length of codeLinks[].symbol */
  CODE_LINK_SYMBOL_MAX: 200,
  /** Maximum length of codeLinks[].file */
  CODE_LINK_FILE_MAX: 500,
  /** Maximum length of card key */
  KEY_MAX: 200,
  /** Maximum number of boundary patterns */
  BOUNDARY_MAX_PATTERNS: 50,
  /** Maximum length of each boundary pattern */
  BOUNDARY_PATTERN_MAX: 500,
} as const;

/**
 * Input interface passed to `validateCardInput`.
 * If a field is `undefined`, validation for that field is skipped.
 */
export interface ValidationInput {
  key?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  relations?: string[];
  codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
  boundary?: string[];
}

/**
 * Validates size limits of card input values.
 * Throws {@link CardValidationError} on violation.
 * Fields are checked in order, so only the first violation is reported.
 *
 * @spec card-model
 * @param input - The input object to validate. `undefined` fields are skipped.
 * @throws {CardValidationError} On size limit violation.
 */
export function validateCardInput(input: ValidationInput): void {
  const { key, summary, body, tags, relations, codeLinks, boundary } = input;

  // ── key ────────────────────────────────────────────────────
  if (key !== undefined && key.length > LIMITS.KEY_MAX) {
    throw new CardValidationError(
      `key exceeds maximum length of ${LIMITS.KEY_MAX} characters (got ${key.length})`,
    );
  }

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
      if (rel.length === 0) {
        throw new CardValidationError('relation item must not be empty');
      }
      if (rel.length > LIMITS.RELATION_TARGET_MAX) {
        throw new CardValidationError(
          `relation item exceeds maximum length of ${LIMITS.RELATION_TARGET_MAX} characters`,
        );
      }
    }
    // Self-reference check requires card key context — done at ops layer
  }

  // ── codeLinks ─────────────────────────────────────────────
  if (codeLinks !== undefined) {
    if (codeLinks.length > LIMITS.ARRAY_MAX) {
      throw new CardValidationError(
        `codeLinks array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${codeLinks.length})`,
      );
    }
    for (const link of codeLinks) {
      if (link.file.length === 0) {
        throw new CardValidationError('codeLink file must not be empty');
      }
      if (link.symbol.length === 0) {
        throw new CardValidationError('codeLink symbol must not be empty');
      }
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

  // ── boundary ──────────────────────────────────────────────
  if (boundary !== undefined) {
    if (boundary.length > LIMITS.BOUNDARY_MAX_PATTERNS) {
      throw new CardValidationError(
        `boundary array exceeds maximum of ${LIMITS.BOUNDARY_MAX_PATTERNS} patterns (got ${boundary.length})`,
      );
    }
    for (const pattern of boundary) {
      if (pattern.length === 0) {
        throw new CardValidationError('boundary pattern must not be empty');
      }
      if (pattern.length > LIMITS.BOUNDARY_PATTERN_MAX) {
        throw new CardValidationError(
          `boundary pattern exceeds maximum length of ${LIMITS.BOUNDARY_PATTERN_MAX} characters`,
        );
      }
      // Validate glob syntax
      try {
        new Bun.Glob(pattern);
      } catch {
        throw new CardValidationError(`boundary pattern is not valid glob syntax: "${pattern}"`);
      }
    }
  }
}
