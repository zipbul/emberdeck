/**
 * Phase 3.2: auto-sync warning contract.
 *
 * When a card file is malformed on disk, *any* read command must emit exactly
 * one `level:warning code:card-sync-failed` JSON-line on stderr — without
 * affecting the stdout shape of that command. The exit code is the natural
 * exit code of the command being invoked (auto-sync warnings don't fail
 * commands by themselves).
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEd, setupTmpProject, parseJsonLines } from './helpers';

describe('auto-sync emits exactly one card-sync-failed warning per malformed file', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
    writeFileSync(
      join(tmp, '.emberdeck/cards/broken.md'),
      'NOT VALID YAML AT ALL\n',
      'utf-8',
    );
  });
  afterEach(() => { cleanup(); });

  test('card list → stderr has exactly one card-sync-failed warning; stdout still v2 list shape', async () => {
    const r = await runEd(['card', 'list'], tmp);
    const warnings = parseJsonLines(r.stderr).filter(
      (l) => l.level === 'warning' && l.code === 'card-sync-failed',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('broken.md');
    // Stdout shape unaffected: card list still returns its per-command JSON
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  test('analyze → exactly one warning; stdout still analyze shape', async () => {
    const r = await runEd(['analyze'], tmp);
    const warnings = parseJsonLines(r.stderr).filter(
      (l) => l.level === 'warning' && l.code === 'card-sync-failed',
    );
    expect(warnings).toHaveLength(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.health).toBeDefined();
  });

  test('validate cards → exactly one warning', async () => {
    const r = await runEd(['validate', 'cards'], tmp);
    const warnings = parseJsonLines(r.stderr).filter(
      (l) => l.level === 'warning' && l.code === 'card-sync-failed',
    );
    expect(warnings).toHaveLength(1);
  });

  test('card get nonexistent → warning preserved alongside error JSON-line', async () => {
    const r = await runEd(['card', 'get', 'definitely-not-there'], tmp);
    expect(r.exitCode).toBe(3);
    const lines = parseJsonLines(r.stderr);
    const warnings = lines.filter((l) => l.level === 'warning' && l.code === 'card-sync-failed');
    expect(warnings).toHaveLength(1);
    const errors = lines.filter((l) => l.level === 'error' && l.code === 'card-not-found');
    expect(errors).toHaveLength(1);
  });
});
