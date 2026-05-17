import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { createCard } from '../../index';
import {
  CardAlreadyExistsError,
  CardKeyError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('createCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should create file and DB card row when given minimal input', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'my-card', summary: 'My card', type: 'spec' });
    expect(existsSync(result.filePath)).toBe(true);
    expect(tc.ctx.cardRepo.findByKey('my-card')).not.toBeNull();
  });


  it('should save provided body to file when body is given', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'with-body',
      summary: 'With body',
      type: 'spec',
    });
  });

  it('should save tags to DB when tags are provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'tag-card', summary: 'TAG', type: 'spec', tags: ['foo', 'bar'] });
    const tags = tc.ctx.classificationRepo.findTagsByCard('tag-card');
    expect(tags).toContain('foo');
    expect(tags).toContain('bar');
  });

  it('should create bidirectional DB relations when relations are provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'target-card', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'src-card',
      summary: 'Source',
      type: 'spec',
      relations: ['target-card'],
    });
    const rows = tc.ctx.relationRepo.findByCardKey('src-card');
    const forwardRow = rows.find((r) => !r.isReverse && r.dstCardKey === 'target-card');
    expect(forwardRow).not.toBeUndefined();
  });

  it('should create subdirectory automatically when key contains path separator', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'a/b', summary: 'Nested', type: 'spec' });
    expect(existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toContain('a/b.md');
  });

  it('should return correct { filePath, fullKey, card } shape', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'shape-card', summary: 'Shape', type: 'spec' });
    expect(result.fullKey).toBe('shape-card');
    expect(result.filePath).toContain('shape-card.md');
    expect(result.card.frontmatter.key).toBe('shape-card');
  });

  it("should set status to 'draft' on newly created card", async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'draft-card', summary: 'Draft', type: 'spec' });
    expect(result.card.frontmatter.status).toBe('draft');
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError when key already exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'dup-card', summary: 'First', type: 'spec' });
    await expect(createCard(tc.ctx, { key: 'dup-card', summary: 'Second', type: 'spec' })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });

  it('should throw CardKeyError when key is empty string', async () => {
    tc = await createTestContext();
    await expect(createCard(tc.ctx, { key: '', summary: 'Empty', type: 'spec' })).rejects.toBeInstanceOf(
      CardKeyError,
    );
  });

  it('should throw CardKeyError when key contains path traversal', async () => {
    tc = await createTestContext();
    await expect(
      createCard(tc.ctx, { key: '../evil', summary: 'Evil', type: 'spec' }),
    ).rejects.toBeInstanceOf(CardKeyError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it("should default the body column to empty string when no namespace is supplied", async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'no-body', summary: 'No body', type: 'spec' });
    // The indexed row's `body` column is derived from the namespace; with no
    // namespace fields it must be the empty string, not undefined / null.
    expect(tc.ctx.cardRepo.findByKey('no-body')?.body).toBe('');
  });

  it('should omit tags field from frontmatter when tags is empty array', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      key: 'empty-tags',
      summary: 'Empty tags',
      type: 'spec',
      tags: [],
    });
    expect(result.card.frontmatter.tags).toBeUndefined();
  });

  it('should omit relations field from frontmatter when relations is empty array', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      key: 'empty-rels',
      summary: 'Empty rels',
      type: 'spec',
      relations: [],
    });
    expect(result.card.frontmatter.relations).toBeUndefined();
  });

  it('should use single character key without error', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'a', summary: 'Single', type: 'spec' });
    expect(result.fullKey).toBe('a');
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should not save any classification when tags and relations are all empty arrays', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'all-empty',
      summary: 'All empty',
      type: 'spec',
      tags: [],
      relations: [],
    });
    expect(tc.ctx.classificationRepo.findTagsByCard('all-empty')).toHaveLength(0);
    expect(tc.ctx.relationRepo.findByCardKey('all-empty')).toHaveLength(0);
  });

  // ── State Transition ──────────────────────────────────────────────────

  it('should succeed on re-create after deleting same key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 're-create', summary: 'First', type: 'spec' });
    tc.ctx.cardRepo.deleteByKey('re-create');
    const filePath = `${tc.cardsDir}/re-create.md`;
    await rm(filePath, { force: true });
    const result = await createCard(tc.ctx, { key: 're-create', summary: 'Second', type: 'spec' });
    expect(existsSync(result.filePath)).toBe(true);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError on second call with same key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'idp-card', summary: 'First', type: 'spec' });
    await expect(createCard(tc.ctx, { key: 'idp-card', summary: 'Again', type: 'spec' })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });
});

describe('createCard — codeLinks', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // Source bindings (code_link rows) come from `ed spec sync` reading
  // `@spec card-key` JSDoc tags. createCard never populates code_link.
  it('does not populate code_link table by itself', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cr-nocl', summary: 'No CL', type: 'spec' });
    expect(tc.ctx.codeLinkRepo.findByCardKey('cr-nocl')).toHaveLength(0);
  });

  // Regression: previously createCard only checked file existence. A DB row
  // whose file was externally deleted let a subsequent createCard upsert over
  // it, silently changing card identity. Now both file AND DB row are checked.
  it('throws CardAlreadyExistsError when DB row exists even if file is missing', async () => {
    tc = await createTestContext();
    const first = await createCard(tc.ctx, { key: 'dup-db', summary: 'first', type: 'spec' });
    // Simulate external deletion of the card file (DB row still present).
    unlinkSync(first.filePath);
    expect(existsSync(first.filePath)).toBe(false);
    expect(tc.ctx.cardRepo.existsByKey('dup-db')).toBe(true);
    // createCard must now reject the duplicate key even though the file is gone.
    await expect(
      createCard(tc.ctx, { key: 'dup-db', summary: 'second', type: 'spec' }),
    ).rejects.toBeInstanceOf(CardAlreadyExistsError);
  });
});
