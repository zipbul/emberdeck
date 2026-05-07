/**
 * Heavy concurrent operation e2e: 50 parallel card creates against the
 * same project, mixed CRUD races, parallel glossary writes. Validates
 * that SQLite WAL + system_lock + per-card locks together keep the DB
 * consistent under load.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

interface RunResult { exitCode: number; stdout: string; stderr: string; }

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

describe('concurrency stress e2e', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    // Pre-warm DB to avoid first-run schema race.
    await runCli(['glossary', 'define', 'init=ok'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  // Subprocess-based parallel writes against the same SQLite DB hit OS-level
  // file lock contention; SQLite WAL handles concurrent reads but not
  // concurrent writers. Some writes will fail with "database is locked" —
  // that's expected. The contract under test:
  //   1. Every result, success OR failure, is a valid JSON envelope (no crash).
  //   2. Successful creates land consistently in the DB (no partial writes).
  //   3. Failures carry stable error codes (no opaque crashes).

  test('20 parallel card creates: every response is a valid JSON envelope', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runCli(['card', 'create', `card-${i}`, '--type', 'brief', '--summary', `s${i}`], tmp),
      ),
    );
    for (const r of results) {
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      if (r.exitCode === 0) {
        expect(parsed.status).toBe('ok');
      } else {
        expect(parsed.status).toBe('error');
        expect(typeof parsed.error.code).toBe('string');
      }
    }
    // Every successful create's card must be present in DB (no half-write).
    const successKeys = results
      .filter((r) => r.exitCode === 0)
      .map((r) => JSON.parse(r.stdout).data.key as string);
    const list = await runCli(['card', 'list', '--limit', '100'], tmp);
    const dbKeys = new Set(
      (JSON.parse(list.stdout).data.items as Array<{ key: string }>).map((i) => i.key),
    );
    for (const k of successKeys) expect(dbKeys.has(k)).toBe(true);
  });

  test('parallel create of cards with the SAME key: at most one succeeds, others fail cleanly', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        runCli(['card', 'create', 'race', '--type', 'brief', '--summary', 's'], tmp),
      ),
    );
    const successes = results.filter((r) => r.exitCode === 0);
    expect(successes.length).toBeLessThanOrEqual(1);
    for (const r of results) {
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
    }
    // The card 'race' exists either 0 or 1 times in DB — never duplicated.
    const get = await runCli(['card', 'list'], tmp);
    const items = JSON.parse(get.stdout).data.items as Array<{ key: string }>;
    expect(items.filter((c) => c.key === 'race').length).toBeLessThanOrEqual(1);
  });

  test('mixed CRUD races: every output is parseable JSON', async () => {
    // Seed sequentially so reads/updates have something to operate on.
    for (let i = 0; i < 5; i++) {
      await runCli(['card', 'create', `seed-${i}`, '--type', 'brief', '--summary', `s${i}`], tmp);
    }
    const ops: Promise<RunResult>[] = [];
    for (let i = 0; i < 5; i++) {
      ops.push(runCli(['card', 'create', `new-${i}`, '--type', 'brief', '--summary', `n${i}`], tmp));
      ops.push(runCli(['card', 'update', `seed-${i}`, '--summary', `updated-${i}`], tmp));
      ops.push(runCli(['card', 'list'], tmp));
    }
    const results = await Promise.all(ops);
    for (const r of results) {
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      expect(['ok', 'partial', 'error', 'unknown']).toContain(parsed.status);
    }
  });

  test('10 parallel glossary define operations all serialize correctly', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        runCli(['glossary', 'define', `term-${i}=def-${i}`], tmp),
      ),
    );
    for (const r of results) expect(r.exitCode).toBe(0);
    const list = await runCli(['glossary', 'lookup'], tmp);
    const entries = JSON.parse(list.stdout).data.entries as Array<{ word: string }>;
    // 1 (warm) + 10 = 11 entries
    expect(entries.length).toBe(11);
  });

  test('parallel operations under load do not produce malformed JSON', async () => {
    const ops: Promise<RunResult>[] = [];
    for (let i = 0; i < 30; i++) {
      ops.push(runCli(['card', 'create', `x-${i}`, '--type', 'brief', '--summary', 's'], tmp));
    }
    const results = await Promise.all(ops);
    // The contract: every stdout is single-document JSON. If two writers ever
    // interleaved on stdout, JSON.parse would throw.
    for (const r of results) {
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }
  });

  test('all parallel operations complete within reasonable time (regression guard)', async () => {
    const start = Date.now();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runCli(['card', 'create', `time-${i}`, '--type', 'brief', '--summary', 's'], tmp),
      ),
    );
    const elapsed = Date.now() - start;
    // 20 parallel ops should complete in well under 30s on any reasonable machine.
    // If a future refactor introduces O(N²) lock acquisition or similar,
    // this catches it.
    expect(elapsed).toBeLessThan(30_000);
  }, 60_000);
});
