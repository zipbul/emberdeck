export { CardKeyError } from './card-key';

/**
 * Thrown when card data is invalid.
 * Used in various validations such as YAML parse failures, missing required fields, and constraint violations.
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
 * Thrown when a relation type not registered in `allowedRelationTypes` is used.
 * Occurs during `relations` field validation in `createCard` and `updateCard`.
 * Can be resolved by registering the new type with `addRelationType`.
 */
export class RelationTypeError extends Error {
  constructor(type: string, allowed: readonly string[]) {
    super(`Invalid relation type "${type}". Allowed: ${allowed.join(', ')}`);
    this.name = 'RelationTypeError';
  }
}

/**
 * Thrown when `EmberdeckOptions.projectRoot` is not configured in code link operations
 * that use gildash (`resolveCardCodeLinks`, `validateCodeLinks`, etc.).
 */
export class GildashNotConfiguredError extends Error {
  constructor() {
    super('gildash is not configured: set projectRoot in EmberdeckOptions');
    this.name = 'GildashNotConfiguredError';
  }
}

/**
 * Thrown when a filesystem operation fails after a successful DB transaction, and the
 * compensation (rollback) also fails. Contains both `originalError` and `compensationError`,
 * so both should be logged. This state risks database-filesystem inconsistency and may
 * require manual inspection.
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
