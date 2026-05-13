/**
 * External-process FS race e2e: simulate another tool editing/deleting card
 * files between ed operations. Card files are SSOT; the CLI auto-syncs file→DB
 * at the start of every invocation, so external edits are silently absorbed
 * and `ed validate` reports a clean state without requiring `ed bulk sync`.
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

  test('external delete of card file → auto-absorbed, validate clean', async () => {
    unlinkSync(join(tmp, '.emberdeck/cards/seed.md'));
    const r = await runCli(['validate', 'cards'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    // Auto-sync removed the stale DB row; nothing to flag.
    expect(parsed.errors.some((e: { code: string }) => e.code === 'STALE_DB_ROW')).toBe(false);
  });

  test('malformed card file + validate cards → reported once (no CARD_SYNC_FAILED + ORPHAN_FILE double-up)', async () => {
    writeFileSync(join(tmp, '.emberdeck/cards/broken.md'), 'NOT VALID YAML AT ALL', 'utf-8');
    const r = await runCli(['validate', 'cards'], tmp);
    const parsed = JSON.parse(r.stdout);
    const orphanForBroken = parsed.errors.filter((e: { code: string; message: string }) =>
      e.code === 'ORPHAN_FILE' && e.message.includes('broken.md'));
    const warnForBroken = (parsed.warnings ?? []).filter((w: { code: string; message: string }) =>
      w.code === 'CARD_SYNC_FAILED' && w.message.includes('broken.md'));
    // The broken file shows up exactly once — as ORPHAN_FILE in errors[];
    // the CARD_SYNC_FAILED warning is suppressed via details.file_path dedup.
    expect(orphanForBroken).toHaveLength(1);
    expect(warnForBroken).toHaveLength(0);
  });

  test('card file with missing parent → friendly CARD_SYNC_FAILED, not raw SQLite FK', async () => {
    // Drop a card file whose parent key doesn't exist in DB or in the same
    // sync batch. The auto-sync topological pre-check should emit a friendly
    // "parent card X not found" error, not the raw "FOREIGN KEY constraint
    // failed" string.
    writeFileSync(
      join(tmp, '.emberdeck/cards/orphan-child.md'),
      [
        '---',
        'key: orphan-child',
        'type: brief',
        'status: draft',
        'summary: parent missing',
        'parent: nonexistent-domain',
        '---',
        '',
      ].join('\n'),
    );
    const r = await runCli(['validate', 'cards'], tmp);
    const parsed = JSON.parse(r.stdout);
    const orphan = parsed.errors.find((e: { code: string; message: string }) =>
      e.code === 'ORPHAN_FILE' && e.message.includes('orphan-child.md'));
    expect(orphan).toBeDefined();
    expect(orphan.message).toContain('parent card "nonexistent-domain" not found');
    expect(orphan.message).not.toContain('FOREIGN KEY constraint failed');
  });

  test('aggregate ed validate with an unreadable card file → partial envelope, not INTERNAL_ERROR', async () => {
    // TOCTOU-style: auto-sync read the file (cached), then permission was
    // restricted before validateCodeLinks ran. The per-card try/catch must
    // capture the I/O error as VALIDATION_FAILED and preserve all other
    // envelope content, not crash the whole command to INTERNAL_ERROR.
    const { chmodSync } = await import('node:fs');
    const seedPath = join(tmp, '.emberdeck/cards/seed.md');
    let r: RunResult;
    try {
      chmodSync(seedPath, 0o000);
      r = await runCli(['validate'], tmp);
    } finally {
      try { chmodSync(seedPath, 0o644); } catch {}
    }
    const parsed = JSON.parse(r.stdout);
    expect(parsed.error?.code).not.toBe('INTERNAL_ERROR');
    expect(parsed.status).not.toBe('error');
    expect(parsed.errors.some((e: { code: string }) => e.code === 'VALIDATION_FAILED')).toBe(true);
  });

  test('ed validate links with an unreadable spec file → partial envelope, not INTERNAL_ERROR', async () => {
    // Same TOCTOU window for the `validate links` subcommand. The brief seed
    // alone has no spec children so we add one before flipping permissions.
    await runCli(['card', 'create', 'spec-x', '--type', 'spec', '--parent', 'seed', '--summary', 's'], tmp);
    const { chmodSync } = await import('node:fs');
    const specPath = join(tmp, '.emberdeck/cards/spec-x.md');
    let r: RunResult;
    try {
      chmodSync(specPath, 0o000);
      r = await runCli(['validate', 'links'], tmp);
    } finally {
      try { chmodSync(specPath, 0o644); } catch {}
    }
    const parsed = JSON.parse(r.stdout);
    expect(parsed.error?.code).not.toBe('INTERNAL_ERROR');
    expect(parsed.status).not.toBe('error');
    expect(parsed.errors.some((e: { code: string }) => e.code === 'VALIDATION_FAILED')).toBe(true);
  });

  test('broken file + thrown command → CARD_SYNC_FAILED warning preserved on catch path', async () => {
    // Auto-sync produces a failure (broken yaml), AND the command itself
    // throws (asking for a non-existent card). The runner's catch path must
    // still surface the CARD_SYNC_FAILED warning so the user sees both
    // problems, not just the thrown error.
    writeFileSync(join(tmp, '.emberdeck/cards/broken.md'), 'BROKEN YAML', 'utf-8');
    const r = await runCli(['card', 'get', 'nonexistent'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.error?.code).toBe('CARD_NOT_FOUND');
    expect(parsed.warnings.some((w: { code: string; message: string }) =>
      w.code === 'CARD_SYNC_FAILED' && w.message.includes('broken.md'))).toBe(true);
  });

  test('KEY_MISMATCH + ed validate (aggregate) → reports KEY_MISMATCH without throwing CARD_NOT_FOUND', async () => {
    // Rename a synced card's file so the on-disk slug no longer matches the frontmatter key.
    const oldPath = join(tmp, '.emberdeck/cards/seed.md');
    const newPath = join(tmp, '.emberdeck/cards/renamed-slug.md');
    writeFileSync(newPath, readFileSync(oldPath, 'utf-8'));
    unlinkSync(oldPath);
    const r = await runCli(['validate'], tmp);
    const parsed = JSON.parse(r.stdout);
    // Should NOT bail out with CARD_NOT_FOUND — the aggregate validate must
    // skip mismatched cards during validateCodeLinks and still surface
    // KEY_MISMATCH (and ORPHAN_FILE) in errors[].
    expect(parsed.error).toBeUndefined();
    expect(parsed.status).not.toBe('error');
    expect(parsed.errors.some((e: { code: string }) => e.code === 'KEY_MISMATCH' || e.code === 'ORPHAN_FILE')).toBe(true);
  });

  test('external write of new card file → auto-absorbed, no ORPHAN_FILE warning', async () => {
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
    const parsed = JSON.parse(r.stdout);
    expect(parsed.errors.some((e: { code: string }) => e.code === 'ORPHAN_FILE')).toBe(false);
    // The card is now queryable via DB without a manual `bulk sync`.
    const get = await runCli(['card', 'get', 'orphan'], tmp);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).data.summary).toBe('external');
  });

  test('external rewrite of summary → auto-absorbed, no CONTENT_MISMATCH warning', async () => {
    const path = join(tmp, '.emberdeck/cards/seed.md');
    const text = readFileSync(path, 'utf-8');
    const modified = text.replace('summary: original', 'summary: tampered');
    writeFileSync(path, modified);
    const r = await runCli(['validate', 'cards'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.errors.some((e: { code: string }) => e.code === 'CONTENT_MISMATCH')).toBe(false);
    // DB has been updated to match the file.
    const get = await runCli(['card', 'get', 'seed'], tmp);
    expect(JSON.parse(get.stdout).data.summary).toBe('tampered');
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
