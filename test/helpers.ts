import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../index';
import type {
  BriefBody,
  PrincipleBody,
  SpecBody,
} from '../src/card/types';

export interface TestContext {
  ctx: EmberdeckContext;
  cardsDir: string;
  cleanup: () => Promise<void>;
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
 * Minimal valid `spec` namespace body. Pass codeLinks separately so binds match.
 */
export function makeTestSpec(file: string, symbol: string): SpecBody {
  return {
    preconditions: [
      { id: 'PRE-001', condition: 'c', binds: [{ file, symbol }], derives: 'parent#R-001' },
    ],
    postconditions: [
      { id: 'POST-001', guarantee: 'g', keyword: 'MUST', binds: [{ file, symbol }], derives: 'parent#R-001' },
    ],
    invariants: [
      { id: 'INV-001', statement: 's', binds: [{ file, symbol }], always_holds: 'per-call' },
    ],
    failures: [
      { violation: 'v', behavior: 'b', exception: { class: 'TestError', file: 'src/errors.ts' } },
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
  const { createCard } = await import('../src/ops/create');
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

export async function createTestContext(): Promise<TestContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_test_'));
  const cardsDir = join(tmpDir, 'cards');
  await mkdir(cardsDir, { recursive: true });

  const ctx = await setupEmberdeck({
    cardsDir,
    dbPath: ':memory:',
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
