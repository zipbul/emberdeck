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
  color: boolean;
}

/**
 * Resolve color enable per the no-color.org standard.
 * Single source of truth for buildRuntime + the runner's catch-path fallback.
 */
export function resolveColor(noColorFlag: boolean): boolean {
  const noColorEnv = process.env.NO_COLOR && process.env.NO_COLOR.length > 0;
  const forceColor = process.env.CLICOLOR_FORCE && process.env.CLICOLOR_FORCE.length > 0;
  return !noColorFlag && !noColorEnv && (forceColor ? true : !!process.stdout.isTTY);
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
        code === 'CLI_USAGE_ERROR' ||
        code === 'FTS_SYNTAX_ERROR'
      ) {
        return EXIT.VALIDATION_FAILURE;
      }
      return EXIT.GENERIC_ERROR;
    }
  }
}

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
