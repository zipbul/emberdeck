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
  serializeCardMarkdown,
  parseCardMarkdown,
  listCards,
  CardKeyError,
  CardNotFoundError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

async function writeTestCardFile(cardsDir: string, slug: string, summary: string, body = '') {
  const content = serializeCardMarkdown(
    { key: slug, summary, status: 'draft', type: 'spec' },
    body,
  );
  const filePath = join(cardsDir, `${slug}.card.md`);
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
    const content = serializeCardMarkdown(
      {
        key: 'sync-rel-src',
        summary: 'Rel src',
        status: 'draft',
        type: 'spec',
        relations: ['sync-rel-dst'],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-rel-src.card.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    const rows = tc.ctx.relationRepo.findByCardKey('sync-rel-src');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'sync-rel-dst')).toBe(true);
  });

  it('should update DB tags when syncing file with classification', async () => {
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      {
        key: 'sync-cls',
        summary: 'Cls',
        status: 'draft',
        type: 'spec',
        tags: ['tag1'],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-cls.card.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    expect(tc.ctx.classificationRepo.findTagsByCard('sync-cls')).toContain('tag1');
  });

  it('should replace relations with empty array when syncing file with no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'sync-norel-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'sync-norel-dst', summary: 'Dst', type: 'spec' });
    const filePathWithRel = join(tc.cardsDir, 'sync-norel-src.card.md');
    const contentWith = serializeCardMarkdown(
      {
        key: 'sync-norel-src',
        summary: 'Src',
        status: 'draft',
        type: 'spec',
        relations: ['sync-norel-dst'],
      },
      '',
    );
    await writeFile(filePathWithRel, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    const contentWithout = serializeCardMarkdown(
      { key: 'sync-norel-src', summary: 'Src', status: 'draft', type: 'spec' },
      '',
    );
    await writeFile(filePathWithRel, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    expect(tc.ctx.relationRepo.findByCardKey('sync-norel-src')).toHaveLength(0);
  });

  it('should reflect latest values after syncing same file twice', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'sync-twice', 'First sync');
    await syncCardFromFile(tc.ctx, join(tc.cardsDir, 'sync-twice.card.md'));
    await writeTestCardFile(tc.cardsDir, 'sync-twice', 'Second sync');
    await syncCardFromFile(tc.ctx, join(tc.cardsDir, 'sync-twice.card.md'));
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
    const filePath = join(tc.cardsDir, 'bad-yaml.card.md');
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
    const unknownPath = join(tc.cardsDir, 'unknown.card.md');
    expect(() => removeCardByFile(tc.ctx, unknownPath)).not.toThrow();
  });
});

describe('syncCardFromFile — codeLinks', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should persist codeLinks to DB when syncing a file with codeLinks in frontmatter', async () => {
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      {
        key: 'sync-cl',
        summary: 'CL',
        status: 'draft',
        type: 'spec',
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-cl.card.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    const links = tc.ctx.codeLinkRepo.findByCardKey('sync-cl');
    expect(links).toHaveLength(1);
    expect(links[0]!.symbol).toBe('myFunc');
  });

  it('should clear codeLinks from DB when syncing same file without codeLinks', async () => {
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'sync-cl-rm.card.md');
    const contentWith = serializeCardMarkdown(
      {
        key: 'sync-cl-rm',
        summary: 'CL RM',
        status: 'draft',
        type: 'spec',
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
      },
      '',
    );
    await writeFile(filePath, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    const contentWithout = serializeCardMarkdown(
      { key: 'sync-cl-rm', summary: 'CL RM', status: 'draft', type: 'spec' },
      '',
    );
    await writeFile(filePath, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    expect(tc.ctx.codeLinkRepo.findByCardKey('sync-cl-rm')).toHaveLength(0);
  });
});

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
    await writeFile(join(tc.cardsDir, 'bad.card.md'), 'NOT VALID FRONTMATTER AT ALL', 'utf-8');
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
    const orphanPath = join(tc.cardsDir, 'orphan.card.md');
    await writeFile(
      orphanPath,
      serializeCardMarkdown({ key: 'orphan', summary: 'O', status: 'draft', type: 'spec' }, ''),
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

  it('should report no orphans after bulkSyncCards resolves the orphan files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'st-orphan', 'Orphan');
    const before = await validateCards(tc.ctx);
    expect(before.orphanFiles).toHaveLength(1);
    await bulkSyncCards(tc.ctx);
    const after = await validateCards(tc.ctx);
    expect(after.orphanFiles).toHaveLength(0);
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
      body: 'body content',
      tags: ['tag1'],
      relations: ['exp-rt-tgt'],
      codeLinks: [{ kind: 'function', file: 'src/foo.ts', symbol: 'foo' }],
    });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-rt-src');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(exportedPath).toBe(filePath);
    expect(parsed.frontmatter.key).toBe('exp-rt-src');
    expect(parsed.frontmatter.summary).toBe('Round-trip source');
    expect(parsed.body).toContain('body content');
    expect(parsed.frontmatter.tags).toContain('tag1');
    expect(parsed.frontmatter.relations).toHaveLength(1);
    expect(parsed.frontmatter.codeLinks).toHaveLength(1);
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
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.relations).toHaveLength(1);
    expect(parsed.frontmatter.relations![0]).toBe('exp-fwd-tgt');
  });

  it('should include tags in the exported file when card has tags', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-tag', summary: 'Tag card', type: 'spec', tags: ['release', 'v2'] });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-tag');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.tags).toEqual(expect.arrayContaining(['release', 'v2']));
  });

  it('should include codeLinks in the exported file when card has code links', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'exp-cl',
      summary: 'CL card',
      type: 'spec',
      codeLinks: [{ kind: 'class', file: 'src/bar.ts', symbol: 'Bar' }],
    });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-cl');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.codeLinks).toHaveLength(1);
    expect(parsed.frontmatter.codeLinks![0]!.symbol).toBe('Bar');
  });

  it('should preserve the card body and return the correct file path', async () => {
    tc = await createTestContext();
    const expected = '## Details\n\nSome notes here.';
    const { filePath } = await createCard(tc.ctx, {
      key: 'exp-body',
      summary: 'Body card',
      type: 'spec',
      body: expected,
    });
    const returnedPath = await exportCardToFile(tc.ctx, 'exp-body');
    const text = await Bun.file(returnedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(returnedPath).toBe(filePath);
    expect(parsed.body).toContain('## Details');
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
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.relations).toBeUndefined();
  });

  it('should export minimal front-matter with no optional fields when all are empty', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exp-min', summary: 'Minimal card', type: 'spec' });
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-min');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.key).toBe('exp-min');
    expect(parsed.frontmatter.relations).toBeUndefined();
    expect(parsed.frontmatter.tags).toBeUndefined();
    expect(parsed.frontmatter.codeLinks).toBeUndefined();
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
    const content = serializeCardMarkdown(
      { key: 'sync-type', summary: 'Type sync', status: 'draft', type: 'architecture' },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-type.card.md');
    await writeFile(filePath, content, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);

    const row = tc.ctx.cardRepo.findByKey('sync-type');
    expect(row).not.toBeNull();
    expect(row!.type).toBe('architecture');
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
    await createCard(tc.ctx, { key: 'exp-type', summary: 'Type export', type: 'architecture' });

    const exportedPath = await exportCardToFile(tc.ctx, 'exp-type');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(parsed.frontmatter.type).toBe('architecture');
  });
});
