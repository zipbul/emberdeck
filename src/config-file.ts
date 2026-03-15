/**
 * Emberdeck configuration file loader.
 *
 * Searches for and loads `.emberdeck.jsonc` or `.emberdeck.json`.
 * Parses JSONC (including comments) with `Bun.JSONC.parse`,
 * strictly validates all fields, and returns the result using the `Result` pattern.
 *
 * @example
 * ```ts
 * const result = await loadConfig();
 * if (isErr(result)) {
 *   console.error(result.data);
 *   process.exit(1);
 * }
 * const options = result; // EmberdeckFileConfig
 * ```
 */

import { resolve, dirname } from 'node:path';
import { err, isErr } from '@zipbul/result';
import { findPackageRoot } from './fs/package-root';
import type { Result, Err } from '@zipbul/result';
import { DEFAULT_RELATION_TYPES } from './config';

// ── Types ──

/** Limits section of the configuration file */
export interface ConfigLimits {
  summaryMax: number;
  bodyMax: number;
  arrayMax: number;
  itemMax: number;
  relationTargetMax: number;
  codeLinkSymbolMax: number;
  codeLinkFileMax: number;
}

/** Full configuration read from the config file */
export interface EmberdeckFileConfig {
  cardsDir: string;
  dbPath: string;
  projectRoot?: string;
  gildashIgnore?: string[];
  allowedRelationTypes: readonly string[];
  limits: ConfigLimits;
  statuses: string[];
  cardExtension: string;
}

/** Config error data */
export interface ConfigError {
  code: 'FILE_NOT_FOUND' | 'PARSE_ERROR' | 'VALIDATION_ERROR';
  message: string;
  filePath?: string;
}

// ── Defaults ──

export const DEFAULT_CARDS_DIR = '.emberdeck/cards';
export const DEFAULT_DB_PATH = '.emberdeck/data.db';
export const DEFAULT_CARD_EXTENSION = '.card.md';
export const DEFAULT_STATUSES: readonly string[] = [
  'draft',
  'accepted',
  'implementing',
  'implemented',
  'deprecated',
];
export const DEFAULT_LIMITS: ConfigLimits = {
  summaryMax: 500,
  bodyMax: 100_000,
  arrayMax: 100,
  itemMax: 100,
  relationTargetMax: 200,
  codeLinkSymbolMax: 200,
  codeLinkFileMax: 500,
};

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
  if (val.length === 0) {
    errors.push(`"${key}": must not be empty`);
  }
}

function assertPositiveInt(
  obj: Record<string, unknown>,
  key: string,
  errors: ValidationErrors,
): void {
  if (!(key in obj)) return;
  const val = obj[key];
  if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
    errors.push(`"${key}": must be a positive integer (received ${String(val)})`);
  }
}

const KNOWN_TOP_KEYS = new Set([
  'cardsDir',
  'dbPath',
  'projectRoot',
  'gildashIgnore',
  'allowedRelationTypes',
  'limits',
  'statuses',
  'cardExtension',
]);

const KNOWN_LIMIT_KEYS = new Set([
  'summaryMax',
  'bodyMax',
  'arrayMax',
  'itemMax',
  'relationTargetMax',
  'codeLinkSymbolMax',
  'codeLinkFileMax',
]);

// ── Core ──

/**
 * Validates the raw parsed result and converts it to `EmberdeckFileConfig`.
 * Collects all unknown keys, type errors, and range errors, then reports them at once.
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
  assertString(obj, 'cardExtension', errors);

  if (typeof obj['cardExtension'] === 'string' && !obj['cardExtension'].startsWith('.')) {
    errors.push(`"cardExtension": must start with a dot (.) (received "${obj['cardExtension']}")`);
  }

  // ── String array fields ──
  assertStringArray(obj, 'gildashIgnore', errors);
  assertStringArray(obj, 'allowedRelationTypes', errors);
  assertStringArray(obj, 'statuses', errors);

  // ── Limits object ──
  if ('limits' in obj) {
    const lim = obj['limits'];
    if (lim === null || typeof lim !== 'object' || Array.isArray(lim)) {
      errors.push(`"limits": must be an object`);
    } else {
      const limObj = lim as Record<string, unknown>;
      for (const key of Object.keys(limObj)) {
        if (!KNOWN_LIMIT_KEYS.has(key)) {
          errors.push(`Unknown key in "limits": "${key}"`);
        }
      }
      for (const key of KNOWN_LIMIT_KEYS) {
        assertPositiveInt(limObj, key, errors);
      }
    }
  }

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
      : undefined;

  const gildashIgnore = Array.isArray(obj['gildashIgnore'])
    ? (obj['gildashIgnore'] as string[])
    : undefined;

  const allowedRelationTypes = Array.isArray(obj['allowedRelationTypes'])
    ? (obj['allowedRelationTypes'] as string[])
    : [...DEFAULT_RELATION_TYPES];

  const statuses = Array.isArray(obj['statuses'])
    ? (obj['statuses'] as string[])
    : [...DEFAULT_STATUSES];

  const cardExtension =
    typeof obj['cardExtension'] === 'string'
      ? (obj['cardExtension'] as string)
      : DEFAULT_CARD_EXTENSION;

  // Merge limits
  const rawLimits = (typeof obj['limits'] === 'object' && obj['limits'] !== null && !Array.isArray(obj['limits']))
    ? (obj['limits'] as Record<string, unknown>)
    : {};
  const limits: ConfigLimits = {
    summaryMax: typeof rawLimits['summaryMax'] === 'number' ? rawLimits['summaryMax'] : DEFAULT_LIMITS.summaryMax,
    bodyMax: typeof rawLimits['bodyMax'] === 'number' ? rawLimits['bodyMax'] : DEFAULT_LIMITS.bodyMax,
    arrayMax: typeof rawLimits['arrayMax'] === 'number' ? rawLimits['arrayMax'] : DEFAULT_LIMITS.arrayMax,
    itemMax: typeof rawLimits['itemMax'] === 'number' ? rawLimits['itemMax'] : DEFAULT_LIMITS.itemMax,
    relationTargetMax: typeof rawLimits['relationTargetMax'] === 'number' ? rawLimits['relationTargetMax'] : DEFAULT_LIMITS.relationTargetMax,
    codeLinkSymbolMax: typeof rawLimits['codeLinkSymbolMax'] === 'number' ? rawLimits['codeLinkSymbolMax'] : DEFAULT_LIMITS.codeLinkSymbolMax,
    codeLinkFileMax: typeof rawLimits['codeLinkFileMax'] === 'number' ? rawLimits['codeLinkFileMax'] : DEFAULT_LIMITS.codeLinkFileMax,
  };

  return {
    cardsDir,
    dbPath,
    projectRoot,
    gildashIgnore,
    allowedRelationTypes,
    limits,
    statuses,
    cardExtension,
  };
}

/**
 * Reads, parses, and validates the config file at the specified path.
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
      message: `Failed to read config file: ${e instanceof Error ? e.message : String(e)}`,
      filePath: absPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (e) {
    return err({
      code: 'PARSE_ERROR',
      message: `JSONC parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      filePath: absPath,
    });
  }

  return validateRawConfig(parsed, absPath);
}

/**
 * Automatically searches for `.emberdeck.jsonc` or `.emberdeck.json` from CWD.
 * If found, loads and validates it; if not found, creates a config with defaults.
 *
 * @param cwd - Directory to start searching from. Default: `process.cwd()`
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
 */
export function buildDefaultConfig(baseDir: string): EmberdeckFileConfig {
  return {
    cardsDir: resolve(baseDir, DEFAULT_CARDS_DIR),
    dbPath: resolve(baseDir, DEFAULT_DB_PATH),
    projectRoot: undefined,
    gildashIgnore: undefined,
    allowedRelationTypes: [...DEFAULT_RELATION_TYPES],
    limits: { ...DEFAULT_LIMITS },
    statuses: [...DEFAULT_STATUSES],
    cardExtension: DEFAULT_CARD_EXTENSION,
  };
}
