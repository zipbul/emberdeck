/**
 * Unified CLI output formatter.
 *
 * Single output shape: JSON envelope on STDOUT.
 *   { schemaVersion, status: ok|partial|error|unknown, data, warnings, errors, error? }
 *
 * `--quiet` opts into a key-only STDOUT (diagnostics on STDERR) for shell pipelines.
 */

import { EXIT, type ExitCode } from './exit-codes';

export type OutputMode = 'json' | 'quiet';
export type Status = 'ok' | 'partial' | 'error' | 'unknown';

export const SCHEMA_VERSION = { major: 1, minor: 0 } as const;

export interface CliMessage {
  code: string;
  message: string;
  key?: string;
  details?: Record<string, unknown>;
}

export interface CliResult<T = unknown> {
  schemaVersion: typeof SCHEMA_VERSION;
  status: Status;
  data: T | null;
  warnings: CliMessage[];
  errors: CliMessage[];
  error?: CliMessage;
}

export interface OutputContext {
  mode: OutputMode;
}

export function resolveOutputMode(opts: { quiet?: boolean }): OutputMode {
  return opts.quiet ? 'quiet' : 'json';
}

/**
 * Build a success CliResult.
 */
export function ok<T>(data: T, warnings: CliMessage[] = []): CliResult<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'ok',
    data,
    warnings,
    errors: [],
  };
}

/**
 * Build a partial-success CliResult (bulk operations).
 */
export function partial<T>(
  data: T,
  errors: CliMessage[],
  warnings: CliMessage[] = [],
): CliResult<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'partial',
    data,
    warnings,
    errors,
  };
}

/**
 * Build an error CliResult.
 */
export function err(error: CliMessage): CliResult<null> {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'error',
    data: null,
    warnings: [],
    errors: [],
    error,
  };
}

/**
 * Build a transient/retryable failure CliResult.
 */
export function unknown(error: CliMessage): CliResult<null> {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'unknown',
    data: null,
    warnings: [],
    errors: [],
    error,
  };
}

/**
 * Map a CliResult.status to an exit code.
 * Override via options.partialIsFailure to make partial = exit 2 (CI gate).
 */
export function statusToExitCode(
  result: CliResult,
  options: { partialIsFailure?: boolean } = {},
): ExitCode {
  switch (result.status) {
    case 'ok':
      return EXIT.OK;
    case 'partial':
      return options.partialIsFailure ? EXIT.VALIDATION_FAILURE : EXIT.OK;
    case 'unknown':
      return EXIT.TRANSIENT;
    case 'error':
      return ERROR_CODE_TO_EXIT[result.error?.code ?? ''] ?? EXIT.GENERIC_ERROR;
  }
}

// CLI_USAGE_ERROR maps to exit 2 per bash convention for misuse.
const ERROR_CODE_TO_EXIT: Record<string, ExitCode> = {
  CARD_NOT_FOUND: EXIT.NOT_FOUND,
  NOT_FOUND: EXIT.NOT_FOUND,
  CARD_ALREADY_EXISTS: EXIT.CONFLICT,
  CONFLICT: EXIT.CONFLICT,
  RENAME_SAME_PATH: EXIT.CONFLICT,
  CONFIG_MISSING: EXIT.CONFIG_MISSING,
  GILDASH_NOT_CONFIGURED: EXIT.CONFIG_MISSING,
  PERMISSION: EXIT.PERMISSION_OR_IO,
  IO_ERROR: EXIT.PERMISSION_OR_IO,
  VALIDATION_ERROR: EXIT.VALIDATION_FAILURE,
  VALIDATION_FAILURE: EXIT.VALIDATION_FAILURE,
  INVALID_CARD_KEY: EXIT.VALIDATION_FAILURE,
  PARENT_VALIDATION_ERROR: EXIT.VALIDATION_FAILURE,
  BOUNDARY_VALIDATION_ERROR: EXIT.VALIDATION_FAILURE,
  ACTIVATION_GUARD_FAILED: EXIT.VALIDATION_FAILURE,
  GLOSSARY_PARSE_ERROR: EXIT.VALIDATION_FAILURE,
  GLOSSARY_VALIDATION_ERROR: EXIT.VALIDATION_FAILURE,
  CLI_USAGE_ERROR: EXIT.VALIDATION_FAILURE,
  FTS_SYNTAX_ERROR: EXIT.VALIDATION_FAILURE,
};

/**
 * Render a CliResult. JSON envelope on STDOUT; quiet mode prints
 * just the key(s) on STDOUT and routes diagnostics to STDERR.
 */
export function render(result: CliResult, ctx: OutputContext): void {
  if (ctx.mode === 'quiet') {
    if (result.status === 'ok' || result.status === 'partial') {
      const data = result.data;
      if (data && typeof data === 'object' && 'key' in data && typeof data.key === 'string') {
        process.stdout.write(data.key + '\n');
      } else if (Array.isArray((data as Record<string, unknown>)?.items)) {
        const items = (data as { items: Array<{ key?: string }> }).items;
        for (const item of items) {
          if (item.key) process.stdout.write(item.key + '\n');
        }
      }
    }
    if (result.errors.length > 0 || result.warnings.length > 0) {
      const parts: string[] = [];
      if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
      if (result.warnings.length > 0) parts.push(`${result.warnings.length} warnings`);
      process.stderr.write(parts.join(', ') + '\n');
    }
    if (result.error) {
      process.stderr.write(`error: ${result.error.message}\n`);
    }
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
