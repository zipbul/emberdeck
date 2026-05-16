/**
 * Map ops-layer errors → stderr JSON-line error objects with stable kebab codes.
 * Stable codes (values) are part of the public CLI contract; uppercase TS keys
 * are internal lookup names only.
 */

import {
  CardKeyError,
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  ParentValidationError,
  ActivationGuardError,
  CompensationError,
  FtsSyntaxError,
} from '../card/errors';
import { GildashInitError } from '../setup';
import { GlossaryParseError, GlossaryValidationError } from '../glossary/io';
import { GlossaryNotFoundError } from '../glossary/errors';
import { ConfigLoadError } from '../config-file';
import { CliUsageError } from './usage-error';
import { EXIT, type ExitCode } from './exit-codes';
import { errorMessage } from '../util/error';

export interface CliErrorLine {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Map kebab error code (value) → ExitCode.
// `code` here is the kebab string actually emitted on stderr.
export const ERROR_CODE_TO_EXIT: Record<string, ExitCode> = {
  // Card surface
  'card-not-found': EXIT.NOT_FOUND,
  'card-already-exists': EXIT.CONFLICT,
  'rename-same-path': EXIT.CONFLICT,
  'invalid-card-key': EXIT.VALIDATION_FAILURE,
  'validation-error': EXIT.VALIDATION_FAILURE,
  'parent-validation-error': EXIT.VALIDATION_FAILURE,
  'fts-syntax-error': EXIT.VALIDATION_FAILURE,
  'activation-guard-failed': EXIT.VALIDATION_FAILURE,
  'boundary-validation-error': EXIT.VALIDATION_FAILURE,
  // Glossary
  'glossary-parse-error': EXIT.VALIDATION_FAILURE,
  'glossary-validation-error': EXIT.VALIDATION_FAILURE,
  'glossary-not-found': EXIT.NOT_FOUND,
  // Setup
  'gildash-init-failed': EXIT.CONFIG_MISSING,
  'config-missing-file': EXIT.CONFIG_MISSING,
  'config-parse-error': EXIT.VALIDATION_FAILURE,
  'config-validation-error': EXIT.VALIDATION_FAILURE,
  // CLI usage
  'cli-usage-error': EXIT.VALIDATION_FAILURE,
  // Compensation / internal
  'compensation-failed': EXIT.GENERIC_ERROR,
  'internal-error': EXIT.GENERIC_ERROR,
  // Output / IO
  'output-encode-failed': EXIT.GENERIC_ERROR,
  'stdout-write-failed': EXIT.PERMISSION_OR_IO,
};

// Simple class-to-kebab-code map. Lookup TS keys stay UPPER_SNAKE for
// readability; values are the emitted kebab codes.
const SIMPLE_ERROR_CODES: Array<[new (...args: never[]) => Error, string]> = [
  [CliUsageError, 'cli-usage-error'],
  [FtsSyntaxError, 'fts-syntax-error'],
  [CardNotFoundError, 'card-not-found'],
  [CardAlreadyExistsError, 'card-already-exists'],
  [CardKeyError, 'invalid-card-key'],
  [CardValidationError, 'validation-error'],
  [ParentValidationError, 'parent-validation-error'],
  [GildashInitError, 'gildash-init-failed'],
  [CardRenameSamePathError, 'rename-same-path'],
  [GlossaryParseError, 'glossary-parse-error'],
  [GlossaryNotFoundError, 'glossary-not-found'],
  [GlossaryValidationError, 'glossary-validation-error'],
];

/** @spec cli-surface/command-routing-and-output/runner-and-output */
export function toCliError(e: unknown): CliErrorLine {
  // Errors that carry structured details first.
  if (e instanceof ConfigLoadError) {
    const codeMap: Record<string, string> = {
      FILE_NOT_FOUND: 'config-missing-file',
      PARSE_ERROR: 'config-parse-error',
      VALIDATION_ERROR: 'config-validation-error',
    };
    return {
      code: codeMap[e.configError.code] ?? 'config-validation-error',
      message: e.message,
      ...(e.configError.filePath ? { details: { filePath: e.configError.filePath } } : {}),
    };
  }
  if (e instanceof ActivationGuardError) {
    return {
      code: 'activation-guard-failed',
      message: e.message,
      details: { unmetConditions: e.unmetConditions },
    };
  }
  if (e instanceof CompensationError) {
    return {
      code: 'compensation-failed',
      message: e.message,
      details: {
        originalError: String(e.originalError),
        compensationError: String(e.compensationError),
      },
    };
  }
  for (const [Cls, code] of SIMPLE_ERROR_CODES) {
    if (e instanceof Cls) return { code, message: e.message };
  }
  return {
    code: 'internal-error',
    message: errorMessage(e),
    ...(e instanceof Error ? { details: { class: e.constructor.name } } : {}),
  };
}
