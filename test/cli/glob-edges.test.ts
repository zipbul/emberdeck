/**
 * Bun.Glob edge case e2e: tests that boundary glob patterns behave as
 * documented across operations. Refactoring matchesAnyGlob or migrating to
 * a different glob library would have to maintain these contracts.
 *
 * Approach: create cards with various boundary glob shapes against a
 * controlled fixture project, then verify check coverage / impact / drift
 * compute the expected matches.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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

function setupGlobFixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-glob-'));
  // Project files at controlled paths
  mkdirSync(join(tmp, 'project/src/auth'), { recursive: true });
  mkdirSync(join(tmp, 'project/src/billing'), { recursive: true });
  mkdirSync(join(tmp, 'project/src/billing/sub'), { recursive: true });
  mkdirSync(join(tmp, 'project/test'), { recursive: true });
  writeFileSync(join(tmp, 'project/package.json'), '{"name":"glob","version":"0.0.0"}');
  writeFileSync(join(tmp, 'project/src/auth/jwt.ts'), 'export const a = 1;\n');
  writeFileSync(join(tmp, 'project/src/auth/session.ts'), 'export const a = 1;\n');
  writeFileSync(join(tmp, 'project/src/billing/invoice.ts'), 'export const a = 1;\n');
  writeFileSync(join(tmp, 'project/src/billing/sub/deep.ts'), 'export const a = 1;\n');
  writeFileSync(join(tmp, 'project/test/foo.spec.ts'), 'export const a = 1;\n');

  writeFileSync(join(tmp, 'package.json'), '{"name":"h","version":"0.0.0"}');
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({
      cardsDir: '.emberdeck/cards',
      dbPath: '.emberdeck/data.db',
      projectRoot: 'project',
    }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

function writeCard(tmp: string, key: string, frontmatter: string): void {
  writeFileSync(
    join(tmp, '.emberdeck/cards', `${key}.json`),
    `---\n${frontmatter}\n---\n`,
  );
}

describe('Bun.Glob boundary edge cases via check impact', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupGlobFixture(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('** matches nested files', async () => {
    writeCard(tmp, 'all-src', [
      'key: all-src',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary:',
      '  - "src/**"',
    ].join('\n'));
    await runCli(['bulk', 'sync'], tmp);
    const r = await runCli(['check', 'impact', 'src/billing/sub/deep.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.affected_cards.some((c: { key: string }) => c.key === 'all-src')).toBe(true);
  });

  test('* does NOT cross / boundary', async () => {
    writeCard(tmp, 'auth-only', [
      'key: auth-only',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary:',
      '  - "src/auth/*.ts"',
    ].join('\n'));
    await runCli(['bulk', 'sync'], tmp);
    // src/auth/jwt.ts matches
    const r1 = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(JSON.parse(r1.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'auth-only')).toBe(true);
    // src/billing/invoice.ts does NOT match
    const r2 = await runCli(['check', 'impact', 'src/billing/invoice.ts'], tmp);
    expect(JSON.parse(r2.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'auth-only')).toBe(false);
  });

  test('multiple patterns: ANY match suffices', async () => {
    writeCard(tmp, 'multi', [
      'key: multi',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary:',
      '  - "src/auth/**"',
      '  - "src/billing/**"',
    ].join('\n'));
    await runCli(['bulk', 'sync'], tmp);
    const r1 = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(JSON.parse(r1.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'multi')).toBe(true);
    const r2 = await runCli(['check', 'impact', 'src/billing/invoice.ts'], tmp);
    expect(JSON.parse(r2.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'multi')).toBe(true);
  });

  test('extension-restricted glob', async () => {
    writeCard(tmp, 'spec-only', [
      'key: spec-only',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary:',
      '  - "**/*.spec.ts"',
    ].join('\n'));
    await runCli(['bulk', 'sync'], tmp);
    const r1 = await runCli(['check', 'impact', 'test/foo.spec.ts'], tmp);
    expect(JSON.parse(r1.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'spec-only')).toBe(true);
    const r2 = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(JSON.parse(r2.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'spec-only')).toBe(false);
  });

  test('empty boundary array → never matches by boundary', async () => {
    writeCard(tmp, 'no-boundary', [
      'key: no-boundary',
      'type: spec',
      'status: draft',
      'summary: x',
    ].join('\n'));
    await runCli(['bulk', 'sync'], tmp);
    const r = await runCli(['check', 'impact', 'src/auth/jwt.ts'], tmp);
    expect(JSON.parse(r.stdout).data.affected_cards.some((c: { key: string }) => c.key === 'no-boundary')).toBe(false);
  });

  test('invalid glob pattern does not crash analyze', async () => {
    writeCard(tmp, 'bad-glob', [
      'key: bad-glob',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary:',
      '  - "[unclosed"',
    ].join('\n'));
    const sync = await runCli(['bulk', 'sync'], tmp);
    // Sync should accept the card (boundary value is a string array — gildash
    // glob errors are only surfaced at check/analyze time).
    expect([0, 2]).toContain(sync.exitCode);
    const analyze = await runCli(['analyze'], tmp);
    expect(analyze.exitCode).toBe(0);
    // Bad glob → card counted as stale boundary, but no crash.
    const parsed = JSON.parse(analyze.stdout);
    expect(parsed.schemaVersion).toEqual({ major: 1, minor: 0 });
  });
});
