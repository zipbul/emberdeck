/**
 * E2E CLI integration tests.
 * Spawns `bun cli.ts ...` in a temp directory and verifies output + exit code.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

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

describe('CLI: basic invocation', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    // create a minimal package.json so findPackageRoot works
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    // create .emberdeck.jsonc with explicit paths to avoid auto-discovery surprises
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({
        cardsDir: '.emberdeck/cards',
        dbPath: '.emberdeck/data.db',
      }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('--help exits 0 and prints usage', async () => {
    const r = await runCli(['--help'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: ed');
    expect(r.stdout).toContain('Commands:');
    expect(r.stdout).toContain('card');
    expect(r.stdout).toContain('validate');
    expect(r.stdout).toContain('check');
  });

  test('--version exits 0 and prints version', async () => {
    const r = await runCli(['--version'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('card --help shows subcommands', async () => {
    const r = await runCli(['card', '--help'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('get');
    expect(r.stdout).toContain('list');
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('update');
  });
});

describe('CLI: card list (empty project)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('JSON output has unified schema', async () => {
    const r = await runCli(['--json', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
    expect(parsed.status).toBe('ok');
    expect(parsed.data.items).toEqual([]);
    expect(parsed.data.total).toBe(0);
    expect(parsed.data.page).toBeDefined();
    expect(parsed.warnings).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });

  test('quiet output is empty for empty list', async () => {
    const r = await runCli(['--quiet', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});

describe('CLI: card create + get (lifecycle)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('create then get a brief card', async () => {
    const create = await runCli(
      ['--json', 'card', 'create', 'test-brief', '--type', 'brief', '--summary', 'A test brief'],
      tmp,
    );
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.status).toBe('ok');
    expect(created.data.key).toBe('test-brief');

    const get = await runCli(['--json', 'card', 'get', 'test-brief'], tmp);
    expect(get.exitCode).toBe(0);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.status).toBe('ok');
    expect(fetched.data.key).toBe('test-brief');
    expect(fetched.data.summary).toBe('A test brief');
    expect(fetched.data.type).toBe('brief');
  });

  test('get nonexistent card → exit 3 + status=error', async () => {
    const r = await runCli(['--json', 'card', 'get', 'nonexistent'], tmp);
    expect(r.exitCode).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CARD_NOT_FOUND');
  });

  test('create duplicate → exit 4 + status=error', async () => {
    await runCli(['--json', 'card', 'create', 'dup', '--type', 'brief', '--summary', 'first'], tmp);
    const second = await runCli(
      ['--json', 'card', 'create', 'dup', '--type', 'brief', '--summary', 'second'],
      tmp,
    );
    expect(second.exitCode).toBe(4);
    const parsed = JSON.parse(second.stdout);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('CARD_ALREADY_EXISTS');
  });
});

describe('CLI: card update', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
    await runCli(['--json', 'card', 'create', 'foo', '--type', 'brief', '--summary', 'orig'], tmp);
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('update via --field summary=...', async () => {
    const r = await runCli(['--json', 'card', 'update', 'foo', '--field', 'summary=updated'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['--json', 'card', 'get', 'foo'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.data.summary).toBe('updated');
  });

  test('update via --summary shortcut', async () => {
    const r = await runCli(['--json', 'card', 'update', 'foo', '--summary', 'shortcut'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['--json', 'card', 'get', 'foo'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.data.summary).toBe('shortcut');
  });
});

describe('CLI: validate cards', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('empty project validates as ok', async () => {
    const r = await runCli(['--json', 'validate', 'cards'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.total_issues).toBe(0);
  });
});

describe('CLI: STDIN input', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('card create --from - reads YAML from STDIN', async () => {
    const yaml = 'summary: from stdin\nstatus: draft\n';
    const proc = Bun.spawn(['bun', CLI, '--json', 'card', 'create', 'from-stdin', '--type', 'brief', '--from', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(yaml);
    await proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.key).toBe('from-stdin');

    const get = await runCli(['--json', 'card', 'get', 'from-stdin'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.data.summary).toBe('from stdin');
  });

  test('card create --from - empty STDIN → exits with error (not crash)', async () => {
    const proc = Bun.spawn(['bun', CLI, '--json', 'card', 'create', 'empty-stdin', '--type', 'brief', '--from', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).not.toBe(0);
    if (stdout.trim().startsWith('{')) {
      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe('error');
    }
  });

  test('card update --body - large STDIN (10KB)', async () => {
    await runCli(['card', 'create', 'big-body', '--type', 'brief', '--summary', 'orig'], tmp);
    const big = 'x'.repeat(10_000);
    const proc = Bun.spawn(['bun', CLI, '--json', 'card', 'update', 'big-body', '--body', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(big);
    await proc.stdin.end();
    await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const get = await runCli(['--json', 'card', 'get', 'big-body'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.data.body.length).toBeGreaterThanOrEqual(10_000);
  });

  test('card update --body - reads body from STDIN', async () => {
    await runCli(['card', 'create', 'with-body', '--type', 'brief', '--summary', 'orig'], tmp);
    const newBody = 'fresh body content\n';
    const proc = Bun.spawn(['bun', CLI, '--json', 'card', 'update', 'with-body', '--body', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(newBody);
    await proc.stdin.end();
    await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);

    const get = await runCli(['--json', 'card', 'get', 'with-body'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.data.body).toContain('fresh body content');
  });
});

describe('CLI: gildash-required commands without projectRoot', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      // intentionally NO projectRoot — gildash will be undefined
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('check coverage --uncovered without gildash → exit 6', async () => {
    const r = await runCli(['--json', 'check', 'coverage', '--uncovered'], tmp);
    expect(r.exitCode).toBe(6);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('GILDASH_NOT_CONFIGURED');
  });

  test('check coverage --suggest without gildash → exit 6', async () => {
    const r = await runCli(['--json', 'check', 'coverage', '--suggest'], tmp);
    expect(r.exitCode).toBe(6);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.error.code).toBe('GILDASH_NOT_CONFIGURED');
  });
});

describe('CLI: --verbose', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('--verbose emits [verbose] lines to stderr', async () => {
    const r = await runCli(['--verbose', '--json', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('[verbose]');
    expect(r.stderr).toContain('buildRuntime');
    expect(r.stderr).toContain('command done');
  });

  test('without --verbose stderr stays clean for ok command', async () => {
    const r = await runCli(['--json', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('[verbose]');
  });
});

describe('CLI: invalid invocation', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('unknown subcommand → non-zero exit, error to stderr', async () => {
    const r = await runCli(['nonexistent-command'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/error|unknown command/i);
  });

  test('missing required arg → non-zero exit', async () => {
    const r = await runCli(['card', 'get'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/missing required argument/i);
  });
});
