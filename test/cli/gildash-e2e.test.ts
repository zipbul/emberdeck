/**
 * CLI subprocess e2e tests with gildash configured against a real fixture
 * project. Existing CLI tests skip projectRoot, so the gildash-dependent code
 * paths in `ed analyze`, `ed check coverage`, `ed validate links`,
 * `ed spec sync`, `ed card list --symbol` are e2e-untested. These tests fill
 * that gap by spawning the real `ed` binary against a copy of
 * `test/fixtures/sample-ts-project/`.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');
const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/sample-ts-project');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

function setupGildashProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-gildash-e2e-'));
  cpSync(FIXTURE_SRC, join(tmp, 'project'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'host', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({
      cardsDir: '.emberdeck/cards',
      dbPath: '.emberdeck/data.db',
      projectRoot: 'project',
    }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards/auth'), { recursive: true });
  return tmp;
}

describe('CLI e2e with real gildash projectRoot', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupGildashProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('ed analyze produces a non-trivial coverage report', async () => {
    const r = await runCli(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.coverage.totalSymbols).toBeGreaterThan(0);
    // No cards yet → ratio is 0 with totalSymbols > 0
    expect(parsed.data.coverage.ratio).toBeLessThanOrEqual(1);
    // unlinked_symbols populated since fixture has classes/functions but no cards
    expect(Array.isArray(parsed.data.unlinked_symbols)).toBe(true);
    expect(parsed.data.unlinked_symbols.length).toBeGreaterThan(0);
  });

  test('ed check coverage --suggest emits domain/spec suggestions for uncovered files', async () => {
    const r = await runCli(['check', 'coverage', '--suggest'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.total).toBeGreaterThan(0);
    expect(Array.isArray(parsed.data.suggestions)).toBe(true);
    expect(parsed.data.suggestions.length).toBeGreaterThan(0);
  });

  test('ed validate links resolves real symbols when card declares them', async () => {
    writeFileSync(
      join(tmp, '.emberdeck/cards/auth/jwt-token.card.md'),
      [
        '---',
        'key: auth/jwt-token',
        'type: spec',
        'status: draft',
        'summary: jwt issuance',
        'codeLinks:',
        '  - kind: class',
        '    file: src/auth/jwt.ts',
        '    symbol: JwtIssuer',
        '---',
        '',
      ].join('\n'),
    );
    const sync = await runCli(['bulk', 'sync'], tmp);
    expect(sync.exitCode).toBe(0);

    const r = await runCli(['validate', 'links', 'auth/jwt-token'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.declared).toBe(1);
    expect(parsed.data.unresolved).toBe(0);
  });

  test('ed validate links flags broken-link when symbol is missing', async () => {
    writeFileSync(
      join(tmp, '.emberdeck/cards/auth/missing.card.md'),
      [
        '---',
        'key: auth/missing',
        'type: spec',
        'status: active',
        'summary: missing',
        'boundary:',
        '  - src/auth/**',
        'codeLinks:',
        '  - kind: class',
        '    file: src/auth/jwt.ts',
        '    symbol: NonexistentSymbol',
        '---',
        '',
      ].join('\n'),
    );
    await runCli(['bulk', 'sync'], tmp);

    const r = await runCli(['validate', 'links', 'auth/missing'], tmp);
    expect(r.exitCode).toBe(2); // partial → exit 2
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.data.broken).toBeGreaterThan(0);
  });

  test('ed card list --symbol filters cards bound to a real symbol', async () => {
    writeFileSync(
      join(tmp, '.emberdeck/cards/auth/jwt-bound.card.md'),
      [
        '---',
        'key: auth/jwt-bound',
        'type: spec',
        'status: draft',
        'summary: bound',
        'codeLinks:',
        '  - kind: class',
        '    file: src/auth/jwt.ts',
        '    symbol: JwtIssuer',
        '---',
        '',
      ].join('\n'),
    );
    await runCli(['bulk', 'sync'], tmp);

    const r = await runCli(['card', 'list', '--symbol', 'JwtIssuer'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.items.some((c: { key: string }) => c.key === 'auth/jwt-bound')).toBe(true);
  });

  test('ed check impact on a fixture file lists affected cards', async () => {
    writeFileSync(
      join(tmp, '.emberdeck/cards/auth/affected.card.md'),
      [
        '---',
        'key: auth/affected',
        'type: spec',
        'status: draft',
        'summary: affected',
        'codeLinks:',
        '  - kind: class',
        '    file: src/auth/jwt.ts',
        '    symbol: JwtIssuer',
        '---',
        '',
      ].join('\n'),
    );
    await runCli(['bulk', 'sync'], tmp);

    const r = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.affected_cards.some((c: { key: string }) => c.key === 'auth/affected')).toBe(true);
  });

  test('ed spec sync auto-creates code links from @spec annotations', async () => {
    // Create card matching the @spec auth/jwt-token annotation in fixture
    await runCli(
      ['card', 'create', 'auth/jwt-token', '--type', 'spec', '--summary', 'jwt'],
      tmp,
    );
    const r = await runCli(['spec', 'sync'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    // Either created (first run) or already_linked (idempotent re-run) > 0
    const linkedCount = parsed.data.created + parsed.data.already_linked;
    expect(linkedCount).toBeGreaterThan(0);
  });
});
