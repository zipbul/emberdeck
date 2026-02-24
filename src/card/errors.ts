export { CardKeyError } from './card-key';

/**
 * 카드 데이터가 유효하지 않을 때 throw된다.
 * YAML 파싱 실패, 필수 필드 누락, 제약 조건 위반 등 다양한 유효성 검사에서 사용된다.
 *
 * @example
 * throw new CardValidationError('summary is required');
 */
export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardValidationError';
  }
}

/**
 * 요청한 key에 해당하는 카드가 존재하지 않을 때 throw된다.
 * `getCard`, `updateCard`, `deleteCard`, `renameCard` 등 접근 연산에서 발생한다.
 */
export class CardNotFoundError extends Error {
  constructor(key: string) {
    super(`Card not found: "${key}"`);
    this.name = 'CardNotFoundError';
  }
}

/**
 * 동일한 key를 가진 카드가 이미 존재할 때 throw된다.
 * `createCard`, `renameCard` 에서 key 충돌 시 발생한다.
 */
export class CardAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Card already exists: "${key}"`);
    this.name = 'CardAlreadyExistsError';
  }
}

/**
 * `renameCard` 에서 소스와 대상 경로가 동일할 때 throw된다.
 * 실제 데이터 변경 없이 노이즈만 생성하는 no-op을 방지한다.
 */
export class CardRenameSamePathError extends Error {
  constructor() {
    super('No-op rename: source and target paths are identical');
    this.name = 'CardRenameSamePathError';
  }
}

/**
 * `allowedRelationTypes`에 등록되지 않은 관계 타입을 사용할 때 throw된다.
 * `createCard`, `updateCard`에서 `relations` 필드 검증 시 발생한다.
 * `addRelationType`로 새 타입을 등록하면 해결된다.
 */
export class RelationTypeError extends Error {
  constructor(type: string, allowed: readonly string[]) {
    super(`Invalid relation type "${type}". Allowed: ${allowed.join(', ')}`);
    this.name = 'RelationTypeError';
  }
}

/**
 * gildash를 사용하는 코드 링크 연산(`resolveCardCodeLinks`, `validateCodeLinks` 등)에서
 * `EmberdeckOptions.projectRoot`이 설정되지 않았을 때 throw된다.
 */
export class GildashNotConfiguredError extends Error {
  constructor() {
    super('gildash is not configured: set projectRoot in EmberdeckOptions');
    this.name = 'GildashNotConfiguredError';
  }
}

/**
 * DB 트랜젝션 성공 후 파일시스템 작업이 실패하고, 보상(rollback) 도중 추가로 실패한 때 throw된다.
 * `originalError`와 `compensationError` 모두를 포함하므로 로그로 기록해야 한다.
 * 이 상태는 데이터베이스와 파일시스템의 비일관성 위험이 있으므로 수동 접토가 필요할 수 있다.
 */
export class CompensationError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly compensationError: unknown,
  ) {
    super('Compensation failed after operation error');
    this.name = 'CompensationError';
  }
}
