export { CardKeyError } from './card-key';

/**
 * Thrown when card data is invalid.
 * Used in various validations such as YAML parse failures, missing required fields, and constraint violations.
 */
export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardValidationError';
  }
}

/**
 * Thrown when no card exists for the requested key.
 * Occurs in access operations such as `getCard`, `updateCard`, `deleteCard`, `renameCard`.
 */
export class CardNotFoundError extends Error {
  constructor(key: string) {
    super(`Card not found: "${key}"`);
    this.name = 'CardNotFoundError';
  }
}

/**
 * Thrown when a card with the same key already exists.
 * Occurs on key collision in `createCard` and `renameCard`.
 */
export class CardAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Card already exists: "${key}"`);
    this.name = 'CardAlreadyExistsError';
  }
}

/**
 * Thrown when source and target paths are identical in `renameCard`.
 * Prevents a no-op that would generate noise without any actual data change.
 */
export class CardRenameSamePathError extends Error {
  constructor() {
    super('No-op rename: source and target paths are identical');
    this.name = 'CardRenameSamePathError';
  }
}

/**
 * Thrown when parent validation fails.
 * Covers: non-existent parent, type hierarchy violation, circular reference.
 */
export class ParentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParentValidationError';
  }
}

/**
 * Thrown when activation guard conditions are not met.
 * Contains the list of unmet conditions for the caller to display.
 */
export class ActivationGuardError extends Error {
  constructor(
    message: string,
    public readonly unmetConditions: string[],
  ) {
    super(message);
    this.name = 'ActivationGuardError';
  }
}

/**
 * Thrown when a filesystem operation fails after a successful DB transaction, and the
 * compensation (rollback) also fails. Contains both `originalError` and `compensationError`,
 * so both should be logged. This state risks database-filesystem inconsistency and may
 * require manual inspection.
 */
/**
 * Thrown when a card_fts MATCH query is malformed (unbalanced quotes, unknown
 * special syntax, etc.). Distinct from internal errors so the CLI can surface
 * a clean usage message instead of a generic failure.
 */
export class FtsSyntaxError extends Error {
  constructor(query: string, original: string) {
    super(`invalid FTS5 search syntax in query "${query}": ${original}`);
    this.name = 'FtsSyntaxError';
  }
}

export class CompensationError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly compensationError: unknown,
  ) {
    super('Compensation failed after operation error');
    this.name = 'CompensationError';
  }
}
