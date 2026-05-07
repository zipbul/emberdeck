/**
 * JSON envelope schema regression test.
 *
 * Every CLI command response must match the documented envelope:
 *   { schemaVersion: { major, minor }, status, data, warnings, errors, error? }
 *
 * This suite spawns each major command via subprocess and asserts the
 * envelope shape (NOT the full data shape — that's covered by per-command
 * tests). Any refactor that drops a required field or changes status/exit-code
 * mapping breaks here.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');
const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/sample-ts-project');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

function setupProject(withGildash: boolean): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-envelope-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  const config: Record<string, unknown> = {
    cardsDir: '.emberdeck/cards',
    dbPath: '.emberdeck/data.db',
  };
  if (withGildash) {
    cpSync(FIXTURE_SRC, join(tmp, 'project'), { recursive: true });
    config.projectRoot = 'project';
  }
  writeFileSync(join(tmp, '.emberdeck.jsonc'), JSON.stringify(config));
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

/**
 * Assert the envelope matches the documented contract:
 * - schemaVersion.major / .minor (numbers)
 * - status ∈ { ok, partial, error, unknown }
 * - data: any
 * - warnings: array of { code, message } objects
 * - errors: array of { code, message } objects
 * - error?: { code, message } when status is error|unknown
 */
function assertEnvelope(stdout: string): {
  schemaVersion: { major: number; minor: number };
  status: 'ok' | 'partial' | 'error' | 'unknown';
  data: unknown;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
  error?: { code: string; message: string };
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`stdout is not valid JSON: ${stdout.slice(0, 200)}`);
  }
  expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
  expect(['ok', 'partial', 'error', 'unknown']).toContain(parsed.status as string);
  expect(parsed).toHaveProperty('data');
  expect(Array.isArray(parsed.warnings)).toBe(true);
  expect(Array.isArray(parsed.errors)).toBe(true);
  for (const w of parsed.warnings as Array<Record<string, unknown>>) {
    expect(typeof w.code).toBe('string');
    expect(typeof w.message).toBe('string');
  }
  for (const e of parsed.errors as Array<Record<string, unknown>>) {
    expect(typeof e.code).toBe('string');
    expect(typeof e.message).toBe('string');
  }
  if (parsed.status === 'error' || parsed.status === 'unknown') {
    const errObj = parsed.error as Record<string, unknown>;
    expect(typeof errObj.code).toBe('string');
    expect(typeof errObj.message).toBe('string');
  }
  return parsed as never;
}

describe('JSON envelope: schema regression across major commands', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(true); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('ed init', async () => {
    // init scaffolds; existing tmp already has files, so init may emit warnings
    const r = await runCli(['init'], tmp);
    assertEnvelope(r.stdout);
  });

  test('ed card create', async () => {
    const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed card get', async () => {
    await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    const r = await runCli(['card', 'get', 'p'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed card get nonexistent → status=error, error mapped to NOT_FOUND', async () => {
    const r = await runCli(['card', 'get', 'nonexistent'], tmp);
    const env = assertEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('CARD_NOT_FOUND');
    expect(r.exitCode).toBe(3);
  });

  test('ed card list', async () => {
    const r = await runCli(['card', 'list'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed validate (no args = all)', async () => {
    const r = await runCli(['validate'], tmp);
    const env = assertEnvelope(r.stdout);
    expect(['ok', 'partial']).toContain(env.status);
  });

  test('ed validate cards', async () => {
    const r = await runCli(['validate', 'cards'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed validate links', async () => {
    const r = await runCli(['validate', 'links'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed check drift', async () => {
    const r = await runCli(['check', 'drift'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed check coverage --uncovered', async () => {
    const r = await runCli(['check', 'coverage', '--uncovered'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed check coverage --suggest', async () => {
    const r = await runCli(['check', 'coverage', '--suggest'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed check impact <files>', async () => {
    const r = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed analyze', async () => {
    const r = await runCli(['analyze'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed glossary lookup (empty glossary)', async () => {
    const r = await runCli(['glossary', 'lookup'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed glossary define WORD=DEFINITION', async () => {
    const r = await runCli(['glossary', 'define', 'foo=foo definition'], tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed bulk sync (empty)', async () => {
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed spec sync', async () => {
    const r = await runCli(['spec', 'sync'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed spec annotate', async () => {
    const r = await runCli(['spec', 'annotate'], tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('CliUsageError envelope (invalid --type)', async () => {
    const r = await runCli(['card', 'create', 'x', '--type', 'invalid', '--summary', 's'], tmp);
    const env = assertEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('CLI_USAGE_ERROR');
    expect(r.exitCode).toBe(2);
  });

  test('GILDASH_NOT_CONFIGURED envelope on gildash-required command without projectRoot', async () => {
    const tmpNoGildash = setupProject(false);
    try {
      const r = await runCli(['spec', 'sync'], tmpNoGildash);
      const env = assertEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error?.code).toBe('GILDASH_NOT_CONFIGURED');
      expect(r.exitCode).toBe(6);
    } finally {
      try { rmSync(tmpNoGildash, { recursive: true, force: true }); } catch {}
    }
  });
});
