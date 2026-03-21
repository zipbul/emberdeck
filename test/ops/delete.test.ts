import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

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
    expect(deleteCard(tc.ctx, 'ghost-del')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should delete nested key card and keep parent directory', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'nested/del', summary: 'Nested del', type: 'spec' });
    await deleteCard(tc.ctx, 'nested/del');
    const { join } = await import('node:path');
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
});
