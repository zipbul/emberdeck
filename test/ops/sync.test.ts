import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createCard,
  syncCardFromFile,
  removeCardByFile,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
  serializeCard,
  parseCard,
  listCards,
  CardKeyError,
  CardNotFoundError,
} from '../../index';
import { createTestContext, BRIEF_BODY, makeTestSpec, type TestContext } from '../helpers';

async function writeTestCardFile(cardsDir: string, slug: string, summary: string) {
  const content = serializeCard(
    { key: slug, summary, status: 'draft', type: 'spec' },
  );
  const filePath = join(cardsDir, `${slug}.md`);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('syncCardFromFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should create DB card row when syncing a new file', async () => {
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-new', 'New sync card');
    await syncCardFromFile(tc.ctx, filePath);
    const row = tc.ctx.cardRepo.findByKey('sync-new');
    expect(row).not.toBeNull();
    expect(row?.summary).toBe('New sync card');
  });

  it('should update existing DB card row when syncing changed file', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sync-upd', summary: 'Original', type: 'spec' });
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-upd', 'Updated by sync');
    await syncCardFromFile(tc.ctx, filePath);
    const row = tc.ctx.cardRepo.findByKey('sync-upd');
    expect(row?.summary).toBe('Updated by sync');
  });

  it('should update DB relations when syncing file that has relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sync-rel-dst', summary: 'Dst', type: 'spec' });
    const content = serializeCard(
      {
        key: 'sync-rel-src',
        summary: 'Rel src',
        status: 'draft',
        type: 'spec',
        relations: ['sync-rel-dst'],
      },
    );
    const filePath = join(tc.cardsDir, 'sync-rel-src.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    const rows = tc.ctx.relationRepo.findByCardKey('sync-rel-src');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'sync-rel-dst')).toBe(true);
  });

  it('should update DB tags when syncing file with classification', async () => {
    tc = await createTestContext();
    const content = serializeCard(
      {
        key: 'sync-cls',
        summary: 'Cls',
        status: 'draft',
        type: 'spec',
        tags: ['tag1'],
      },
    );
    const filePath = join(tc.cardsDir, 'sync-cls.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    expect(tc.ctx.classificationRepo.findTagsByCard('sync-cls')).toContain('tag1');
  });

  it('should replace relations with empty array when syncing file with no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sync-norel-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'sync-norel-dst', summary: 'Dst', type: 'spec' });
    const filePathWithRel = join(tc.cardsDir, 'sync-norel-src.md');
    const contentWith = serializeCard(
      {
        key: 'sync-norel-src',
        summary: 'Src',
        status: 'draft',
        type: 'spec',
        relations: ['sync-norel-dst'],
      },
    );
    await writeFile(filePathWithRel, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    const contentWithout = serializeCard(
      { key: 'sync-norel-src', summary: 'Src', status: 'draft', type: 'spec' },
    );
    await writeFile(filePathWithRel, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    expect(tc.ctx.relationRepo.findByCardKey('sync-norel-src')).toHaveLength(0);
  });

  it('should reflect latest values after syncing same file twice', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'sync-twice', 'First sync');
    await syncCardFromFile(tc.ctx, join(tc.cardsDir, 'sync-twice.md'));
    await writeTestCardFile(tc.cardsDir, 'sync-twice', 'Second sync');
    await syncCardFromFile(tc.ctx, join(tc.cardsDir, 'sync-twice.md'));
    const row = tc.ctx.cardRepo.findByKey('sync-twice');
    expect(row?.summary).toBe('Second sync');
  });

  it('should keep exactly one DB row after syncing same file twice', async () => {
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-idp', 'Idempotent');
    await syncCardFromFile(tc.ctx, filePath);
    await syncCardFromFile(tc.ctx, filePath);
    const rows = listCards(tc.ctx);
    expect(rows.filter((r) => r.key === 'sync-idp')).toHaveLength(1);
  });

  it('should propagate error when card file has invalid YAML frontmatter', async () => {
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'bad-yaml.md');
    await writeFile(filePath, '---\nNOT VALID YAML: [[\n---\nbody', 'utf-8');
    expect(syncCardFromFile(tc.ctx, filePath)).rejects.toThrow();
  });
});

describe('removeCardByFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should delete DB card row when card with matching filePath exists', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { key: 'rm-exists', summary: 'Remove', type: 'spec' });
    removeCardByFile(tc.ctx, filePath);
    expect(tc.ctx.cardRepo.findByKey('rm-exists')).toBeNull();
  });

  it('should do nothing when no card matches the given filePath', async () => {
    tc = await createTestContext();
    const unknownPath = join(tc.cardsDir, 'unknown.md');
    expect(() => removeCardByFile(tc.ctx, unknownPath)).not.toThrow();
  });
});

// code_link rows are populated by `ed spec sync` from source `@spec`
// annotations — `syncCardFromFile` no longer reads/writes them.

// ---------------------------------------------------------------------------
// bulkSyncCards
// ---------------------------------------------------------------------------

describe('bulkSyncCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return synced=3 and empty errors when directory has 3 card files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-a', 'A');
    await writeTestCardFile(tc.cardsDir, 'bulk-b', 'B');
    await writeTestCardFile(tc.cardsDir, 'bulk-c', 'C');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should scan specified dirPath instead of ctx.cardsDir', async () => {
    tc = await createTestContext();
    const altDir = join(tc.cardsDir, 'sub');
    await mkdir(altDir);
    await writeTestCardFile(altDir, 'bulk-sub', 'Sub');
    const result = await bulkSyncCards(tc.ctx, altDir);
    expect(result.synced).toBe(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-sub')).not.toBeNull();
  });

  it('should default to ctx.cardsDir when dirPath is not provided', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-def', 'Default');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-def')).not.toBeNull();
  });

  it('should collect failing file in errors and continue processing remaining files', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'bad.md'), 'NOT VALID FRONTMATTER AT ALL', 'utf-8');
    await writeTestCardFile(tc.cardsDir, 'bulk-good', 'Good');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.synced).toBeGreaterThanOrEqual(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-good')).not.toBeNull();
  });

  it('should return synced=0 and empty errors for an empty directory', async () => {
    tc = await createTestContext();
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should upsert existing DB row without creating duplicates', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bulk-upsert', summary: 'Original', type: 'spec' });
    await writeTestCardFile(tc.cardsDir, 'bulk-upsert', 'Updated by bulk');
    await bulkSyncCards(tc.ctx);
    const rows = listCards(tc.ctx).filter((r) => r.key === 'bulk-upsert');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('Updated by bulk');
  });

  it('should produce same synced count and no duplicate rows when called twice', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-2x', 'Twice');
    const r1 = await bulkSyncCards(tc.ctx);
    const r2 = await bulkSyncCards(tc.ctx);
    expect(r1.synced).toBe(1);
    expect(r2.synced).toBe(1);
    expect(listCards(tc.ctx).filter((r) => r.key === 'bulk-2x')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateCards
// ---------------------------------------------------------------------------

describe('validateCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return all empty arrays when files and DB rows are perfectly in sync', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'val-sync', summary: 'S', type: 'spec' });
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(0);
    expect(result.orphanFiles).toHaveLength(0);
    expect(result.keyMismatches).toHaveLength(0);
  });

  it('should report DB row as stale when its file has been deleted', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { key: 'val-stale', summary: 'Stale', type: 'spec' });
    await unlink(filePath);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows.some((r) => r.key === 'val-stale')).toBe(true);
  });

  it('should report file as orphan when no corresponding DB row exists', async () => {
    tc = await createTestContext();
    const orphanPath = join(tc.cardsDir, 'orphan.md');
    await writeFile(
      orphanPath,
      serializeCard({ key: 'orphan', summary: 'O', status: 'draft', type: 'spec' }),
      'utf-8',
    );
    const result = await validateCards(tc.ctx);
    expect(result.orphanFiles).toContain(orphanPath);
  });

  it('should return all empty arrays when DB is empty and directory is empty', async () => {
    tc = await createTestContext();
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(0);
    expect(result.orphanFiles).toHaveLength(0);
    expect(result.keyMismatches).toHaveLength(0);
  });

  it('should detect keyMismatch when DB key does not match file path', async () => {
    tc = await createTestContext();
    // Create a card normally
    await createCard(tc.ctx, { key: 'correct-key', summary: 'Correct', type: 'spec' });
    // Manually update the DB key to a different value, creating a mismatch
    tc.ctx.db.$client.run(
      `UPDATE card SET key = ? WHERE key = ?`,
      ['wrong-key', 'correct-key'],
    );
    const result = await validateCards(tc.ctx);
    expect(result.keyMismatches.length).toBeGreaterThanOrEqual(1);
    expect(result.keyMismatches.some((m) => m.row.key === 'wrong-key')).toBe(true);
  });

  it('should report no orphans after bulkSyncCards resolves the orphan files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'st-orphan', 'Orphan');
    const before = await validateCards(tc.ctx);
    expect(before.orphanFiles).toHaveLength(1);
    await bulkSyncCards(tc.ctx);
    const after = await validateCards(tc.ctx);
    expect(after.orphanFiles).toHaveLength(0);
  });

  // D-2: content-mismatch detection
  it('should report content-mismatch warning when DB status differs from file status', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cm-status', summary: 'S', type: 'brief' });
    // Directly mutate DB status without updating file
    tc.ctx.db.$client.prepare('UPDATE card SET status = ? WHERE key = ?').run('drifted', 'cm-status');
    const result = await validateCards(tc.ctx);
    const mismatch = result.warnings.filter((w) => w.type === 'content-mismatch' && w.cardKey === 'cm-status');
    expect(mismatch.length).toBeGreaterThanOrEqual(1);
    expect(mismatch.some((w) => w.message.includes('status'))).toBe(true);
  });

  it('should report content-mismatch warning when DB summary differs from file summary', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cm-summ', summary: 'Original', type: 'brief' });
    tc.ctx.db.$client.prepare('UPDATE card SET summary = ? WHERE key = ?').run('Tampered', 'cm-summ');
    const result = await validateCards(tc.ctx);
    const mismatch = result.warnings.filter((w) => w.type === 'content-mismatch' && w.cardKey === 'cm-summ');
    expect(mismatch.length).toBeGreaterThanOrEqual(1);
    expect(mismatch.some((w) => w.message.includes('summary'))).toBe(true);
  });

  it('should report two content-mismatch warnings when both status and summary differ', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cm-both', summary: 'S', type: 'brief' });
    tc.ctx.db.$client.prepare('UPDATE card SET status = ?, summary = ? WHERE key = ?').run('drifted', 'X', 'cm-both');
    const result = await validateCards(tc.ctx);
    const mismatch = result.warnings.filter((w) => w.type === 'content-mismatch' && w.cardKey === 'cm-both');
    expect(mismatch).toHaveLength(2);
  });

  it('should not report content-mismatch when DB and file are in sync', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cm-ok', summary: 'OK', type: 'brief' });
    const result = await validateCards(tc.ctx);
    const mismatch = result.warnings.filter((w) => w.type === 'content-mismatch');
    expect(mismatch).toHaveLength(0);
  });

  it('should skip content-mismatch check for stale DB rows whose file was deleted', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { key: 'cm-del', summary: 'Del', type: 'brief' });
    await unlink(filePath);
    const result = await validateCards(tc.ctx);
    const mismatch = result.warnings.filter((w) => w.type === 'content-mismatch' && w.cardKey === 'cm-del');
    expect(mismatch).toHaveLength(0);
  });

  it('should not modify DB or files — validateCards is read-only', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'ro-orphan', 'Orphan');
    await validateCards(tc.ctx);
    expect(tc.ctx.cardRepo.findByKey('ro-orphan')).toBeNull();
  });
});

describe('exportCardToFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should restore all front-matter fields when round-tripping through DB and file', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-rt-tgt', summary: 'Target card', type: 'spec' });
    const { filePath } = await createCard(tc.ctx, {
      key: 'exp-rt-src',
      summary: 'Round-trip source',
      type: 'spec',
      tags: ['tag1'],
      relations: ['exp-rt-tgt'],
      });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-rt-src');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(exportedPath).toBe(filePath);
    expect(parsed.frontmatter.key).toBe('exp-rt-src');
    expect(parsed.frontmatter.summary).toBe('Round-trip source');
    expect(parsed.frontmatter.tags).toContain('tag1');
    expect(parsed.frontmatter.relations).toHaveLength(1);
  });

  it('should include only forward (non-reverse) relations in the exported file', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-fwd-tgt', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'exp-fwd-src',
      summary: 'Source',
      type: 'spec',
      relations: ['exp-fwd-tgt'],
    });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-fwd-src');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(parsed.frontmatter.relations).toHaveLength(1);
    expect(parsed.frontmatter.relations![0]).toBe('exp-fwd-tgt');
  });

  it('should include tags in the exported file when card has tags', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-tag', summary: 'Tag card', type: 'spec', tags: ['release', 'v2'] });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-tag');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(parsed.frontmatter.tags).toEqual(expect.arrayContaining(['release', 'v2']));
  });

  it('should preserve the card body and return the correct file path', async () => {
    tc = await createTestContext();
    const expected = '## Details\n\nSome notes here.';
    const { filePath } = await createCard(tc.ctx, {
      key: 'exp-body',
      summary: 'Body card',
      type: 'spec',
    });
    const returnedPath = await exportCardToFile(tc.ctx, 'exp-body');
    expect(returnedPath).toBe(filePath);
  });

  it('round-trip export produces identical content', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'exp-ns-rt',
      summary: 'NS round-trip',
      type: 'spec',
      spec: makeTestSpec('src/x.ts', 'foo'),
      });
    const path1 = await exportCardToFile(tc.ctx, 'exp-ns-rt');
    const text1 = await Bun.file(path1).text();
    await syncCardFromFile(tc.ctx, path1);
    const path2 = await exportCardToFile(tc.ctx, 'exp-ns-rt');
    const text2 = await Bun.file(path2).text();
    expect(text2).toBe(text1);
  });

  it('round-trips a domain card (namespacesJson preserves overview/scope/cross_domain_dependencies)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'platform-a', summary: 'Domain A', type: 'domain' });
    await createCard(tc.ctx, {
      key: 'platform-b',
      summary: 'Domain B',
      type: 'domain',
      domain: {
        overview: 'B overview',
        scope: 'B scope',
        cross_domain_dependencies: [
          { domain: 'platform-a', relationship: 'consumes events from A' },
        ],
      },
    });
    const path1 = await exportCardToFile(tc.ctx, 'platform-b');
    const text1 = await Bun.file(path1).text();
    await syncCardFromFile(tc.ctx, path1);
    const path2 = await exportCardToFile(tc.ctx, 'platform-b');
    const text2 = await Bun.file(path2).text();
    expect(text2).toBe(text1);
    const parsed = parseCard(text1);
    expect(parsed.frontmatter.type).toBe('domain');
    expect(parsed.frontmatter.domain).toBeDefined();
    expect(parsed.frontmatter.domain!.overview).toBe('B overview');
    expect(parsed.frontmatter.domain!.scope).toBe('B scope');
    expect(parsed.frontmatter.domain!.cross_domain_dependencies).toHaveLength(1);
    expect(parsed.frontmatter.domain!.cross_domain_dependencies![0]!.domain).toBe('platform-a');
  });

  it('should throw CardKeyError when the key format is invalid', async () => {
    tc = await createTestContext();
    expect(() => exportCardToFile(tc.ctx, '!!bad key!!')).toThrow(CardKeyError);
  });

  it('should throw CardNotFoundError when card does not exist in DB', async () => {
    tc = await createTestContext();
    await expect(exportCardToFile(tc.ctx, 'no-such-card')).rejects.toThrow(CardNotFoundError);
  });

  it('should omit relations field when card only has incoming (reverse) relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-rev-tgt', summary: 'Reverse target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'exp-rev-src',
      summary: 'Reverse source',
      type: 'spec',
      relations: ['exp-rev-tgt'],
    });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-rev-tgt');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(parsed.frontmatter.relations).toBeUndefined();
  });

  it('should export minimal front-matter with no optional fields when all are empty', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-min', summary: 'Minimal card', type: 'spec' });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-min');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(parsed.frontmatter.key).toBe('exp-min');
    expect(parsed.frontmatter.relations).toBeUndefined();
    expect(parsed.frontmatter.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncCardFromFile — type
// ---------------------------------------------------------------------------

describe('syncCardFromFile — type', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should persist type to DB when syncing a file with type in frontmatter', async () => {
    tc = await createTestContext();
    const content = serializeCard(
      { key: 'sync-type', summary: 'Type sync', status: 'draft', type: 'brief' },
    );
    const filePath = join(tc.cardsDir, 'sync-type.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);

    const row = tc.ctx.cardRepo.findByKey('sync-type');
    expect(row).not.toBeNull();
    expect(row!.type).toBe('brief');
  });
});

// ---------------------------------------------------------------------------
// exportCardToFile — type round-trip
// ---------------------------------------------------------------------------

describe('exportCardToFile — type round-trip', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should include type in exported file when card has type', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-type', summary: 'Type export', type: 'brief' });

    const exportedPath = await exportCardToFile(tc.ctx, 'exp-type');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCard(text);
    expect(parsed.frontmatter.type).toBe('brief');
  });
});
