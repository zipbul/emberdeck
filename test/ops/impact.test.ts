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
      slug: 'direct',
      summary: 'Direct',
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
      slug: 'sym-match',
      summary: 'Match',
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
      slug: 'base',
      summary: 'Base',
      codeLinks: [{ kind: 'class', file: 'src/base.ts', symbol: 'Base' }],
    });
    await createCard(tc.ctx, {
      slug: 'dependent',
      summary: 'Depends on base',
      relations: [{ type: 'depends-on', target: 'base' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/base.ts']);
    expect(result.affectedCards.length).toBeGreaterThanOrEqual(2);
    const transitive = result.affectedCards.find((c) => c.linkType === 'transitive');
    expect(transitive).toBeDefined();
    expect(transitive!.key).toBe('dependent');
    expect(transitive!.via).toBe('base');
  });

  it('should calculate risk level as critical when affecting critical priority card', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'crit',
      summary: 'Critical card',
      priority: 'critical',
      codeLinks: [{ kind: 'function', file: 'src/core.ts', symbol: 'core' }],
    });

    const result = preChangeCheck(tc.ctx, ['src/core.ts']);
    expect(result.riskLevel).toBe('critical');
  });

  it('should calculate risk level as high when 3+ direct cards affected', async () => {
    tc = await createTestContext();
    for (let i = 0; i < 3; i++) {
      await createCard(tc.ctx, {
        slug: `multi-${i}`,
        summary: `Card ${i}`,
        codeLinks: [{ kind: 'function', file: 'src/shared.ts', symbol: `fn${i}` }],
      });
    }

    const result = preChangeCheck(tc.ctx, ['src/shared.ts']);
    expect(result.riskLevel).toBe('high');
  });

  it('should identify at-risk verified acceptance criteria', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'at-risk',
      summary: 'At risk',
      codeLinks: [{ kind: 'function', file: 'src/risky.ts', symbol: 'riskyFn' }],
      acceptance: [
        { id: 'ac-1', description: 'Must handle errors', verified: true },
        { id: 'ac-2', description: 'Must be fast', verified: false },
      ],
    });

    const result = preChangeCheck(tc.ctx, ['src/risky.ts']);
    // Only verified criteria are at-risk (ac-1)
    expect(result.atRiskAcceptance).toHaveLength(1);
    expect(result.atRiskAcceptance[0]!.criterionId).toBe('ac-1');
  });

  it('should calculate risk level as medium when 1-2 direct cards affected', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'med-risk',
      summary: 'Medium',
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

  it('should generate suggested actions for at-risk criteria', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'suggest',
      summary: 'Suggest',
      codeLinks: [{ kind: 'function', file: 'src/s.ts', symbol: 'fn' }],
      acceptance: [{ id: 'ac-1', description: 'Must validate', verified: true }],
    });

    const result = preChangeCheck(tc.ctx, ['src/s.ts']);
    expect(result.suggestedActions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestedActions[0]).toContain('ac-1');
  });

  it('should return empty results for unrelated files', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'unrelated',
      summary: 'Unrelated',
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

  it('should warn when affected acceptance criteria exist', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'guard-card',
      summary: 'Guard',
      codeLinks: [{ kind: 'function', file: 'src/guarded.ts', symbol: 'fn' }],
      acceptance: [{ id: 'ac-1', description: 'Must work', verified: true }],
    });

    const result = regressionGuard(tc.ctx, ['src/guarded.ts']);
    expect(result.qualityGate).toBe('warn');
    expect(result.affectedAcceptance.length).toBeGreaterThanOrEqual(1);
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

  it('should handle firebat array format directly', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, ['src/a.ts'], [
      { severity: 'warning', message: 'Unused import' },
      { severity: 'warning', message: 'Missing return type' },
    ]);
    expect(result.qualityGate).toBe('warn');
    expect(result.newIssues).toHaveLength(2);
  });

  it('should pass with empty changedFiles and no firebat', async () => {
    tc = await createTestContext();
    const result = regressionGuard(tc.ctx, []);
    expect(result.qualityGate).toBe('pass');
  });

  it('should include affected acceptance count in recommendation', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'rec-card',
      summary: 'Rec',
      codeLinks: [{ kind: 'function', file: 'src/r.ts', symbol: 'fn' }],
      acceptance: [{ id: 'ac-1', description: 'Works', verified: true }],
    });

    const result = regressionGuard(tc.ctx, ['src/r.ts']);
    expect(result.recommendation).toContain('at-risk');
  });
});
