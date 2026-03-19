import { join } from 'node:path';

const CARD_SLUG_RE =
  /^(?![A-Za-z]:)(?!.*::)(?!.*:)(?!.*\/\/)(?!\.{1,2}$)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Thrown when a card slug or key is invalid.
 * Occurs when disallowed characters, Windows drive paths, relative paths (`..`), etc. are included.
 *
 * @example
 * normalizeSlug(''); // throws CardKeyError
 * normalizeSlug('../evil'); // throws CardKeyError
 */
export class CardKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardKeyError';
  }
}

function assertValidSlug(slug: string): void {
  if (!CARD_SLUG_RE.test(slug)) {
    throw new CardKeyError(`Invalid card slug: ${slug}`);
  }
}

/**
 * Normalizes backslashes to forward slashes in the slug, strips leading/trailing slashes,
 * then validates against the CARD_SLUG_RE pattern.
 *
 * @spec card-model
 * @param slug - Input slug. Throws CardKeyError if empty.
 * @returns The normalized slug string.
 * @throws {CardKeyError} When the slug is invalid.
 */
export function normalizeSlug(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  assertValidSlug(normalized);
  return normalized;
}

/**
 * Validates the fullKey and returns the normalized slug.
 * Entry point for normalizing keys received from the API at the ops layer.
 *
 * @spec card-model
 * @param fullKey - Card identifier string.
 * @returns The normalized slug.
 * @throws {CardKeyError} When fullKey is empty or invalid.
 */
export function parseFullKey(fullKey: string): string {
  if (typeof fullKey !== 'string' || fullKey.length === 0) {
    throw new CardKeyError('Invalid card key: empty');
  }
  return normalizeSlug(fullKey);
}

/**
 * cardsDir + slug → absolute path to the card file (`*.card.md`).
 *
 * @spec card-model
 * @example
 * buildCardPath('/data/cards', 'auth-token')
 * // → '/data/cards/auth-token.card.md'
 */
export function buildCardPath(cardsDir: string, slug: string): string {
  return join(cardsDir, `${slug}.card.md`);
}
