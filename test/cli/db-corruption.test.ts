/**
 * DB-level fault tolerance e2e: corrupt SQLite file, missing schema,
 * truncated WAL. Validates that ed reports a readable error envelope
 * rather than crashing.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runEd as runCli } from './helpers';

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

  test('completely corrupt data.db → exit non-zero + stderr JSON-line error', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'this is not a sqlite file at all');
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    // SQLite rejects the header → setupEmberdeck throws → runner surfaces
    // exit 1 + JSON-line error on stderr.
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('"level":"error"');
  });

  test('truncated data.db (file shorter than SQLite header) → exit non-zero + stderr error', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'SQ');
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    // 2-byte file (still has corrupted header from prior init) → bun:sqlite
    // rejects on open → structured CLI error.
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('"level":"error"');
  });

  test('missing data.db file (after init) → re-creates DB transparently', async () => {
    unlinkSync(join(tmp, '.emberdeck/data.db'));
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.total).toBe(0);
  });

  test('readonly data.db → write op reports error', async () => {
    chmodSync(join(tmp, '.emberdeck/data.db'), 0o400);
    try {
      const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
      // Read-only file blocks the DB write → safeWriteOperation surfaces a
      // structured CLI error (exit 2, JSON-line on stderr).
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('"level":"error"');
    } finally {
      chmodSync(join(tmp, '.emberdeck/data.db'), 0o644);
    }
  });
});
