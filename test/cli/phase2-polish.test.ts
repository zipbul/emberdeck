/**
 * Phase 2 polish: partial-status, --since persistence, export STDOUT, unknown option, spinner mode-detect.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

interface RunResult { exitCode: number; stdout: string; stderr: string; }

async function runCli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, ...env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-pol-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

describe('Phase 2 polish: bulk create partial-success', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('mixed success/failure in bulk → status=partial', async () => {
    // First card good, second card uses bad parent → fail
    const yaml = `- key: ok-card
  type: brief
  summary: OK card
- key: bad-parent
  type: brief
  summary: bad
  parent: nonexistent-parent
`;
    writeFileSync(join(tmp, 'mix.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'mix.yaml'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.data.created).toBe(1);
    expect(parsed.data.failed).toBe(1);
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0].key).toBe('bad-parent');
  });

  test('all success → status=ok', async () => {
    const yaml = `- key: a-card
  type: brief
  summary: A
- key: b-card
  type: brief
  summary: B
`;
    writeFileSync(join(tmp, 'all.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'all.yaml'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.created).toBe(2);
  });

  test('all failure → status=partial (per CLI_PLAN §3.6) + exit 2 (CI gate)', async () => {
    const yaml = `- key: bad1
  type: brief
  summary: X
  parent: nonexistent
- key: bad2
  type: brief
  summary: Y
  parent: nonexistent
`;
    writeFileSync(join(tmp, 'all-bad.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'all-bad.yaml'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.data.created).toBe(0);
    expect(parsed.data.failed).toBe(2);
    // partial-success in bulk → exit 2 (CI gate signal, NOT exit 0)
    expect(r.exitCode).toBe(2);
  });

  test('partial mixed → exit 2 (gate signal)', async () => {
    const yaml = `- key: ok-card
  type: brief
  summary: OK
- key: bad-parent
  type: brief
  summary: bad
  parent: nonexistent
`;
    writeFileSync(join(tmp, 'mix2.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'mix2.yaml'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('all success → exit 0', async () => {
    const yaml = `- key: c1
  type: brief
  summary: c1
- key: c2
  type: brief
  summary: c2
`;
    writeFileSync(join(tmp, 'good.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'good.yaml'], tmp);
    expect(r.exitCode).toBe(0);
  });
});

describe('Phase 2 polish: card export STDOUT default', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    await runCli(['card', 'create', 'expo', '--type', 'brief', '--summary', 'export me'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('default → content to STDOUT (markdown)', async () => {
    const r = await runCli(['card', 'export', 'expo'], tmp, { NO_COLOR: '1' });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('---');
    expect(r.stdout).toContain('key: expo');
    expect(r.stdout).toContain('summary: export me');
  });

  test('default STDOUT does NOT modify original file', async () => {
    const path = join(tmp, '.emberdeck/cards/expo.card.md');
    const before = await Bun.file(path).text();
    const beforeStat = await Bun.file(path).stat();
    await runCli(['card', 'export', 'expo'], tmp);
    const after = await Bun.file(path).text();
    const afterStat = await Bun.file(path).stat();
    expect(after).toBe(before);
    expect(afterStat.mtime.getTime()).toBe(beforeStat.mtime.getTime());
  });

  test('--out FILE does NOT modify original file', async () => {
    const path = join(tmp, '.emberdeck/cards/expo.card.md');
    const before = await Bun.file(path).text();
    await runCli(['card', 'export', 'expo', '--out', join(tmp, 'side.md')], tmp);
    const after = await Bun.file(path).text();
    expect(after).toBe(before);
  });

  test('--out=- explicit STDOUT', async () => {
    const r = await runCli(['card', 'export', 'expo', '--out', '-'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('key: expo');
  });

  test('--out FILE writes to file', async () => {
    const outPath = join(tmp, 'out.md');
    const r = await runCli(['card', 'export', 'expo', '--out', outPath], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.mode).toBe('file');
    const content = await Bun.file(outPath).text();
    expect(content).toContain('key: expo');
  });

  test('--in-place rewrites original file', async () => {
    const r = await runCli(['card', 'export', 'expo', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.mode).toBe('in-place');
    expect(parsed.data.filePath).toContain('expo');
  });
});

describe('Phase 2 polish: spec sync-symbols --since persistence (programmatic)', () => {
  test('system_metadata table stores and retrieves last_symbol_sync_at', async () => {
    // gildash unavailable in CLI test env, so verify persistence via direct DB ops.
    const { setupEmberdeck, teardownEmberdeck } = await import('../../src/setup');
    const tmp = mkdtempSync(join(tmpdir(), 'meta-'));
    mkdirSync(join(tmp, 'cards'), { recursive: true });
    const ctx = await setupEmberdeck({ cardsDir: join(tmp, 'cards'), dbPath: join(tmp, 'data.db') });

    // first read: empty (Bun.SQLite returns null for no rows in some versions)
    const before = ctx.db.$client
      .prepare('SELECT value FROM system_metadata WHERE key = ?')
      .get('last_symbol_sync_at');
    expect(before ?? null).toBeNull();

    // upsert
    const ts = '2026-04-27T12:00:00Z';
    ctx.db.$client
      .prepare(
        'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run('last_symbol_sync_at', ts, ts);

    const after = ctx.db.$client
      .prepare('SELECT value FROM system_metadata WHERE key = ?')
      .get('last_symbol_sync_at') as { value: string };
    expect(after.value).toBe(ts);

    // upsert overwrites
    const ts2 = '2026-04-27T13:00:00Z';
    ctx.db.$client
      .prepare(
        'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run('last_symbol_sync_at', ts2, ts2);

    const overwritten = ctx.db.$client
      .prepare('SELECT value FROM system_metadata WHERE key = ?')
      .get('last_symbol_sync_at') as { value: string };
    expect(overwritten.value).toBe(ts2);

    await teardownEmberdeck(ctx);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('Phase 2 polish: unknown command/option', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('unknown subcommand → non-zero, stderr error', async () => {
    const r = await runCli(['totally-fake-command'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/unknown command|error/);
  });

  test('unknown option on known command → non-zero, stderr error', async () => {
    const r = await runCli(['card', 'list', '--bogus-flag'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/unknown option|error/);
  });
});

describe('Phase 2 polish: card create/update --glossary/--tag/--parent', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    await runCli(['glossary', 'define', 'foo=Foo def', 'bar=Bar def'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('card create with --glossary single word', async () => {
    const r = await runCli(['card', 'create', 'g1', '--type', 'brief', '--summary', 's', '--glossary', 'foo'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 'g1'], tmp);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.data.frontmatter.glossary).toEqual(['foo']);
  });

  test('card create with --glossary comma-separated', async () => {
    const r = await runCli(['card', 'create', 'g2', '--type', 'brief', '--summary', 's', '--glossary', 'foo,bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 'g2'], tmp);
    expect(JSON.parse(get.stdout).data.frontmatter.glossary).toEqual(['foo', 'bar']);
  });

  test('card create with repeated --glossary flag', async () => {
    const r = await runCli(['card', 'create', 'g3', '--type', 'brief', '--summary', 's', '--glossary', 'foo', '--glossary', 'bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 'g3'], tmp);
    expect(JSON.parse(get.stdout).data.frontmatter.glossary).toEqual(['foo', 'bar']);
  });

  test('card create with --tag (repeatable)', async () => {
    const r = await runCli(['card', 'create', 't1', '--type', 'brief', '--summary', 's', '--glossary', 'foo', '--tag', 'alpha', '--tag', 'beta'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 't1'], tmp);
    expect(JSON.parse(get.stdout).data.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  test('card create with --parent', async () => {
    await runCli(['card', 'create', 'parent-of-p', '--type', 'brief', '--summary', 'p', '--glossary', 'foo'], tmp);
    const r = await runCli(['card', 'create', 'p-child', '--type', 'spec', '--summary', 'c', '--parent', 'parent-of-p', '--glossary', 'foo'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 'p-child'], tmp);
    expect(JSON.parse(get.stdout).data.frontmatter.parent).toBe('parent-of-p');
  });

  test('card update --glossary replaces existing glossary', async () => {
    await runCli(['card', 'create', 'u1', '--type', 'brief', '--summary', 's', '--glossary', 'foo'], tmp);
    const r = await runCli(['card', 'update', 'u1', '--glossary', 'bar'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['card', 'get', 'u1'], tmp);
    expect(JSON.parse(get.stdout).data.frontmatter.glossary).toEqual(['bar']);
  });
});

describe('Phase 2 polish: --quiet mode', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('--quiet suppresses JSON envelope on stdout', async () => {
    const r = await runCli(['--quiet', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toMatch(/"schemaVersion"/);
  });

  test('default emits JSON envelope', async () => {
    const r = await runCli(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"schemaVersion"/);
  });
});

describe('Phase 2 polish: enum validation at CLI layer', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('card create --type invalid → rejected before write (no corrupt file)', async () => {
    const r = await runCli(['card', 'create', 'bad-type', '--type', 'banana', '--summary', 'x'], tmp);
    expect(r.exitCode).not.toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('error');
    expect(parsed.error.message).toContain('invalid --type');
    // Verify NO file was created (no corruption)
    const list = await runCli(['card', 'list'], tmp);
    expect(JSON.parse(list.stdout).data.total).toBe(0);
  });

  test('card create --status invalid → rejected', async () => {
    const r = await runCli(['card', 'create', 'x', '--type', 'brief', '--summary', 'x', '--status', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.error.message).toContain('invalid status');
  });

  test('card set-status invalid → rejected', async () => {
    await runCli(['card', 'create', 'x', '--type', 'brief', '--summary', 'x'], tmp);
    const r = await runCli(['card', 'set-status', 'x', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.parse(r.stdout).error.message).toContain('invalid status');
  });

  test('card list --type invalid → rejected', async () => {
    const r = await runCli(['card', 'list', '--type', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
  });

  test('card search --type invalid → rejected', async () => {
    const r = await runCli(['card', 'search', 'foo', '--type', 'banana'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.parse(r.stdout).error.message).toContain('invalid --type');
  });

  test('bulk create with invalid type in YAML → rejected, no corruption', async () => {
    const yaml = `- key: bad-bulk
  type: banana
  summary: x
`;
    writeFileSync(join(tmp, 'bad.yaml'), yaml);
    const r = await runCli(['bulk', 'create', '--from', 'bad.yaml'], tmp);
    expect(r.exitCode).toBe(2); // partial
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.data.rejected_pre_write).toBe(1);
    expect(parsed.data.created).toBe(0);
    // No card actually created
    const list = await runCli(['card', 'list'], tmp);
    expect(JSON.parse(list.stdout).data.total).toBe(0);
  });

  test('card update --field type=invalid → rejected', async () => {
    await runCli(['card', 'create', 'x', '--type', 'brief', '--summary', 'x'], tmp);
    const r = await runCli(['card', 'update', 'x', '--field', 'type=banana'], tmp);
    expect(r.exitCode).not.toBe(0);
  });
});

describe('Phase 2 polish: card export emits JSON envelope', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    await runCli(['card', 'create', 'jx', '--type', 'brief', '--summary', 'json export'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('STDOUT emits PURE CliResult JSON (jq-parseable, markdown nested in data.content)', async () => {
    const r = await runCli(['card', 'export', 'jx'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.mode).toBe('stdout');
    expect(parsed.data.content).toContain('key: jx');
    expect(parsed.data.content).toContain('summary: json export');
    expect(parsed.data.bytes).toBe(parsed.data.content.length);
  });

  test('--in-place emits only JSON envelope (no raw markdown leak)', async () => {
    const r = await runCli(['card', 'export', 'jx', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.mode).toBe('in-place');
  });
});

describe('Phase 2 polish: spinner stays out of stdout AND no stderr leaks in JSON', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('analyze: stdout is pure JSON, no spinner artifacts', async () => {
    const r = await runCli(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(r.stdout).not.toContain('\x1b[');
    expect(r.stdout).not.toContain('⠋');
  });

  test('analyze: stderr also clean (no spinner leak)', async () => {
    const r = await runCli(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('⠋');
    expect(r.stderr).not.toContain('analyzing');
  });

  test('bulk sync: stderr clean of spinner', async () => {
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('⠋');
    expect(r.stderr).not.toContain('syncing');
  });

  test('validate links: stderr clean', async () => {
    const r = await runCli(['validate', 'links'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('⠋');
    expect(r.stderr).not.toContain('validating');
  });
});
