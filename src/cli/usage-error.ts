/**
 * User-input misuse at the CLI layer (wrong flag combo, malformed --field=...,
 * unsupported value, etc.). Maps to exit 2 (per bash convention for misuse).
 * Distinct from ops-layer validation errors (which carry CardValidationError etc.).
 *
 * Lives in its own module so output.ts / confirm.ts can throw it without a
 * circular dep with errors.ts (which imports CliMessage from output.ts).
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}
