/**
 * Unified CLI output formatter.
 *
 * Per CLI_PLAN §3 (JSON schema) and §8 (output formats):
 * - status enum: ok | partial | error | unknown
 * - schemaVersion: { major: 1, minor: 0 }
 * - field-presence matrix consistent across all status values
 *
 * Output mode resolution:
 * - explicit `--output={human,json,quiet}` wins
 * - else: TTY → human, pipe → json
 */

import { EXIT, type ExitCode } from './exit-codes';
import { CliUsageError } from './usage-error';

export type OutputMode = 'human' | 'json' | 'quiet';
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
  color: boolean;
}

const VALID_OUTPUT_MODES: ReadonlyArray<OutputMode> = ['human', 'json', 'quiet'];

/**
 * Resolve output mode based on flags + TTY detection.
 * Throws on invalid --output value.
 */
export function resolveOutputMode(opts: {
  output?: string;
  json?: boolean;
  quiet?: boolean;
}): OutputMode {
  if (opts.output !== undefined && !VALID_OUTPUT_MODES.includes(opts.output as OutputMode)) {
    throw new CliUsageError(`invalid --output '${opts.output}'. Allowed: ${VALID_OUTPUT_MODES.join('|')}`);
  }
  if (opts.output === 'json' || opts.json) return 'json';
  if (opts.output === 'quiet' || opts.quiet) return 'quiet';
  if (opts.output === 'human') return 'human';
  return process.stdout.isTTY ? 'human' : 'json';
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
    case 'error': {
      const code = result.error?.code;
      if (code === 'CARD_NOT_FOUND' || code === 'NOT_FOUND') return EXIT.NOT_FOUND;
      if (code === 'CARD_ALREADY_EXISTS' || code === 'CONFLICT' || code === 'RENAME_SAME_PATH') return EXIT.CONFLICT;
      if (code === 'CONFIG_MISSING' || code === 'GILDASH_NOT_CONFIGURED') return EXIT.CONFIG_MISSING;
      if (code === 'PERMISSION' || code === 'IO_ERROR') return EXIT.PERMISSION_OR_IO;
      // All validation-class codes → exit 2 (CI-friendly).
      // CLI_USAGE_ERROR is also exit 2 per bash convention for misuse.
      if (
        code === 'VALIDATION_ERROR' ||
        code === 'VALIDATION_FAILURE' ||
        code === 'INVALID_CARD_KEY' ||
        code === 'PARENT_VALIDATION_ERROR' ||
        code === 'BOUNDARY_VALIDATION_ERROR' ||
        code === 'ACTIVATION_GUARD_FAILED' ||
        code === 'GLOSSARY_PARSE_ERROR' ||
        code === 'GLOSSARY_VALIDATION_ERROR' ||
        code === 'CLI_USAGE_ERROR'
      ) {
        return EXIT.VALIDATION_FAILURE;
      }
      return EXIT.GENERIC_ERROR;
    }
  }
}

/**
 * Render a CliResult to STDOUT according to the output mode.
 * Writes warnings/errors to STDERR (human/quiet modes).
 */
export function render(result: CliResult, ctx: OutputContext, humanRenderer?: (data: unknown) => string): void {
  if (ctx.mode === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (ctx.mode === 'quiet') {
    // STDOUT: minimal (often nothing)
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
    // STDERR: 1-line summary for diagnostics
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

  // human mode
  const RED = ctx.color ? Bun.color('red', 'ansi-256') ?? '' : '';
  const YELLOW = ctx.color ? Bun.color('yellow', 'ansi-256') ?? '' : '';
  const RESET = ctx.color ? '\x1b[0m' : '';

  if (result.error) {
    process.stderr.write(`${RED}error${RESET}: ${result.error.message}\n`);
    if (result.error.details) {
      for (const [k, v] of Object.entries(result.error.details)) {
        process.stderr.write(`  ${k}: ${JSON.stringify(v)}\n`);
      }
    }
    return;
  }

  if (humanRenderer && result.data != null) {
    process.stdout.write(humanRenderer(result.data));
    if (!process.stdout.isTTY) process.stdout.write('\n');
  } else if (result.data != null) {
    // fallback: pretty JSON
    process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
  }

  // warnings/errors to STDERR
  for (const w of result.warnings) {
    process.stderr.write(`${YELLOW}warning${RESET}: ${w.message}\n`);
  }
  for (const e of result.errors) {
    process.stderr.write(`${RED}error${RESET}: ${e.message}${e.key ? ` (key: ${e.key})` : ''}\n`);
  }
}
