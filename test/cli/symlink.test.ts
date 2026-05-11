/**
 * Symlink handling e2e: card files that ARE symlinks, symlinks pointing
 * outside cardsDir, broken symlinks. Validates that ed bulk sync / get
 * either follow symlinks transparently or report stable errors.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
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
  const tmp = mkdtempSync(join(tmpdir(), 'ed-symlink-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

const validCardContent = (key: string) => [
  '---',
  `key: ${key}`,
  'type: brief',
  'status: draft',
  `summary: card ${key}`,
  '---',
  '',
].join('\n');

describe('symlink handling e2e', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('card file IS a symlink to a real file → bulk sync follows + reads', async () => {
    // Real card stored outside the cards dir.
    const realPath = join(tmp, 'real-card.md');
    writeFileSync(realPath, validCardContent('symlinked'));
    // Symlink inside cards dir points to real file.
    symlinkSync(realPath, join(tmp, '.emberdeck/cards/symlinked.md'));

    const sync = await runCli(['bulk', 'sync'], tmp);
    expect(sync.exitCode).toBe(0);

    const get = await runCli(['card', 'get', 'symlinked'], tmp);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).data.summary).toBe('card symlinked');
  });

  test('broken symlink → bulk sync handles cleanly, good cards still synced', async () => {
    symlinkSync('/nonexistent/path', join(tmp, '.emberdeck/cards/broken.md'));
    writeFileSync(join(tmp, '.emberdeck/cards/good.md'), validCardContent('good'));

    const sync = await runCli(['bulk', 'sync'], tmp);
    // Either skipped (exit 0) or reported as partial (exit 2). Both acceptable —
    // contract is "no crash + good card still made it".
    expect([0, 2]).toContain(sync.exitCode);
    const parsed = JSON.parse(sync.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
    // Good card synced into DB (verifiable via subsequent get).
    const get = await runCli(['card', 'get', 'good'], tmp);
    expect(get.exitCode).toBe(0);
  });

  test('symlink to file in another temp directory → still readable', async () => {
    const otherTmp = mkdtempSync(join(tmpdir(), 'ed-symlink-other-'));
    try {
      const remotePath = join(otherTmp, 'remote.md');
      writeFileSync(remotePath, validCardContent('remote'));
      symlinkSync(remotePath, join(tmp, '.emberdeck/cards/remote.md'));

      const sync = await runCli(['bulk', 'sync'], tmp);
      expect(sync.exitCode).toBe(0);
      const get = await runCli(['card', 'get', 'remote'], tmp);
      expect(get.exitCode).toBe(0);
    } finally {
      try { rmSync(otherTmp, { recursive: true, force: true }); } catch {}
    }
  });

  test('directory symlink in cards tree: contents discovered if Bun.Glob follows', async () => {
    const realDir = join(tmp, 'real-dir');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'inside.json'), validCardContent('linked-dir/inside'));
    symlinkSync(realDir, join(tmp, '.emberdeck/cards/linked-dir'));

    const sync = await runCli(['bulk', 'sync'], tmp);
    // Either the glob follows the dir symlink and syncs (status=ok) or it doesn't (still ok with synced=0).
    // Contract: subprocess returns valid JSON envelope without crash.
    const parsed = JSON.parse(sync.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
  });
});
