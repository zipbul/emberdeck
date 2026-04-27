/**
 * Map ops-layer errors → CliMessage with stable error codes.
 * Stable codes are part of the JSON schema contract (CLI_PLAN §3).
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
} from '../card/errors';
import { GlossaryParseError, GlossaryValidationError } from '../glossary/io';
import type { CliMessage } from './output';
import { CliUsageError } from './usage-error';

export { CliUsageError };

export function toCliError(e: unknown): CliMessage {
  if (e instanceof CliUsageError) {
    return { code: 'CLI_USAGE_ERROR', message: e.message };
  }
  if (e instanceof CardNotFoundError) {
    return { code: 'CARD_NOT_FOUND', message: e.message };
  }
  if (e instanceof CardAlreadyExistsError) {
    return { code: 'CARD_ALREADY_EXISTS', message: e.message };
  }
  if (e instanceof CardKeyError) {
    return { code: 'INVALID_CARD_KEY', message: e.message };
  }
  if (e instanceof CardValidationError) {
    return { code: 'VALIDATION_ERROR', message: e.message };
  }
  if (e instanceof ParentValidationError) {
    return { code: 'PARENT_VALIDATION_ERROR', message: e.message };
  }
  if (e instanceof ActivationGuardError) {
    return {
      code: 'ACTIVATION_GUARD_FAILED',
      message: e.message,
      details: { unmet_conditions: e.unmetConditions },
    };
  }
  if (e instanceof BoundaryValidationError) {
    return { code: 'BOUNDARY_VALIDATION_ERROR', message: e.message };
  }
  if (e instanceof GildashNotConfiguredError) {
    return { code: 'GILDASH_NOT_CONFIGURED', message: e.message };
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
  if (e instanceof CardRenameSamePathError) {
    return { code: 'RENAME_SAME_PATH', message: e.message };
  }
  if (e instanceof GlossaryParseError) {
    return { code: 'GLOSSARY_PARSE_ERROR', message: e.message };
  }
  if (e instanceof GlossaryValidationError) {
    return { code: 'GLOSSARY_VALIDATION_ERROR', message: e.message };
  }

  // unknown error
  const msg = e instanceof Error ? e.message : String(e);
  return { code: 'INTERNAL_ERROR', message: msg };
}
