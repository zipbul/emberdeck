import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

import { createCard, renameCard, updateCard, updateCardStatus } from '../../index';
import {
  CardAlreadyExistsError,
  CardKeyError,
  CardNotFoundError,
  CardRenameSamePathError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('renameCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should move file and update frontmatter key when rename succeeds', async () => {
    tc = await createTestContext();
    const { filePath: oldPath } = await createCard(tc.ctx, {
      key: 'old-name',
      summary: 'Old',
      type: 'spec',
    });
    const result = await renameCard(tc.ctx, 'old-name', 'new-name');
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(result.newFilePath)).toBe(true);
    expect(result.card.frontmatter.key).toBe('new-name');
  });

  it('should update DB key and filePath when rename succeeds', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'db-old', summary: 'DB old', type: 'spec' });
    await renameCard(tc.ctx, 'db-old', 'db-new');
    expect(tc.ctx.cardRepo.findByKey('db-old')).toBeNull();
    const newRow = tc.ctx.cardRepo.findByKey('db-new');
    expect(newRow).not.toBeNull();
    expect(newRow?.filePath).toContain('db-new.card.md');
  });

  it('should restore forward relations under new key after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rnm-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'rnm-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'rnm-src', {
      relations: ['rnm-dst'],
    });
    await renameCard(tc.ctx, 'rnm-src', 'rnm-src-new');
    const rows = tc.ctx.relationRepo.findByCardKey('rnm-src-new');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'rnm-dst')).toBe(true);
  });

  it('should restore tags under new key after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rnm-tag', summary: 'Tag', type: 'spec', tags: ['t1'] });
    await renameCard(tc.ctx, 'rnm-tag', 'rnm-tag-new');
    const tags = tc.ctx.classificationRepo.findTagsByCard('rnm-tag-new');
    expect(tags).toContain('t1');
  });

  it('should return { oldFilePath, newFilePath, newFullKey, card } with correct shape', async () => {
    tc = await createTestContext();
    const { filePath: oldPath } = await createCard(tc.ctx, {
      key: 'rnm-shape',
      summary: 'Shape',
      type: 'spec',
    });
    const result = await renameCard(tc.ctx, 'rnm-shape', 'rnm-shape-new');
    expect(result.oldFilePath).toBe(oldPath);
    expect(result.newFullKey).toBe('rnm-shape-new');
    expect(result.newFilePath).toContain('rnm-shape-new.card.md');
  });

  it('should create nested subdirectory automatically when renaming to nested key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'flat-slug', summary: 'Flat', type: 'spec' });
    const result = await renameCard(tc.ctx, 'flat-slug', 'nested/renamed');
    expect(existsSync(result.newFilePath)).toBe(true);
    expect(result.newFilePath).toContain('nested/renamed.card.md');
  });

  it('should create bidirectional reverse relation entries under new key after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bidi-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'bidi-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'bidi-src', {
      relations: ['bidi-dst'],
    });
    await renameCard(tc.ctx, 'bidi-src', 'bidi-src-new');
    const reverseRows = tc.ctx.relationRepo.findByCardKey('bidi-dst');
    expect(reverseRows.some((r) => r.isReverse && r.dstCardKey === 'bidi-src-new')).toBe(true);
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardRenameSamePathError when old and new paths are identical', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'same-slug', summary: 'Same', type: 'spec' });
    expect(renameCard(tc.ctx, 'same-slug', 'same-slug')).rejects.toBeInstanceOf(
      CardRenameSamePathError,
    );
  });

  it('should throw CardNotFoundError when source card does not exist', async () => {
    tc = await createTestContext();
    expect(renameCard(tc.ctx, 'ghost', 'target')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw CardAlreadyExistsError when target card already exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'src-conflict', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'dst-conflict', summary: 'Dst', type: 'spec' });
    expect(renameCard(tc.ctx, 'src-conflict', 'dst-conflict')).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });

  it('should throw CardKeyError when newKey is invalid', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'valid-src', summary: 'Valid', type: 'spec' });
    expect(renameCard(tc.ctx, 'valid-src', '')).rejects.toBeInstanceOf(CardKeyError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should rename card without errors when it has no relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'no-rel-rnm', summary: 'No rel', type: 'spec' });
    const result = await renameCard(tc.ctx, 'no-rel-rnm', 'no-rel-rnm-new');
    expect(tc.ctx.relationRepo.findByCardKey('no-rel-rnm-new')).toHaveLength(0);
    expect(existsSync(result.newFilePath)).toBe(true);
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should throw CardNotFoundError when source missing even if target exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'co-dst', summary: 'Dst exists', type: 'spec' });
    expect(renameCard(tc.ctx, 'co-src-missing', 'co-dst')).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should preserve relations and tags simultaneously after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'all-rnm-src', summary: 'All', type: 'spec' });
    await createCard(tc.ctx, { key: 'all-rnm-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'all-rnm-src', {
      relations: ['all-rnm-dst'],
      tags: ['tg'],
    });
    await renameCard(tc.ctx, 'all-rnm-src', 'all-rnm-new');
    expect(tc.ctx.relationRepo.findByCardKey('all-rnm-new').length).toBeGreaterThan(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('all-rnm-new')).toContain('tg');
  });

  // ── State Transition ───────────────────────────────────────────────────

  it('should confirm old file path no longer exists after rename', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { key: 'st-rnm-old', summary: 'Old', type: 'spec' });
    await renameCard(tc.ctx, 'st-rnm-old', 'st-rnm-new');
    expect(existsSync(filePath)).toBe(false);
  });

  it('should confirm new file path exists after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-new-old', summary: 'Old', type: 'spec' });
    const result = await renameCard(tc.ctx, 'st-new-old', 'st-new-new');
    expect(existsSync(result.newFilePath)).toBe(true);
  });

  it('should succeed on chained renames A then B then C', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'chain-a', summary: 'Chain A', type: 'spec' });
    await renameCard(tc.ctx, 'chain-a', 'chain-b');
    const result = await renameCard(tc.ctx, 'chain-b', 'chain-c');
    expect(result.newFullKey).toBe('chain-c');
    expect(tc.ctx.cardRepo.findByKey('chain-a')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('chain-b')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('chain-c')).not.toBeNull();
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should throw CardNotFoundError when re-renaming from old key after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'idp-rnm-src', summary: 'Idp', type: 'spec' });
    await renameCard(tc.ctx, 'idp-rnm-src', 'idp-rnm-dst');
    expect(renameCard(tc.ctx, 'idp-rnm-src', 'idp-rnm-dst2')).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should preserve body, status, and summary after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'preserve-all',
      summary: 'Preserved',
      type: 'spec',
      body: 'Body preserved',
    });
    const result = await renameCard(tc.ctx, 'preserve-all', 'preserve-all-new');
    expect(result.card.frontmatter.summary).toBe('Preserved');
    expect(result.card.body).toBe('Body preserved');
    expect(result.card.frontmatter.status).toBe('draft');
  });

  it('should have no old DB row and a valid new DB row after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'db-verify-old', summary: 'DB verify', type: 'spec' });
    await renameCard(tc.ctx, 'db-verify-old', 'db-verify-new');
    expect(tc.ctx.cardRepo.findByKey('db-verify-old')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('db-verify-new')).not.toBeNull();
  });

  // ── codeLink Preservation ─────────────────────────────────────────────

  it('should preserve single codeLink under new key when rename succeeds', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cl-single-old', summary: 'CL single', type: 'spec' });
    await updateCard(tc.ctx, 'cl-single-old', {
      codeLinks: [{ kind: 'function', file: 'src/foo.ts', symbol: 'myFn' }],
    });
    await renameCard(tc.ctx, 'cl-single-old', 'cl-single-new');
    const oldLinks = tc.ctx.codeLinkRepo.findByCardKey('cl-single-old');
    expect(oldLinks).toHaveLength(0);
    const newLinks = tc.ctx.codeLinkRepo.findByCardKey('cl-single-new');
    expect(newLinks).toHaveLength(1);
    expect(newLinks[0]!.kind).toBe('function');
    expect(newLinks[0]!.file).toBe('src/foo.ts');
    expect(newLinks[0]!.symbol).toBe('myFn');
  });

  it('should preserve type in DB after rename', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rnm-tp-src', summary: 'Type preserve', type: 'intent' });
    await renameCard(tc.ctx, 'rnm-tp-src', 'rnm-tp-dst');
    const row = tc.ctx.cardRepo.findByKey('rnm-tp-dst');
    expect(row).not.toBeNull();
    expect(row!.type).toBe('intent');
  });
});
