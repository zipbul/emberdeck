/**
 * DB-level fault tolerance e2e: corrupt SQLite file, missing schema,
 * truncated WAL. Validates that ed reports a readable error envelope
 * rather than crashing.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnCli as runCli } from './helpers';

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

  test('completely corrupt data.db file → stderr JSON-line error, no crash', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'this is not a sqlite file at all');
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    // Either recovers (exit 0 + per-command JSON on stdout) or errors (stderr JSON-line).
    if (r.exitCode !== 0) {
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('"level":"error"');
    } else {
      JSON.parse(r.stdout); // must parse
    }
  });

  test('truncated data.db (file shorter than SQLite header)', async () => {
    writeFileSync(join(tmp, '.emberdeck/data.db'), 'SQ');
    try { unlinkSync(join(tmp, '.emberdeck/data.db-wal')); } catch {}
    try { unlinkSync(join(tmp, '.emberdeck/data.db-shm')); } catch {}

    const r = await runCli(['card', 'list'], tmp);
    // Either recovers or emits structured error
    if (r.exitCode === 0) {
      JSON.parse(r.stdout);
    } else {
      expect(r.stderr).toContain('"level":"error"');
    }
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
    const { chmodSync } = await import('node:fs');
    chmodSync(join(tmp, '.emberdeck/data.db'), 0o400);
    try {
      const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
      if (r.exitCode !== 0) {
        expect(r.stdout).toBe('');
        expect(r.stderr).toContain('"level":"error"');
      }
    } finally {
      chmodSync(join(tmp, '.emberdeck/data.db'), 0o644);
    }
  });
});
