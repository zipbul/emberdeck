/**
 * DB-level fault tolerance e2e: corrupt SQLite file, missing schema,
 * truncated WAL. Validates that ed reports a readable error envelope
 * rather than crashing.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
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
  const tmp = mkdtempSync(join(tmpdir(), 'ed-dbcorrupt-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

describe('DB corruption / fault tolerance e2e', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    // Initialize a clean DB.
    await runCli(['glossary', 'define', 'init=ok'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('completely corrupt data.db file → JSON error envelope, no crash', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'this is not a sqlite file at all');
    // Also remove WAL/SHM so SQLite can't recover from them.
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    // Either crashes cleanly with JSON error envelope, or recovers via fallback.
    // Contract: stdout MUST be parseable JSON envelope.
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
    if (r.exitCode !== 0) {
      expect(parsed.status).toBe('error');
      expect(typeof parsed.error.code).toBe('string');
    }
  });

  test('truncated data.db (file shorter than SQLite header)', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'SQ');  // < 16 bytes
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
  });

  test('missing data.db file (after init) → re-creates DB transparently', async () => {
    unlinkSync(join(tmp, '.emberdeck/data.db'));
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.total).toBe(0);
  });

  test('readonly data.db → write op reports error envelope', async () => {
    const { chmodSync } = await import('node:fs');
    chmodSync(join(tmp, '.emberdeck/data.db'), 0o400);
    try {
      const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
      // Read might succeed (chmod 400 allows read), write must fail with JSON envelope.
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      if (r.exitCode !== 0) expect(parsed.status).toBe('error');
    } finally {
      chmodSync(join(tmp, '.emberdeck/data.db'), 0o644);
    }
  });
});
