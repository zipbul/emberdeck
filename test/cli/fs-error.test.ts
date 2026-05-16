/**
 * Filesystem error e2e: readonly cards directory, missing parent dir, disk
 * write failures. Covers `atomicWrite` error path + `safeWriteOperation`
 * compensation logic.
 *
 * We use POSIX permissions (chmod 0o500 = read+exec, no write) on the cards
 * directory to simulate "disk write fails" without needing actual full-disk
 * conditions. This exercises the rename/unlink fallback in fs/writer.ts.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnCli as runCli } from './helpers';

const IS_ROOT = process.getuid?.() === 0;

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-fserr-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

const describeIfNotRoot = IS_ROOT ? describe.skip : describe;

describeIfNotRoot('FS write error e2e', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => {
    if (tmp) {
      // Restore writable perms so cleanup can rm
      try { chmodSync(join(tmp, '.emberdeck/cards'), 0o755); } catch {}
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });

  test('readonly cards dir → card create reports stderr JSON-line error', async () => {
    chmodSync(join(tmp, '.emberdeck/cards'), 0o500);  // r+x, no write
    const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('"level":"error"');
    expect(r.stderr).toContain('"code":');
  });

  test('readonly cards dir + atomicWrite leaves no orphaned tmp files', async () => {
    chmodSync(join(tmp, '.emberdeck/cards'), 0o500);
    await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    chmodSync(join(tmp, '.emberdeck/cards'), 0o755);
    const files = readdirSync(join(tmp, '.emberdeck/cards'));
    // No `*.tmp.<hash>` artefacts should remain.
    expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  test('readonly cards dir → safeWriteOperation rolls back DB row (no orphan in card list)', async () => {
    chmodSync(join(tmp, '.emberdeck/cards'), 0o500);
    const create = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    expect(create.exitCode).not.toBe(0);
    chmodSync(join(tmp, '.emberdeck/cards'), 0o755);

    // After rollback the card must not exist in the DB; `card get` returns NOT_FOUND.
    const got = await runCli(['card', 'get', 'p'], tmp);
    expect(got.exitCode).toBe(3); // NOT_FOUND
    expect(got.stdout).toBe('');
    expect(got.stderr).toContain('"code":"card-not-found"');
  });

  test('missing parent dir for namespaced key still creates dir tree', async () => {
    // Card with deep namespace requires mkdir -p; verify it's handled.
    const r = await runCli(['card', 'create', 'a/b/c/deep', '--type', 'brief', '--summary', 's'], tmp);
    expect(r.exitCode).toBe(0);
  });

  test('cardsDir does not exist → init creates it; otherwise card create fails cleanly', async () => {
    const tmp2 = mkdtempSync(join(tmpdir(), 'ed-noinit-'));
    try {
      writeFileSync(join(tmp2, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
      writeFileSync(
        join(tmp2, '.emberdeck.jsonc'),
        JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
      );
      // Don't pre-create .emberdeck/cards. Setup will fail trying to open DB.
      const r = await runCli(['card', 'list'], tmp2);
      // Either auto-creates (exit 0 + per-command JSON) or clean error (stderr JSON-line).
      if (r.exitCode === 0) {
        JSON.parse(r.stdout);
      } else {
        expect(r.stdout).toBe('');
        expect(r.stderr).toContain('"level":"error"');
      }
    } finally {
      try { rmSync(tmp2, { recursive: true, force: true }); } catch {}
    }
  });

  test('config file unreadable → stderr JSON-line error', async () => {
    chmodSync(join(tmp, '.emberdeck.jsonc'), 0o000);
    const r = await runCli(['card', 'list'], tmp);
    chmodSync(join(tmp, '.emberdeck.jsonc'), 0o644);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('"level":"error"');
  });
});
