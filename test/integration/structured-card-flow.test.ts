/**
 * E2E: structured card path (file → parse → DB sync → activation → search)
 *
 * Covers the modern namespace-based workflow:
 *  1. Write a card file with `principle:` / `brief:` / `spec:` namespace.
 *  2. syncCardFromFile parses + validates structure (parser-level).
 *  3. Activation guard validates cross-refs.
 *  4. FTS5 search returns matches against namespace content.
 */
import { describe, expect, it, afterEach } from 'bun:test';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertRejects,
  createTestContext,
  ensure4tierScaffold,
  makeTestBrief,
  makeTestSpec,
  makeTestPrinciple,
  type TestContext,
} from '../helpers';
import { ActivationGuardError } from '../../src/card/errors';
import { syncCardFromFile, bulkSyncCards } from '../../src/ops/sync';
import { createCard } from '../../src/ops/create';
import { updateCard, updateCardStatus } from '../../src/ops/update';
import { serializeCard } from '../../src/card/serialize';

let tc: TestContext;

afterEach(async () => {
  if (tc) await tc.cleanup();
});

describe('Structured card flow E2E', () => {
  it('creates principle via file write + sync, then activates', async () => {
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'pr.md');
    const md = serializeCard(
      {
        key: 'pr',
        summary: 'Test principle',
        type: 'principle',
        status: 'draft',
        principle: makeTestPrinciple(),
      },
    );
    await writeFile(filePath, md);

    await syncCardFromFile(tc.ctx, filePath);
    const row = tc.ctx.cardRepo.findByKey('pr');
    expect(row?.type).toBe('principle');

    // Activate via updateCardStatus
    await updateCardStatus(tc.ctx, 'pr', 'active');
    const after = tc.ctx.cardRepo.findByKey('pr');
    expect(after?.status).toBe('active');
  });

  it('rejects activating a brief without brief namespace', async () => {
    tc = await createTestContext();
    await ensure4tierScaffold(tc.ctx);

    // createCard without brief namespace, draft → ok
    await createCard(tc.ctx, {
      key: 'b1',
      summary: 'partial',
      type: 'brief',
      status: 'draft',
      parent: '_dom',
    });

    const err = await assertRejects(
      updateCardStatus(tc.ctx, 'b1', 'active'),
      ActivationGuardError,
    );
    expect(err.unmetConditions).toEqual(expect.arrayContaining([expect.stringMatching(/brief.*namespace/)]));
  });

  it('activates brief with valid namespace and bad refs are caught', async () => {
    tc = await createTestContext();
    await ensure4tierScaffold(tc.ctx);

    const goodBrief = makeTestBrief();
    await createCard(tc.ctx, {
      key: 'b2',
      summary: 'good',
      type: 'brief',
      status: 'active',
      parent: '_dom',
      brief: goodBrief,
    });

    // Update with broken cross-ref → reject on activation re-check
    const broken = makeTestBrief();
    broken.flow[0]!.covers = ['G-999']; // unknown goal

    const err = await assertRejects(
      updateCard(tc.ctx, 'b2', { brief: broken, status: 'active' }),
      ActivationGuardError,
    );
    expect(err.unmetConditions).toEqual(expect.arrayContaining([expect.stringMatching(/G-999/)]));
  });

  it('activates spec with namespace and binds match codeLinks', async () => {
    tc = await createTestContext();
    await ensure4tierScaffold(tc.ctx);

    // Create a parent brief first (requires domain parent)
    await createCard(tc.ctx, {
      key: 'parent',
      summary: 'parent brief',
      type: 'brief',
      status: 'active',
      parent: '_dom',
      brief: makeTestBrief(),
    });

    const codeLinks = [{ kind: 'function', file: 'src/x.ts', symbol: 'doX' }];
    const spec = makeTestSpec('src/x.ts', 'doX');
    spec.preconditions[0]!.derives = 'parent#R-001';
    spec.postconditions[0]!.derives = 'parent#R-001';

    void codeLinks;
    await createCard(tc.ctx, {
      key: 'parent/s1',
      summary: 'spec under parent',
      type: 'spec',
      status: 'active',
      parent: 'parent',
      relations: ['parent'],
      spec,
    });

    const row = tc.ctx.cardRepo.findByKey('parent/s1');
    expect(row?.status).toBe('active');
  });

  // `binds` was removed from spec subitems — source bindings live in code only.

  it('FTS5 search finds card by namespace content', async () => {
    tc = await createTestContext();
    const brief = makeTestBrief();
    brief.context.problem = 'unique-problem-keyword-zebra';
    await createCard(tc.ctx, {
      key: 'searchable',
      summary: 'fts test',
      type: 'brief',
      status: 'draft',
      brief,
    });

    const results = tc.ctx.cardRepo.search('zebra');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.key === 'searchable')).toBe(true);
  });

  it('FTS5 search finds domain card by overview/scope text', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'searchable-domain',
      summary: 'd',
      type: 'domain',
      status: 'draft',
      domain: {
        overview: 'unique-domain-keyword-aurora',
        scope: 'covers something',
      },
    });

    const results = tc.ctx.cardRepo.search('aurora');
    expect(results.some((r) => r.key === 'searchable-domain')).toBe(true);
  });

  it('bulkSyncCards processes a directory of structured cards', async () => {
    tc = await createTestContext();
    const sub = join(tc.cardsDir, 'group');
    await mkdir(sub, { recursive: true });

    const md1 = serializeCard(
      { key: 'group/a', summary: 'a', type: 'brief', status: 'draft', brief: makeTestBrief() },
    );
    const md2 = serializeCard(
      { key: 'group/b', summary: 'b', type: 'brief', status: 'draft', brief: makeTestBrief() },
    );
    await writeFile(join(sub, 'a.md'), md1);
    await writeFile(join(sub, 'b.md'), md2);

    const result = await bulkSyncCards(tc.ctx);
    expect(result.synced).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(tc.ctx.cardRepo.findByKey('group/a')).toBeTruthy();
    expect(tc.ctx.cardRepo.findByKey('group/b')).toBeTruthy();
  });
});
