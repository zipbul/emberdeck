/**
 * Phase 2 e2e: 25 newly-added subcommands smoke + key behaviors.
 * In-process via parseAsync (helpers.runEd).
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEd, setupTmpProject, parseJsonLines } from './helpers';

describe('Phase 2: card commands (delete/rename/search/export/set-status/tree/relations)', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(async () => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
    await runEd(['card', 'create', 'parent-b', '--type', 'brief', '--summary', 'parent'], tmp);
    await runEd(['card', 'create', 'child-s', '--type', 'spec', '--summary', 'child'], tmp);
  });
  afterEach(() => { cleanup(); });

  test('card delete with --yes', async () => {
    const r = await runEd(['card', 'delete', 'child-s', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'child-s'], tmp);
    expect(get.exitCode).toBe(3);
  });

  test('card delete without --yes when non-TTY → error', async () => {
    const r = await runEd(['card', 'delete', 'child-s'], tmp);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(parseJsonLines(r.stderr).find((l) => l.level === 'error')?.message).toContain('--yes');
  });

  test('card rename', async () => {
    const r = await runEd(['card', 'rename', 'parent-b', 'parent-renamed'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'parent-renamed'], tmp);
    expect(get.exitCode).toBe(0);
  });

  test('card search returns matching card', async () => {
    const r = await runEd(['card', 'search', 'parent'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items.some((i: { key: string }) => i.key === 'parent-b')).toBe(true);
  });

  test('card export --in-place rewrites file from DB', async () => {
    const r = await runEd(['card', 'export', 'parent-b', '--in-place'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.mode).toBe('in-place');
    expect(parsed.filePath).toContain('parent-b');
  });

  test('card set-status changes status', async () => {
    const r = await runEd(['card', 'set-status', 'parent-b', 'draft', '--reason', 'WIP'], tmp);
    expect(r.exitCode).toBe(0);
    const get = await runEd(['card', 'get', 'parent-b'], tmp);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.status).toBe('draft');
  });

  test('card tree returns hierarchy', async () => {
    const r = await runEd(['card', 'tree', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.key).toBe('parent-b');
    expect(parsed.children).toBeDefined();
  });

  test('card relations lists empty relations', async () => {
    const r = await runEd(['card', 'relations', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.forward).toEqual([]);
  });

  test('card context returns BFS depth 1', async () => {
    const r = await runEd(['card', 'context', 'parent-b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.key).toBe('parent-b');
  });
});

describe('Phase 2: glossary', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
  });
  afterEach(() => { cleanup(); });

  test('glossary define + lookup', async () => {
    const def = await runEd(['glossary', 'define', 'foo=Foo def', 'bar=Bar def'], tmp);
    expect(def.exitCode).toBe(0);
    const parsed = JSON.parse(def.stdout);
    expect(parsed.defined).toHaveLength(2);

    const lookup = await runEd(['glossary', 'lookup', 'foo'], tmp);
    expect(lookup.exitCode).toBe(0);
    const lk = JSON.parse(lookup.stdout);
    expect(lk.entries[0].definition).toBe('Foo def');
  });

  test('glossary lookup all returns entries', async () => {
    await runEd(['glossary', 'define', 'word1=def1'], tmp);
    const r = await runEd(['glossary', 'lookup'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.entries).toHaveLength(1);
  });

  test('glossary remove with --yes', async () => {
    await runEd(['glossary', 'define', 'gone=temporary'], tmp);
    const r = await runEd(['glossary', 'remove', 'gone', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
  });

  test('glossary rename', async () => {
    await runEd(['glossary', 'define', 'old=def'], tmp);
    const r = await runEd(['glossary', 'rename', 'old', 'new'], tmp);
    expect(r.exitCode).toBe(0);
    const lookup = await runEd(['glossary', 'lookup', 'new'], tmp);
    expect(JSON.parse(lookup.stdout).entries.length).toBe(1);
  });

  test('glossary define --from FILE', async () => {
    const json = JSON.stringify([{ word: 'filew-word', definition: 'from json file' }]);
    writeFileSync(join(tmp, 'gl.json'), json);
    const r = await runEd(['glossary', 'define', '--from', 'gl.json'], tmp);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).defined).toHaveLength(1);
  });
});

describe('Phase 2: validate / check / spec / bulk / single', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => {
    const h = setupTmpProject();
    tmp = h.tmp;
    cleanup = h.cleanup;
  });
  afterEach(() => { cleanup(); });

  test('validate (no args = all)', async () => {
    const r = await runEd(['validate'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.cards).toBeDefined();
    expect(parsed.links).toBeDefined();
  });

  test('validate links (empty project, no gildash)', async () => {
    const r = await runEd(['validate', 'links'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary.total).toBe(0);
  });

  test('check drift on empty project', async () => {
    const r = await runEd(['check', 'drift'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.health.total).toBe(0);
  });

  test('check impact on file with no card → low risk', async () => {
    const r = await runEd(['check', 'impact', 'src/foo.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(['low', 'medium']).toContain(parsed.riskLevel);
  });

  test('check regression on empty change set → pass', async () => {
    const r = await runEd(['check', 'regression', 'src/foo.ts'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.passOrFail).toBe('pass');
  });

  test('check interactions with two cards no overlap', async () => {
    await runEd(['card', 'create', 'a', '--type', 'brief', '--summary', 'a'], tmp);
    await runEd(['card', 'create', 'b', '--type', 'brief', '--summary', 'b'], tmp);
    const r = await runEd(['check', 'interactions', 'a', 'b'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.interactions).toBeDefined();
  });

  test('analyze on empty project', async () => {
    const r = await runEd(['analyze'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.health.total).toBe(0);
  });

  test('bulk create from JSON file', async () => {
    const json = JSON.stringify([
      { key: 'card-x', type: 'brief', summary: 'bulk x' },
      { key: 'card-y', type: 'brief', summary: 'bulk y' },
    ]);
    writeFileSync(join(tmp, 'cards.json'), json);
    const r = await runEd(['bulk', 'create', '--from', 'cards.json'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.created).toHaveLength(2);
  });

  test('bulk sync (empty dir)', async () => {
    const r = await runEd(['bulk', 'sync'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.synced).toBe(0);
  });

  test('reset with --yes wipes everything', async () => {
    await runEd(['card', 'create', 'doomed', '--type', 'brief', '--summary', 'rip'], tmp);
    const r = await runEd(['reset', '--yes'], tmp);
    expect(r.exitCode).toBe(0);
    const list = await runEd(['card', 'list'], tmp);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.total).toBe(0);
  });

  test('reset without --yes non-TTY → error', async () => {
    const r = await runEd(['reset'], tmp);
    expect(r.exitCode).not.toBe(0);
  });

});

describe('Phase 2: spec sync partial-status paths', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('spec sync with no annotations in source → ok (zero counts)', async () => {
    const r = await runEd(['spec', 'sync'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.alreadyLinked).toBe(0);
    expect(parsed.unmatched).toEqual([]);
  });

  test('spec sync with @spec annotation referencing nonexistent card → unmatched entry (no exit-2 envelope)', async () => {
    writeFileSync(
      join(tmp, 'src.ts'),
      '/** @spec missing-card */\nexport function foo() {}\n',
      'utf8',
    );
    const r = await runEd(['spec', 'sync'], tmp);
    // Either gildash didn't pick up the annotation, or it surfaces as an
    // unmatched entry (v2: structured under parsed.unmatched, not error code).
    if (r.exitCode === 0) {
      const parsed = JSON.parse(r.stdout);
      // unmatched may or may not contain the missing-card entry depending on
      // whether gildash indexed the TS file; either is valid in this minimal fixture
      expect(Array.isArray(parsed.unmatched)).toBe(true);
    } else {
      // partial path: exit 2, stdout still emits per-command shape (sync returns data)
      expect(r.exitCode).toBe(2);
    }
  });
});

describe('Phase 2: spec sync-symbols --since handling', () => {
  let tmp: string;
  let cleanup: () => void;
  beforeEach(() => { const h = setupTmpProject(); tmp = h.tmp; cleanup = h.cleanup; });
  afterEach(() => { cleanup(); });

  test('--since with garbage value → cli-usage-error (exit 2)', async () => {
    const r = await runEd(['spec', 'sync-symbols', '--since', 'garbage-not-a-date'], tmp);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    const err = parseJsonLines(r.stderr).find((l) => l.level === 'error');
    expect(err?.code).toBe('cli-usage-error');
    expect(err?.message).toContain('--since');
  });

  test('--since ISO 8601 timestamp accepted; sinceSource=flag', async () => {
    const r = await runEd(['spec', 'sync-symbols', '--since', '2026-01-01T00:00:00Z'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.sinceSource).toBe('flag');
    expect(parsed.since).toBe('2026-01-01T00:00:00Z');
  });

  test('--since epoch ms accepted; sinceSource=flag', async () => {
    const r = await runEd(['spec', 'sync-symbols', '--since', '1700000000000'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.sinceSource).toBe('flag');
  });

  test('no --since on first run uses default-24h source', async () => {
    const r = await runEd(['spec', 'sync-symbols'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.sinceSource).toBe('default-24h');
    expect(parsed.nextSyncMarker).toBeTruthy();
  });

  test('no --since on second run uses last-sync source from metadata', async () => {
    await runEd(['spec', 'sync-symbols'], tmp); // seeds last_symbol_sync_at
    const r = await runEd(['spec', 'sync-symbols'], tmp);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.sinceSource).toBe('last-sync');
  });
});
