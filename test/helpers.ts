import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../index';
import { createEmberdeckDb, closeDb } from '../src/db/connection';
import { DrizzleCardRepository } from '../src/db/card-repo';
import { DrizzleRelationRepository } from '../src/db/relation-repo';
import { DrizzleClassificationRepository } from '../src/db/classification-repo';
import { DrizzleCodeLinkRepository } from '../src/db/code-link-repo';
import { DrizzleChangelogRepository } from '../src/db/changelog-repo';
import { mockGildash } from './fixtures/gildash';
import { createCard } from '../src/ops/create';
import type {
  BriefBody,
  CodeLink,
  PrincipleBody,
  SpecBody,
} from '../src/card/types';

/**
 * Populate the code_link table directly for a card key. Source bindings are
 * the SoT (populated by `ed spec sync` from `@spec card-key` annotations),
 * but tests can pre-populate via this helper to focus on downstream behavior.
 */
export function setCardCodeLinks(ctx: EmberdeckContext, cardKey: string, links: CodeLink[]): void {
  ctx.codeLinkRepo.replaceForCard(cardKey, links);
}

export interface TestContext {
  ctx: EmberdeckContext;
  cardsDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Assert that a promise rejects with a specific error class, and return the
 * typed error for further assertions.
 *
 * Why this exists:
 *   - `expect(p).rejects.toBeInstanceOf(Class)` runs the assertion but
 *     bun:test's types don't model `.rejects` as a Promise, so awaiting it
 *     triggers TS2362-ish "await has no effect" warnings.
 *   - `expect(p).rejects.toThrow(objectContaining({name: 'X'}))` matches on
 *     the name string, NOT the constructor — an unrelated class with the
 *     same `name` field would pass.
 *   - The try/catch + expect.unreachable pattern is verbose AND silently
 *     passes if the wrong error class is thrown (test name lies about what
 *     it locks in).
 *
 * This helper does one thing: assert real `instanceof`, return typed error
 * for downstream property assertions. Use AAA structure:
 *
 *   // Act
 *   const err = await assertRejects(sut(...), ActivationGuardError);
 *   // Assert
 *   expect(err.unmetConditions).toEqual(expect.arrayContaining([...]));
 */
export async function assertRejects<E extends Error>(
  promise: Promise<unknown>,
  errorClass: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof errorClass) return e;
    throw new Error(
      `assertRejects: expected ${errorClass.name} but got ${(e as Error)?.constructor?.name ?? typeof e}: ${(e as Error)?.message ?? String(e)}`,
    );
  }
  throw new Error(`assertRejects: expected ${errorClass.name} but promise resolved`);
}

/**
 * Higher-order helper that guarantees TestContext cleanup runs even when the
 * test body or the setup factory throws mid-way.
 *
 * Use instead of the `let tc: TestContext` + `afterEach(() => tc?.cleanup())`
 * pattern when you need the partial-setup-leak protection: if `factory()`
 * throws after creating some side effects (tmp dir, open DB handle), the
 * partially-built context is still passed to `cleanup` so resources are not
 * orphaned. The plain `?.cleanup()` pattern silently skips cleanup when
 * `factory` throws.
 *
 * @example
 *   it('does X', async () => {
 *     await withTestContext(createTestContext, async (tc) => {
 *       const result = await doX(tc.ctx);
 *       expect(result).toBe(true);
 *     });
 *   });
 */
export async function withTestContext(
  factory: () => Promise<TestContext>,
  fn: (tc: TestContext) => Promise<void>,
): Promise<void> {
  let tc: TestContext | undefined;
  try {
    tc = await factory();
    await fn(tc);
  } finally {
    if (tc) {
      try {
        await tc.cleanup();
      } catch {
        // Cleanup-best-effort: the original test error (if any) is the one
        // worth surfacing; cleanup errors here would mask it.
      }
    }
  }
}

/**
 * Minimal valid `principle` namespace body for activation tests.
 */
export function makeTestPrinciple(): PrincipleBody {
  return {
    statement: 'System MUST do X for test invariance.',
    rationale: 'Test rationale explaining why X is required.',
    applies_to: '*',
    enforcement: 'blocking',
  };
}

/**
 * Minimal valid `brief` namespace body that passes validateBriefRefs.
 */
export function makeTestBrief(): BriefBody {
  return {
    context: { problem: 'test problem', impact: [{ statement: 'test impact' }] },
    scope: {
      goals: [{ id: 'G-001', statement: 'test goal' }],
      non_goals: [],
      assumptions: [],
    },
    flow: [
      { id: 'S-H-01', kind: 'happy', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
      { id: 'S-F-01', kind: 'failure', given: 'a', when: 'b', then: 'c', covers: ['G-001'] },
    ],
    design: { overview: 'test design', components: [], data_flow: [], invariants: [] },
    policy: [
      { id: 'R-001', subject: 's', keyword: 'MUST', predicate: 'p', governs: ['S-H-01', 'S-F-01'] },
    ],
    external: [{ id: 'C-001', statement: 's', reference: { title: 't', locator: 'l' } }],
    compatibility: { guarantees: [] },
    limits: [],
    criteria: [
      { id: 'SC-001', type: 'binary', measure: { predicate: 'p' }, verifies: ['S-H-01', 'S-F-01'] },
    ],
    rationale: {
      alternatives: [
        { option: 'A', pros: ['p'], cons: ['c'] },
        { option: 'B', pros: ['p'], cons: ['c'] },
      ],
      chosen: { option: 'A', reasoning: 'r' },
      addresses: ['C-001'],
    },
  };
}

/**
 * Minimal valid `spec` namespace body for tests.
 * Binding to source is via `@spec card-key` annotations — not declared here.
 */
export function makeTestSpec(_file?: string, _symbol?: string): SpecBody {
  return {
    preconditions: [
      { id: 'PRE-001', condition: 'c', derives: 'parent#R-001' },
    ],
    postconditions: [
      { id: 'POST-001', guarantee: 'g', keyword: 'MUST', derives: 'parent#R-001' },
    ],
    invariants: [
      { id: 'INV-001', statement: 's', always_holds: 'per-call' },
    ],
    failures: [
      { violation: 'v', behavior: 'b' },
    ],
  };
}

/**
 * Filler body strings for tests. Body is free-form prose now (canonical
 * structure lives in frontmatter.brief / frontmatter.spec namespaces),
 * so these constants are just non-empty content for round-trip / FTS5
 * coverage. They no longer encode any required section structure.
 *
 * Kept under their original names to avoid churn across ~60 test sites.
 */
export const BRIEF_BODY = '## Notes\n\nTest brief filler body. Structure lives in frontmatter.brief namespace.';
export const SPEC_BODY = '## Notes\n\nTest spec filler body. Structure lives in frontmatter.spec namespace.';

/**
 * 4-tier scaffolding helper: ensure a draft domain (and optionally brief) exists
 * so that active brief/spec creation passes the activation guard's parent check.
 *
 * Usage:
 *   const { domain } = await ensure4tierScaffold(tc.ctx);             // creates draft domain
 *   const { domain, brief } = await ensure4tierScaffold(tc.ctx, true); // also creates draft brief
 *
 * Returns the keys of created scaffolding so tests can use them as parent= values.
 */
export async function ensure4tierScaffold(
  ctx: import('../src/config').EmberdeckContext,
  withBrief = false,
  domainKey = '_dom',
  briefKey = '_br',
): Promise<{ domain: string; brief?: string }> {
  if (!ctx.cardRepo.findByKey(domainKey)) {
    await createCard(ctx, { key: domainKey, summary: 'scaffold domain', type: 'domain' });
  }
  if (withBrief && !ctx.cardRepo.findByKey(briefKey)) {
    await createCard(ctx, {
      key: briefKey,
      summary: 'scaffold brief',
      type: 'brief',
      parent: domainKey,
    });
  }
  return withBrief ? { domain: domainKey, brief: briefKey } : { domain: domainKey };
}

/**
 * Default test context. Spins up a real `Gildash.open` against a tmp
 * project so behavior that depends on the real index (annotation scan,
 * reindex caching, etc.) is exercised end-to-end.
 *
 * If your test reassigns `tc.ctx.gildash = mockGildash(...)` immediately, prefer
 * `createMockTestContext()` — it skips the real `Gildash.open` (15-30 ms each)
 * and produces a context with an empty mock gildash already installed.
 */
export async function createTestContext(): Promise<TestContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_test_'));
  const cardsDir = join(tmpDir, 'cards');
  await mkdir(cardsDir, { recursive: true });
  // Minimum project shape for gildash to recognize and index the project.
  // Tests that need real source files for binding checks add their own.
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'ed-test', version: '0.0.0' }), 'utf8');
  await writeFile(join(tmpDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext' } }), 'utf8');

  const ctx = await setupEmberdeck({
    cardsDir,
    dbPath: ':memory:',
    projectRoot: tmpDir,
  });

  return {
    ctx,
    cardsDir,
    cleanup: async () => {
      await teardownEmberdeck(ctx);
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Lightweight test context that bypasses the real `Gildash.open`. Use when
 * the test reassigns `ctx.gildash` to a controlled mock anyway — saves the
 * real-index startup cost (15-30 ms × N tests).
 *
 * The default `mockGildash({})` returns empty results for every method, which
 * is the same behavior as a freshly-opened gildash on an empty TS project, so
 * tests that rely on "no indexed files" semantics still work without changes.
 */
export async function createMockTestContext(): Promise<TestContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_test_mock_'));
  const cardsDir = join(tmpDir, 'cards');
  await mkdir(cardsDir, { recursive: true });

  const db = createEmberdeckDb(':memory:');
  const ctx: EmberdeckContext = {
    cardsDir,
    projectRoot: tmpDir,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    codeLinkRepo: new DrizzleCodeLinkRepository(db),
    changelogRepo: new DrizzleChangelogRepository(db),
    ignorePatterns: [],
    regressionThreshold: 0,
    gildash: mockGildash({}),
  };

  return {
    ctx,
    cardsDir,
    cleanup: async () => {
      try { await ctx.gildash.close(); } catch { /* mock — best effort */ }
      closeDb(db);
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
