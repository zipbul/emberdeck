/**
 * Phase 2 e2e: 25 newly-added subcommands smoke + key behaviors.
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

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-p2-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

describe('Phase 2: card commands (delete/rename/search/export/set-status/tree/relations)', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = setupProject();
    await runCli(['card', 'create', 'parent-b', '--type', 'brief', '--summary', 'parent'], tmp);
    await runCli(['card', 'create', 'child-s', '--type', 'spec', '--summary', 'child'], tmp);
  });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('card delete with --yes', async () => {
    const r = await runCli(['--json', 'card', 'delete', 'child-s', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['--json', 'card', 'get', 'child-s'], tmp);
    expect(get.exitCode).toBe(3);
  });

  test('card delete without --yes when non-TTY → error', async () => {
    const r = await runCli(['--json', 'card', 'delete', 'child-s'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toContain('--yes');
  });

  test('card rename', async () => {
    const r = await runCli(['--json', 'card', 'rename', 'parent-b', 'parent-renamed'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['--json', 'card', 'get', 'parent-renamed'], tmp);
    expect(get.exitCode).toBe(0);
  });

  test('card search returns matching card', async () => {
    const r = await runCli(['--json', 'card', 'search', 'parent'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.items.some((i: { key: string }) => i.key === 'parent-b')).toBe(true);
  });

  test('card export --in-place rewrites file from DB', async () => {
    const r = await runCli(['--json', 'card', 'export', 'parent-b', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.mode).toBe('in-place');
    expect(parsed.data.filePath).toContain('parent-b');
  });

  test('card set-status changes status', async () => {
    const r = await runCli(['--json', 'card', 'set-status', 'parent-b', 'draft', '--reason', 'WIP'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runCli(['--json', 'card', 'get', 'parent-b'], tmp);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.data.status).toBe('draft');
  });

  test('card tree returns hierarchy', async () => {
    const r = await runCli(['--json', 'card', 'tree', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.key).toBe('parent-b');
    expect(parsed.data.children).toBeDefined();
  });

  test('card relations lists empty relations', async () => {
    const r = await runCli(['--json', 'card', 'relations', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.forward).toEqual([]);
  });

  test('card context returns BFS depth 1', async () => {
    const r = await runCli(['--json', 'card', 'context', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.key).toBe('parent-b');
  });
});

describe('Phase 2: glossary', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('glossary define + lookup', async () => {
    const def = await runCli(['--json', 'glossary', 'define', 'foo=Foo def', 'bar=Bar def'], tmp);
    expect(def.exitCode).toBe(0);
    const parsed = JSON.parse(def.stdout);
    expect(parsed.data.created).toBe(2);

    const lookup = await runCli(['--json', 'glossary', 'lookup', 'foo'], tmp);
    expect(lookup.exitCode).toBe(0);
    const lk = JSON.parse(lookup.stdout);
    expect(lk.data.entry.definition).toBe('Foo def');
  });

  test('glossary lookup all returns entries', async () => {
    await runCli(['glossary', 'define', 'word1=def1'], tmp);
    const r = await runCli(['--json', 'glossary', 'lookup'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.entries).toHaveLength(1);
  });

  test('glossary remove with --yes', async () => {
    await runCli(['glossary', 'define', 'gone=temporary'], tmp);
    const r = await runCli(['--json', 'glossary', 'remove', 'gone', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
  });

  test('glossary rename', async () => {
    await runCli(['glossary', 'define', 'old=def'], tmp);
    const r = await runCli(['--json', 'glossary', 'rename', 'old', 'new'], tmp);
    expect(r.exitCode).toBe(0);
    const lookup = await runCli(['--json', 'glossary', 'lookup', 'new'], tmp);
    expect(JSON.parse(lookup.stdout).data.found).toBe(true);
  });

  test('glossary define --from STDIN YAML', async () => {
    const yaml = '- word: stream-word\n  definition: from yaml\n';
    const proc = Bun.spawn(['bun', CLI, '--json', 'glossary', 'define', '--from', '-'], {
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
    expect(JSON.parse(stdout).data.created).toBe(1);
  });
});

describe('Phase 2: validate / check / spec / bulk / single', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('validate (no args = all)', async () => {
    const r = await runCli(['--json', 'validate'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.cards).toBeDefined();
    expect(parsed.data.links).toBeDefined();
    expect(parsed.data.briefs).toBeDefined();
  });

  test('validate links (empty project, no gildash)', async () => {
    const r = await runCli(['--json', 'validate', 'links'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.declared).toBe(0);
  });

  test('check drift on empty project', async () => {
    const r = await runCli(['--json', 'check', 'drift'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.health.total).toBe(0);
  });

  test('check impact on file with no card → low risk', async () => {
    const r = await runCli(['--json', 'check', 'impact', 'src/foo.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(['low', 'medium']).toContain(parsed.data.risk_level);
  });

  test('check regression on empty change set → pass', async () => {
    const r = await runCli(['--json', 'check', 'regression', 'src/foo.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.pass_or_fail).toBe('pass');
  });

  test('check interactions with two cards no overlap', async () => {
    await runCli(['card', 'create', 'a', '--type', 'brief', '--summary', 'a'], tmp);
    await runCli(['card', 'create', 'b', '--type', 'brief', '--summary', 'b'], tmp);
    const r = await runCli(['--json', 'check', 'interactions', 'a', 'b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.interactions).toBeDefined();
  });

  test('analyze on empty project', async () => {
    const r = await runCli(['--json', 'analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.health.total).toBe(0);
  });

  test('bulk create from YAML file', async () => {
    const yaml = `- key: card-x
  type: brief
  summary: bulk x
- key: card-y
  type: brief
  summary: bulk y
`;
    writeFileSync(join(tmp, 'cards.yaml'), yaml);
    const r = await runCli(['--json', 'bulk', 'create', '--from', 'cards.yaml'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.created).toBe(2);
  });

  test('bulk sync (empty dir)', async () => {
    const r = await runCli(['--json', 'bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.data.synced).toBe(0);
  });

  test('reset with --yes wipes everything', async () => {
    await runCli(['card', 'create', 'doomed', '--type', 'brief', '--summary', 'rip'], tmp);
    const r = await runCli(['--json', 'reset', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
    const list = await runCli(['--json', 'card', 'list'], tmp);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.data.total).toBe(0);
  });

  test('reset without --yes non-TTY → error', async () => {
    const r = await runCli(['--json', 'reset'], tmp);
    expect(r.exitCode).not.toBe(0);
  });

  test('spec annotate without gildash → exit 6', async () => {
    const r = await runCli(['--json', 'spec', 'annotate'], tmp);
    expect(r.exitCode).toBe(6);
  });

  test('spec sync without gildash → exit 6', async () => {
    const r = await runCli(['--json', 'spec', 'sync'], tmp);
    expect(r.exitCode).toBe(6);
  });

  test('spec sync-symbols without gildash → exit 6', async () => {
    const r = await runCli(['--json', 'spec', 'sync-symbols'], tmp);
    expect(r.exitCode).toBe(6);
  });
});
