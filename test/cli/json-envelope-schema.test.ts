/**
 * JSON envelope schema regression test.
 *
 * Every CLI command response must match the documented envelope:
 *   { schemaVersion: { major, minor }, status, data, warnings, errors, error? }
 *
 * Calls `program.parseAsync` in-process via `runEd` (no subprocess) — same
 * code path as the binary entry, ~10× cheaper.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runEd, setupTmpProject } from './helpers';

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/sample-ts-project');

function setupProject(withGildash: boolean): { tmp: string; cleanup: () => void } {
  const projectRoot = withGildash ? 'project' : undefined;
  const handle = setupTmpProject({ projectRoot });
  if (withGildash) {
    cpSync(FIXTURE_SRC, join(handle.tmp, 'project'), { recursive: true });
  }
  return handle;
}

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
  let handle: { tmp: string; cleanup: () => void };
  beforeEach(() => { handle = setupProject(true); });
  afterEach(() => { handle.cleanup(); });

  test('ed init', async () => {
    const r = await runEd(['init'], handle.tmp);
    assertEnvelope(r.stdout);
  });

  test('ed card create', async () => {
    const r = await runEd(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed card get', async () => {
    await runEd(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], handle.tmp);
    const r = await runEd(['card', 'get', 'p'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed card get nonexistent → status=error, error mapped to NOT_FOUND', async () => {
    const r = await runEd(['card', 'get', 'nonexistent'], handle.tmp);
    const env = assertEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('CARD_NOT_FOUND');
    expect(r.exitCode).toBe(3);
  });

  test('ed card list', async () => {
    const r = await runEd(['card', 'list'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed validate (no args = all)', async () => {
    const r = await runEd(['validate'], handle.tmp);
    const env = assertEnvelope(r.stdout);
    expect(['ok', 'partial']).toContain(env.status);
  });

  test('ed validate cards', async () => {
    const r = await runEd(['validate', 'cards'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed validate links', async () => {
    const r = await runEd(['validate', 'links'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed check drift', async () => {
    const r = await runEd(['check', 'drift'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed check coverage --uncovered', async () => {
    const r = await runEd(['check', 'coverage', '--uncovered'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed check coverage --suggest', async () => {
    const r = await runEd(['check', 'coverage', '--suggest'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed check impact <files>', async () => {
    const r = await runEd(['check', 'impact', 'src/auth/jwt.ts'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed analyze', async () => {
    const r = await runEd(['analyze'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed glossary lookup (empty glossary)', async () => {
    const r = await runEd(['glossary', 'lookup'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed glossary define WORD=DEFINITION', async () => {
    const r = await runEd(['glossary', 'define', 'foo=foo definition'], handle.tmp);
    expect(assertEnvelope(r.stdout).status).toBe('ok');
  });

  test('ed bulk sync (empty)', async () => {
    const r = await runEd(['bulk', 'sync'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed spec sync', async () => {
    const r = await runEd(['spec', 'sync'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('ed spec annotate', async () => {
    const r = await runEd(['spec', 'annotate'], handle.tmp);
    expect(['ok', 'partial']).toContain(assertEnvelope(r.stdout).status);
  });

  test('CliUsageError envelope (invalid --type)', async () => {
    const r = await runEd(['card', 'create', 'x', '--type', 'invalid', '--summary', 's'], handle.tmp);
    const env = assertEnvelope(r.stdout);
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('CLI_USAGE_ERROR');
    expect(r.exitCode).toBe(2);
  });

  test('GILDASH_NOT_CONFIGURED envelope on gildash-required command without projectRoot', async () => {
    const noGildash = setupProject(false);
    try {
      const r = await runEd(['spec', 'sync'], noGildash.tmp);
      const env = assertEnvelope(r.stdout);
      expect(env.status).toBe('error');
      expect(env.error?.code).toBe('GILDASH_NOT_CONFIGURED');
      expect(r.exitCode).toBe(6);
    } finally {
      noGildash.cleanup();
    }
  });
});
