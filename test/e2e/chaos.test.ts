/**
 * CHAOS END-TO-END TESTS
 *
 * These tests exercise the entire Emberdeck system through realistic
 * multi-step workflows, verifying that every field survives every operation.
 *
 * Each scenario runs against a real in-memory SQLite DB + temp filesystem.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createCard,
  bulkCreateCards,
  updateCard,
  updateCardStatus,
  deleteCard,
  renameCard,
  getCard,
  listCards,
  searchCards,
  getCardContext,
  getRelationGraph,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
  checkDrift,
  checkInteractions,
  preChangeCheck,
  regressionGuard,
  buildCardPath,
  type CreateCardInput,
} from '../../index';
import { createTestContext, ensure4tierScaffold, makeTestSpec, type TestContext } from '../helpers';

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// SCENARIO 1: Full Lifecycle -- Single Card Through Every Operation
// ============================================================================

describe('Scenario 1: Full Lifecycle -- Single Card Through Every Operation', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should preserve every field through create -> update -> status transitions -> rename -> export -> sync -> context -> drift', async () => {
    tc = await createTestContext();
    const { ctx } = tc;
    await ensure4tierScaffold(ctx, true);

    // -- Step 1: Create with ALL fields (parent=_br for 4-tier) --
    const createInput: CreateCardInput = {
      key: 'auth-token',
      summary: 'JWT token management and validation',
      type: 'spec',
      parent: '_br',
      tags: ['auth', 'security'],
      relations: [],
      spec: makeTestSpec('src/auth/token.ts', 'refreshToken'),
    };

    // Create dependency targets first (specs under the brief scaffold)
    await createCard(ctx, { key: 'user-session', summary: 'User session management', type: 'spec' });
    await createCard(ctx, { key: 'api-gateway', summary: 'API gateway routing', type: 'brief', parent: '_dom' });

    // Now create with relations
    createInput.relations = ['user-session', 'api-gateway'];
    const created = await createCard(ctx, createInput);
    // Source bindings are now populated via `ed spec sync` — for this E2E
    // we seed them directly so later steps (rename preservation, codeLinks
    // assertion) have data to verify.
    ctx.codeLinkRepo.replaceForCard('auth-token', [
      { kind: 'function', file: 'src/auth/token.ts', symbol: 'refreshToken' },
      { kind: 'function', file: 'src/auth/token.ts', symbol: 'validate' },
    ]);

    expect(created.fullKey).toBe('auth-token');
    expect(existsSync(created.filePath)).toBe(true);
    expect(created.card.frontmatter.key).toBe('auth-token');
    expect(created.card.frontmatter.summary).toBe('JWT token management and validation');
    expect(created.card.frontmatter.type).toBe('spec');
    expect(created.card.frontmatter.status).toBe('draft');
    expect(created.card.frontmatter.tags).toEqual(['auth', 'security']);
    expect(created.card.frontmatter.relations).toEqual(['user-session', 'api-gateway']);

    // -- Step 2: Update fields --
    const updated = await updateCard(ctx, 'auth-token', {
      summary: 'JWT token management, validation, and blacklisting',
      tags: ['auth', 'security', 'jwt'],
    });

    expect(updated.card.frontmatter.summary).toContain('blacklisting');
    const tags = ctx.classificationRepo.findTagsByCard('auth-token');
    expect(tags).toContain('jwt');

    // -- Step 3: Status transitions --
    await updateCardStatus(ctx, 'auth-token', 'active');
    const afterActive = await getCard(ctx, 'auth-token');
    expect(afterActive.card.frontmatter.status).toBe('active');

    await updateCardStatus(ctx, 'auth-token', 'drifted');
    const afterDrifted = await getCard(ctx, 'auth-token');
    expect(afterDrifted.card.frontmatter.status).toBe('drifted');

    // -- Step 4: Rename --
    const renamed = await renameCard(ctx, 'auth-token', 'auth/jwt-token');
    expect(existsSync(renamed.oldFilePath)).toBe(false);
    expect(existsSync(renamed.newFilePath)).toBe(true);
    expect(renamed.card.frontmatter.key).toBe('auth/jwt-token');
    expect(renamed.card.frontmatter.status).toBe('drifted');
    expect(renamed.card.frontmatter.type).toBe('spec');

    // Verify DB state after rename
    expect(ctx.cardRepo.findByKey('auth-token')).toBeNull();
    expect(ctx.cardRepo.findByKey('auth/jwt-token')).not.toBeNull();

    // Verify relations preserved
    const rels = ctx.relationRepo.findByCardKey('auth/jwt-token');
    const forwardRels = rels.filter((r) => !r.isReverse);
    expect(forwardRels.length).toBeGreaterThanOrEqual(2);

    // Verify tags preserved
    expect(ctx.classificationRepo.findTagsByCard('auth/jwt-token')).toContain('jwt');

    // Verify codeLinks preserved
    const codeLinks = ctx.codeLinkRepo.findByCardKey('auth/jwt-token');
    expect(codeLinks).toHaveLength(2);

    // -- Step 5: Export --
    const exportedPath = await exportCardToFile(ctx, 'auth/jwt-token');
    expect(existsSync(exportedPath)).toBe(true);

    // -- Step 6: Validate --
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows).toHaveLength(0);

    // -- Step 7: checkDrift --
    const drift = await checkDrift(ctx, 'auth/jwt-token');
    expect(drift.health).toBeDefined();

    // -- Step 8: getCardContext --
    const context = await getCardContext(ctx, 'auth/jwt-token');
    expect(context.card.frontmatter.key).toBe('auth/jwt-token');
    expect(context.downstreamCards.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// SCENARIO 2: Bulk Operations
// ============================================================================

describe('Scenario 2: Bulk Create + Relations + Sync', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should handle bulk create with inter-card relations, then sync, validate, and export', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // -- Bulk create with relations --
    const result = await bulkCreateCards(ctx, [
      { key: 'core/db', summary: 'Database layer', type: 'brief' },
      { key: 'core/auth', summary: 'Authentication module', type: 'spec', relations: ['core/db'] },
      { key: 'core/api', summary: 'API gateway', type: 'brief', relations: ['core/auth'] },
      { key: 'feature/users', summary: 'User management', type: 'spec', relations: ['core/db', 'core/auth'] },
    ]);

    expect(result.created).toBe(4);
    expect(result.failed).toBe(0);

    // Verify relations
    const apiRels = ctx.relationRepo.findByCardKey('core/api');
    expect(apiRels.some((r) => !r.isReverse && r.dstCardKey === 'core/auth')).toBe(true);

    const userRels = ctx.relationRepo.findByCardKey('feature/users');
    const forwardUserRels = userRels.filter((r) => !r.isReverse);
    expect(forwardUserRels).toHaveLength(2);

    // -- Relation graph --
    const graph = getRelationGraph(ctx, 'core/api', { direction: 'forward', maxDepth: 3 });
    expect(graph.some((n) => n.key === 'core/auth')).toBe(true);
    expect(graph.some((n) => n.key === 'core/db')).toBe(true);

    // -- BulkSync --
    const syncResult = await bulkSyncCards(ctx);
    expect(syncResult.synced).toBe(4);

    // -- Validate --
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows).toHaveLength(0);
    expect(validation.orphanFiles).toHaveLength(0);

    // -- Search --
    const searchResults = searchCards(ctx, 'Authentication');
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]!.key).toBe('core/auth');

    // -- Delete with cascading --
    await deleteCard(ctx, 'core/db', { force: true });
    expect(ctx.cardRepo.findByKey('core/db')).toBeNull();

    // -- Remaining cards still work --
    const remaining = listCards(ctx);
    expect(remaining).toHaveLength(3);
  });
});

// ============================================================================
// SCENARIO 3: File Sync Chaos
// ============================================================================

describe('Scenario 3: File Sync Chaos -- external edits + re-sync', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should recover from external file edits through bulkSync', async () => {
    tc = await createTestContext();
    const { ctx, cardsDir } = tc;

    // Create cards through API
    await createCard(ctx, { key: 'sync-a', summary: 'Card A', type: 'spec' });
    await createCard(ctx, { key: 'sync-b', summary: 'Card B', type: 'spec' });

    // Externally modify a file
    const filePath = buildCardPath(cardsDir, 'sync-a');
    const content = await readFile(filePath, 'utf-8');
    const modified = content.replace('Card A', 'Card A (modified externally)');
    await writeFile(filePath, modified, 'utf-8');

    // Delete a file externally
    const filePathB = buildCardPath(cardsDir, 'sync-b');
    await unlink(filePathB);

    // Add a new file externally
    const newFilePath = join(cardsDir, 'sync-c.md');
    await writeFile(newFilePath, '---\nkey: sync-c\nsummary: Card C (external)\nstatus: draft\ntype: spec\n---\n', 'utf-8');

    // Validate to detect issues
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows.some((r) => r.key === 'sync-b')).toBe(true);
    expect(validation.orphanFiles.some((f) => f.includes('sync-c'))).toBe(true);

    // BulkSync to recover
    const syncResult = await bulkSyncCards(ctx);
    expect(syncResult.synced).toBeGreaterThanOrEqual(2);

    // Verify recovery
    const rowA = ctx.cardRepo.findByKey('sync-a');
    expect(rowA?.summary).toContain('modified externally');

    const rowC = ctx.cardRepo.findByKey('sync-c');
    expect(rowC).not.toBeNull();
    expect(rowC?.summary).toBe('Card C (external)');
  });
});

// ============================================================================
// SCENARIO 4: Impact Analysis
// ============================================================================

describe('Scenario 4: Impact Analysis -- preChangeCheck + regressionGuard', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should detect direct and transitive impact through code links and relations', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // Build a dependency chain with code links
    await createCard(ctx, { key: 'impact/base', summary: 'Base module', type: 'spec' });
    ctx.codeLinkRepo.replaceForCard('impact/base', [
      { kind: 'function', file: 'src/base.ts', symbol: 'baseFn' },
    ]);
    await createCard(ctx, {
      key: 'impact/middle',
      summary: 'Middle module',
      type: 'spec',
      relations: ['impact/base'],
    });
    ctx.codeLinkRepo.replaceForCard('impact/middle', [
      { kind: 'function', file: 'src/middle.ts', symbol: 'middleFn' },
    ]);
    await createCard(ctx, {
      key: 'impact/top',
      summary: 'Top module',
      type: 'spec',
      relations: ['impact/middle'],
    });
    ctx.codeLinkRepo.replaceForCard('impact/top', [
      { kind: 'function', file: 'src/top.ts', symbol: 'topFn' },
    ]);

    // Pre-change check: changing src/base.ts
    const impact = await preChangeCheck(ctx, ['src/base.ts']);
    expect(impact.affectedCards.some((c) => c.key === 'impact/base' && c.linkType === 'direct')).toBe(true);
    expect(impact.affectedCards.some((c) => c.key === 'impact/middle' && c.linkType === 'transitive')).toBe(true);
    expect(impact.riskLevel).not.toBe('low');

    // Regression guard
    const guard = await regressionGuard(ctx, ['src/base.ts']);
    expect(guard.passOrFail).toBe('pass');
    expect(guard.affectedCards.length).toBeGreaterThanOrEqual(2);

    // Check interactions
    const interactions = await checkInteractions(ctx, ['impact/base', 'impact/middle']);
    // They have a relation, so hasRelation should be detected
    const pair = interactions.interactions.find(
      (i) => i.pair.includes('impact/base') && i.pair.includes('impact/middle'),
    );
    if (pair) {
      expect(pair.hasRelation).toBe(true);
    }
  });
});

// ============================================================================
// SCENARIO 5: Concurrent Operations
// ============================================================================

describe('Scenario 5: Concurrent Operations', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should handle concurrent creates, updates, and renames without corruption', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // Create base cards
    await createCard(ctx, { key: 'conc-a', summary: 'A', type: 'spec' });
    await createCard(ctx, { key: 'conc-b', summary: 'B', type: 'spec' });
    await createCard(ctx, { key: 'conc-c', summary: 'C', type: 'spec' });

    // Concurrent operations on different keys
    const results = await Promise.allSettled([
      updateCard(ctx, 'conc-a', { summary: 'A updated' }),
      updateCard(ctx, 'conc-b', { summary: 'B updated' }),
      renameCard(ctx, 'conc-c', 'conc-c-new'),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(ctx.cardRepo.findByKey('conc-a')?.summary).toBe('A updated');
    expect(ctx.cardRepo.findByKey('conc-b')?.summary).toBe('B updated');
    expect(ctx.cardRepo.findByKey('conc-c-new')).not.toBeNull();
    expect(ctx.cardRepo.findByKey('conc-c')).toBeNull();
  });
});
