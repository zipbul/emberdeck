/**
 * Cross-process system_lock e2e: two `ed glossary define` invocations against
 * the same project run in parallel; the lock serializes them. Stale-lock
 * recovery is tested by injecting a synthetic stale row into system_lock and
 * verifying a fresh process can claim it.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const CLI = join(import.meta.dir, '../../cli.ts');

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-syslock-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

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

describe('system_lock cross-process e2e', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('two parallel glossary define on same project both succeed (lock serializes)', async () => {
    // Warm up the DB sequentially so subsequent parallel calls don't race
    // on initial schema creation (that race is OS-level SQLite, not the
    // system_lock under test).
    await runCli(['glossary', 'define', 'warm=up'], tmp);

    const [r1, r2] = await Promise.all([
      runCli(['glossary', 'define', 'word-a=def-a'], tmp),
      runCli(['glossary', 'define', 'word-b=def-b'], tmp),
    ]);
    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);
    const list = await runCli(['glossary', 'lookup'], tmp);
    const parsed = JSON.parse(list.stdout);
    const words = (parsed.data.entries as Array<{ word: string }>).map((e) => e.word).sort();
    expect(words).toContain('word-a');
    expect(words).toContain('word-b');
  });

  test('three parallel define operations all succeed without lock-timeout error', async () => {
    await runCli(['glossary', 'define', 'warm=up'], tmp);

    const results = await Promise.all([
      runCli(['glossary', 'define', 'a=1'], tmp),
      runCli(['glossary', 'define', 'b=2'], tmp),
      runCli(['glossary', 'define', 'c=3'], tmp),
    ]);
    for (const r of results) {
      expect(r.exitCode).toBe(0);
    }
    const list = await runCli(['glossary', 'lookup'], tmp);
    // 4 entries: warm=up, a=1, b=2, c=3
    expect(JSON.parse(list.stdout).data.entries).toHaveLength(4);
  });

  test('stale lock (dead PID) is reaped: subsequent invocation succeeds', async () => {
    // Initialize the project DB by running a single command.
    await runCli(['glossary', 'define', 'init=ok'], tmp);

    // Inject a stale lock row pointing at PID 1 (init) with a wrong start_time.
    // Real system_lock liveness check should detect mismatch and reap.
    const dbPath = join(tmp, '.emberdeck/data.db');
    const db = new Database(dbPath);
    try {
      db.run(`INSERT OR REPLACE INTO system_lock (name, pid, start_time_ticks, acquired_at)
               VALUES ('glossary', 99999999, 999999, '2000-01-01T00:00:00Z')`);
    } finally {
      db.close();
    }

    // A fresh ed run should detect the stale lock and reap it before its own write.
    const r = await runCli(['glossary', 'define', 'after-stale=ok'], tmp);
    expect(r.exitCode).toBe(0);
  });

  test('lock row removed after successful operation', async () => {
    await runCli(['glossary', 'define', 'x=y'], tmp);
    const dbPath = join(tmp, '.emberdeck/data.db');
    const db = new Database(dbPath);
    try {
      const row = db.prepare("SELECT * FROM system_lock WHERE name = 'glossary'").get();
      expect(row).toBeNull();
    } finally {
      db.close();
    }
  });
});
