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
    { key: slug, summary, status: 'draft' },
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
    // Arrange
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-new', 'New sync card');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-new');
    expect(row).not.toBeNull();
    expect(row?.summary).toBe('New sync card');
  });

  it('should update existing DB card row when syncing changed file', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-upd', summary: 'Original' });
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-upd', 'Updated by sync');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-upd');
    expect(row?.summary).toBe('Updated by sync');
  });

  it('should update DB relations when syncing file that has relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-rel-dst', summary: 'Dst' });
    const content = serializeCardMarkdown(
      {
        key: 'sync-rel-src',
        summary: 'Rel src',
        status: 'draft',
        relations: [{ type: 'depends-on', target: 'sync-rel-dst' }],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-rel-src.card.md');
    await writeFile(filePath, content, 'utf-8');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const rows = tc.ctx.relationRepo.findByCardKey('sync-rel-src');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'sync-rel-dst')).toBe(true);
  });

  it('should update DB keywords and tags when syncing file with classification', async () => {
    // Arrange
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      {
        key: 'sync-cls',
        summary: 'Cls',
        status: 'draft',
        keywords: ['kw1'],
        tags: ['tag1'],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-cls.card.md');
    await writeFile(filePath, content, 'utf-8');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('sync-cls')).toContain('kw1');
    expect(tc.ctx.classificationRepo.findTagsByCard('sync-cls')).toContain('tag1');
  });

  it('should replace relations with empty array when syncing file with no relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-norel-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'sync-norel-dst', summary: 'Dst' });
    const filePathWithRel = join(tc.cardsDir, 'sync-norel-src.card.md');
    const contentWith = serializeCardMarkdown(
      {
        key: 'sync-norel-src',
        summary: 'Src',
        status: 'draft',
        relations: [{ type: 'depends-on', target: 'sync-norel-dst' }],
      },
      '',
    );
    await writeFile(filePathWithRel, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    // Act: now sync file without relations
    const contentWithout = serializeCardMarkdown(
      { key: 'sync-norel-src', summary: 'Src', status: 'draft' },
      '',
    );
    await writeFile(filePathWithRel, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('sync-norel-src')).toHaveLength(0);
  });

  it('should reflect latest values after syncing same file twice', async () => {
    // Arrange
    tc = await createTestContext();
    const fp1 = await writeTestCardFile(tc.cardsDir, 'sync-twice', 'First sync');
    await syncCardFromFile(tc.ctx, fp1);
    const fp2 = await writeTestCardFile(tc.cardsDir, 'sync-twice', 'Second sync');
    // Act
    await syncCardFromFile(tc.ctx, fp2);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-twice');
    expect(row?.summary).toBe('Second sync');
  });

  it('should keep exactly one DB row after syncing same file twice', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-idp', 'Idempotent');
    await syncCardFromFile(tc.ctx, filePath);
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const rows = listCards(tc.ctx);
    expect(rows.filter((r) => r.key === 'sync-idp')).toHaveLength(1);
  });

  it('should propagate error when card file has invalid YAML frontmatter', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'bad-yaml.card.md');
    await writeFile(filePath, '---\nNOT VALID YAML: [[\n---\nbody', 'utf-8');
    // Act & Assert
    expect(syncCardFromFile(tc.ctx, filePath)).rejects.toThrow();
  });
});

describe('removeCardByFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should delete DB card row when card with matching filePath exists', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'rm-exists', summary: 'Remove' });
    // Act
    removeCardByFile(tc.ctx, filePath);
    // Assert
    expect(tc.ctx.cardRepo.findByKey('rm-exists')).toBeNull();
  });

  it('should do nothing when no card matches the given filePath', async () => {
    // Arrange
    tc = await createTestContext();
    const unknownPath = join(tc.cardsDir, 'unknown.card.md');
    // Act (should not throw)
    expect(() => removeCardByFile(tc.ctx, unknownPath)).not.toThrow();
  });
});

describe('syncCardFromFile — codeLinks', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should persist codeLinks to DB when syncing a file with codeLinks in frontmatter', async () => {
    // Arrange
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      {
        key: 'sync-cl',
        summary: 'CL',
        status: 'draft',
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-cl.card.md');
    await writeFile(filePath, content, 'utf-8');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const links = tc.ctx.codeLinkRepo.findByCardKey('sync-cl');
    expect(links).toHaveLength(1);
    expect(links[0]!.symbol).toBe('myFunc');
  });

  it('should clear codeLinks from DB when syncing same file without codeLinks', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'sync-cl-rm.card.md');
    const contentWith = serializeCardMarkdown(
      {
        key: 'sync-cl-rm',
        summary: 'CL RM',
        status: 'draft',
        codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
      },
      '',
    );
    await writeFile(filePath, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    // Act: sync without codeLinks
    const contentWithout = serializeCardMarkdown(
      { key: 'sync-cl-rm', summary: 'CL RM', status: 'draft' },
      '',
    );
    await writeFile(filePath, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
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

  // [HP-1] 3 .card.md files → synced=3, errors=[]
  it('should return synced=3 and empty errors when directory has 3 card files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-a', 'A');
    await writeTestCardFile(tc.cardsDir, 'bulk-b', 'B');
    await writeTestCardFile(tc.cardsDir, 'bulk-c', 'C');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  // [HP-2] dirPath argument specified → scans that path
  it('should scan specified dirPath instead of ctx.cardsDir', async () => {
    tc = await createTestContext();
    const altDir = join(tc.cardsDir, 'sub');
    await mkdir(altDir);
    await writeTestCardFile(altDir, 'bulk-sub', 'Sub');
    const result = await bulkSyncCards(tc.ctx, altDir);
    expect(result.synced).toBe(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-sub')).not.toBeNull();
  });

  // [HP-3] dirPath not provided → uses ctx.cardsDir
  it('should default to ctx.cardsDir when dirPath is not provided', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-def', 'Default');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-def')).not.toBeNull();
  });

  // [HP-4] File with relations → DB relations synced
  it('should sync relations to DB when card file contains relations', async () => {
    tc = await createTestContext();
    // Insert dst into DB first via createCard (to satisfy FK)
    await createCard(tc.ctx, { slug: 'bulk-rel-dst', summary: 'Dst' });
    const src = serializeCardMarkdown(
      { key: 'bulk-rel-src', summary: 'Src', status: 'draft', relations: [{ type: 'depends-on', target: 'bulk-rel-dst' }] },
      '',
    );
    await writeFile(join(tc.cardsDir, 'bulk-rel-src.card.md'), src, 'utf-8');
    await bulkSyncCards(tc.ctx);
    const rels = tc.ctx.relationRepo.findByCardKey('bulk-rel-src');
    expect(rels.some((r) => !r.isReverse && r.dstCardKey === 'bulk-rel-dst')).toBe(true);
  });

  // [HP-5] File with keywords+tags → DB classification synced
  it('should sync keywords and tags to DB when card file contains classification', async () => {
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      { key: 'bulk-cls', summary: 'Cls', status: 'draft', keywords: ['kw1'], tags: ['tag1'] },
      '',
    );
    await writeFile(join(tc.cardsDir, 'bulk-cls.card.md'), content, 'utf-8');
    await bulkSyncCards(tc.ctx);
    expect(tc.ctx.classificationRepo.findKeywordsByCard('bulk-cls')).toContain('kw1');
    expect(tc.ctx.classificationRepo.findTagsByCard('bulk-cls')).toContain('tag1');
  });

  // [HP-6] File with codeLinks → DB code links synced
  it('should sync codeLinks to DB when card file contains codeLinks', async () => {
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      { key: 'bulk-cl', summary: 'CL', status: 'draft', codeLinks: [{ kind: 'function', file: 'a.ts', symbol: 'fn' }] },
      '',
    );
    await writeFile(join(tc.cardsDir, 'bulk-cl.card.md'), content, 'utf-8');
    await bulkSyncCards(tc.ctx);
    expect(tc.ctx.codeLinkRepo.findByCardKey('bulk-cl')).toHaveLength(1);
  });

  // [HP-7] File already in DB → upsert (no duplicates)
  it('should upsert existing DB row without creating duplicates', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'bulk-upsert', summary: 'Original' });
    await writeTestCardFile(tc.cardsDir, 'bulk-upsert', 'Updated by bulk');
    await bulkSyncCards(tc.ctx);
    const rows = listCards(tc.ctx).filter((r) => r.key === 'bulk-upsert');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('Updated by bulk');
  });

  // [HP-8] File with constraints → constraintsJson stored
  it('should store constraintsJson when card file contains constraints', async () => {
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      { key: 'bulk-con', summary: 'Con', status: 'draft', constraints: { maxItems: 5 } },
      '',
    );
    await writeFile(join(tc.cardsDir, 'bulk-con.card.md'), content, 'utf-8');
    await bulkSyncCards(tc.ctx);
    const row = tc.ctx.cardRepo.findByKey('bulk-con');
    expect(row?.constraintsJson).not.toBeNull();
    expect(JSON.parse(row!.constraintsJson!)).toEqual({ maxItems: 5 });
  });

  // [NE-1] 1 file fails → collected in errors, remaining processed
  it('should collect failing file in errors and continue processing remaining files', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'bad.card.md'), 'NOT VALID FRONTMATTER AT ALL', 'utf-8');
    await writeTestCardFile(tc.cardsDir, 'bulk-good', 'Good');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.errors).toHaveLength(1);
    expect(result.synced).toBe(1);
    expect(tc.ctx.cardRepo.findByKey('bulk-good')).not.toBeNull();
  });

  // [NE-2] All files fail → synced=0, errors=[all]
  it('should return synced=0 and all files in errors when all files fail', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'bad1.card.md'), 'INVALID', 'utf-8');
    await writeFile(join(tc.cardsDir, 'bad2.card.md'), 'INVALID', 'utf-8');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(2);
  });

  // [NE-3] dirPath does not exist → throw propagated
  it('should throw when dirPath does not exist', async () => {
    tc = await createTestContext();
    await expect(bulkSyncCards(tc.ctx, '/nonexistent/path/xyz')).rejects.toThrow();
  });

  // [ED-1] Empty directory → synced=0, errors=[]
  it('should return synced=0 and empty errors for an empty directory', async () => {
    tc = await createTestContext();
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  // [ED-2] Only non-.card.md files present → synced=0
  it('should return synced=0 when directory has no .card.md files', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'readme.md'), '# readme', 'utf-8');
    await writeFile(join(tc.cardsDir, 'notes.txt'), 'notes', 'utf-8');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  // [ED-3] Only 1 file present and it fails → synced=0, errors=[1]
  it('should return synced=0 and one error when the only file fails', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'only.card.md'), 'BAD CONTENT', 'utf-8');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.filePath).toContain('only.card.md');
  });

  // [CO-1] Half of files fail → synced=N/2, errors=N/2
  it('should correctly partition synced and errors when half of files fail', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-ok1', 'Ok1');
    await writeTestCardFile(tc.cardsDir, 'bulk-ok2', 'Ok2');
    await writeFile(join(tc.cardsDir, 'fail1.card.md'), 'BAD', 'utf-8');
    await writeFile(join(tc.cardsDir, 'fail2.card.md'), 'BAD', 'utf-8');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  // [ST-1] Same dir called twice → second call same synced count, no duplicate DB rows
  it('should produce same synced count and no duplicate rows when called twice', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'bulk-2x', 'Twice');
    const r1 = await bulkSyncCards(tc.ctx);
    const r2 = await bulkSyncCards(tc.ctx);
    expect(r1.synced).toBe(1);
    expect(r2.synced).toBe(1);
    expect(listCards(tc.ctx).filter((r) => r.key === 'bulk-2x')).toHaveLength(1);
  });

  // [ID-1] Repeated calls → no duplicate relation/keyword rows
  it('should not create duplicate relation rows when called multiple times', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'bulk-id-dst', summary: 'Dst' });
    const content = serializeCardMarkdown(
      { key: 'bulk-id-src', summary: 'Src', status: 'draft', relations: [{ type: 'depends-on', target: 'bulk-id-dst' }] },
      '',
    );
    await writeFile(join(tc.cardsDir, 'bulk-id-src.card.md'), content, 'utf-8');
    await bulkSyncCards(tc.ctx);
    await bulkSyncCards(tc.ctx);
    const rels = tc.ctx.relationRepo.findByCardKey('bulk-id-src').filter((r) => !r.isReverse);
    expect(rels).toHaveLength(1);
  });

  // [OR-1] First file fails but subsequent files continue processing
  it('should continue processing when the first file in the directory fails', async () => {
    tc = await createTestContext();
    // 'aaa' sorts before 'zzz'
    await writeFile(join(tc.cardsDir, 'aaa.card.md'), 'INVALID', 'utf-8');
    await writeTestCardFile(tc.cardsDir, 'zzz-ok', 'Ok');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(tc.ctx.cardRepo.findByKey('zzz-ok')).not.toBeNull();
  });

  // [OR-2] Non-contiguous failures (1st, 3rd) → errors collected accurately
  it('should collect non-contiguous failures accurately', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'a-fail.card.md'), 'BAD', 'utf-8');
    await writeTestCardFile(tc.cardsDir, 'b-pass', 'Pass');
    await writeFile(join(tc.cardsDir, 'c-fail.card.md'), 'BAD', 'utf-8');
    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(1);
    expect(result.errors).toHaveLength(2);
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

  // [HP-1] Files and DB perfectly in sync → all empty arrays
  it('should return all empty arrays when files and DB rows are perfectly in sync', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'val-sync', summary: 'S' });
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(0);
    expect(result.orphanFiles).toHaveLength(0);
    expect(result.keyMismatches).toHaveLength(0);
  });

  // [NE-1] Stale DB row (file missing) → included in staleDbRows
  it('should report DB row as stale when its file has been deleted', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'val-stale', summary: 'Stale' });
    await unlink(filePath);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows.some((r) => r.key === 'val-stale')).toBe(true);
  });

  // [NE-2] Orphan file (no DB row) → included in orphanFiles
  it('should report file as orphan when no corresponding DB row exists', async () => {
    tc = await createTestContext();
    const orphanPath = join(tc.cardsDir, 'orphan.card.md');
    await writeFile(
      orphanPath,
      serializeCardMarkdown({ key: 'orphan', summary: 'O', status: 'draft' }, ''),
      'utf-8',
    );
    const result = await validateCards(tc.ctx);
    expect(result.orphanFiles).toContain(orphanPath);
  });

  // [NE-3] Key mismatch → included in keyMismatches
  it('should report key mismatch when row key does not match filename-derived key', async () => {
    tc = await createTestContext();
    // file name 'mismatch-file.card.md' but frontmatter key 'different-key'
    const fp = join(tc.cardsDir, 'mismatch-file.card.md');
    await writeFile(
      fp,
      serializeCardMarkdown({ key: 'different-key', summary: 'M', status: 'draft' }, ''),
      'utf-8',
    );
    await syncCardFromFile(tc.ctx, fp);
    const result = await validateCards(tc.ctx);
    expect(result.keyMismatches.some((m) => m.row.key === 'different-key' && m.expectedKey === 'mismatch-file')).toBe(true);
  });

  // [ED-1] DB empty and no files → all empty arrays
  it('should return all empty arrays when DB is empty and directory is empty', async () => {
    tc = await createTestContext();
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(0);
    expect(result.orphanFiles).toHaveLength(0);
    expect(result.keyMismatches).toHaveLength(0);
  });

  // [ED-2] DB empty and 1 file → orphanFiles=[1]
  it('should report single orphan file when DB is empty but one file exists', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'solo-orphan', 'Orphan');
    const result = await validateCards(tc.ctx);
    expect(result.orphanFiles).toHaveLength(1);
    expect(result.staleDbRows).toHaveLength(0);
  });

  // [ED-3] 1 DB row and no file → staleDbRows=[1]
  it('should report single stale DB row when one row exists but its file is gone', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'solo-stale', summary: 'Stale' });
    await unlink(filePath);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(1);
    expect(result.orphanFiles).toHaveLength(0);
  });

  // [ED-4] stale+orphan+mismatch all occur simultaneously → each collected
  it('should detect stale, orphan, and mismatch issues simultaneously', async () => {
    tc = await createTestContext();
    // stale
    const { filePath: stalePath } = await createCard(tc.ctx, { slug: 'sim-stale', summary: 'Stale' });
    await unlink(stalePath);
    // orphan
    await writeTestCardFile(tc.cardsDir, 'sim-orphan', 'Orphan');
    // mismatch
    const mmPath = join(tc.cardsDir, 'sim-file.card.md');
    await writeFile(mmPath, serializeCardMarkdown({ key: 'sim-diff', summary: 'Mm', status: 'draft' }, ''), 'utf-8');
    await syncCardFromFile(tc.ctx, mmPath);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows.some((r) => r.key === 'sim-stale')).toBe(true);
    expect(result.orphanFiles.some((f) => f.includes('sim-orphan'))).toBe(true);
    expect(result.keyMismatches.some((m) => m.expectedKey === 'sim-file')).toBe(true);
  });

  // [CO-1] Multiple stale + multiple orphan + multiple mismatch simultaneously
  it('should handle multiple stale rows, orphan files, and mismatches simultaneously', async () => {
    tc = await createTestContext();
    const { filePath: s1 } = await createCard(tc.ctx, { slug: 'co-stale1', summary: 'S1' });
    const { filePath: s2 } = await createCard(tc.ctx, { slug: 'co-stale2', summary: 'S2' });
    await unlink(s1);
    await unlink(s2);
    await writeTestCardFile(tc.cardsDir, 'co-orphan1', 'O1');
    await writeTestCardFile(tc.cardsDir, 'co-orphan2', 'O2');
    const mm1 = join(tc.cardsDir, 'co-file1.card.md');
    const mm2 = join(tc.cardsDir, 'co-file2.card.md');
    await writeFile(mm1, serializeCardMarkdown({ key: 'co-diff1', summary: 'M1', status: 'draft' }, ''), 'utf-8');
    await writeFile(mm2, serializeCardMarkdown({ key: 'co-diff2', summary: 'M2', status: 'draft' }, ''), 'utf-8');
    await syncCardFromFile(tc.ctx, mm1);
    await syncCardFromFile(tc.ctx, mm2);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(2);
    expect(result.orphanFiles).toHaveLength(2);
    expect(result.keyMismatches).toHaveLength(2);
  });

  // [CO-2] orphanFiles only includes .card.md files (other extensions excluded)
  it('should not include non-.card.md files in orphanFiles', async () => {
    tc = await createTestContext();
    await writeFile(join(tc.cardsDir, 'readme.md'), '# readme', 'utf-8');
    await writeFile(join(tc.cardsDir, 'notes.txt'), 'notes', 'utf-8');
    const result = await validateCards(tc.ctx);
    expect(result.orphanFiles).toHaveLength(0);
  });

  // [ST-1] validateCards → bulkSyncCards → validateCards: second validate has orphans=0
  it('should report no orphans after bulkSyncCards resolves the orphan files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'st-orphan', 'Orphan');
    const before = await validateCards(tc.ctx);
    expect(before.orphanFiles).toHaveLength(1);
    await bulkSyncCards(tc.ctx);
    const after = await validateCards(tc.ctx);
    expect(after.orphanFiles).toHaveLength(0);
  });

  // [ST-2] validateCards does not modify DB/files (read-only)
  it('should not modify DB or files — validateCards is read-only', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'ro-orphan', 'Orphan');
    await validateCards(tc.ctx);
    // DB should still not have the row
    expect(tc.ctx.cardRepo.findByKey('ro-orphan')).toBeNull();
  });

  // [ST-3] bulkSyncCards N files → validateCards → orphans=0, stale=0
  it('should show no stale or orphan issues after bulkSync on a dir with N files', async () => {
    tc = await createTestContext();
    await writeTestCardFile(tc.cardsDir, 'sync-v1', 'V1');
    await writeTestCardFile(tc.cardsDir, 'sync-v2', 'V2');
    await writeTestCardFile(tc.cardsDir, 'sync-v3', 'V3');
    await bulkSyncCards(tc.ctx);
    const result = await validateCards(tc.ctx);
    expect(result.staleDbRows).toHaveLength(0);
    expect(result.orphanFiles).toHaveLength(0);
  });

  // [ID-1] Repeated validateCards calls → identical results
  it('should return identical results when called twice without any changes', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'id-val', summary: 'Id' });
    await unlink(filePath);
    const r1 = await validateCards(tc.ctx);
    const r2 = await validateCards(tc.ctx);
    expect(r1.staleDbRows.map((r) => r.key)).toEqual(r2.staleDbRows.map((r) => r.key));
  });

  // [ID-2] Even with mismatch, repeated validate returns same result (no modifications)
  it('should return the same keyMismatches on repeated calls', async () => {
    tc = await createTestContext();
    const mmPath = join(tc.cardsDir, 'id-file.card.md');
    await writeFile(mmPath, serializeCardMarkdown({ key: 'id-diff', summary: 'D', status: 'draft' }, ''), 'utf-8');
    await syncCardFromFile(tc.ctx, mmPath);
    const r1 = await validateCards(tc.ctx);
    const r2 = await validateCards(tc.ctx);
    expect(r1.keyMismatches.length).toBe(r2.keyMismatches.length);
  });
});

describe('exportCardToFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // [HP-1] Card with all fields → round-trip verification
  it('should restore all front-matter fields when round-tripping through DB and file', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-rt-tgt', summary: 'Target card' });
    const { filePath } = await createCard(tc.ctx, {
      slug: 'exp-rt-src',
      summary: 'Round-trip source',
      body: 'body content',
      keywords: ['kw1'],
      tags: ['tag1'],
      relations: [{ type: 'depends-on', target: 'exp-rt-tgt' }],
      codeLinks: [{ kind: 'function', file: 'src/foo.ts', symbol: 'foo' }],
      constraints: { maxSize: 100 },
    });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-rt-src');
    // Assert
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    expect(exportedPath).toBe(filePath);
    expect(parsed.frontmatter.key).toBe('exp-rt-src');
    expect(parsed.frontmatter.summary).toBe('Round-trip source');
    expect(parsed.body).toContain('body content');
    expect(parsed.frontmatter.keywords).toContain('kw1');
    expect(parsed.frontmatter.tags).toContain('tag1');
    expect(parsed.frontmatter.relations).toHaveLength(1);
    expect(parsed.frontmatter.codeLinks).toHaveLength(1);
  });

  // [HP-2] Only forward relations (isReverse=false) included in frontmatter.relations
  it('should include only forward (non-reverse) relations in the exported file', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-fwd-tgt', summary: 'Target' });
    await createCard(tc.ctx, {
      slug: 'exp-fwd-src',
      summary: 'Source',
      relations: [{ type: 'depends-on', target: 'exp-fwd-tgt' }],
    });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-fwd-src');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert: only forward relation is present
    expect(parsed.frontmatter.relations).toHaveLength(1);
    expect(parsed.frontmatter.relations![0]).toEqual({ type: 'depends-on', target: 'exp-fwd-tgt' });
  });

  // [HP-3] Keywords included
  it('should include keywords in the exported file when card has keywords', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-kw', summary: 'KW card', keywords: ['alpha', 'beta'] });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-kw');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert
    expect(parsed.frontmatter.keywords).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  // [HP-4] Tags included
  it('should include tags in the exported file when card has tags', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-tag', summary: 'Tag card', tags: ['release', 'v2'] });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-tag');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert
    expect(parsed.frontmatter.tags).toEqual(expect.arrayContaining(['release', 'v2']));
  });

  // [HP-5] codeLinks included
  it('should include codeLinks in the exported file when card has code links', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'exp-cl',
      summary: 'CL card',
      codeLinks: [{ kind: 'class', file: 'src/bar.ts', symbol: 'Bar' }],
    });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-cl');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert
    expect(parsed.frontmatter.codeLinks).toHaveLength(1);
    expect(parsed.frontmatter.codeLinks![0]!.symbol).toBe('Bar');
  });

  // [HP-6] constraintsJson → constraints included
  it('should include constraints in the exported file when card has constraintsJson', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'exp-con',
      summary: 'Constraint card',
      constraints: { maxRetries: 3 },
    });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-con');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert
    expect(parsed.frontmatter.constraints).toBeDefined();
    expect((parsed.frontmatter.constraints as Record<string, unknown>).maxRetries).toBe(3);
  });

  // [HP-7] Body content preserved + row.filePath returned
  it('should preserve the card body and return the correct file path', async () => {
    // Arrange
    tc = await createTestContext();
    const expected = '## Details\n\nSome notes here.';
    const { filePath } = await createCard(tc.ctx, {
      slug: 'exp-body',
      summary: 'Body card',
      body: expected,
    });
    // Act
    const returnedPath = await exportCardToFile(tc.ctx, 'exp-body');
    const text = await Bun.file(returnedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert
    expect(returnedPath).toBe(filePath);
    expect(parsed.body).toContain('## Details');
  });

  // [NE-8] Invalid fullKey → CardKeyError
  it('should throw CardKeyError when the key format is invalid', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(() => exportCardToFile(tc.ctx, '!!bad key!!')).toThrow(CardKeyError);
  });

  // [NE-9] Non-existent key → CardNotFoundError
  it('should throw CardNotFoundError when card does not exist in DB', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    await expect(exportCardToFile(tc.ctx, 'no-such-card')).rejects.toThrow(CardNotFoundError);
  });

  // [ED-10] Only isReverse=true relations → no frontmatter.relations
  it('should omit relations field when card only has incoming (reverse) relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-rev-tgt', summary: 'Reverse target' });
    await createCard(tc.ctx, {
      slug: 'exp-rev-src',
      summary: 'Reverse source',
      relations: [{ type: 'depends-on', target: 'exp-rev-tgt' }],
    });
    // Act: export the target card which only has a reverse mirror row
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-rev-tgt');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert: no relations in frontmatter (reverse rows filtered out)
    expect(parsed.frontmatter.relations).toBeUndefined();
  });

  // [CO-11] constraintsJson null + empty arrays → minimal frontmatter
  it('should export minimal front-matter with no optional fields when all are empty', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exp-min', summary: 'Minimal card' });
    // Act
    const exportedPath = await exportCardToFile(tc.ctx, 'exp-min');
    const text = await Bun.file(exportedPath).text();
    const parsed = parseCardMarkdown(text);
    // Assert: no optional fields
    expect(parsed.frontmatter.key).toBe('exp-min');
    expect(parsed.frontmatter.relations).toBeUndefined();
    expect(parsed.frontmatter.keywords).toBeUndefined();
    expect(parsed.frontmatter.tags).toBeUndefined();
    expect(parsed.frontmatter.codeLinks).toBeUndefined();
    expect(parsed.frontmatter.constraints).toBeUndefined();
  });
});
