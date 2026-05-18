/**
 * Phase 2 polish: partial-status, --since persistence, export STDOUT, unknown option, spinner mode-detect.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEd, setupTmpProject, parseJsonLines } from './helpers';

describe('Phase 2 polish: bulk create partial-success', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('mixed success/failure in bulk → exit 2 + partial arrays', async () => {
    const json = JSON.stringify([
      { key: 'ok-card', type: 'brief', summary: 'OK card' },
      { key: 'bad-parent', type: 'brief', summary: 'bad', parent: 'nonexistent-parent' },
    ]);
    writeFileSync(join(tmp, 'mix.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'mix.json'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toHaveLength(1);
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.failed[0].key).toBe('bad-parent');
  });

  test('all success → exit 0', async () => {
    const json = JSON.stringify([
      { key: 'a-card', type: 'brief', summary: 'A' },
      { key: 'b-card', type: 'brief', summary: 'B' },
    ]);
    writeFileSync(join(tmp, 'all.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'all.json'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toHaveLength(2);
  });

  test('all failure → exit 2 + failed[] populated, created[] empty', async () => {
    const json = JSON.stringify([
      { key: 'bad1', type: 'brief', summary: 'X', parent: 'nonexistent' },
      { key: 'bad2', type: 'brief', summary: 'Y', parent: 'nonexistent' },
    ]);
    writeFileSync(join(tmp, 'all-bad.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'all-bad.json'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toHaveLength(0);
    expect(parsed.failed).toHaveLength(2);
    expect(r.exitCode).toBe(2);
  });

  test('partial mixed → exit 2 (gate signal)', async () => {
    const json = JSON.stringify([
      { key: 'ok-card', type: 'brief', summary: 'OK' },
      { key: 'bad-parent', type: 'brief', summary: 'bad', parent: 'nonexistent' },
    ]);
    writeFileSync(join(tmp, 'mix2.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'mix2.json'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('all success → exit 0', async () => {
    const json = JSON.stringify([
      { key: 'c1', type: 'brief', summary: 'c1' },
      { key: 'c2', type: 'brief', summary: 'c2' },
    ]);
    writeFileSync(join(tmp, 'good.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'good.json'], tmp);
    expect(r.exitCode).toBe(0);
  });
});

describe('Phase 2 polish: card export STDOUT default', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(async () => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
    await runEd(['card', 'create', 'expo', '--type', 'brief', '--summary', 'export me'], tmp);
  });
  afterEach(() => { cleanup(); });

  test('default → markdown content nested in JSON output (mode=stdout)', async () => {
    const r = await runEd(['card', 'export', 'expo'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('stdout');
    expect(parsed.content).toContain('---');
    expect(parsed.content).toContain('key: expo');
    expect(parsed.content).toContain('summary: export me');
  });

  test('default STDOUT does NOT modify original file', async () => {
    const path = join(tmp, '.emberdeck/cards/expo.md');
    const before = await Bun.file(path).text();
    const beforeStat = await Bun.file(path).stat();
    await runEd(['card', 'export', 'expo'], tmp);
    const after = await Bun.file(path).text();
    const afterStat = await Bun.file(path).stat();
    expect(after).toBe(before);
    expect(afterStat.mtime.getTime()).toBe(beforeStat.mtime.getTime());
  });

  test('--out FILE does NOT modify original file', async () => {
    const path = join(tmp, '.emberdeck/cards/expo.md');
    const before = await Bun.file(path).text();
    await runEd(['card', 'export', 'expo', '--out', join(tmp, 'side.md')], tmp);
    const after = await Bun.file(path).text();
    expect(after).toBe(before);
  });

  test('--out=- explicit STDOUT', async () => {
    const r = await runEd(['card', 'export', 'expo', '--out', '-'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.content).toContain('key: expo');
  });

  test('--out FILE writes to file', async () => {
    const outPath = join(tmp, 'out.md');
    const r = await runEd(['card', 'export', 'expo', '--out', outPath], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('file');
    const content = await Bun.file(outPath).text();
    expect(content).toContain('key: expo');
  });

  test('--in-place rewrites original file', async () => {
    const r = await runEd(['card', 'export', 'expo', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('in-place');
    expect(parsed.filePath).toContain('expo');
  });
});

// system_metadata upsert moved to test/migration.test.ts — DB-layer test
// with no CLI involvement (used raw db.$client.prepare).

describe('Phase 2 polish: unknown command/option', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('unknown subcommand → non-zero, stderr error', async () => {
    const r = await runEd(['totally-fake-command'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/unknown command|error/);
  });

  test('unknown option on known command → non-zero, stderr error', async () => {
    const r = await runEd(['card', 'list', '--bogus-flag'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/unknown option|error/);
  });
});

describe('Phase 2 polish: card create/update --glossary/--tag/--parent', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(async () => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
    await runEd(['glossary', 'define', 'foo=Foo def', 'bar=Bar def'], tmp);
  });
  afterEach(() => { cleanup(); });

  test('card create with --glossary single word', async () => {
    const r = await runEd(['card', 'create', 'g1', '--type', 'brief', '--summary', 's', '--glossary', 'foo'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'g1'], tmp);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.glossary).toEqual(['foo']);
  });

  test('card create with --glossary comma-separated', async () => {
    const r = await runEd(['card', 'create', 'g2', '--type', 'brief', '--summary', 's', '--glossary', 'foo,bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'g2'], tmp);
    expect(JSON.parse(get.stdout).glossary).toEqual(['foo', 'bar']);
  });

  test('card create with repeated --glossary flag', async () => {
    const r = await runEd(['card', 'create', 'g3', '--type', 'brief', '--summary', 's', '--glossary', 'foo', '--glossary', 'bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'g3'], tmp);
    expect(JSON.parse(get.stdout).glossary).toEqual(['foo', 'bar']);
  });

  test('card create with --tag (repeatable)', async () => {
    const r = await runEd(['card', 'create', 't1', '--type', 'brief', '--summary', 's', '--glossary', 'foo', '--tag', 'alpha', '--tag', 'beta'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 't1'], tmp);
    expect(JSON.parse(get.stdout).tags).toEqual(['alpha', 'beta']);
  });

  test('card create with --parent', async () => {
    await runEd(['card', 'create', 'parent-of-p', '--type', 'brief', '--summary', 'p', '--glossary', 'foo'], tmp);
    const r = await runEd(['card', 'create', 'p-child', '--type', 'spec', '--summary', 'c', '--parent', 'parent-of-p', '--glossary', 'foo'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'p-child'], tmp);
    expect(JSON.parse(get.stdout).parent).toBe('parent-of-p');
  });

  test('card update --glossary replaces existing glossary', async () => {
    await runEd(['card', 'create', 'u1', '--type', 'brief', '--summary', 's', '--glossary', 'foo'], tmp);
    const r = await runEd(['card', 'update', 'u1', '--glossary', 'bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'u1'], tmp);
    expect(JSON.parse(get.stdout).glossary).toEqual(['bar']);
  });
});

describe('Phase 2 polish: --quiet mode', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('--quiet produces compact JSON (single line, no pretty-print)', async () => {
    const r = await runEd(['--quiet', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    // No schemaVersion envelope in v2; compact JSON → no leading "  " indent on first key
    expect(r.stdout).not.toMatch(/"schemaVersion"/);
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1);
  });

  test('default emits pretty-printed v2 JSON (multi-line, top-level keys present)', async () => {
    const r = await runEd(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    // v2 has no envelope; only per-command keys at top level
    expect(r.stdout).not.toMatch(/"schemaVersion"/);
    expect(r.stdout).toMatch(/"items"/);
    expect(r.stdout).toMatch(/"total"/);
    expect(r.stdout.split('\n').length).toBeGreaterThan(1);
  });
});

describe('Phase 2 polish: enum validation at CLI layer', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('card create --type invalid → rejected before write (no corrupt file)', async () => {
    const r = await runEd(['card', 'create', 'bad-type', '--type', 'banana', '--summary', 'x'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    const err = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(err?.message).toContain('invalid --type');
    // Verify NO file was created (no corruption)
    const list = await runEd(['card', 'list'], tmp);
    expect(JSON.parse(list.stdout).total).toBe(0);
  });

  test('card create --status invalid → rejected', async () => {
    const r = await runEd(['card', 'create', 'x', '--type', 'brief', '--summary', 'x', '--status', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    const err = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(err?.message).toContain('invalid status');
  });

  test('card set-status invalid → rejected', async () => {
    await runEd(['card', 'create', 'x', '--type', 'brief', '--summary', 'x'], tmp);
    const r = await runEd(['card', 'set-status', 'x', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    const err = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(err?.message).toContain('invalid status');
  });

  test('card list --type invalid → rejected', async () => {
    const r = await runEd(['card', 'list', '--type', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
  });

  test('card search --type invalid → rejected', async () => {
    const r = await runEd(['card', 'search', 'foo', '--type', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    const err = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(err?.message).toContain('invalid --type');
  });

  test('bulk create with invalid type in JSON → rejected, no corruption', async () => {
    const json = JSON.stringify([{ key: 'bad-bulk', type: 'banana', summary: 'x' }]);
    writeFileSync(join(tmp, 'bad.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'bad.json'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.created).toHaveLength(0);
    // No card actually created
    const list = await runEd(['card', 'list'], tmp);
    expect(JSON.parse(list.stdout).total).toBe(0);
  });

  test('card update --field type=invalid → rejected', async () => {
    await runEd(['card', 'create', 'x', '--type', 'brief', '--summary', 'x'], tmp);
    const r = await runEd(['card', 'update', 'x', '--field', 'type=banana'], tmp);
    expect(r.exitCode).not.toBe(0);
  });
});

describe('Phase 2 polish: card export emits JSON envelope', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(async () => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
    await runEd(['card', 'create', 'jx', '--type', 'brief', '--summary', 'json export'], tmp);
  });
  afterEach(() => { cleanup(); });

  test('STDOUT emits PURE v2 JSON (jq-parseable, markdown nested in content)', async () => {
    const r = await runEd(['card', 'export', 'jx'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('stdout');
    expect(parsed.content).toContain('key: jx');
    expect(parsed.content).toContain('summary: json export');
    expect(parsed.bytes).toBe(parsed.content.length);
  });

  test('--in-place emits only v2 JSON (no raw markdown leak)', async () => {
    const r = await runEd(['card', 'export', 'jx', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('in-place');
  });
});

describe('Phase 2 polish: spinner stays out of stdout/stderr (agent-first JSON contract)', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  // Spinner glyph + ANSI artifacts must never appear in stdout (agents
  // parse stdout as JSON) and must never appear in stderr (JSON-line
  // log channel). Asserting per-command instead of one bag-test gives a
  // clear failure surface: a regression in one command's runner doesn't
  // hide behind another command's clean output.
  const SPINNER_GLYPHS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
  const ANSI_CSI = '\x1b[';

  function expectAgentClean(stream: string): void {
    expect(stream).not.toContain(ANSI_CSI);
    for (const g of SPINNER_GLYPHS) expect(stream).not.toContain(g);
  }

  const commands: Array<[name: string, argv: string[]]> = [
    ['analyze',        ['analyze']],
    ['bulk sync',      ['bulk', 'sync']],
    ['validate links', ['validate', 'links']],
  ];

  test.each(commands)(
    'agent-clean stdout + stderr: %s',
    async (_name, argv) => {
      const r = await runEd(argv, tmp);
      expect(r.exitCode).toBe(0);
      // stdout must be a parseable JSON envelope (no spinner / ANSI interleaved).
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      expectAgentClean(r.stdout);
      expectAgentClean(r.stderr);
    },
  );
});
