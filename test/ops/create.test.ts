import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

import { createCard } from '../../index';
import {
  CardAlreadyExistsError,
  CardKeyError,
  CardValidationError,
  RelationTypeError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

/** Default acceptance criteria for tests that don't care about acceptance content */
const AC = [{ id: 'ac-1', description: 'placeholder criterion', verified: false }];

describe('createCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should create file and DB card row when given minimal input', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'my-card', summary: 'My card', acceptance: AC });
    expect(existsSync(result.filePath)).toBe(true);
    expect(tc.ctx.cardRepo.findByKey('my-card')).not.toBeNull();
  });

  it('should save provided body to file when body is given', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      slug: 'with-body',
      summary: 'With body',
      acceptance: AC,
      body: 'Hello world',
    });
    expect(result.card.body).toBe('Hello world');
  });

  it('should save keywords to DB when keywords are provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'kw-card', summary: 'KW', acceptance: AC, keywords: ['alpha', 'beta'] });
    const kws = tc.ctx.classificationRepo.findKeywordsByCard('kw-card');
    expect(kws).toContain('alpha');
    expect(kws).toContain('beta');
  });

  it('should save tags to DB when tags are provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'tag-card', summary: 'TAG', acceptance: AC, tags: ['foo', 'bar'] });
    const tags = tc.ctx.classificationRepo.findTagsByCard('tag-card');
    expect(tags).toContain('foo');
    expect(tags).toContain('bar');
  });

  it('should create bidirectional DB relations when relations are provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'target-card', summary: 'Target', acceptance: AC });
    await createCard(tc.ctx, {
      slug: 'src-card',
      summary: 'Source',
      acceptance: AC,
      relations: [{ type: 'depends-on', target: 'target-card' }],
    });
    const rows = tc.ctx.relationRepo.findByCardKey('src-card');
    const forwardRow = rows.find((r) => !r.isReverse && r.dstCardKey === 'target-card');
    expect(forwardRow).not.toBeUndefined();
  });

  it('should create subdirectory automatically when slug contains path separator', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'a/b', summary: 'Nested', acceptance: AC });
    expect(existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toContain('a/b.card.md');
  });

  it('should return correct { filePath, fullKey, card } shape', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'shape-card', summary: 'Shape', acceptance: AC });
    expect(result.fullKey).toBe('shape-card');
    expect(result.filePath).toContain('shape-card.card.md');
    expect(result.card.frontmatter.key).toBe('shape-card');
  });

  it("should set status to 'draft' on newly created card", async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'draft-card', summary: 'Draft', acceptance: AC });
    expect(result.card.frontmatter.status).toBe('draft');
  });

  // ── Acceptance Required ─────────────────────────────────────────────────

  it('should throw CardValidationError when acceptance is missing', async () => {
    tc = await createTestContext();
    expect(
      createCard(tc.ctx, { slug: 'no-ac', summary: 'No AC' }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  it('should throw CardValidationError when acceptance is empty array', async () => {
    tc = await createTestContext();
    expect(
      createCard(tc.ctx, { slug: 'empty-ac', summary: 'Empty AC', acceptance: [] }),
    ).rejects.toBeInstanceOf(CardValidationError);
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError when slug already exists', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'dup-card', summary: 'First', acceptance: AC });
    expect(createCard(tc.ctx, { slug: 'dup-card', summary: 'Second', acceptance: AC })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });

  it('should throw RelationTypeError when relation type is not allowed', async () => {
    tc = await createTestContext({ allowedRelationTypes: ['related'] });
    expect(
      createCard(tc.ctx, {
        slug: 'rel-err',
        summary: 'RelErr',
        acceptance: AC,
        relations: [{ type: 'depends-on', target: 'other' }],
      }),
    ).rejects.toBeInstanceOf(RelationTypeError);
  });

  it('should throw CardKeyError when slug is empty string', async () => {
    tc = await createTestContext();
    expect(createCard(tc.ctx, { slug: '', summary: 'Empty', acceptance: AC })).rejects.toBeInstanceOf(
      CardKeyError,
    );
  });

  it('should throw CardKeyError when slug contains path traversal', async () => {
    tc = await createTestContext();
    expect(
      createCard(tc.ctx, { slug: '../evil', summary: 'Evil', acceptance: AC }),
    ).rejects.toBeInstanceOf(CardKeyError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it("should default body to empty string when body is undefined", async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'no-body', summary: 'No body', acceptance: AC });
    expect(result.card.body).toBe('');
  });

  it('should omit keywords field from frontmatter when keywords is empty array', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      slug: 'empty-kw',
      summary: 'Empty KW',
      acceptance: AC,
      keywords: [],
    });
    expect(result.card.frontmatter.keywords).toBeUndefined();
  });

  it('should omit tags field from frontmatter when tags is empty array', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      slug: 'empty-tags',
      summary: 'Empty tags',
      acceptance: AC,
      tags: [],
    });
    expect(result.card.frontmatter.tags).toBeUndefined();
  });

  it('should omit relations field from frontmatter when relations is empty array', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, {
      slug: 'empty-rels',
      summary: 'Empty rels',
      acceptance: AC,
      relations: [],
    });
    expect(result.card.frontmatter.relations).toBeUndefined();
  });

  it('should create card successfully when allowedRelationTypes is empty and no relations given', async () => {
    tc = await createTestContext({ allowedRelationTypes: [] });
    const result = await createCard(tc.ctx, { slug: 'no-rel-types', summary: 'OK', acceptance: AC });
    expect(existsSync(result.filePath)).toBe(true);
  });

  it('should use single character slug without error', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { slug: 'a', summary: 'Single', acceptance: AC });
    expect(result.fullKey).toBe('a');
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should not save any classification when keywords, tags, and relations are all empty arrays', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'all-empty',
      summary: 'All empty',
      acceptance: AC,
      keywords: [],
      tags: [],
      relations: [],
    });
    expect(tc.ctx.classificationRepo.findKeywordsByCard('all-empty')).toHaveLength(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('all-empty')).toHaveLength(0);
    expect(tc.ctx.relationRepo.findByCardKey('all-empty')).toHaveLength(0);
  });

  it('should throw RelationTypeError when allowedRelationTypes is empty and relations provided', async () => {
    tc = await createTestContext({ allowedRelationTypes: [] });
    expect(
      createCard(tc.ctx, {
        slug: 'no-allowed',
        summary: 'No allowed',
        acceptance: AC,
        relations: [{ type: 'related', target: 'other' }],
      }),
    ).rejects.toBeInstanceOf(RelationTypeError);
  });

  // ── State Transition ──────────────────────────────────────────────────

  it('should succeed on re-create after deleting same slug', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 're-create', summary: 'First', acceptance: AC });
    tc.ctx.cardRepo.deleteByKey('re-create');
    const { rm } = await import('node:fs/promises');
    const filePath = `${tc.cardsDir}/re-create.card.md`;
    await rm(filePath, { force: true });
    const result = await createCard(tc.ctx, { slug: 're-create', summary: 'Second', acceptance: AC });
    expect(existsSync(result.filePath)).toBe(true);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError on second call with same slug', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-card', summary: 'First', acceptance: AC });
    expect(createCard(tc.ctx, { slug: 'idp-card', summary: 'Again', acceptance: AC })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });
});

describe('createCard — codeLinks', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should persist codeLinks to DB when creating card with codeLinks', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'cr-cl',
      summary: 'CL',
      acceptance: AC,
      codeLinks: [{ kind: 'function', file: 'src/a.ts', symbol: 'myFunc' }],
    });
    const links = tc.ctx.codeLinkRepo.findByCardKey('cr-cl');
    expect(links).toHaveLength(1);
    expect(links[0]!.symbol).toBe('myFunc');
    expect(links[0]!.file).toBe('src/a.ts');
  });

  it('should not persist any codeLinks when creating card without codeLinks', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cr-nocl', summary: 'No CL', acceptance: AC });
    expect(tc.ctx.codeLinkRepo.findByCardKey('cr-nocl')).toHaveLength(0);
  });

  it('should not persist any codeLinks when creating card with empty codeLinks array', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'cr-emptycl', summary: 'Empty CL', acceptance: AC, codeLinks: [] });
    expect(tc.ctx.codeLinkRepo.findByCardKey('cr-emptycl')).toHaveLength(0);
  });

  // ── Constraints ────────────────────────────────────────────────────────

  it('should store constraints as JSON in DB when constraints object is provided', async () => {
    tc = await createTestContext();
    const constraints = { maxLength: 100, required: true };
    await createCard(tc.ctx, { slug: 'cst-card', summary: 'Cst', acceptance: AC, constraints });
    const row = tc.ctx.cardRepo.findByKey('cst-card');
    expect(row?.constraintsJson).toBe(JSON.stringify(constraints));
  });

  it('should set constraintsJson to null in DB when constraints is not provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-cst-card', summary: 'No cst', acceptance: AC });
    const row = tc.ctx.cardRepo.findByKey('no-cst-card');
    expect(row?.constraintsJson).toBeNull();
  });
});
