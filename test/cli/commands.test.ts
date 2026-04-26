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
