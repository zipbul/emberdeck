/**
 * emberdeck 설정 파일 로더.
 *
 * `.emberdeck.jsonc` 또는 `.emberdeck.json`을 탐색하여 로드한다.
 * `Bun.JSONC.parse`로 주석 포함 JSONC를 파싱하고,
 * 모든 필드를 엄격하게 검증한 뒤 `Result` 패턴으로 반환한다.
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
import type { Result, Err } from '@zipbul/result';
import { DEFAULT_RELATION_TYPES } from './config';

// ── Types ──

/** 설정 파일의 limits 섹션 */
export interface ConfigLimits {
  summaryMax: number;
  bodyMax: number;
  arrayMax: number;
  itemMax: number;
  relationTargetMax: number;
  codeLinkSymbolMax: number;
  codeLinkFileMax: number;
}

/** 설정 파일에서 읽은 전체 구성 */
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

/** config 에러 데이터 */
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
    errors.push(`"${key}": string이어야 합니다 (received ${typeof obj[key]})`);
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
    errors.push(`"${key}": string[] 이어야 합니다 (received ${typeof val})`);
    return;
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== 'string') {
      errors.push(`"${key}[${i}]": string이어야 합니다 (received ${typeof val[i]})`);
    }
  }
  if (val.length === 0) {
    errors.push(`"${key}": 비어있을 수 없습니다`);
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
    errors.push(`"${key}": 양의 정수여야 합니다 (received ${String(val)})`);
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
 * 원시 파싱 결과를 검증하고 `EmberdeckFileConfig`로 변환한다.
 * 알 수 없는 키, 타입 오류, 범위 오류를 모두 수집한 뒤 한번에 보고한다.
 */
export function validateRawConfig(
  raw: unknown,
  filePath: string,
): Result<EmberdeckFileConfig, ConfigError> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: '설정 파일의 최상위는 객체여야 합니다',
      filePath,
    });
  }

  const obj = raw as Record<string, unknown>;
  const errors: ValidationErrors = [];

  // ── 알 수 없는 키 감지 ──
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      errors.push(`알 수 없는 키: "${key}"`);
    }
  }

  // ── string 필드 ──
  assertString(obj, 'cardsDir', errors);
  assertString(obj, 'dbPath', errors);
  assertString(obj, 'projectRoot', errors);
  assertString(obj, 'cardExtension', errors);

  if (typeof obj['cardExtension'] === 'string' && !obj['cardExtension'].startsWith('.')) {
    errors.push(`"cardExtension": 점(.)으로 시작해야 합니다 (received "${obj['cardExtension']}")`);
  }

  // ── string[] 필드 ──
  assertStringArray(obj, 'gildashIgnore', errors);
  assertStringArray(obj, 'allowedRelationTypes', errors);
  assertStringArray(obj, 'statuses', errors);

  // ── limits 객체 ──
  if ('limits' in obj) {
    const lim = obj['limits'];
    if (lim === null || typeof lim !== 'object' || Array.isArray(lim)) {
      errors.push(`"limits": 객체여야 합니다`);
    } else {
      const limObj = lim as Record<string, unknown>;
      for (const key of Object.keys(limObj)) {
        if (!KNOWN_LIMIT_KEYS.has(key)) {
          errors.push(`"limits"에 알 수 없는 키: "${key}"`);
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

  // ── 기본값 병합 ──
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

  // limits 병합
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
 * 지정된 경로에서 설정 파일을 읽고 파싱+검증한다.
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
      message: `설정 파일을 찾을 수 없습니다: ${absPath}`,
      filePath: absPath,
    });
  }

  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return err({
      code: 'PARSE_ERROR',
      message: `설정 파일 읽기 실패: ${e instanceof Error ? e.message : String(e)}`,
      filePath: absPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (e) {
    return err({
      code: 'PARSE_ERROR',
      message: `JSONC 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
      filePath: absPath,
    });
  }

  return validateRawConfig(parsed, absPath);
}

/**
 * CWD에서 `.emberdeck.jsonc` 또는 `.emberdeck.json`을 자동 탐색한다.
 * 찾으면 로드+검증, 없으면 기본값으로 config를 생성한다.
 *
 * @param cwd - 탐색 시작 디렉토리. 기본값: `process.cwd()`
 */
export async function loadConfig(
  cwd?: string,
): Promise<Result<EmberdeckFileConfig, ConfigError>> {
  const baseDir = cwd ?? process.cwd();

  for (const name of CONFIG_FILE_NAMES) {
    const candidate = resolve(baseDir, name);
    const exists = await Bun.file(candidate).exists();
    if (exists) {
      return loadConfigFromPath(candidate);
    }
  }

  // 설정 파일 없음 → 기본값으로 생성
  return buildDefaultConfig(baseDir);
}

/**
 * CLI arg로 config를 override한다.
 * undefined인 arg는 무시한다.
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
 * 기본값만으로 config 생성. 설정 파일이 없을 때 사용.
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
