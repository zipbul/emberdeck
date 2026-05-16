/**
 * Emberdeck configuration file loader.
 *
 * Searches for and loads `.emberdeck.jsonc` or `.emberdeck.json`.
 * Parses JSONC (including comments) with `Bun.JSONC.parse`,
 * strictly validates all fields, and returns the result using the `Result` pattern.
 */

import { resolve, dirname } from 'node:path';
import { err } from '@zipbul/result';
import { findPackageRoot } from './fs/package-root';
import type { Result } from '@zipbul/result';
import { errorMessage } from './util/error';

// ── Types ──

/** Full configuration read from the config file */
export interface EmberdeckFileConfig {
  cardsDir: string;
  dbPath: string;
  projectRoot: string;
  analysisIgnore?: string[];
  ignorePatterns: string[];
  regressionThreshold: number;
}

/** Config error data */
export interface ConfigError {
  code: 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'VALIDATION_ERROR';
  message: string;
  filePath?: string;
}

/**
 * Thrown by buildRuntime when loadConfig returns Err. Carries the underlying
 * ConfigError code so toCliError can pick the right stderr code + exit code:
 *   FILE_NOT_FOUND   → exit 6 (config-missing)
 *   PARSE_ERROR      → exit 2 (config-parse-error)
 *   VALIDATION_ERROR → exit 2 (config-validation-error)
 *
 * Distinct from internal-error so automation can branch on the failure class.
 */
export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly configError: ConfigError,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

// ── Defaults ──

export const DEFAULT_CARDS_DIR = '.emberdeck/cards';
export const DEFAULT_DB_PATH = '.emberdeck/data.db';

const CONFIG_FILE_NAMES = ['.emberdeck.jsonc', '.emberdeck.json'] as const;

// ── Validation helpers ──

type ValidationErrors = string[];

function assertString(obj: Record<string, unknown>, key: string, errors: ValidationErrors): void {
  if (key in obj && typeof obj[key] !== 'string') {
    errors.push(`"${key}": must be a string (received ${typeof obj[key]})`);
  }
}

function assertStringArray(
  obj: Record<string, unknown>,
  key: string,
  errors: ValidationErrors,
  allowEmpty = false,
): void {
  if (!(key in obj)) return;
  const val = obj[key];
  if (!Array.isArray(val)) {
    errors.push(`"${key}": must be a string[] (received ${typeof val})`);
    return;
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== 'string') {
      errors.push(`"${key}[${i}]": must be a string (received ${typeof val[i]})`);
    }
  }
  if (!allowEmpty && val.length === 0) {
    errors.push(`"${key}": must not be empty`);
  }
}

function assertNumber(
  obj: Record<string, unknown>,
  key: string,
  errors: ValidationErrors,
  min?: number,
  max?: number,
): void {
  if (!(key in obj)) return;
  const val = obj[key];
  if (typeof val !== 'number') {
    errors.push(`"${key}": must be a number (received ${typeof val})`);
    return;
  }
  if (min !== undefined && val < min) {
    errors.push(`"${key}": must be >= ${min} (received ${val})`);
  }
  if (max !== undefined && val > max) {
    errors.push(`"${key}": must be <= ${max} (received ${val})`);
  }
}

const KNOWN_TOP_KEYS = new Set([
  'cardsDir',
  'dbPath',
  'projectRoot',
  'analysisIgnore',
  'ignorePatterns',
  'regressionThreshold',
]);

// ── Core ──

/**
 * Validates the raw parsed result and converts it to `EmberdeckFileConfig`.
 * Collects all unknown keys, type errors, and range errors, then reports them at once.
  * @spec cli-surface/project-setup/setup-config-root
 */
export function validateRawConfig(
  raw: unknown,
  filePath: string,
): Result<EmberdeckFileConfig, ConfigError> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'The top level of the config file must be an object',
      filePath,
    });
  }

  const obj = raw as Record<string, unknown>;
  const errors: ValidationErrors = [];

  // ── Detect unknown keys ──
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      errors.push(`Unknown key: "${key}"`);
    }
  }

  // ── String fields ──
  assertString(obj, 'cardsDir', errors);
  assertString(obj, 'dbPath', errors);
  assertString(obj, 'projectRoot', errors);

  // ── String array fields ──
  assertStringArray(obj, 'analysisIgnore', errors, true);
  assertStringArray(obj, 'ignorePatterns', errors, true);

  // ── Number fields ──
  assertNumber(obj, 'regressionThreshold', errors, 0, 1);

  if (errors.length > 0) {
    return err({
      code: 'VALIDATION_ERROR',
      message: errors.join('\n'),
      filePath,
    });
  }

  // ── Merge with defaults ──
  const resolvedDir = dirname(filePath);

  const cardsDir =
    typeof obj['cardsDir'] === 'string'
      ? resolve(resolvedDir, obj['cardsDir'])
      : resolve(resolvedDir, DEFAULT_CARDS_DIR);

  const dbPath =
    typeof obj['dbPath'] === 'string'
      ? resolve(resolvedDir, obj['dbPath'])
      : resolve(resolvedDir, DEFAULT_DB_PATH);

  const projectRoot =
    typeof obj['projectRoot'] === 'string'
      ? resolve(resolvedDir, obj['projectRoot'])
      : resolvedDir;

  const analysisIgnore = Array.isArray(obj['analysisIgnore'])
    ? (obj['analysisIgnore'] as string[])
    : undefined;

  const ignorePatterns = Array.isArray(obj['ignorePatterns'])
    ? (obj['ignorePatterns'] as string[])
    : [];

  const regressionThreshold = typeof obj['regressionThreshold'] === 'number'
    ? obj['regressionThreshold']
    : 0;

  return {
    cardsDir,
    dbPath,
    projectRoot,
    analysisIgnore,
    ignorePatterns,
    regressionThreshold,
  };
}

/**
 * Reads, parses, and validates the config file at the specified path.
  * @spec cli-surface/project-setup/setup-config-root
 */
export async function loadConfigFromPath(
  filePath: string,
): Promise<Result<EmberdeckFileConfig, ConfigError>> {
  const absPath = resolve(filePath);
  const file = Bun.file(absPath);
  const exists = await file.exists();
  if (!exists) {
    return err({
      code: 'FILE_NOT_FOUND',
      message: `Config file not found: ${absPath}`,
      filePath: absPath,
    });
  }

  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return err({
      code: 'PARSE_ERROR',
      message: `Failed to read config file: ${errorMessage(e)}`,
      filePath: absPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (e) {
    return err({
      code: 'PARSE_ERROR',
      message: `JSONC parsing failed: ${errorMessage(e)}`,
      filePath: absPath,
    });
  }

  return validateRawConfig(parsed, absPath);
}

/**
 * Automatically searches for `.emberdeck.jsonc` or `.emberdeck.json` from CWD.
 * If found, loads and validates it; if not found, creates a config with defaults.
  * @spec cli-surface/project-setup/setup-config-root
 */
export async function loadConfig(
  cwd?: string,
): Promise<Result<EmberdeckFileConfig, ConfigError>> {
  const baseDir = cwd ?? findPackageRoot(process.cwd());

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = resolve(baseDir, name);
    const exists = await Bun.file(candidate).exists();
    if (exists) {
      return loadConfigFromPath(candidate);
    }
  }

  // No config file found -> create with defaults
  return buildDefaultConfig(baseDir);
}

/**
 * Overrides config with CLI args.
 * Args that are undefined are ignored.
  * @spec cli-surface/project-setup/setup-config-root
 */
export function mergeCliArgs(
  config: EmberdeckFileConfig,
  args: {
    dir?: string;
    dbPath?: string;
    projectRoot?: string;
  },
): EmberdeckFileConfig {
  return {
    ...config,
    ...(args.dir !== undefined ? { cardsDir: resolve(args.dir) } : {}),
    ...(args.dbPath !== undefined ? { dbPath: resolve(args.dbPath) } : {}),
    ...(args.projectRoot !== undefined ? { projectRoot: resolve(args.projectRoot) } : {}),
  };
}

/**
 * Creates a config using only defaults. Used when no config file exists.
  * @spec cli-surface/project-setup/setup-config-root
 */
export function buildDefaultConfig(baseDir: string): EmberdeckFileConfig {
  return {
    cardsDir: resolve(baseDir, DEFAULT_CARDS_DIR),
    dbPath: resolve(baseDir, DEFAULT_DB_PATH),
    projectRoot: baseDir,
    analysisIgnore: undefined,
    ignorePatterns: [],
    regressionThreshold: 0,
  };
}
