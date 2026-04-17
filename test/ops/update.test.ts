import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import { createCard, updateCard, updateCardStatus } from '../../index';
import {
  CardNotFoundError,
  CardValidationError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('updateCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should update summary in file and DB when summary field is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-summary', summary: 'Old', type: 'spec' });
    await updateCard(tc.ctx, 'upd-summary', { summary: 'New summary' });
    const row = tc.ctx.cardRepo.findByKey('upd-summary');
    expect(row?.summary).toBe('New summary');
  });

  it('should update body in file when body field is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-body', summary: 'Body test', type: 'spec', body: 'old body' });
    const result = await updateCard(tc.ctx, 'upd-body', { body: 'new body' });
    expect(result.card.body).toBe('new body');
  });

  it('should replace tags in DB when tags array is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-tag', summary: 'Tag', type: 'spec', tags: ['x'] });
    await updateCard(tc.ctx, 'upd-tag', { tags: ['y', 'z'] });
    const tags = tc.ctx.classificationRepo.findTagsByCard('upd-tag');
    expect(tags).not.toContain('x');
    expect(tags).toContain('y');
  });

  it('should replace relations in DB when relations array is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-rel-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'upd-rel-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'upd-rel-src', {
      relations: ['upd-rel-dst'],
    });
    const rows = tc.ctx.relationRepo.findByCardKey('upd-rel-src');
    expect(rows.some((r) => r.dstCardKey === 'upd-rel-dst' && !r.isReverse)).toBe(true);
  });

  it('should update multiple fields simultaneously when several fields provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-multi', summary: 'Multi', type: 'spec' });
    const result = await updateCard(tc.ctx, 'upd-multi', {
      summary: 'Updated multi',
      body: 'updated body',
    });
    expect(result.card.frontmatter.summary).toBe('Updated multi');
    expect(result.card.body).toBe('updated body');
  });

  it('should return { filePath, card } with correct shape', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-shape', summary: 'Shape', type: 'spec' });
    const result = await updateCard(tc.ctx, 'upd-shape', { summary: 'Updated shape' });
    expect(result.filePath).toContain('upd-shape.card.md');
    expect(result.card.frontmatter.key).toBe('upd-shape');
  });

  it('should preserve existing fields when empty fields object is provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-nop', summary: 'No change', type: 'spec', body: 'preserved' });
    const result = await updateCard(tc.ctx, 'upd-nop', {});
    expect(result.card.frontmatter.summary).toBe('No change');
    expect(result.card.body).toBe('preserved');
  });

  it('should preserve existing body when body field is not in update fields', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-body-prsv', summary: 'Preserve', type: 'spec', body: 'keep me' });
    const result = await updateCard(tc.ctx, 'upd-body-prsv', { summary: 'Changed' });
    expect(result.card.body).toBe('keep me');
  });

  it('should update status in DB when updateCardStatus is called', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-card', summary: 'Status', type: 'brief' });
    await updateCardStatus(tc.ctx, 'st-card', 'active');
    const row = tc.ctx.cardRepo.findByKey('st-card');
    expect(row?.status).toBe('active');
  });

  it('should update status in file frontmatter when updateCardStatus is called', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-file', summary: 'Status file', type: 'brief' });
    const result = await updateCardStatus(tc.ctx, 'st-file', 'active');
    expect(result.card.frontmatter.status).toBe('active');
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardNotFoundError when key does not exist', async () => {
    tc = await createTestContext();
    expect(updateCard(tc.ctx, 'nonexistent', { summary: 'X' })).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should throw CardNotFoundError when file exists but frontmatter.key mismatches in updateCard', async () => {
    tc = await createTestContext();
    const wrongPath = join(tc.ctx.cardsDir, 'mismatch-upd.card.md');
    await Bun.write(wrongPath, '---\nkey: different-key\nsummary: s\nstatus: draft\ntype: spec\n---\n');
    await expect(
      updateCard(tc.ctx, 'mismatch-upd', { summary: 'X' }),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw CardNotFoundError when file exists but frontmatter.key mismatches in updateCardStatus', async () => {
    tc = await createTestContext();
    const wrongPath = join(tc.ctx.cardsDir, 'mismatch-st.card.md');
    await Bun.write(wrongPath, '---\nkey: different-key\nsummary: s\nstatus: draft\ntype: spec\n---\n');
    await expect(
      updateCardStatus(tc.ctx, 'mismatch-st', 'active'),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw CardNotFoundError when updateCardStatus key does not exist', async () => {
    tc = await createTestContext();
    expect(
      updateCardStatus(tc.ctx, 'ghost-card', 'active'),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should remove tags from DB when tags is null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'tag-null', summary: 'Tag null', type: 'spec', tags: ['y'] });
    await updateCard(tc.ctx, 'tag-null', { tags: null });
    expect(tc.ctx.classificationRepo.findTagsByCard('tag-null')).toHaveLength(0);
  });

  it('should remove relations from DB when relations is null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rel-null-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'rel-null-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'rel-null-src', {
      relations: ['rel-null-dst'],
    });
    await updateCard(tc.ctx, 'rel-null-src', { relations: null });
    expect(tc.ctx.relationRepo.findByCardKey('rel-null-src')).toHaveLength(0);
  });

  it('should remove relations from DB when relations is empty array', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'rel-empty-src', summary: 'Src', type: 'spec' });
    await createCard(tc.ctx, { key: 'rel-empty-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'rel-empty-src', {
      relations: ['rel-empty-dst'],
    });
    await updateCard(tc.ctx, 'rel-empty-src', { relations: [] });
    expect(tc.ctx.relationRepo.findByCardKey('rel-empty-src')).toHaveLength(0);
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should remove all classifications when tags and relations are all null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'all-null-src', summary: 'All null', type: 'spec' });
    await createCard(tc.ctx, { key: 'all-null-dst', summary: 'Dst', type: 'spec' });
    await updateCard(tc.ctx, 'all-null-src', {
      tags: ['b'],
      relations: ['all-null-dst'],
    });
    await updateCard(tc.ctx, 'all-null-src', {
      tags: null,
      relations: null,
    });
    expect(tc.ctx.classificationRepo.findTagsByCard('all-null-src')).toHaveLength(0);
    expect(tc.ctx.relationRepo.findByCardKey('all-null-src')).toHaveLength(0);
  });

  it('should update DB row and file when updateCardStatus is called while DB row is missing', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'st-no-db', summary: 'No DB', type: 'brief' });
    tc.ctx.cardRepo.deleteByKey('st-no-db');
    const result = await updateCardStatus(tc.ctx, 'st-no-db', 'active');
    expect(result.card.frontmatter.status).toBe('active');
    const row = tc.ctx.cardRepo.findByKey('st-no-db');
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.key).toBe('st-no-db');
    expect(row?.summary).toBe('No DB');
  });

  // ── State Transition ──────────────────────────────────────────────────

  it('should reflect latest value after multiple consecutive updates', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'multi-upd', summary: 'First', type: 'spec' });
    await updateCard(tc.ctx, 'multi-upd', { summary: 'Second' });
    await updateCard(tc.ctx, 'multi-upd', { summary: 'Third' });
    const row = tc.ctx.cardRepo.findByKey('multi-upd');
    expect(row?.summary).toBe('Third');
  });

  it('should reflect latest status after multiple status transitions', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'multi-st', summary: 'Status', type: 'brief' });
    await updateCardStatus(tc.ctx, 'multi-st', 'active');
    await updateCardStatus(tc.ctx, 'multi-st', 'drifted');
    const row = tc.ctx.cardRepo.findByKey('multi-st');
    expect(row?.status).toBe('drifted');
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should produce identical result when same update is applied twice', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'idp-upd', summary: 'Idempotent', type: 'spec' });
    await updateCard(tc.ctx, 'idp-upd', { summary: 'Same summary' });
    const result = await updateCard(tc.ctx, 'idp-upd', { summary: 'Same summary' });
    expect(result.card.frontmatter.summary).toBe('Same summary');
    expect(tc.ctx.cardRepo.findByKey('idp-upd')?.summary).toBe('Same summary');
  });
});

describe('updateCard — bodyPatches', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should apply a single patch to the body', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-single', summary: 'Patch', type: 'spec', body: '## Contracts\n- WHEN A THEN B\n- WHEN C THEN D' });
    const result = await updateCard(tc.ctx, 'bp-single', {
      bodyPatches: [{ old: 'WHEN A THEN B', new: 'WHEN A THEN X' }],
    });
    expect(result.card.body).toContain('WHEN A THEN X');
    expect(result.card.body).toContain('WHEN C THEN D');
  });

  it('should apply multiple patches sequentially', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-multi', summary: 'Multi', type: 'spec', body: 'alpha beta gamma' });
    const result = await updateCard(tc.ctx, 'bp-multi', {
      bodyPatches: [
        { old: 'alpha', new: 'ALPHA' },
        { old: 'gamma', new: 'GAMMA' },
      ],
    });
    expect(result.card.body).toBe('ALPHA beta GAMMA');
  });

  it('should throw when old text is not found in body', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-miss', summary: 'Miss', type: 'spec', body: 'hello world' });
    await expect(
      updateCard(tc.ctx, 'bp-miss', { bodyPatches: [{ old: 'nonexistent', new: 'x' }] }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('should throw when old text appears more than once', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-dup', summary: 'Dup', type: 'spec', body: 'foo bar foo' });
    await expect(
      updateCard(tc.ctx, 'bp-dup', { bodyPatches: [{ old: 'foo', new: 'baz' }] }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('should throw when body and bodyPatches are both provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-conflict', summary: 'Conflict', type: 'spec', body: 'text' });
    await expect(
      updateCard(tc.ctx, 'bp-conflict', { body: 'new', bodyPatches: [{ old: 'text', new: 'x' }] }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('should persist patched body to DB and file', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-persist', summary: 'Persist', type: 'spec', body: 'old content here' });
    await updateCard(tc.ctx, 'bp-persist', { bodyPatches: [{ old: 'old content', new: 'new content' }] });
    const row = tc.ctx.cardRepo.findByKey('bp-persist');
    expect(row?.body).toBe('new content here');
  });

  it('should preserve dollar signs in replacement text literally', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-dollar', summary: 'Dollar', type: 'spec', body: 'price is X' });
    const result = await updateCard(tc.ctx, 'bp-dollar', {
      bodyPatches: [{ old: 'price is X', new: 'price is $100' }],
    });
    expect(result.card.body).toBe('price is $100');
  });

  it('should allow second patch to target text created by first patch', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'bp-chain', summary: 'Chain', type: 'spec', body: 'aaa bbb' });
    const result = await updateCard(tc.ctx, 'bp-chain', {
      bodyPatches: [
        { old: 'aaa', new: 'ccc' },
        { old: 'ccc bbb', new: 'done' },
      ],
    });
    expect(result.card.body).toBe('done');
  });
});

describe('updateCard — codeLinks', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should persist codeLinks to DB when updating card with codeLinks field', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-cl', summary: 'CL', type: 'spec' });
    await updateCard(tc.ctx, 'upd-cl', { codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }] });
    const links = tc.ctx.codeLinkRepo.findByCardKey('upd-cl');
    expect(links).toHaveLength(1);
    expect(links[0]!.symbol).toBe('myFunc');
  });

  it('should remove codeLinks from DB when updating with codeLinks: null', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-cl-null', summary: 'CL Null', type: 'spec', codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }] });
    await updateCard(tc.ctx, 'upd-cl-null', { codeLinks: null });
    expect(tc.ctx.codeLinkRepo.findByCardKey('upd-cl-null')).toHaveLength(0);
  });

  it('should remove codeLinks from DB when updating with empty codeLinks array', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-cl-empty', summary: 'CL Empty', type: 'spec', codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }] });
    await updateCard(tc.ctx, 'upd-cl-empty', { codeLinks: [] });
    expect(tc.ctx.codeLinkRepo.findByCardKey('upd-cl-empty')).toHaveLength(0);
  });

  it('should not modify codeLinks in DB when updating without codeLinks field', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'upd-cl-skip', summary: 'CL Skip', type: 'spec', codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }] });
    await updateCard(tc.ctx, 'upd-cl-skip', { summary: 'Updated summary' });
    const links = tc.ctx.codeLinkRepo.findByCardKey('upd-cl-skip');
    expect(links).toHaveLength(1);
  });
});
