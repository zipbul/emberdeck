/**
 * END-TO-END WORKFLOW TESTS
 *
 * Five scenarios covering the major emberdeck workflows:
 *   1. Onboarding — project scan → card creation → validation → analysis
 *   2. Code change — pre-change check → drift detection → regression guard
 *   3. Design change — type change → activation guard → rename → history
 *   4. Card deletion + cleanup — parent delete → orphan detection → sync
 *   5. Code→spec — uncovered symbols → card creation → link validation → annotation sync
 */
import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  bulkCreateCards,
  updateCard,
  updateCardStatus,
  deleteCard,
  renameCard,
  getCard,
  validateCards,
  validateCodeLinks,
  bulkSyncCards,
  checkDrift,
  preChangeCheck,
  regressionGuard,
  suggestCardScope,
  getUncoveredSymbols,
  syncSpecAnnotations,
  analyze,
} from '../../index';
import { createTestContext, ensure4tierScaffold, BRIEF_BODY, SPEC_BODY, makeTestBrief, makeTestSpec, type TestContext } from '../helpers';

// ============================================================================
// Mock gildash factory (same pattern as coverage-analysis tests)
// ============================================================================

function createMockGildash(
  symbols: Record<string, Array<{ name: string; kind: string; isExported: boolean }>>,
  overrides?: { searchAnnotations?: (...args: unknown[]) => unknown[] },
) {
  const fileSymbols = new Map<
    string,
    Array<{ name: string; kind: string; isExported: boolean; filePath: string }>
  >();
  const indexedFiles: Array<{
    project: string;
    filePath: string;
    mtimeMs: number;
    size: number;
    contentHash: string;
    updatedAt: string;
    lineCount: number;
  }> = [];

  for (const [filePath, syms] of Object.entries(symbols)) {
    fileSymbols.set(
      filePath,
      syms.map((s) => ({
        ...s,
        filePath,
        id: 0,
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        signature: null,
        fingerprint: null,
        detail: {},
      })),
    );
    indexedFiles.push({
      project: 'default',
      filePath,
      mtimeMs: Date.now(),
      size: 100,
      contentHash: 'abc',
      updatedAt: new Date().toISOString(),
      lineCount: 10,
    });
  }

  return {
    reindex: async () => {},
    close: async () => {},
    listIndexedFiles: () => indexedFiles,
    getSymbolsByFile: (fp: string) => fileSymbols.get(fp) ?? [],
    searchSymbols: (query: { text?: string; exact?: boolean; filePath?: string }) => {
      const results: any[] = [];
      for (const [fp, syms] of fileSymbols) {
        if (query.filePath) {
          const matches = fp === query.filePath || fp.endsWith('/' + query.filePath);
          if (!matches) continue;
        }
        for (const s of syms) {
          if (query.exact && query.text && s.name !== query.text) continue;
          if (!query.exact && query.text && !s.name.includes(query.text)) continue;
          results.push(query.filePath ? { ...s, filePath: query.filePath } : s);
        }
      }
      return results;
    },
    getSymbolChanges: () => [],
    searchAnnotations: overrides?.searchAnnotations ?? (() => []),
    getDependencies: () => [],
  } as any;
}


// ============================================================================
// SCENARIO 1: Onboarding flow
// ============================================================================

describe('E2E Scenario 1: Onboarding flow', () => {
  let tc: TestContext;
  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should scan project, suggest cards, bulk create, validate, and analyze', async () => {
    tc = await createTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/api/routes.ts': [
        { name: 'getUsers', kind: 'function', isExported: true },
        { name: 'getUser', kind: 'function', isExported: true },
      ],
      '/project/src/api/handler.ts': [
        { name: 'handleRequest', kind: 'function', isExported: true },
      ],
      '/project/src/db/query.ts': [
        { name: 'runQuery', kind: 'function', isExported: true },
      ],
    });

    // Step 1: suggestCardScope → 4-tier domain/brief/spec suggestions
    // Fresh project (no existing cards) → multi-file directory suggested as domain.
    const suggestions = await suggestCardScope(tc.ctx);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const apiSuggestion = suggestions.find((s) => s.suggestedKey === 'src/api');
    expect(apiSuggestion).toBeDefined();
    expect(apiSuggestion!.type).toBe('domain');

    // Step 2: bulkCreateCards with 4-tier parent relationship
    // platform (domain) → api-layer (brief) → db-layer (spec)
    const bulk = await bulkCreateCards(tc.ctx, [
      { key: 'platform', summary: 'Platform domain', type: 'domain' },
      {
        key: 'api-layer',
        summary: 'API layer',
        type: 'brief',
        parent: 'platform',
        boundary: ['src/api/**'],
      },
      {
        key: 'db-layer',
        summary: 'DB layer',
        type: 'spec',
        parent: 'api-layer',
        relations: ['api-layer'],
        codeLinks: [{ kind: 'function', file: 'src/db/query.ts', symbol: 'runQuery' }],
      },
    ]);

    expect(bulk.created).toBe(3);
    expect(bulk.failed).toBe(0);

    // Step 3: validateCards → no structural warnings (except expected orphan/empty-tree)
    const validation = await validateCards(tc.ctx);
    expect(validation.staleDbRows).toHaveLength(0);
    expect(validation.orphanFiles).toHaveLength(0);

    // Step 4: analyze → health.total matches created count
    const result = await analyze(tc.ctx);
    expect(result.health.total).toBe(3);
    expect(result.health.draft).toBe(3);
  });
});

// ============================================================================
// SCENARIO 2: Code change flow
// ============================================================================

describe('E2E Scenario 2: Code change flow', () => {
  let tc: TestContext;
  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should detect impact, drift after symbol removal, and regression guard failure', async () => {
    tc = await createTestContext();
    tc.ctx.projectRoot = '/project';
    await ensure4tierScaffold(tc.ctx, true);

    // Create an active card with code links (4-tier: spec under brief under domain)
    await createCard(tc.ctx, {
      key: 'auth-service',
      summary: 'Authentication service',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [
        { kind: 'function', file: 'src/auth.ts', symbol: 'login' },
        { kind: 'function', file: 'src/auth.ts', symbol: 'logout' },
      ],
      boundary: ['src/auth/**'],
      spec: makeTestSpec('src/auth.ts', 'login'),
    });
    await updateCardStatus(tc.ctx, 'auth-service', 'active');

    // Set gildash with symbols present
    tc.ctx.gildash = createMockGildash({
      '/project/src/auth.ts': [
        { name: 'login', kind: 'function', isExported: true },
        { name: 'logout', kind: 'function', isExported: true },
      ],
    });

    // Step 1: preChangeCheck → affected card
    const impact = preChangeCheck(tc.ctx, ['src/auth.ts']);
    expect(impact.affectedCards.some((c) => c.key === 'auth-service')).toBe(true);

    // Step 2: Remove symbols from mock (simulate code deletion)
    tc.ctx.gildash = createMockGildash({});

    // Step 3: checkDrift with autoTransition → active→drifted
    const drift = await checkDrift(tc.ctx, undefined, { autoTransition: true });
    const driftCard = drift.cards.find((c) => c.key === 'auth-service');
    expect(driftCard).toBeDefined();
    expect(driftCard!.status).toBe('drifted');
    expect(driftCard!.driftType).toBe('broken_link');

    // Verify DB status changed
    const row = tc.ctx.cardRepo.findByKey('auth-service');
    expect(row!.status).toBe('drifted');

    // Step 4: regressionGuard → fail
    const guard = await regressionGuard(tc.ctx, ['src/auth.ts']);
    expect(guard.passOrFail).toBe('fail');
  });
});

// ============================================================================
// SCENARIO 3: Design change flow
// ============================================================================

describe('E2E Scenario 3: Design change flow', () => {
  let tc: TestContext;
  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should handle type change, activation guard, rename, and history', async () => {
    tc = await createTestContext();
    await ensure4tierScaffold(tc.ctx, true);

    // Step 1: Create brief card with domain parent and activate it
    await createCard(tc.ctx, {
      key: 'infra-layer',
      summary: 'Infrastructure layer',
      type: 'brief',
      parent: '_dom',
      body: BRIEF_BODY,
      brief: makeTestBrief(),
    });
    await updateCardStatus(tc.ctx, 'infra-layer', 'active');
    const afterActive = await getCard(tc.ctx, 'infra-layer');
    expect(afterActive.card.frontmatter.status).toBe('active');

    // Step 2: updateCard changing type to spec → re-checks activation guard
    // No codeLinks → guard fails → status forced to draft
    const updated = await updateCard(tc.ctx, 'infra-layer', { type: 'spec' });
    expect(updated.card.frontmatter.type).toBe('spec');
    expect(updated.card.frontmatter.status).toBe('draft');

    // Step 3: Add codeLinks, spec body, AND repoint parent to a brief
    // (4-tier: spec.parent must be brief|spec, not domain).
    // Use the scaffold's _br as the new parent.
    await updateCard(tc.ctx, 'infra-layer', {
      parent: '_br',
      codeLinks: [{ kind: 'class', file: 'src/infra/base.ts', symbol: 'BaseInfra' }],
      body: SPEC_BODY,
      spec: makeTestSpec('src/infra/base.ts', 'BaseInfra'),
    });
    await updateCardStatus(tc.ctx, 'infra-layer', 'active');
    const reactivated = await getCard(tc.ctx, 'infra-layer');
    expect(reactivated.card.frontmatter.status).toBe('active');

    // Step 4: renameCard → file moves, references updated, changelog recorded
    const renamed = await renameCard(tc.ctx, 'infra-layer', 'core/infra-layer');
    expect(renamed.card.frontmatter.key).toBe('core/infra-layer');
    expect(renamed.oldFilePath).not.toBe(renamed.newFilePath);

    // Old key should not exist
    expect(tc.ctx.cardRepo.findByKey('infra-layer')).toBeNull();
    // New key should exist
    expect(tc.ctx.cardRepo.findByKey('core/infra-layer')).not.toBeNull();

    // Step 5: getCard with includeHistory → rename history present
    const cardWithHistory = await getCard(tc.ctx, 'core/infra-layer', { includeHistory: true });
    expect(cardWithHistory.card.frontmatter.key).toBe('core/infra-layer');
    expect(cardWithHistory.history).toBeDefined();
    expect(cardWithHistory.history!.length).toBeGreaterThanOrEqual(1);
    const renameEntry = cardWithHistory.history!.find((h) => h.field === 'key');
    expect(renameEntry).toBeDefined();
    expect(renameEntry!.oldValue).toBe('infra-layer');
    expect(renameEntry!.newValue).toBe('core/infra-layer');
  });
});

// ============================================================================
// SCENARIO 4: Card deletion + cleanup
// ============================================================================

describe('E2E Scenario 4: Card deletion + cleanup', () => {
  let tc: TestContext;
  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should delete parent, detect orphans, and verify sync', async () => {
    tc = await createTestContext();

    // Step 1: Create parent + 2 children, then add cross-relations
    await createCard(tc.ctx, {
      key: 'parent-mod',
      summary: 'Parent module',
      type: 'brief',
    });
    await createCard(tc.ctx, {
      key: 'child-a',
      summary: 'Child A',
      type: 'spec',
      parent: 'parent-mod',
    });
    await createCard(tc.ctx, {
      key: 'child-b',
      summary: 'Child B',
      type: 'spec',
      parent: 'parent-mod',
    });
    // Both exist now, add cross-relations
    await updateCard(tc.ctx, 'child-a', { relations: ['child-b'] });
    await updateCard(tc.ctx, 'child-b', { relations: ['child-a'] });

    // Step 2: deleteCard parent with force
    await deleteCard(tc.ctx, 'parent-mod', { force: true });
    expect(tc.ctx.cardRepo.findByKey('parent-mod')).toBeNull();

    // Step 3: Children should have parent === null
    const childA = tc.ctx.cardRepo.findByKey('child-a');
    expect(childA).not.toBeNull();
    expect(childA!.parent).toBeNull();

    const childB = tc.ctx.cardRepo.findByKey('child-b');
    expect(childB).not.toBeNull();
    expect(childB!.parent).toBeNull();

    // Step 4: validateCards → orphan warnings
    const validation = await validateCards(tc.ctx);
    const orphanWarnings = validation.warnings.filter((w) => w.type === 'orphan-card');
    expect(orphanWarnings.length).toBeGreaterThanOrEqual(2);

    // Step 5: bulkSyncCards → DB-file consistency
    const syncResult = await bulkSyncCards(tc.ctx);
    expect(syncResult.synced).toBe(2);
    expect(syncResult.errors).toHaveLength(0);
  });
});

// ============================================================================
// SCENARIO 5: Code → spec flow
// ============================================================================

describe('E2E Scenario 5: Code → spec flow', () => {
  let tc: TestContext;
  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should find uncovered symbols, create card, validate links, and sync annotations', async () => {
    tc = await createTestContext();
    tc.ctx.projectRoot = '/project';
    tc.ctx.gildash = createMockGildash({
      '/project/src/payment.ts': [
        { name: 'charge', kind: 'function', isExported: true },
        { name: 'refund', kind: 'function', isExported: true },
      ],
      '/project/src/billing.ts': [
        { name: 'createInvoice', kind: 'function', isExported: true },
      ],
    });

    // Step 1: getUncoveredSymbols → all uncovered
    const uncovered = await getUncoveredSymbols(tc.ctx);
    expect(uncovered.totalSymbols).toBe(3);
    expect(uncovered.coveredSymbols).toBe(0);
    expect(uncovered.uncovered).toHaveLength(3);

    // Step 2: createCard linking some symbols
    await createCard(tc.ctx, {
      key: 'payment',
      summary: 'Payment processing',
      type: 'spec',
      codeLinks: [
        { kind: 'function', file: 'src/payment.ts', symbol: 'charge' },
        { kind: 'function', file: 'src/payment.ts', symbol: 'refund' },
      ],
    });

    // Step 3: validateCodeLinks → declared > 0, valid > 0, broken === 0
    const linkResult = await validateCodeLinks(tc.ctx, 'payment');
    expect(linkResult.declared).toBe(2);
    expect(linkResult.valid).toBe(2);
    expect(linkResult.broken).toHaveLength(0);

    // Step 4: Set searchAnnotations to return @spec annotations matching existing link
    tc.ctx.gildash = createMockGildash(
      {
        '/project/src/payment.ts': [
          { name: 'charge', kind: 'function', isExported: true },
          { name: 'refund', kind: 'function', isExported: true },
        ],
        '/project/src/billing.ts': [
          { name: 'createInvoice', kind: 'function', isExported: true },
        ],
      },
      {
        searchAnnotations: () => [
          {
            tag: 'spec',
            value: 'payment',
            filePath: 'src/payment.ts',
            symbolName: 'charge',
            line: 1,
          },
        ],
      },
    );

    // Step 5: syncSpecAnnotations → alreadyLinked (charge already linked)
    const syncResult = await syncSpecAnnotations(tc.ctx);
    expect(syncResult.alreadyLinked).toBe(1);
    expect(syncResult.created).toBe(0);
  });
});
