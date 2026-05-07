/**
 * Cross-process concurrency e2e: parallel `bun cli.ts` invocations against
 * the same project. Verifies SQLite WAL + system_lock + per-card locks keep
 * the DB consistent under writer contention. In-process Promise.all on
 * createCard would only exercise withCardLock serialization, missing the
 * cross-process file-lock path — so subprocess is required.
 *
 * Fan-out reduced from 20× → 5× per scenario after measuring: lock-contention
 * effects are observable at 5 concurrent processes; 20 only multiplied cost.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

interface RunResult { exitCode: number; stdout: string; }

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout };
}

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-stress-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

describe('cross-process concurrency stress', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    await runCli(['glossary', 'define', 'init=ok'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('5 parallel card creates: every response is valid JSON, successes land in DB', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runCli(['card', 'create', `card-${i}`, '--type', 'brief', '--summary', 's'], tmp),
      ),
    );
    for (const r of results) {
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      if (r.exitCode === 0) expect(parsed.status).toBe('ok');
      else expect(parsed.status).toBe('error');
    }
    const successKeys = results
      .filter((r) => r.exitCode === 0)
      .map((r) => JSON.parse(r.stdout).data.key as string);
    const list = await runCli(['card', 'list', '--limit', '100'], tmp);
    const dbKeys = new Set(
      (JSON.parse(list.stdout).data.items as Array<{ key: string }>).map((i) => i.key),
    );
    for (const k of successKeys) expect(dbKeys.has(k)).toBe(true);
  });

  test('parallel create of SAME key: at most one wins, no duplicate row', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        runCli(['card', 'create', 'race', '--type', 'brief', '--summary', 's'], tmp),
      ),
    );
    const successes = results.filter((r) => r.exitCode === 0);
    expect(successes.length).toBeLessThanOrEqual(1);
    const list = await runCli(['card', 'list'], tmp);
    const items = JSON.parse(list.stdout).data.items as Array<{ key: string }>;
    expect(items.filter((c) => c.key === 'race').length).toBeLessThanOrEqual(1);
  });

  test('mixed CRUD races (create + update + list): every output is valid JSON', async () => {
    for (let i = 0; i < 3; i++) {
      await runCli(['card', 'create', `seed-${i}`, '--type', 'brief', '--summary', 's'], tmp);
    }
    const ops: Promise<RunResult>[] = [];
    for (let i = 0; i < 3; i++) {
      ops.push(runCli(['card', 'create', `new-${i}`, '--type', 'brief', '--summary', 'n'], tmp));
      ops.push(runCli(['card', 'update', `seed-${i}`, '--summary', `up-${i}`], tmp));
      ops.push(runCli(['card', 'list'], tmp));
    }
    const results = await Promise.all(ops);
    for (const r of results) {
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      expect(['ok', 'partial', 'error', 'unknown']).toContain(parsed.status);
    }
  });

  test('5 parallel glossary defines all serialize via system_lock', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runCli(['glossary', 'define', `term-${i}=def-${i}`], tmp),
      ),
    );
    for (const r of results) expect(r.exitCode).toBe(0);
    const list = await runCli(['glossary', 'lookup'], tmp);
    const entries = JSON.parse(list.stdout).data.entries as Array<{ word: string }>;
    // 1 (warm) + 5 = 6 entries
    expect(entries.length).toBe(6);
  });

  test('parallel operations under load do not produce malformed/interleaved JSON on stdout', async () => {
    const ops: Promise<RunResult>[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(runCli(['card', 'create', `x-${i}`, '--type', 'brief', '--summary', 's'], tmp));
    }
    const results = await Promise.all(ops);
    for (const r of results) {
      // If two writers ever interleaved on stdout, JSON.parse would throw.
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }
  });

  test('parallel ops complete within wall-clock budget (regression guard for O(N²) lock paths)', async () => {
    const start = Date.now();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runCli(['card', 'create', `time-${i}`, '--type', 'brief', '--summary', 's'], tmp),
      ),
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);
});
