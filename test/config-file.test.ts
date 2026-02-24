import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isErr } from '@zipbul/result';

import {
  loadConfig,
  loadConfigFromPath,
  validateRawConfig,
  mergeCliArgs,
  buildDefaultConfig,
  DEFAULT_CARDS_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_CARD_EXTENSION,
  DEFAULT_STATUSES,
  DEFAULT_LIMITS,
  type EmberdeckFileConfig,
} from '../src/config-file';

// ── helpers ──

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_cfg_'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(name: string, content: string): Promise<string> {
  const p = join(tmpDir, name);
  await writeFile(p, content, 'utf-8');
  return p;
}

// ── validateRawConfig ──

describe('validateRawConfig', () => {
  // ── valid cases ──

  it('빈 객체 → 기본값으로 생성', () => {
    const filePath = join(tmpDir, '.emberdeck.jsonc');
    const result = validateRawConfig({}, filePath);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.cardsDir).toBe(resolve(tmpDir, DEFAULT_CARDS_DIR));
    expect(config.dbPath).toBe(resolve(tmpDir, DEFAULT_DB_PATH));
    expect(config.cardExtension).toBe(DEFAULT_CARD_EXTENSION);
    expect(config.statuses).toEqual([...DEFAULT_STATUSES]);
    expect(config.limits).toEqual(DEFAULT_LIMITS);
  });

  it('모든 필드 지정', () => {
    const raw = {
      cardsDir: './my-cards',
      dbPath: './my.db',
      projectRoot: './proj',
      gildashIgnore: ['node_modules', 'dist'],
      allowedRelationTypes: ['depends-on', 'custom'],
      statuses: ['open', 'closed'],
      cardExtension: '.md',
      limits: {
        summaryMax: 200,
        bodyMax: 50_000,
        arrayMax: 50,
        itemMax: 50,
        relationTargetMax: 100,
        codeLinkSymbolMax: 100,
        codeLinkFileMax: 300,
      },
    };
    const filePath = join(tmpDir, '.emberdeck.jsonc');
    const result = validateRawConfig(raw, filePath);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.cardsDir).toBe(resolve(tmpDir, './my-cards'));
    expect(config.dbPath).toBe(resolve(tmpDir, './my.db'));
    expect(config.projectRoot).toBe(resolve(tmpDir, './proj'));
    expect(config.gildashIgnore).toEqual(['node_modules', 'dist']);
    expect(config.allowedRelationTypes).toEqual(['depends-on', 'custom']);
    expect(config.statuses).toEqual(['open', 'closed']);
    expect(config.cardExtension).toBe('.md');
    expect(config.limits.summaryMax).toBe(200);
  });

  it('limits 일부만 지정 → 나머지는 기본값', () => {
    const filePath = join(tmpDir, '.emberdeck.json');
    const result = validateRawConfig({ limits: { summaryMax: 300 } }, filePath);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.limits.summaryMax).toBe(300);
    expect(config.limits.bodyMax).toBe(DEFAULT_LIMITS.bodyMax);
  });

  // ── invalid: top-level type ──

  it('null → 에러', () => {
    const result = validateRawConfig(null, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.code).toBe('VALIDATION_ERROR');
      expect(result.data.message).toContain('객체');
    }
  });

  it('배열 → 에러', () => {
    const result = validateRawConfig([], '/fake');
    expect(isErr(result)).toBe(true);
  });

  it('문자열 → 에러', () => {
    const result = validateRawConfig('hello', '/fake');
    expect(isErr(result)).toBe(true);
  });

  // ── invalid: unknown keys ──

  it('알 수 없는 키 → 에러', () => {
    const result = validateRawConfig({ unknownKey: 123 }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('unknownKey');
    }
  });

  it('limits에 알 수 없는 키 → 에러', () => {
    const result = validateRawConfig({ limits: { badKey: 1 } }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('badKey');
    }
  });

  // ── invalid: type errors ──

  it('cardsDir가 number → 에러', () => {
    const result = validateRawConfig({ cardsDir: 123 }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('cardsDir');
    }
  });

  it('statuses가 string이 아닌 항목 → 에러', () => {
    const result = validateRawConfig({ statuses: ['ok', 42] }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('statuses[1]');
    }
  });

  it('빈 statuses 배열 → 에러', () => {
    const result = validateRawConfig({ statuses: [] }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('비어있을 수 없습니다');
    }
  });

  it('cardExtension이 점으로 시작하지 않음 → 에러', () => {
    const result = validateRawConfig({ cardExtension: 'md' }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('점(.)');
    }
  });

  it('limits가 배열 → 에러', () => {
    const result = validateRawConfig({ limits: [] }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('limits');
    }
  });

  it('limits에 음수 → 에러', () => {
    const result = validateRawConfig({ limits: { summaryMax: -1 } }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('양의 정수');
    }
  });

  it('limits에 소수 → 에러', () => {
    const result = validateRawConfig({ limits: { bodyMax: 1.5 } }, '/fake');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.message).toContain('양의 정수');
    }
  });

  // ── 에러 메시지 집계 ──

  it('여러 에러를 한번에 수집', () => {
    const result = validateRawConfig(
      { cardsDir: 123, unknownKey: true, statuses: 'string' },
      '/fake',
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const lines = result.data.message.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── loadConfigFromPath ──

describe('loadConfigFromPath', () => {
  it('존재하지 않는 경로 → FILE_NOT_FOUND', async () => {
    const result = await loadConfigFromPath(join(tmpDir, 'no-such-file.jsonc'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('유효한 JSONC 파일 → 정상 로드', async () => {
    const p = await writeConfig('.emberdeck.jsonc', `{
      // 주석 허용
      "cardsDir": "./c",
      "dbPath": "./d.db"
    }`);
    const result = await loadConfigFromPath(p);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.cardsDir).toBe(resolve(tmpDir, './c'));
  });

  it('잘못된 JSON → PARSE_ERROR', async () => {
    const p = await writeConfig('.emberdeck.jsonc', '{ invalid json }}}');
    const result = await loadConfigFromPath(p);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.code).toBe('PARSE_ERROR');
    }
  });

  it('유효 JSON이지만 검증 실패 → VALIDATION_ERROR', async () => {
    const p = await writeConfig('.emberdeck.json', '{ "badKey": 1 }');
    const result = await loadConfigFromPath(p);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.code).toBe('VALIDATION_ERROR');
    }
  });
});

// ── loadConfig (auto-search) ──

describe('loadConfig', () => {
  it('설정 파일 없을 때 → 기본값 반환', async () => {
    const result = await loadConfig(tmpDir);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.cardsDir).toBe(resolve(tmpDir, DEFAULT_CARDS_DIR));
    expect(config.dbPath).toBe(resolve(tmpDir, DEFAULT_DB_PATH));
  });

  it('.emberdeck.jsonc 우선 탐색', async () => {
    await writeConfig('.emberdeck.jsonc', '{ "cardsDir": "./a" }');
    await writeConfig('.emberdeck.json', '{ "cardsDir": "./b" }');
    const result = await loadConfig(tmpDir);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.cardsDir).toBe(resolve(tmpDir, './a'));
  });

  it('.emberdeck.json fallback', async () => {
    await writeConfig('.emberdeck.json', '{ "dbPath": "./fallback.db" }');
    const result = await loadConfig(tmpDir);
    expect(isErr(result)).toBe(false);
    const config = result as EmberdeckFileConfig;
    expect(config.dbPath).toBe(resolve(tmpDir, './fallback.db'));
  });
});

// ── mergeCliArgs ──

describe('mergeCliArgs', () => {
  it('CLI args가 config을 override', () => {
    const config = buildDefaultConfig(tmpDir);
    const merged = mergeCliArgs(config, {
      dir: '/abs/cards',
      dbPath: '/abs/data.db',
    });
    expect(merged.cardsDir).toBe(resolve('/abs/cards'));
    expect(merged.dbPath).toBe(resolve('/abs/data.db'));
    // 다른 필드는 유지
    expect(merged.cardExtension).toBe(config.cardExtension);
    expect(merged.limits).toEqual(config.limits);
  });

  it('undefined arg는 무시', () => {
    const config = buildDefaultConfig(tmpDir);
    const merged = mergeCliArgs(config, {});
    expect(merged.cardsDir).toBe(config.cardsDir);
    expect(merged.dbPath).toBe(config.dbPath);
  });

  it('projectRoot override', () => {
    const config = buildDefaultConfig(tmpDir);
    const merged = mergeCliArgs(config, { projectRoot: '/proj' });
    expect(merged.projectRoot).toBe(resolve('/proj'));
  });
});

// ── buildDefaultConfig ──

describe('buildDefaultConfig', () => {
  it('기본값 정확성', () => {
    const config = buildDefaultConfig('/base');
    expect(config.cardsDir).toBe(resolve('/base', DEFAULT_CARDS_DIR));
    expect(config.dbPath).toBe(resolve('/base', DEFAULT_DB_PATH));
    expect(config.projectRoot).toBeUndefined();
    expect(config.gildashIgnore).toBeUndefined();
    expect(config.allowedRelationTypes).toEqual([
      'depends-on', 'references', 'related', 'extends', 'conflicts',
    ]);
    expect(config.statuses).toEqual([...DEFAULT_STATUSES]);
    expect(config.limits).toEqual(DEFAULT_LIMITS);
    expect(config.cardExtension).toBe(DEFAULT_CARD_EXTENSION);
  });

  it('반환된 limits은 독립 복사본', () => {
    const a = buildDefaultConfig('/a');
    const b = buildDefaultConfig('/b');
    a.limits.summaryMax = 999;
    expect(b.limits.summaryMax).toBe(DEFAULT_LIMITS.summaryMax);
  });
});
