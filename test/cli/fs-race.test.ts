/**
 * External-process FS race e2e: simulate another tool editing/deleting card
 * files between ed operations. Validates that ed detects divergence
 * (validateCards content-mismatch / orphan-file / stale-db-row) and emits
 * structured warnings rather than silently corrupting state.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
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
  const tmp = mkdtempSync(join(tmpdir(), 'ed-fsrace-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

describe('external FS modification e2e', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    // Seed a card so we have DB rows to diff against.
    await runCli(['card', 'create', 'seed', '--type', 'brief', '--summary', 'original'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('external delete of card file → validate flags stale-db-row', async () => {
    unlinkSync(join(tmp, '.emberdeck/cards/seed.md'));
    const r = await runCli(['validate', 'cards'], tmp);
    expect(r.exitCode).toBe(2);  // partial
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.errors.some((e: { code: string }) => e.code === 'STALE_DB_ROW')).toBe(true);
  });

  test('external write of new card file → validate flags orphan-file until sync', async () => {
    writeFileSync(
      join(tmp, '.emberdeck/cards/orphan.md'),
      [
        '---',
        'key: orphan',
        'type: brief',
        'status: draft',
        'summary: external',
        '---',
        '',
      ].join('\n'),
    );
    const r = await runCli(['validate', 'cards'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.errors.some((e: { code: string }) => e.code === 'ORPHAN_FILE')).toBe(true);
    // After bulk sync the orphan is reconciled — at minimum the orphan-file
    // warning disappears.
    await runCli(['bulk', 'sync'], tmp);
    const r2 = await runCli(['validate', 'cards'], tmp);
    const parsed2 = JSON.parse(r2.stdout);
    expect(parsed2.errors.some((e: { code: string }) => e.code === 'ORPHAN_FILE')).toBe(false);
  });

  test('external rewrite of summary → validate flags content-mismatch', async () => {
    const path = join(tmp, '.emberdeck/cards/seed.md');
    const text = readFileSync(path, 'utf-8');
    const modified = text.replace('summary: original', 'summary: tampered');
    writeFileSync(path, modified);
    const r = await runCli(['validate', 'cards'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.errors.some((e: { code: string }) => e.code === 'CONTENT_MISMATCH')).toBe(true);
  });

  test('external rewrite then bulk sync reconciles DB', async () => {
    const path = join(tmp, '.emberdeck/cards/seed.md');
    const text = readFileSync(path, 'utf-8');
    writeFileSync(path, text.replace('summary: original', 'summary: external-update'));
    await runCli(['bulk', 'sync'], tmp);
    const get = await runCli(['card', 'get', 'seed'], tmp);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).data.summary).toBe('external-update');
  });

  test('external delete during analyze run → analyze still produces valid envelope', async () => {
    // Race: delete file just before analyze. analyze tolerates missing files.
    unlinkSync(join(tmp, '.emberdeck/cards/seed.md'));
    const r = await runCli(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
  });
});
