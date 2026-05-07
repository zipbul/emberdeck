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

const CLI = join(import.meta.dir, '../../cli.ts');
const IS_ROOT = process.getuid?.() === 0;

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

  test('readonly cards dir → card create reports IO error envelope', async () => {
    chmodSync(join(tmp, '.emberdeck/cards'), 0o500);  // r+x, no write
    const r = await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    expect(r.exitCode).not.toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('error');
    // Error code may be PERMISSION/IO_ERROR/INTERNAL_ERROR depending on
    // which layer caught it; the contract is just "non-zero exit + error envelope"
    expect(typeof parsed.error.code).toBe('string');
    expect(parsed.error.message.length).toBeGreaterThan(0);
  });

  test('readonly cards dir + atomicWrite leaves no orphaned tmp files', async () => {
    chmodSync(join(tmp, '.emberdeck/cards'), 0o500);
    await runCli(['card', 'create', 'p', '--type', 'brief', '--summary', 's'], tmp);
    chmodSync(join(tmp, '.emberdeck/cards'), 0o755);
    const files = readdirSync(join(tmp, '.emberdeck/cards'));
    // No `*.tmp.<hash>` artefacts should remain.
    expect(files.filter((f) => f.includes('.tmp.'))).toEqual([]);
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
      // Either it auto-creates the dir or returns clean error envelope.
      // Either way, response is JSON envelope with status field.
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
      expect(['ok', 'error']).toContain(parsed.status);
    } finally {
      try { rmSync(tmp2, { recursive: true, force: true }); } catch {}
    }
  });

  test('config file unreadable → CONFIG_MISSING-class error', async () => {
    chmodSync(join(tmp, '.emberdeck.jsonc'), 0o000);
    const r = await runCli(['card', 'list'], tmp);
    chmodSync(join(tmp, '.emberdeck.jsonc'), 0o644);
    expect(r.exitCode).not.toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('error');
  });
});
