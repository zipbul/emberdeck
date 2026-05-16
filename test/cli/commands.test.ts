/**
 * E2E CLI integration tests.
 * Spawns `bun cli.ts ...` in a temp directory and verifies output + exit code.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEd, parseJsonLines } from './helpers';

// Some tests still need real subprocess: STDIN piping, ANSI/env var verification.
// These import the CLI entry path directly.
const CLI = join(import.meta.dir, '../../cli.ts');

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
    const r = await runEd(['--help'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: ed');
    expect(r.stdout).toContain('Commands:');
    expect(r.stdout).toContain('card');
    expect(r.stdout).toContain('validate');
    expect(r.stdout).toContain('check');
  });

  test('--version exits 0 and prints version', async () => {
    const r = await runEd(['--version'], tmp);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('card --help shows subcommands', async () => {
    const r = await runEd(['card', '--help'], tmp);
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

  test('JSON output has v2 per-command shape', async () => {
    const r = await runEd(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(parsed.limit).toBeDefined();
    expect(parsed.offset).toBeDefined();
    expect(parsed.hasMore).toBe(false);
    expect(parseJsonLines(r.stderr)).toEqual([]);
  });

  test('quiet output is compact JSON (no envelope, single line)', async () => {
    const r = await runEd(['--quiet', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    // --quiet → compact JSON (no pretty-print), single trailing newline
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toEqual([]);
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
    const create = await runEd(
      ['card', 'create', 'test-brief', '--type', 'brief', '--summary', 'A test brief'],
      tmp,
    );
    expect(create.exitCode).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.key).toBe('test-brief');

    const get = await runEd(['card', 'get', 'test-brief'], tmp);
    expect(get.exitCode).toBe(0);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.key).toBe('test-brief');
    expect(fetched.summary).toBe('A test brief');
    expect(fetched.type).toBe('brief');
  });

  test('get nonexistent card → exit 3 + stderr error JSON-line', async () => {
    const r = await runEd(['card', 'get', 'nonexistent'], tmp);
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe('');
    const errs = parseJsonLines(r.stderr);
    expect(errs.find((l) => l.level === 'error')?.code).toBe('card-not-found');
  });

  test('create duplicate → exit 4 + stderr error JSON-line', async () => {
    await runEd(['card', 'create', 'dup', '--type', 'brief', '--summary', 'first'], tmp);
    const second = await runEd(
      ['card', 'create', 'dup', '--type', 'brief', '--summary', 'second'],
      tmp,
    );
    expect(second.exitCode).toBe(4);
    expect(second.stdout).toBe('');
    const errs = parseJsonLines(second.stderr);
    expect(errs.find((l) => l.level === 'error')?.code).toBe('card-already-exists');
  });
});

describe('CLI: card list filters', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
    await runEd(['card', 'create', 'b1', '--type', 'brief', '--summary', 'first'], tmp);
    await runEd(['card', 'create', 'b2', '--type', 'brief', '--summary', 'second'], tmp);
    await runEd(['card', 'create', 's1', '--type', 'spec', '--summary', 'spec one'], tmp);
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('--type filter narrows results', async () => {
    const r = await runEd(['card', 'list', '--type', 'brief'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.total).toBe(2);
    expect(parsed.items.every((i: { type: string }) => i.type === 'brief')).toBe(true);
  });

  test('--limit + --offset paginates', async () => {
    const r = await runEd(['card', 'list', '--limit', '2', '--offset', '0'], tmp);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.total).toBe(3);
    expect(parsed.hasMore).toBe(true);
  });

  test('--file without --symbol → error', async () => {
    const r = await runEd(['card', 'list', '--file', 'foo.ts'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    const errs = parseJsonLines(r.stderr);
    expect(errs.find((l) => l.level === 'error')?.message).toContain('--symbol');
  });

  test('--symbol with no matches returns empty list', async () => {
    const r = await runEd(['card', 'list', '--symbol', 'nonExistentSymbol'], tmp);
    // gildash not configured here so symbol search returns empty
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toEqual([]);
  });

  test('--glossary with no glossary defined returns empty', async () => {
    const r = await runEd(['card', 'list', '--glossary', 'undefined-word'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toEqual([]);
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
    await runEd(['card', 'create', 'foo', '--type', 'brief', '--summary', 'orig'], tmp);
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('update via --field summary=...', async () => {
    const r = await runEd(['card', 'update', 'foo', '--field', 'summary=updated'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'foo'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.summary).toBe('updated');
  });

  test('update via --summary shortcut', async () => {
    const r = await runEd(['card', 'update', 'foo', '--summary', 'shortcut'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'foo'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.summary).toBe('shortcut');
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
    const r = await runEd(['validate', 'cards'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.total).toBe(0);
    expect(parsed.items).toEqual([]);
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

  test('card create --from - reads JSON from STDIN', async () => {
    const json = JSON.stringify({ summary: 'from stdin', status: 'draft' });
    const proc = Bun.spawn(['bun', CLI, 'card', 'create', 'from-stdin', '--type', 'brief', '--from', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(json);
    await proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.key).toBe('from-stdin');

    const get = await runEd(['card', 'get', 'from-stdin'], tmp);
    const fetched = JSON.parse(get.stdout);
    expect(fetched.summary).toBe('from stdin');
  });

  test('card create --from - empty STDIN → exits with error (not crash)', async () => {
    const proc = Bun.spawn(['bun', CLI, 'card', 'create', 'empty-stdin', '--type', 'brief', '--from', '-'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    expect(proc.exitCode).not.toBe(0);
    // v2: error → stdout empty, stderr has error JSON-line
    expect(stdout).toBe('');
    expect(parseJsonLines(stderr).some((l) => l.level === 'error')).toBe(true);
  });

});

describe('CLI: stdout is pure JSON (agent-first)', () => {
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

  test('error path: empty stdout, stderr JSON-line error, no ANSI', async () => {
    const proc = Bun.spawn(['bun', CLI, 'card', 'get', 'nonexistent'], {
      cwd: tmp,
      env: { ...process.env, NO_COLOR: '', CLICOLOR_FORCE: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    // v2: error → stdout empty (no envelope), stderr carries JSON-line error
    expect(stdout).toBe('');
    expect(stderr).toContain('"level":"error"');
    expect(stderr).toContain('"code":"card-not-found"');
    expect(stdout).not.toContain('\x1b[');
    expect(stderr).not.toContain('\x1b[');
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

  test('--verbose emits level:verbose JSON-lines to stderr', async () => {
    const r = await runEd(['--verbose', 'card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    const lines = parseJsonLines(r.stderr);
    expect(lines.some((l) => l.level === 'verbose' && l.message === 'buildRuntime')).toBe(true);
    expect(lines.some((l) => l.level === 'verbose' && l.message === 'command done')).toBe(true);
  });

  test('--verbose does NOT leak error message contents (only error JSON-line emitted)', async () => {
    // Trigger CardNotFoundError; key contains a token-like marker.
    const proc = await runEd(
      ['--verbose', 'card', 'get', 'token-MY-SECRET-abc'],
      tmp,
    );
    expect(proc.exitCode).toBe(3);
    // The error line includes the bad key in its message (intentional),
    // but no verbose line should leak it raw (verbose is for execution flow only).
    const verboseLines = parseJsonLines(proc.stderr).filter((l) => l.level === 'verbose');
    expect(verboseLines.length).toBeGreaterThan(0);
    for (const line of verboseLines) {
      expect(JSON.stringify(line)).not.toContain('MY-SECRET');
      expect(JSON.stringify(line)).not.toContain('token-MY');
    }
  });

  test('without --verbose stderr stays clean for ok command', async () => {
    const r = await runEd(['card', 'list'], tmp);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLines(r.stderr).filter((l) => l.level === 'verbose')).toEqual([]);
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
    const r = await runEd(['nonexistent-command'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/error|unknown command/i);
  });

  test('missing required arg → non-zero exit', async () => {
    const r = await runEd(['card', 'get'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/missing required argument/i);
  });
});

describe('CLI: card update --patch root key whitelist', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-cli-patch-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('--patch with unwrapped namespace contents → exit 2 + usage error', async () => {
    const create = await runEd(
      ['card', 'create', 'patch-target', '--type', 'principle', '--summary', 'target'],
      tmp,
    );
    expect(create.exitCode).toBe(0);

    // Unwrapped patch: top-level keys are namespace contents (context/scope/...), not 'brief'/'spec'/etc.
    const badPatch = join(tmp, 'bad-patch.json');
    writeFileSync(badPatch, JSON.stringify({ context: { problem: 'x', impact: [] }, scope: {} }));
    const r = await runEd(['card', 'update', 'patch-target', '--patch', badPatch], tmp);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    const errs = parseJsonLines(r.stderr);
    const err = errs.find((l) => l.level === 'error');
    expect(err?.code).toBe('cli-usage-error');
    expect(err?.message).toMatch(/UpdateCardFields names/);
    expect(err?.message).toMatch(/unknown keys/);
  });

  test('--patch with allowed top-level scalar (summary) succeeds', async () => {
    await runEd(
      ['card', 'create', 'patch-allowed', '--type', 'principle', '--summary', 'before'],
      tmp,
    );
    const goodPatch = join(tmp, 'good-patch.json');
    writeFileSync(goodPatch, JSON.stringify({ summary: 'after' }));
    const r = await runEd(['card', 'update', 'patch-allowed', '--patch', goodPatch], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.key).toBe('patch-allowed');
  });
});
