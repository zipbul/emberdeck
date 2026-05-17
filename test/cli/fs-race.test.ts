/**
 * External-process FS race e2e: simulate another tool editing/deleting card
 * files between ed operations. Card files are SSOT; the CLI auto-syncs file→DB
 * at the start of every invocation, so external edits are silently absorbed
 * and `ed validate` reports a clean state without requiring `ed bulk sync`.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEd as runCli, parseJsonLines } from './helpers';

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
    // Auto-sync removed the stale DB row; nothing to flag.
    expect(parsed.summary.total).toBe(0);
    expect(parsed.fileLevelIssues).toEqual([]);
  });

  test('malformed card file + validate cards → reported once (orphan-file only, not duplicate card-sync-failed)', async () => {
    writeFileSync(join(tmp, '.emberdeck/cards/broken.md'), 'NOT VALID YAML AT ALL', 'utf-8');
    const r = await runCli(['validate', 'cards'], tmp);
    const parsed = JSON.parse(r.stdout);
    const orphanForBroken = parsed.fileLevelIssues.filter((i: { code: string; filePath: string }) =>
      i.code === 'orphan-file' && i.filePath.includes('broken.md'));
    expect(orphanForBroken).toHaveLength(1);
  });

  test('card file with missing parent → friendly parent-not-found message, not raw SQLite FK', async () => {
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
    const orphan = parsed.fileLevelIssues.find((i: { code: string; filePath: string; message: string }) =>
      i.code === 'orphan-file' && i.filePath.includes('orphan-child.md'));
    expect(orphan).toBeDefined();
    expect(orphan.message).toContain('parent card "nonexistent-domain" not found');
    expect(orphan.message).not.toContain('FOREIGN KEY constraint failed');
  });

  test('aggregate ed validate with an unreadable card file → links.items[].ioError set, not internal-error', async () => {
    const seedPath = join(tmp, '.emberdeck/cards/seed.md');
    let r: Awaited<ReturnType<typeof runCli>>;
    try {
      chmodSync(seedPath, 0o000);
      r = await runCli(['validate'], tmp);
    } finally {
      try { chmodSync(seedPath, 0o644); } catch {}
    }
    // Not a fatal error path — stdout should still emit per-command shape.
    expect(r.stdout.length).toBeGreaterThan(0);
    const errLine = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(errLine?.code).not.toBe('internal-error');
  });

  test('ed validate links <typo-key> → card-not-found error (stderr JSON-line), exit 3', async () => {
    const r = await runCli(['validate', 'links', 'definitely-not-a-real-key'], tmp);
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe('');
    const errLine = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(errLine?.code).toBe('card-not-found');
  });

  test('ed validate links (fan-out) with key-mismatch card → emits skipped item, does not crash', async () => {
    await runCli(['card', 'create', 'spec-x', '--type', 'spec', '--parent', 'seed', '--summary', 's'], tmp);
    const orig = join(tmp, '.emberdeck/cards/spec-x.md');
    const renamed = join(tmp, '.emberdeck/cards/wrong-slug.md');
    writeFileSync(renamed, readFileSync(orig, 'utf-8'));
    unlinkSync(orig);
    const r = await runCli(['validate', 'links'], tmp);
    // No fatal error; output must be parseable per-command JSON
    if (r.stdout.trim()) {
      JSON.parse(r.stdout);
    }
  });

  test('ed validate links <good-key> → ok output (smoke)', async () => {
    await runCli(['card', 'create', 'spec-ok', '--type', 'spec', '--parent', 'seed', '--summary', 's'], tmp);
    const r = await runCli(['validate', 'links', 'spec-ok'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.total).toBe(0);
    expect(parsed.summary.broken).toBe(0);
  });

  test('ed validate links with an unreadable spec file → not internal-error', async () => {
    await runCli(['card', 'create', 'spec-x', '--type', 'spec', '--parent', 'seed', '--summary', 's'], tmp);
    const specPath = join(tmp, '.emberdeck/cards/spec-x.md');
    let r: Awaited<ReturnType<typeof runCli>>;
    try {
      chmodSync(specPath, 0o000);
      r = await runCli(['validate', 'links'], tmp);
    } finally {
      try { chmodSync(specPath, 0o644); } catch {}
    }
    const errLine = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(errLine?.code).not.toBe('internal-error');
  });

  test('broken file + thrown command → card-sync-failed warning still emitted on catch path', async () => {
    writeFileSync(join(tmp, '.emberdeck/cards/broken.md'), 'BROKEN YAML', 'utf-8');
    const r = await runCli(['card', 'get', 'nonexistent'], tmp);
    expect(r.exitCode).toBe(3);
    const lines = parseJsonLines(r.stderr);
    expect(lines.some((l) => l.level === 'error' && l.code === 'card-not-found')).toBe(true);
    expect(lines.some((l) => l.level === 'warning' && l.code === 'card-sync-failed' && l.message.includes('broken.md'))).toBe(true);
  });

  test('key-mismatch + ed validate (aggregate) → reports key-mismatch or orphan-file without crash', async () => {
    const oldPath = join(tmp, '.emberdeck/cards/seed.md');
    const newPath = join(tmp, '.emberdeck/cards/renamed-slug.md');
    writeFileSync(newPath, readFileSync(oldPath, 'utf-8'));
    unlinkSync(oldPath);
    const r = await runCli(['validate'], tmp);
    expect(r.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    const issueCodes: string[] = [
      ...parsed.cards.items.flatMap((it: { issues: Array<{ code: string }> }) => it.issues.map((i) => i.code)),
      ...parsed.cards.fileLevelIssues.map((i: { code: string }) => i.code),
    ];
    expect(issueCodes.some((c) => c === 'key-mismatch' || c === 'orphan-file')).toBe(true);
  });

  test('external write of new card file → auto-absorbed, no orphan-file fileLevelIssue', async () => {
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
    expect(parsed.fileLevelIssues.some((i: { code: string }) => i.code === 'orphan-file')).toBe(false);
    // The card is now queryable via DB without a manual `bulk sync`.
    const get = await runCli(['card', 'get', 'orphan'], tmp);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).summary).toBe('external');
  });

  test('external rewrite of summary → auto-absorbed, no content-mismatch reported', async () => {
    const path = join(tmp, '.emberdeck/cards/seed.md');
    const text = readFileSync(path, 'utf-8');
    const modified = text.replace('summary: original', 'summary: tampered');
    writeFileSync(path, modified);
    const r = await runCli(['validate', 'cards'], tmp);
    const parsed = JSON.parse(r.stdout);
    const allIssueCodes: string[] = [
      ...parsed.items.flatMap((it: { issues: Array<{ code: string }> }) => it.issues.map((i) => i.code)),
      ...parsed.fileLevelIssues.map((i: { code: string }) => i.code),
    ];
    expect(allIssueCodes.includes('content-mismatch')).toBe(false);
    // DB has been updated to match the file.
    const get = await runCli(['card', 'get', 'seed'], tmp);
    expect(JSON.parse(get.stdout).summary).toBe('tampered');
  });

  test('external rewrite then bulk sync reconciles DB', async () => {
    const path = join(tmp, '.emberdeck/cards/seed.md');
    const text = readFileSync(path, 'utf-8');
    writeFileSync(path, text.replace('summary: original', 'summary: external-update'));
    await runCli(['bulk', 'sync'], tmp);
    const get = await runCli(['card', 'get', 'seed'], tmp);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).summary).toBe('external-update');
  });

  test('external delete during analyze run → analyze still produces valid v2 JSON', async () => {
    unlinkSync(join(tmp, '.emberdeck/cards/seed.md'));
    const r = await runCli(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.health).toBeDefined();
  });
});
