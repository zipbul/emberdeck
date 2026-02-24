import { join } from 'node:path';

const CARD_SLUG_RE =
  /^(?![A-Za-z]:)(?!.*::)(?!.*:)(?!.*\/\/)(?!\.{1,2}$)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * 유효하지 않은 카드 slug 또는 key일 때 throw된다.
 * 허용되지 않는 문자, Windows 드라이브 경로, 상대 경로(`..`) 등이 포함되었을 때 발생한다.
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
 * slug의 백슬래시를 슬래시로 정규화하고 선행/후행 슬래시를 제거한 후
 * CARD_SLUG_RE 패턴으로 유효성을 검증다.
 *
 * @param slug - 입력 slug. 비어 있으면 CardKeyError가 throw된다.
 * @returns 정규화된 slug 문자열.
 * @throws {CardKeyError} slug이 유효하지 않을 때.
 */
export function normalizeSlug(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  assertValidSlug(normalized);
  return normalized;
}

/**
 * fullKey를 유효성 검증한 후 정규화된 slug으로 반환한다.
 * ops 레이어에서 API로 입력된 key를 정규화하는 진입점.
 *
 * @param fullKey - 카드 식별자 문자열.
 * @returns 정규화된 slug.
 * @throws {CardKeyError} fullKey가 비어 있거나 유효하지 않을 때.
 */
export function parseFullKey(fullKey: string): string {
  if (typeof fullKey !== 'string' || fullKey.length === 0) {
    throw new CardKeyError('Invalid card key: empty');
  }
  return normalizeSlug(fullKey);
}

/**
 * cardsDir + slug → 카드 파일 절대 경로 (`*.card.md`).
 *
 * @example
 * buildCardPath('/data/cards', 'auth-token')
 * // → '/data/cards/auth-token.card.md'
 */
export function buildCardPath(cardsDir: string, slug: string): string {
  return join(cardsDir, `${slug}.card.md`);
}
