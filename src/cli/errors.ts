/**
 * Map ops-layer errors → CliMessage with stable error codes.
 * Stable codes are part of the JSON schema contract.
 */

import {
  CardKeyError,
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  ParentValidationError,
  ActivationGuardError,
  BoundaryValidationError,
  GildashNotConfiguredError,
  CompensationError,
  FtsSyntaxError,
} from '../card/errors';
import { GlossaryParseError, GlossaryValidationError } from '../glossary/io';
import type { CliMessage } from './output';
import { CliUsageError } from './usage-error';
import { errorMessage } from '../util/error';


// Errors that map to {code, message:e.message} with no additional details.
const SIMPLE_ERROR_CODES: Array<[new (...args: never[]) => Error, string]> = [
  [CliUsageError, 'CLI_USAGE_ERROR'],
  [FtsSyntaxError, 'FTS_SYNTAX_ERROR'],
  [CardNotFoundError, 'CARD_NOT_FOUND'],
  [CardAlreadyExistsError, 'CARD_ALREADY_EXISTS'],
  [CardKeyError, 'INVALID_CARD_KEY'],
  [CardValidationError, 'VALIDATION_ERROR'],
  [ParentValidationError, 'PARENT_VALIDATION_ERROR'],
  [BoundaryValidationError, 'BOUNDARY_VALIDATION_ERROR'],
  [GildashNotConfiguredError, 'GILDASH_NOT_CONFIGURED'],
  [CardRenameSamePathError, 'RENAME_SAME_PATH'],
  [GlossaryParseError, 'GLOSSARY_PARSE_ERROR'],
  [GlossaryValidationError, 'GLOSSARY_VALIDATION_ERROR'],
];

export function toCliError(e: unknown): CliMessage {
  // Errors that carry structured details first.
  if (e instanceof ActivationGuardError) {
    return {
      code: 'ACTIVATION_GUARD_FAILED',
      message: e.message,
      details: { unmet_conditions: e.unmetConditions },
    };
  }
  if (e instanceof CompensationError) {
    return {
      code: 'COMPENSATION_FAILED',
      message: e.message,
      details: {
        original_error: String(e.originalError),
        compensation_error: String(e.compensationError),
      },
    };
  }
  for (const [Cls, code] of SIMPLE_ERROR_CODES) {
    if (e instanceof Cls) return { code, message: e.message };
  }
  return { code: 'INTERNAL_ERROR', message: errorMessage(e) };
}
