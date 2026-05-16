/**
 * CLI flag override matrix e2e: verifies that explicit `--config <path>`,
 * `--dir`, `--db-path`, `--project-root` arguments take precedence over
 * `.emberdeck.jsonc` defaults at runtime.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnCli as runCli } from './helpers';

describe('CLI flag overrides matrix', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ed-flags-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('--config <path> picks up alternate config file', async () => {
    // Default .emberdeck.jsonc points to default-cards/
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: 'default-cards', dbPath: '.emberdeck/default.db' }),
    );
    mkdirSync(join(tmp, 'default-cards'), { recursive: true });
    // Alt config points to alt-cards/
    writeFileSync(
      join(tmp, 'alt.jsonc'),
      JSON.stringify({ cardsDir: 'alt-cards', dbPath: '.emberdeck/alt.db' }),
    );
    mkdirSync(join(tmp, 'alt-cards'), { recursive: true });

    // Create card via alt config; it should land in alt-cards, not default-cards.
    const r = await runCli(
      ['--config', 'alt.jsonc', 'card', 'create', 'p', '--type', 'brief', '--summary', 's'],
      tmp,
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(tmp, 'alt-cards/p.md'))).toBe(true);
    expect(existsSync(join(tmp, 'default-cards/p.md'))).toBe(false);
  });

  test('--dir overrides cardsDir from config', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: 'config-cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, 'config-cards'), { recursive: true });
    mkdirSync(join(tmp, 'cli-cards'), { recursive: true });
    mkdirSync(join(tmp, '.emberdeck'), { recursive: true });

    const r = await runCli(
      ['--dir', 'cli-cards', 'card', 'create', 'p', '--type', 'brief', '--summary', 's'],
      tmp,
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(tmp, 'cli-cards/p.md'))).toBe(true);
    expect(existsSync(join(tmp, 'config-cards/p.md'))).toBe(false);
  });

  test('--db-path overrides dbPath from config', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/config.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });

    const r = await runCli(
      ['--db-path', '.emberdeck/cli.db', 'card', 'create', 'p', '--type', 'brief', '--summary', 's'],
      tmp,
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(tmp, '.emberdeck/cli.db'))).toBe(true);
    expect(existsSync(join(tmp, '.emberdeck/config.db'))).toBe(false);
  });

  test('--project-root overrides projectRoot from config', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({
        cardsDir: '.emberdeck/cards',
        dbPath: '.emberdeck/data.db',
        projectRoot: 'config-root',
      }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
    // Don't create config-root → if the override didn't kick in, gildash init
    // would fail loudly. Instead create cli-root with a tiny ts file.
    mkdirSync(join(tmp, 'cli-root/src'), { recursive: true });
    writeFileSync(join(tmp, 'cli-root/package.json'), '{"name":"cli","version":"0.0.0"}');
    writeFileSync(join(tmp, 'cli-root/src/foo.ts'), 'export const foo = 1;\n');

    const r = await runCli(['--project-root', 'cli-root', 'analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.health).toBeDefined();
    // Indicates gildash actually attached to cli-root (saw at least one symbol)
    expect(parsed.coverage.totalSymbols).toBeGreaterThan(0);
  });

  test('multiple flags compose: --dir + --db-path together', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: 'config-cards', dbPath: '.emberdeck/config.db' }),
    );
    mkdirSync(join(tmp, 'config-cards'), { recursive: true });
    mkdirSync(join(tmp, 'cli-cards'), { recursive: true });
    mkdirSync(join(tmp, '.emberdeck'), { recursive: true });

    const r = await runCli(
      ['--dir', 'cli-cards', '--db-path', '.emberdeck/cli.db',
       'card', 'create', 'p', '--type', 'brief', '--summary', 's'],
      tmp,
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(tmp, 'cli-cards/p.md'))).toBe(true);
    expect(existsSync(join(tmp, '.emberdeck/cli.db'))).toBe(true);
    expect(existsSync(join(tmp, '.emberdeck/config.db'))).toBe(false);
  });

  test('--config to nonexistent path → error envelope', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });

    const r = await runCli(['--config', 'does-not-exist.jsonc', 'card', 'list'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('"level":"error"');
  });

  test('--quiet emits compact JSON (no schemaVersion envelope, single line)', async () => {
    writeFileSync(
      join(tmp, '.emberdeck.jsonc'),
      JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
    );
    mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });

    await runCli(['card', 'create', 'foo-card', '--type', 'brief', '--summary', 's'], tmp);
    const r = await runCli(['--quiet', 'card', 'get', 'foo-card'], tmp);
    expect(r.exitCode).toBe(0);
    // v2 quiet: compact JSON object (single line), no envelope
    const parsed = JSON.parse(r.stdout);
    expect(parsed.key).toBe('foo-card');
    expect(r.stdout).not.toContain('"schemaVersion"');
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(1);
  });
});
