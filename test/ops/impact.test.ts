import { describe, it, expect, afterEach, mock } from 'bun:test';

import {
  createCard,
  updateCardStatus,
  preChangeCheck,
  regressionGuard,
} from '../../index';
import { createTestContext, SPEC_BODY, makeTestSpec, type TestContext } from '../helpers';

describe('preChangeCheck', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should find directly affected cards by file', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'direct',
      summary: 'Direct',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/auth.ts', symbol: 'login' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/auth.ts']);
    expect(result.affectedCards).toHaveLength(1);
    expect(result.affectedCards[0]!.key).toBe('direct');
    expect(result.affectedCards[0]!.linkType).toBe('direct');
  });

  it('should filter by symbol when provided', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'sym-match',
      summary: 'Match',
      type: 'spec',
      codeLinks: [
        { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
        { kind: 'function', file: 'src/auth.ts', symbol: 'logout' },
      ],
    });

    const result = preChangeCheck(tc.ctx, ['src/auth.ts'], ['login']);
    expect(result.affectedCards).toHaveLength(1);
    expect(result.affectedCards[0]!.affectedLinks).toBe(1);
  });

  it('should find transitive dependents', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'base',
      summary: 'Base',
      type: 'spec',
      codeLinks: [{ kind: 'class', file: 'src/base.ts', symbol: 'Base' }],
    });
    await createCard(tc.ctx, {
      key: 'dependent',
      summary: 'Depends on base',
      type: 'spec',
      relations: ['base'],
    });

    const result = preChangeCheck(tc.ctx, ['src/base.ts']);
    expect(result.affectedCards).toHaveLength(2);
    const transitive = result.affectedCards.find((c) => c.linkType === 'transitive');
    expect(transitive).toBeDefined();
    expect(transitive!.key).toBe('dependent');
    expect(transitive!.via).toBe('base');
  });

  it('should calculate risk level as high when 3+ direct cards affected', async () => {
    tc = await createTestContext();
    for (let i = 0; i < 3; i++) {
      await createCard(tc.ctx, {
        key: `multi-${i}`,
        summary: `Card ${i}`,
        type: 'spec',
        codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: `fn${i}` }],
      });
    }

    const result = preChangeCheck(tc.ctx, ['src/shared.ts']);
    expect(result.riskLevel).toBe('high');
  });

  it('should calculate risk level as medium when 1-2 direct cards affected', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'med-risk',
      summary: 'Medium',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/med.ts', symbol: 'fn' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/med.ts']);
    expect(result.riskLevel).toBe('medium');
  });

  it('should return empty results for empty files array', async () => {
    tc = await createTestContext();
    const result = preChangeCheck(tc.ctx, []);
    expect(result.affectedCards).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
  });

  it('should return empty results for unrelated files', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'unrelated',
      summary: 'Unrelated',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/other.ts', symbol: 'other' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/different.ts']);
    expect(result.affectedCards).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
  });

  it('should detect cards affected by boundary matching', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'bnd-card',
      summary: 'Boundary card',
      type: 'spec',
      boundary: ['src/auth/**'],
    });

    const result = preChangeCheck(tc.ctx, ['src/auth/login.ts']);
    const affected = result.affectedCards.find((c) => c.key === 'bnd-card');
    expect(affected).toBeDefined();
    expect(affected!.linkType).toBe('boundary');
  });

  it('should include newUncoveredFiles for files not matched by any card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'covered',
      summary: 'Covered',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/covered.ts', symbol: 'fn' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/covered.ts', 'src/uncovered.ts']);
    expect(result.newUncoveredFiles).toContain('src/uncovered.ts');
    expect(result.newUncoveredFiles).not.toContain('src/covered.ts');
  });
});

describe('regressionGuard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should pass when no affected cards', async () => {
    tc = await createTestContext();
    const result = await regressionGuard(tc.ctx, ['src/clean.ts']);
    expect(result.passOrFail).toBe('pass');
    expect(result.driftedRatio).toBe(0);
  });

  it('should pass when affected cards are not drifted', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'guard-card',
      summary: 'Guard',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/guarded.ts', symbol: 'fn' }],
    });

    const result = await regressionGuard(tc.ctx, ['src/guarded.ts']);
    expect(result.passOrFail).toBe('pass');
    expect(result.affectedCards).toHaveLength(1);
  });

  it('should fail when affected cards are drifted and threshold is 0', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'drifted-card',
      summary: 'Drifted',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/drift.ts', symbol: 'fn' }],
    });
    await updateCardStatus(tc.ctx, 'drifted-card', 'drifted');

    const result = await regressionGuard(tc.ctx, ['src/drift.ts']);
    expect(result.passOrFail).toBe('fail');
    expect(result.driftedRatio).toBeGreaterThan(0);
  });

  it('should pass with empty changedFiles', async () => {
    tc = await createTestContext();
    const result = await regressionGuard(tc.ctx, []);
    expect(result.passOrFail).toBe('pass');
  });

  it('should return threshold in result', async () => {
    tc = await createTestContext();
    const result = await regressionGuard(tc.ctx, []);
    expect(result.threshold).toBe(0);
  });

  it('should pass when driftedRatio equals threshold (> not >=)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'thresh-clean',
      summary: 'Clean',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/t.ts', symbol: 'clean' }],
    });
    await createCard(tc.ctx, {
      key: 'thresh-dirty',
      summary: 'Dirty',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/t.ts', symbol: 'dirty' }],
    });
    await updateCardStatus(tc.ctx, 'thresh-dirty', 'drifted');

    // 1 drifted out of 2 = ratio 0.5. Set threshold to 0.5 → pass (> not >=)
    tc.ctx.regressionThreshold = 0.5;
    const result = await regressionGuard(tc.ctx, ['src/t.ts']);
    expect(result.passOrFail).toBe('pass');
    expect(result.driftedRatio).toBe(0.5);
    expect(result.threshold).toBe(0.5);
  });

  it('should fail when driftedRatio exceeds custom threshold', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'thresh2-dirty',
      summary: 'Dirty',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/u.ts', symbol: 'dirty' }],
    });
    await updateCardStatus(tc.ctx, 'thresh2-dirty', 'drifted');

    // 1 drifted out of 1 = ratio 1.0. Threshold 0.5 → fail
    tc.ctx.regressionThreshold = 0.5;
    const result = await regressionGuard(tc.ctx, ['src/u.ts']);
    expect(result.passOrFail).toBe('fail');
    expect(result.driftedRatio).toBe(1);
  });

  it('should detect drift via driftType even when autoTransition is false (status stays active)', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'drift-detect',
      summary: 'Drift via driftType',
      type: 'spec',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/gone.ts', symbol: 'missingFn' }],
      spec: makeTestSpec('src/gone.ts', 'missingFn'),
    });
    await updateCardStatus(tc.ctx, 'drift-detect', 'active');

    // Mock gildash so broken_link drift is detected (symbol not found)
    tc.ctx.gildash = {
      searchAnnotations: mock(() => []),
      searchSymbols: mock(() => []),
      getSymbolChanges: mock(() => []),
      getSymbolsByFile: mock(() => []),
      getFileInfo: mock(() => null),
      close: mock(() => Promise.resolve()),
    } as any;

    const result = await regressionGuard(tc.ctx, ['src/gone.ts']);
    // The affected card should report driftType even though DB status is active
    const card = result.affectedCards.find((c) => c.key === 'drift-detect');
    expect(card).toBeDefined();
    expect(card!.driftType).toBe('broken_link');
    // DB status stays active (autoTransition=false inside regressionGuard)
    expect(card!.status).toBe('active');
    // But regressionGuard should count it as drifted and fail
    expect(result.driftedRatio).toBeGreaterThan(0);
    expect(result.passOrFail).toBe('fail');
  });
});
