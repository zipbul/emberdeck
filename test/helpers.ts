import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../index';

export interface TestContext {
  ctx: EmberdeckContext;
  cardsDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Minimal valid brief body with all 8 required sections.
 * Use when creating active brief cards in tests.
 */
export const BRIEF_BODY = `
## Motivation
Test motivation. This section exists for validation.

## Scope
Test scope. Goals and non-goals defined here.

## Scenario
Test scenario. User flow is described here.

## Rule
Test rule. Business policies are defined here.

## Constraint
Test constraint. External obligations listed here.

## Risk
Test risk. Failure scenarios documented here.

## Criteria
Test criteria. Success metrics defined here.

## Decision
Test decision. Alternatives considered here.
`.trim();

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
