/**
 * Malformed-fixture e2e: card files on disk with broken YAML / missing
 * required fields / type-mismatch values. Existing CLI tests use clean
 * fixtures, so the error-throw branches in `card/markdown.ts` normalizers
 * (currently 24% uncovered at line-level) are unreachable from behavioral
 * tests. These spawn `ed` against pathological inputs and assert the JSON
 * envelope reports a stable error code.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

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

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-malformed-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

function writeCard(tmp: string, key: string, content: string): void {
  const path = join(tmp, '.emberdeck/cards', `${key}.md`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('malformed card files: error envelope regression', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('card with broken YAML frontmatter → bulk sync reports per-file error, exits 2', async () => {
    writeCard(tmp, 'broken-yaml', [
      '---',
      'key: broken-yaml',
      '  type: spec',  // bad indent — YAML parser should reject
      ': : invalid',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0].code).toBe('SYNC_FAILED');
  });

  test('card missing required key field', async () => {
    writeCard(tmp, 'no-key', [
      '---',
      'type: brief',
      'summary: missing key',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
  });

  test('card with invalid type', async () => {
    writeCard(tmp, 'bad-type', [
      '---',
      'key: bad-type',
      'type: notavalidtype',
      'summary: bad',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.errors[0].code).toBe('SYNC_FAILED');
  });

  test('card with invalid status', async () => {
    writeCard(tmp, 'bad-status', [
      '---',
      'key: bad-status',
      'type: brief',
      'status: notastatus',
      'summary: x',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('card with non-array boundary', async () => {
    writeCard(tmp, 'bad-boundary', [
      '---',
      'key: bad-boundary',
      'type: spec',
      'status: draft',
      'summary: x',
      'boundary: src/auth/**',  // string, not array
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  test('card with non-string entries in tags array', async () => {
    writeCard(tmp, 'bad-tags', [
      '---',
      'key: bad-tags',
      'type: brief',
      'status: draft',
      'summary: x',
      'tags:',
      '  - 123',
      '  - { not: a string }',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('card with malformed brief namespace', async () => {
    writeCard(tmp, 'bad-brief', [
      '---',
      'key: bad-brief',
      'type: brief',
      'status: draft',
      'summary: x',
      'brief:',
      '  context: not-an-object',  // should be object
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('card with malformed brief.flow item missing required field', async () => {
    writeCard(tmp, 'bad-flow', [
      '---',
      'key: bad-flow',
      'type: brief',
      'status: draft',
      'summary: x',
      'brief:',
      '  context: { problem: p, impact: [{ statement: i }] }',
      '  scope: { goals: [], non_goals: [], assumptions: [] }',
      '  flow:',
      '    - kind: invalid-kind',  // not "happy" or "failure"',
      '      id: F-001',
      '      given: g',
      '      when: w',
      '      then: t',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('card with malformed brief.policy keyword', async () => {
    writeCard(tmp, 'bad-policy', [
      '---',
      'key: bad-policy',
      'type: brief',
      'status: draft',
      'summary: x',
      'brief:',
      '  context: { problem: p, impact: [{ statement: i }] }',
      '  scope: { goals: [], non_goals: [], assumptions: [] }',
      '  policy:',
      '    - id: P-001',
      '      subject: s',
      '      keyword: SHOULDNT',  // not in allowed list
      '      predicate: p',
      '      governs: []',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('card with non-string codeLinks file', async () => {
    writeCard(tmp, 'bad-codelinks', [
      '---',
      'key: bad-codelinks',
      'type: spec',
      'status: draft',
      'summary: x',
      'codeLinks:',
      '  - kind: class',
      '    file: 12345',  // number not string',
      '    symbol: Foo',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('valid card alongside malformed: partial-success envelope', async () => {
    writeCard(tmp, 'good', [
      '---',
      'key: good',
      'type: brief',
      'status: draft',
      'summary: ok',
      '---',
      '',
    ].join('\n'));
    writeCard(tmp, 'bad', [
      '---',
      'key: bad',
      'type: not-a-type',
      'status: draft',
      'summary: x',
      '---',
      '',
    ].join('\n'));
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe('partial');
    expect(parsed.data.synced).toBe(1);
    expect(parsed.data.errors).toBeGreaterThan(0);
  });

  test('card file with totally invalid markdown (no frontmatter)', async () => {
    writeCard(tmp, 'no-frontmatter', '# just markdown\n\nno YAML at all\n');
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });

  test('empty card file', async () => {
    writeCard(tmp, 'empty', '');
    const r = await runCli(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(2);
  });
});
