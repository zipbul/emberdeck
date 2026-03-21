import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  preChangeCheck,
  regressionGuard,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

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
    expect(result.affectedCards.length).toBeGreaterThanOrEqual(2);
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
});

describe('regressionGuard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should pass when no issues and no affected cards', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/clean.ts']);
    expect(result.qualityGate).toBe('pass');
    expect(result.recommendation).toContain('passed');
  });

  it('should warn when firebat reports non-critical issues', async () => {
    tc = await createTestContext();
    const firebatReport = {
      issues: [
        { file: 'src/a.ts', rule: 'no-unused', message: 'Unused var', severity: 'warning' },
      ],
    };

    const result = regressionGuard(tc.ctx, ['src/a.ts'], firebatReport);
    expect(result.qualityGate).toBe('warn');
    expect(result.newIssues).toHaveLength(1);
  });

  it('should fail when firebat reports critical issues', async () => {
    tc = await createTestContext();
    const firebatReport = [
      { file: 'src/a.ts', rule: 'security', message: 'SQL injection', severity: 'critical' },
    ];

    const result = regressionGuard(tc.ctx, ['src/a.ts'], firebatReport);
    expect(result.qualityGate).toBe('fail');
    expect(result.recommendation).toContain('Critical');
  });

  it('should warn when affected cards exist', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      key: 'guard-card',
      summary: 'Guard',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/guarded.ts', symbol: 'fn' }],
    });

    const result = regressionGuard(tc.ctx, ['src/guarded.ts']);
    expect(result.qualityGate).toBe('warn');
    expect(result.affectedCardCount).toBeGreaterThanOrEqual(1);
  });

  it('should handle null firebatReport gracefully', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], null);
    expect(result.qualityGate).toBe('pass');
  });

  it('should handle undefined firebatReport gracefully', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], undefined);
    expect(result.qualityGate).toBe('pass');
  });

  it('should fail when firebat reports error severity issues', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], [
      { severity: 'error', message: 'Type mismatch' },
    ]);
    expect(result.qualityGate).toBe('fail');
  });

  it('should pass with empty changedFiles and no firebat', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, []);
    expect(result.qualityGate).toBe('pass');
  });

  it('should pass gracefully when firebatReport is a string', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], 'scan completed' as any);
    expect(result.qualityGate).toBe('pass');
  });

  it('should pass gracefully when firebatReport is a number', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], 42 as any);
    expect(result.qualityGate).toBe('pass');
  });
});
