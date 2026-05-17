import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { createCard, deleteCard, updateCard } from '../../index';
import { CardNotFoundError } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('deleteCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should delete file and DB card row when card exists', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { key: 'del-card', summary: 'Del', type: 'spec' });
    await deleteCard(tc.ctx, 'del-card');
    expect(existsSync(filePath)).toBe(false);
    expect(tc.ctx.cardRepo.findByKey('del-card')).toBeNull();
  });

  it('should cascade-delete card_relation rows via FK when card with relations is deleted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'del-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'del-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'del-src', {
      relations: ['del-dst'],
    });
    await deleteCard(tc.ctx, 'del-src');
    expect(tc.ctx.relationRepo.findByCardKey('del-src')).toHaveLength(0);
  });

  it('should cascade-delete card_tag rows via FK when card is deleted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'del-cls',
      summary: 'Cls',
      type: 'spec',
      tags: ['tag1'],
    });
    await deleteCard(tc.ctx, 'del-cls');
    expect(tc.ctx.classificationRepo.findTagsByCard('del-cls')).toHaveLength(0);
  });

  it('should return { filePath } that matches the deleted file path', async () => {
    tc = await createTestContext();
    const { filePath: createdPath } = await createCard(tc.ctx, {
      key: 'del-ret',
      summary: 'Return',
      type: 'spec',
    });
    const result = await deleteCard(tc.ctx, 'del-ret');
    expect(result.filePath).toBe(createdPath);
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardNotFoundError when key does not exist', async () => {
    tc = await createTestContext();
    await expect(deleteCard(tc.ctx, 'ghost-del')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should delete nested key card and keep parent directory', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'nested/del', summary: 'Nested del', type: 'spec' });
    await deleteCard(tc.ctx, 'nested/del');
    const dir = join(tc.cardsDir, 'nested');
    expect(existsSync(dir)).toBe(true);
  });

  it('should skip cascade implicitly since FK on_delete handles it', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rel-del-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'rel-del-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'rel-del-src', {
      relations: ['rel-del-dst'],
    });
    await deleteCard(tc.ctx, 'rel-del-dst');
    const rows = tc.ctx.relationRepo.findByCardKey('rel-del-src');
    expect(rows.filter((r) => r.dstCardKey === 'rel-del-dst')).toHaveLength(0);
  });

  // ── State Transition ───────────────────────────────────────────────────

  it('should return false from existsByKey after card is deleted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'exists-del', summary: 'Exists del', type: 'spec' });
    await deleteCard(tc.ctx, 'exists-del');
    expect(tc.ctx.cardRepo.existsByKey('exists-del')).toBe(false);
  });

  it('should clean up DB records when card file was externally deleted', async () => {
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, {
      key: 'ext-del',
      summary: 'Externally deleted',
      type: 'spec',
    });
    // Simulate external deletion of the card file
    await unlink(filePath);
    expect(existsSync(filePath)).toBe(false);

    // deleteCard should still succeed and clean up the DB
    const result = await deleteCard(tc.ctx, 'ext-del');
    expect(result.filePath).toBe(filePath);
    expect(tc.ctx.cardRepo.findByKey('ext-del')).toBeNull();
    expect(tc.ctx.cardRepo.existsByKey('ext-del')).toBe(false);
  });

  it('should have zero relation rows after deleting card with relations', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-del-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'st-del-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'st-del-src', {
      relations: ['st-del-dst'],
    });
    await deleteCard(tc.ctx, 'st-del-src');
    expect(tc.ctx.relationRepo.findByCardKey('st-del-src')).toHaveLength(0);
  });

  it('returns detachedChildren and removedCrossDomainRefs as always-arrays (force=false leaf → empty)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'arrow', summary: 'Arrow', type: 'spec' });
    const r = await deleteCard(tc.ctx, 'arrow');
    expect(Array.isArray(r.detachedChildren)).toBe(true);
    expect(Array.isArray(r.removedCrossDomainRefs)).toBe(true);
    expect(r.detachedChildren).toEqual([]);
    expect(r.removedCrossDomainRefs).toEqual([]);
  });

  it('populates detachedChildren with child keys when --force detaches them', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'parent-x', summary: 'Parent', type: 'brief' });
    await createCard(tc.ctx, { key: 'parent-x/child-a', summary: 'A', type: 'spec', parent: 'parent-x' });
    await createCard(tc.ctx, { key: 'parent-x/child-b', summary: 'B', type: 'spec', parent: 'parent-x' });
    const r = await deleteCard(tc.ctx, 'parent-x', { force: true });
    expect(r.detachedChildren.sort()).toEqual(['parent-x/child-a', 'parent-x/child-b']);
    expect(r.removedCrossDomainRefs).toEqual([]);
  });

  // Regression: best-effort cascade failures used to be silently swallowed;
  // now they're collected into failedChildUpdates / failedRelationUpdates /
  // failedCrossDomainUpdates arrays so callers can surface them.
  it('returns failedChildUpdates / failedRelationUpdates / failedCrossDomainUpdates arrays on every call', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'leaf-card', summary: 'L', type: 'spec' });
    const r = await deleteCard(tc.ctx, 'leaf-card');
    expect(Array.isArray(r.failedChildUpdates)).toBe(true);
    expect(Array.isArray(r.failedRelationUpdates)).toBe(true);
    expect(Array.isArray(r.failedCrossDomainUpdates)).toBe(true);
    // Leaf with no force, no refs, no cross-domain deps → all three empty.
    expect(r.failedChildUpdates).toEqual([]);
    expect(r.failedRelationUpdates).toEqual([]);
    expect(r.failedCrossDomainUpdates).toEqual([]);
  });

  it('populates failedChildUpdates when a child file has been externally removed before force-delete', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gp', summary: 'GP', type: 'brief' });
    const child = await createCard(tc.ctx, { key: 'gp/child', summary: 'C', type: 'spec', parent: 'gp' });
    // Externally delete the child file so the parent-removal write fails inside
    // the best-effort cascade. The DB still detaches the child; the file write
    // failure should surface on failedChildUpdates rather than vanishing.
    unlinkSync(child.filePath);
    const r = await deleteCard(tc.ctx, 'gp', { force: true });
    expect(r.detachedChildren).toEqual(['gp/child']);
    expect(r.failedChildUpdates).toHaveLength(1);
    expect(r.failedChildUpdates[0]!.cardKey).toBe('gp/child');
    expect(typeof r.failedChildUpdates[0]!.reason).toBe('string');
  });
});
