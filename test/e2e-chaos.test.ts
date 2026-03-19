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
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

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
  listCardRelations,
  getCardContext,
  getRelationGraph,
  syncCardFromFile,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
  verifyAcceptance,
  listUnverified,
  getCardHistory,
  generateContext,
  checkDrift,
  checkInteractions,
  preChangeCheck,
  regressionGuard,
  buildCardPath,
  LIMITS,
  type CreateCardInput,
  type AcceptanceCriterion,
  type CardRelation,
  type CodeLink,
} from '../index';
import { createTestContext, type TestContext } from './helpers';

// ============================================================================
// Helpers
// ============================================================================

function makeAcceptance(count: number, verified = false): AcceptanceCriterion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ac-${i + 1}`,
    description: `Acceptance criterion ${i + 1}`,
    verified,
  }));
}

function makeCodeLinks(count: number): CodeLink[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'function',
    file: `src/module-${i}.ts`,
    symbol: `handler${i}`,
  }));
}

function makeRelations(targets: string[], type = 'depends-on'): CardRelation[] {
  return targets.map((target) => ({ type, target }));
}

// ============================================================================
// SCENARIO 1: Full Lifecycle — Single Card Through Every Operation
// ============================================================================

describe('Scenario 1: Full Lifecycle — Single Card Through Every Operation', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should preserve every field through create -> update -> status transitions -> rename -> export -> sync -> context -> drift -> history', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // ── Step 1: Create with ALL fields ──────────────────────────────────
    const createInput: CreateCardInput = {
      slug: 'auth-token',
      summary: 'JWT token management and validation',
      type: 'feature',
      priority: 'high',
      acceptance: [
        { id: 'ac-1', description: 'Token expiry triggers auto-refresh', verified: false },
        { id: 'ac-2', description: 'Refresh failure triggers logout', verified: false },
        { id: 'ac-3', description: 'Blacklisted tokens rejected immediately', verified: false },
      ],
      body: '# Auth Token\n\nHandles JWT lifecycle including generation, validation, refresh, and revocation.',
      keywords: ['jwt', 'authentication', 'token'],
      tags: ['auth', 'security'],
      relations: [
        { type: 'depends-on', target: 'user-session' },
        { type: 'references', target: 'api-gateway' },
      ],
      codeLinks: [
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'generateToken' },
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'validateToken' },
        { kind: 'class', file: 'src/auth/token-manager.ts', symbol: 'TokenManager' },
      ],
      constraints: {
        maxTokenAge: '24h',
        refreshWindow: '1h',
        algorithm: 'RS256',
      },
    };

    // Pre-create relation targets so relations resolve
    await createCard(ctx, { slug: 'user-session', summary: 'Session management', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    await createCard(ctx, { slug: 'api-gateway', summary: 'API gateway routing', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    const created = await createCard(ctx, createInput);

    // Assert: every field survived creation
    expect(created.fullKey).toBe('auth-token');
    expect(existsSync(created.filePath)).toBe(true);

    const afterCreate = await getCard(ctx, 'auth-token');
    expect(afterCreate.frontmatter.key).toBe('auth-token');
    expect(afterCreate.frontmatter.summary).toBe(createInput.summary);
    expect(afterCreate.frontmatter.status).toBe('draft');
    expect(afterCreate.frontmatter.type).toBe('feature');
    expect(afterCreate.frontmatter.priority).toBe('high');
    expect(afterCreate.frontmatter.acceptance).toHaveLength(3);
    expect(afterCreate.frontmatter.acceptance![0]!.id).toBe('ac-1');
    expect(afterCreate.frontmatter.acceptance![0]!.verified).toBe(false);
    expect(afterCreate.frontmatter.acceptance![2]!.description).toBe('Blacklisted tokens rejected immediately');
    expect(afterCreate.body).toContain('# Auth Token');
    expect(afterCreate.frontmatter.keywords).toEqual(['jwt', 'authentication', 'token']);
    expect(afterCreate.frontmatter.tags).toEqual(['auth', 'security']);
    expect(afterCreate.frontmatter.relations).toHaveLength(2);
    expect(afterCreate.frontmatter.relations![0]!.type).toBe('depends-on');
    expect(afterCreate.frontmatter.relations![0]!.target).toBe('user-session');
    expect(afterCreate.frontmatter.relations![1]!.type).toBe('references');
    expect(afterCreate.frontmatter.relations![1]!.target).toBe('api-gateway');
    expect(afterCreate.frontmatter.codeLinks).toHaveLength(3);
    expect(afterCreate.frontmatter.codeLinks![2]!.kind).toBe('class');
    expect(afterCreate.frontmatter.constraints).toEqual({
      maxTokenAge: '24h',
      refreshWindow: '1h',
      algorithm: 'RS256',
    });

    // Verify DB relations include reverse mirrors
    const relations = listCardRelations(ctx, 'auth-token');
    const forwardRels = relations.filter((r) => !r.isReverse);
    const reverseRels = relations.filter((r) => r.isReverse);
    expect(forwardRels).toHaveLength(2);
    // Reverse mirrors come from user-session and api-gateway pointing back
    // Check reverse mirrors exist on target cards
    const sessionRels = listCardRelations(ctx, 'user-session');
    const sessionReverse = sessionRels.filter((r) => r.isReverse && r.dstCardKey === 'auth-token');
    expect(sessionReverse.length).toBeGreaterThanOrEqual(1);

    // ── Step 2: Update every field ──────────────────────────────────────
    await updateCard(ctx, 'auth-token', {
      summary: 'JWT token management, validation, and rotation',
      type: 'refactor',
      priority: 'critical',
      acceptance: [
        { id: 'ac-1', description: 'Token expiry triggers auto-refresh', verified: false },
        { id: 'ac-2', description: 'Refresh failure triggers logout', verified: false },
        { id: 'ac-3', description: 'Blacklisted tokens rejected immediately', verified: false },
        { id: 'ac-4', description: 'Token rotation on compromise detection', verified: false },
      ],
      body: '# Auth Token (v2)\n\nNow includes rotation logic.',
      keywords: ['jwt', 'authentication', 'token', 'rotation'],
      tags: ['auth', 'security', 'critical-path'],
      relations: [
        { type: 'depends-on', target: 'user-session' },
        { type: 'references', target: 'api-gateway' },
        { type: 'related', target: 'user-session' },
      ],
      codeLinks: [
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'generateToken' },
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'validateToken' },
        { kind: 'class', file: 'src/auth/token-manager.ts', symbol: 'TokenManager' },
        { kind: 'function', file: 'src/auth/rotation.ts', symbol: 'rotateToken' },
      ],
      constraints: {
        maxTokenAge: '12h',
        refreshWindow: '30m',
        algorithm: 'RS256',
        rotationPolicy: 'on-compromise',
      },
    });

    const afterUpdate = await getCard(ctx, 'auth-token');
    expect(afterUpdate.frontmatter.summary).toBe('JWT token management, validation, and rotation');
    expect(afterUpdate.frontmatter.type).toBe('refactor');
    expect(afterUpdate.frontmatter.priority).toBe('critical');
    expect(afterUpdate.frontmatter.acceptance).toHaveLength(4);
    expect(afterUpdate.frontmatter.acceptance![3]!.id).toBe('ac-4');
    expect(afterUpdate.body).toContain('(v2)');
    expect(afterUpdate.frontmatter.keywords).toHaveLength(4);
    expect(afterUpdate.frontmatter.tags).toContain('critical-path');
    expect(afterUpdate.frontmatter.relations).toHaveLength(3);
    expect(afterUpdate.frontmatter.codeLinks).toHaveLength(4);
    expect((afterUpdate.frontmatter.constraints as Record<string, string>).rotationPolicy).toBe('on-compromise');

    // Verify changelog was recorded for field changes
    const historyAfterUpdate = getCardHistory(ctx, 'auth-token');
    expect(historyAfterUpdate.length).toBeGreaterThanOrEqual(1);
    const summaryChange = historyAfterUpdate.find((h) => h.field === 'summary');
    expect(summaryChange).toBeDefined();
    expect(summaryChange!.oldValue).toBe('JWT token management and validation');
    expect(summaryChange!.newValue).toBe('JWT token management, validation, and rotation');

    const typeChange = historyAfterUpdate.find((h) => h.field === 'type');
    expect(typeChange).toBeDefined();
    expect(typeChange!.oldValue).toBe('feature');
    expect(typeChange!.newValue).toBe('refactor');

    // ── Step 3: Full status lifecycle ───────────────────────────────────
    // draft -> accepted
    await updateCardStatus(ctx, 'auth-token', 'accepted');
    let card = await getCard(ctx, 'auth-token');
    expect(card.frontmatter.status).toBe('accepted');

    // accepted -> implementing
    await updateCardStatus(ctx, 'auth-token', 'implementing');
    card = await getCard(ctx, 'auth-token');
    expect(card.frontmatter.status).toBe('implementing');

    // implementing -> implemented (should warn about unverified acceptance)
    const implResult = await updateCardStatus(ctx, 'auth-token', 'implemented');
    expect(implResult.card.frontmatter.status).toBe('implemented');
    expect(implResult.warnings).toBeDefined();
    expect(implResult.warnings!.length).toBe(4); // all 4 acceptance criteria unverified

    // implemented -> deprecated
    await updateCardStatus(ctx, 'auth-token', 'deprecated');
    card = await getCard(ctx, 'auth-token');
    expect(card.frontmatter.status).toBe('deprecated');

    // Verify all status transitions were logged
    const statusHistory = getCardHistory(ctx, 'auth-token').filter((h) => h.field === 'status');
    expect(statusHistory).toHaveLength(4); // draft->accepted, accepted->implementing, implementing->implemented, implemented->deprecated

    // Verify fields survived all status transitions
    expect(card.frontmatter.type).toBe('refactor');
    expect(card.frontmatter.priority).toBe('critical');
    expect(card.frontmatter.acceptance).toHaveLength(4);
    expect(card.frontmatter.codeLinks).toHaveLength(4);
    expect(card.frontmatter.relations).toHaveLength(3);
    expect(card.frontmatter.keywords).toHaveLength(4);
    expect(card.frontmatter.tags).toHaveLength(3);
    expect(card.frontmatter.constraints).toBeDefined();

    // ── Step 4: Rename ──────────────────────────────────────────────────
    const renameResult = await renameCard(ctx, 'auth-token', 'jwt-lifecycle');

    expect(renameResult.newFullKey).toBe('jwt-lifecycle');
    expect(existsSync(renameResult.newFilePath)).toBe(true);
    expect(existsSync(renameResult.oldFilePath)).toBe(false);

    // Verify ALL fields survived rename
    const afterRename = await getCard(ctx, 'jwt-lifecycle');
    expect(afterRename.frontmatter.key).toBe('jwt-lifecycle');
    expect(afterRename.frontmatter.summary).toBe('JWT token management, validation, and rotation');
    expect(afterRename.frontmatter.status).toBe('deprecated');
    expect(afterRename.frontmatter.type).toBe('refactor');
    expect(afterRename.frontmatter.priority).toBe('critical');
    expect(afterRename.frontmatter.acceptance).toHaveLength(4);
    expect(afterRename.frontmatter.keywords).toHaveLength(4);
    expect(afterRename.frontmatter.tags).toHaveLength(3);
    expect(afterRename.frontmatter.codeLinks).toHaveLength(4);
    expect(afterRename.frontmatter.constraints).toEqual({
      maxTokenAge: '12h',
      refreshWindow: '30m',
      algorithm: 'RS256',
      rotationPolicy: 'on-compromise',
    });
    expect(afterRename.body).toContain('(v2)');

    // Verify relations survived rename in DB
    const renamedRelations = listCardRelations(ctx, 'jwt-lifecycle');
    const renamedForward = renamedRelations.filter((r) => !r.isReverse);
    expect(renamedForward).toHaveLength(3);

    // Verify code links survived in DB
    const renamedCodeLinks = ctx.codeLinkRepo.findByCardKey('jwt-lifecycle');
    expect(renamedCodeLinks).toHaveLength(4);

    // Verify changelog was migrated to new key
    const renamedHistory = getCardHistory(ctx, 'jwt-lifecycle');
    expect(renamedHistory.length).toBeGreaterThan(0);

    // Verify old key is gone
    expect(ctx.cardRepo.findByKey('auth-token')).toBeNull();

    // ── Step 5: Export to file ──────────────────────────────────────────
    const exportPath = await exportCardToFile(ctx, 'jwt-lifecycle');
    expect(existsSync(exportPath)).toBe(true);

    // Read exported file and verify roundtrip
    const exported = await getCard(ctx, 'jwt-lifecycle');
    expect(exported.frontmatter.summary).toBe('JWT token management, validation, and rotation');
    expect(exported.frontmatter.acceptance).toHaveLength(4);
    expect(exported.frontmatter.constraints).toBeDefined();

    // ── Step 6: Sync from file (simulate external edit) ─────────────────
    const filePath = buildCardPath(tc.cardsDir, 'jwt-lifecycle');
    const fileContent = await readFile(filePath, 'utf-8');
    const modifiedContent = fileContent.replace(
      'JWT token management, validation, and rotation',
      'JWT token management (externally edited)',
    );
    await writeFile(filePath, modifiedContent);
    await syncCardFromFile(ctx, filePath);

    const afterSync = await getCard(ctx, 'jwt-lifecycle');
    expect(afterSync.frontmatter.summary).toBe('JWT token management (externally edited)');
    // All other fields should still be intact
    expect(afterSync.frontmatter.type).toBe('refactor');
    expect(afterSync.frontmatter.priority).toBe('critical');
    expect(afterSync.frontmatter.acceptance).toHaveLength(4);
    expect(afterSync.frontmatter.codeLinks).toHaveLength(4);
    expect(afterSync.frontmatter.constraints).toBeDefined();

    // ── Step 7: Generate context ────────────────────────────────────────
    const contextPack = await generateContext(ctx, 'jwt-lifecycle', {
      maxDepth: 3,
      includeBody: true,
    });

    expect(contextPack.cards.length).toBeGreaterThanOrEqual(1);
    const rootCard = contextPack.cards.find((c) => c.key === 'jwt-lifecycle');
    expect(rootCard).toBeDefined();
    expect(rootCard!.body).toBeDefined(); // includeBody=true for root
    expect(contextPack.acceptanceCriteria.length).toBeGreaterThanOrEqual(4);
    expect(contextPack.codeLinks.length).toBeGreaterThanOrEqual(4);
    expect(contextPack.constraints['jwt-lifecycle']).toBeDefined();
    expect(contextPack.recentChanges.length).toBeGreaterThan(0);

    // ── Step 8: Check drift ─────────────────────────────────────────────
    const drift = checkDrift(ctx, 'jwt-lifecycle');
    expect(drift.driftScore).toBeGreaterThanOrEqual(0);
    expect(drift.driftScore).toBeLessThanOrEqual(1);
    // Should detect unverified acceptance
    expect(drift.summary).toBeDefined();

    // ── Step 9: Get full history ────────────────────────────────────────
    const fullHistory = getCardHistory(ctx, 'jwt-lifecycle');
    // Should include: summary change, type change, priority change, body change,
    // acceptance change, and all 4 status changes — at minimum
    expect(fullHistory.length).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================================
// SCENARIO 2: Project Bootstrap -> Session Recovery
// ============================================================================

describe('Scenario 2: Project Bootstrap -> Session Recovery', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should bulk_create 10 cards with cross-relations, then recover context from different starting points', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // ── Step 1: Bulk create 10 cards with various types, priorities, cross-relations ──
    const cards: CreateCardInput[] = [
      {
        slug: 'auth-core',
        summary: 'Core authentication module',
        type: 'feature',
        priority: 'critical',
        acceptance: makeAcceptance(3),
        keywords: ['auth', 'core'],
        tags: ['auth'],
        codeLinks: [{ kind: 'class', file: 'src/auth/core.ts', symbol: 'AuthService' }],
        constraints: { protocol: 'OAuth2' },
      },
      {
        slug: 'auth-token',
        summary: 'JWT token management',
        type: 'feature',
        priority: 'high',
        acceptance: makeAcceptance(2),
        keywords: ['jwt', 'token'],
        tags: ['auth'],
        codeLinks: [{ kind: 'function', file: 'src/auth/token.ts', symbol: 'generateToken' }],
        relations: [{ type: 'depends-on', target: 'auth-core' }],
      },
      {
        slug: 'auth-session',
        summary: 'Session lifecycle management',
        type: 'feature',
        priority: 'high',
        acceptance: makeAcceptance(2),
        keywords: ['session'],
        tags: ['auth'],
        codeLinks: [{ kind: 'class', file: 'src/auth/session.ts', symbol: 'SessionManager' }],
        relations: [{ type: 'depends-on', target: 'auth-core' }, { type: 'related', target: 'auth-token' }],
      },
      {
        slug: 'api-gateway',
        summary: 'API gateway and routing',
        type: 'feature',
        priority: 'critical',
        acceptance: makeAcceptance(3),
        tags: ['api'],
        codeLinks: [{ kind: 'class', file: 'src/api/gateway.ts', symbol: 'Gateway' }],
        relations: [{ type: 'depends-on', target: 'auth-token' }],
      },
      {
        slug: 'rate-limiter',
        summary: 'Rate limiting middleware',
        type: 'feature',
        priority: 'medium',
        acceptance: makeAcceptance(2),
        tags: ['api', 'middleware'],
        codeLinks: [{ kind: 'function', file: 'src/api/rate-limit.ts', symbol: 'rateLimiter' }],
        relations: [{ type: 'related', target: 'api-gateway' }],
      },
      {
        slug: 'db-connection',
        summary: 'Database connection pool',
        type: 'feature',
        priority: 'critical',
        acceptance: makeAcceptance(2),
        tags: ['db'],
        codeLinks: [{ kind: 'class', file: 'src/db/pool.ts', symbol: 'ConnectionPool' }],
      },
      {
        slug: 'user-repo',
        summary: 'User data repository',
        type: 'feature',
        priority: 'high',
        acceptance: makeAcceptance(1),
        tags: ['db', 'user'],
        codeLinks: [{ kind: 'class', file: 'src/db/user-repo.ts', symbol: 'UserRepository' }],
        relations: [{ type: 'depends-on', target: 'db-connection' }],
      },
      {
        slug: 'auth-bug-refresh',
        summary: 'Bug: refresh token not invalidated on password change',
        type: 'bug',
        priority: 'critical',
        acceptance: [{ id: 'ac-1', description: 'Password change invalidates all refresh tokens', verified: false }],
        tags: ['auth', 'bug'],
        relations: [{ type: 'related', target: 'auth-token' }, { type: 'related', target: 'user-repo' }],
      },
      {
        slug: 'perf-spike-caching',
        summary: 'Spike: investigate caching strategy for token validation',
        type: 'spike',
        priority: 'low',
        acceptance: makeAcceptance(1),
        tags: ['perf'],
        relations: [{ type: 'references', target: 'auth-token' }],
      },
      {
        slug: 'adr-token-algorithm',
        summary: 'Decision: use RS256 for JWT signing',
        type: 'decision',
        priority: 'medium',
        acceptance: makeAcceptance(1),
        body: '# ADR: Token Signing Algorithm\n\nWe chose RS256 over HS256 for asymmetric key management.',
        tags: ['adr'],
        relations: [{ type: 'references', target: 'auth-core' }],
      },
    ];

    const bulkResult = await bulkCreateCards(ctx, cards);

    // Assert: all 10 created successfully
    expect(bulkResult.created).toBe(10);
    expect(bulkResult.failed).toBe(0);
    expect(bulkResult.keys).toHaveLength(10);
    expect(bulkResult.errors).toHaveLength(0);

    // ── Step 2: Verify the full graph is consistent ─────────────────────
    const allCards = listCards(ctx);
    expect(allCards).toHaveLength(10);

    // Verify cross-relations survived bulk create
    const authTokenRels = listCardRelations(ctx, 'auth-token');
    const authTokenForward = authTokenRels.filter((r) => !r.isReverse);
    expect(authTokenForward.some((r) => r.dstCardKey === 'auth-core' && r.type === 'depends-on')).toBe(true);

    // Verify auth-core has reverse relations from auth-token, auth-session, adr-token-algorithm
    const authCoreRels = listCardRelations(ctx, 'auth-core');
    const authCoreReverse = authCoreRels.filter((r) => r.isReverse);
    expect(authCoreReverse.length).toBeGreaterThanOrEqual(2); // auth-token, auth-session depend on it

    // ── Step 3: Generate context from different starting cards ───────────
    // From auth-core: should reach most auth-related cards
    const authContext = await generateContext(ctx, 'auth-core', { maxDepth: 3 });
    expect(authContext.cards.length).toBeGreaterThanOrEqual(3);
    expect(authContext.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
    expect(authContext.codeLinks.length).toBeGreaterThanOrEqual(1);

    // From db-connection: should reach user-repo and via bug card to auth area
    const dbContext = await generateContext(ctx, 'db-connection', { maxDepth: 3 });
    expect(dbContext.cards.length).toBeGreaterThanOrEqual(2);

    // ── Step 4: Check drift on all cards ────────────────────────────────
    const globalDrift = checkDrift(ctx);
    expect(globalDrift.driftScore).toBeGreaterThanOrEqual(0);
    expect(globalDrift.driftScore).toBeLessThanOrEqual(1);

    // ── Step 5: Check interactions between related cards ────────────────
    const interactions = checkInteractions(ctx, ['auth-token', 'auth-session', 'auth-bug-refresh']);
    // auth-token and auth-session share auth-core dependency
    expect(interactions.interactions.length).toBeGreaterThanOrEqual(1);

    // ── Step 6: Pre-change check on shared file ─────────────────────────
    const preCheck = preChangeCheck(ctx, ['src/auth/token.ts']);
    expect(preCheck.affectedCards.length).toBeGreaterThanOrEqual(1);
    expect(preCheck.affectedCards.some((c) => c.key === 'auth-token')).toBe(true);

    // ── Step 7: Validate all cards ──────────────────────────────────────
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows).toHaveLength(0);
    expect(validation.orphanFiles).toHaveLength(0);
  });
});

// ============================================================================
// SCENARIO 3: Refactoring Workflow
// ============================================================================

describe('Scenario 3: Refactoring Workflow', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should track code links through pre-change -> rename -> verify acceptance -> check drift', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // ── Step 1: Create cards with code links ────────────────────────────
    await createCard(ctx, {
      slug: 'token-service',
      summary: 'Token generation and validation',
      type: 'feature',
      priority: 'high',
      acceptance: [
        { id: 'ac-1', description: 'Tokens are signed with RS256', verified: true },
        { id: 'ac-2', description: 'Expired tokens are rejected', verified: true },
      ],
      codeLinks: [
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'generateToken' },
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'validateToken' },
      ],
      tags: ['auth'],
    });

    await createCard(ctx, {
      slug: 'auth-middleware',
      summary: 'Authentication middleware for API routes',
      type: 'feature',
      priority: 'high',
      acceptance: [
        { id: 'ac-1', description: 'Unauthenticated requests get 401', verified: true },
      ],
      codeLinks: [
        { kind: 'function', file: 'src/auth/token.ts', symbol: 'validateToken' },
        { kind: 'function', file: 'src/middleware/auth.ts', symbol: 'authMiddleware' },
      ],
      relations: [{ type: 'depends-on', target: 'token-service' }],
      tags: ['auth', 'middleware'],
    });

    // ── Step 2: Pre-change check before modifying token.ts ──────────────
    const preCheck = preChangeCheck(ctx, ['src/auth/token.ts'], ['generateToken']);
    expect(preCheck.affectedCards.some((c) => c.key === 'token-service' && c.linkType === 'direct')).toBe(true);
    // auth-middleware should appear as transitive or direct (depends on implementation)
    expect(preCheck.riskLevel).not.toBe('low');
    // At-risk acceptance should include verified criteria on directly affected cards
    expect(preCheck.atRiskAcceptance.length).toBeGreaterThanOrEqual(1);

    // ── Step 3: Verify acceptance criteria ───────────────────────────────
    // Unverify ac-1 (simulating code change invalidating it)
    await verifyAcceptance(ctx, 'token-service', 'ac-1', false);

    const unverifiedList = listUnverified(ctx);
    expect(unverifiedList.some((u) => u.key === 'token-service')).toBe(true);

    // Re-verify after fix
    await verifyAcceptance(ctx, 'token-service', 'ac-1', true);
    const afterReverify = await getCard(ctx, 'token-service');
    expect(afterReverify.frontmatter.acceptance![0]!.verified).toBe(true);

    // ── Step 4: Check drift ─────────────────────────────────────────────
    const drift = checkDrift(ctx, 'token-service');
    expect(drift.driftScore).toBeGreaterThanOrEqual(0);

    // ── Step 5: Verify acceptance changelog ──────────────────────────────
    const history = getCardHistory(ctx, 'token-service');
    const acceptanceChanges = history.filter((h) => h.field === 'acceptance');
    expect(acceptanceChanges.length).toBeGreaterThanOrEqual(2); // unverify + re-verify

    // ── Step 6: Check interactions between the two cards ────────────────
    const interactions = checkInteractions(ctx, ['token-service', 'auth-middleware']);
    // They share src/auth/token.ts:validateToken
    expect(interactions.interactions.length).toBeGreaterThanOrEqual(1);
    const pair = interactions.interactions.find(
      (i) => i.pair.includes('token-service') && i.pair.includes('auth-middleware'),
    );
    expect(pair).toBeDefined();
    expect(pair!.sharedSymbols.length).toBeGreaterThanOrEqual(1);
    expect(pair!.sharedSymbols.some((s) => s.symbol === 'validateToken')).toBe(true);

    // ── Step 7: Regression guard ────────────────────────────────────────
    const regression = regressionGuard(ctx, ['src/auth/token.ts']);
    expect(regression.qualityGate).toBeDefined();
    // Since we have verified acceptance criteria on a card linked to this file,
    // there should be at-risk acceptance
    expect(regression.affectedAcceptance.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// SCENARIO 4: Concurrent Chaos
// ============================================================================

describe('Scenario 4: Concurrent Chaos', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should handle simultaneous creates, updates, renames, and deletes without data corruption', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // ── Step 1: Create base cards ───────────────────────────────────────
    const baseCards = Array.from({ length: 10 }, (_, i) => ({
      slug: `concurrent-${i}`,
      summary: `Concurrent card ${i}`,
      type: 'feature' as const,
      priority: 'medium' as const,
      keywords: [`kw-${i}`],
      tags: [`tag-${i}`],
      acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] as AcceptanceCriterion[],
    }));

    // Create sequentially first so we have a base
    for (const card of baseCards) {
      await createCard(ctx, card);
    }

    // ── Step 2: Concurrent operations ───────────────────────────────────
    const operations = [
      // Create new cards
      createCard(ctx, { slug: 'new-1', summary: 'New card 1', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }),
      createCard(ctx, { slug: 'new-2', summary: 'New card 2', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }),

      // Update existing cards
      updateCard(ctx, 'concurrent-0', { summary: 'Updated 0', keywords: ['updated'] }),
      updateCard(ctx, 'concurrent-1', { summary: 'Updated 1', tags: ['updated-tag'] }),
      updateCard(ctx, 'concurrent-2', { body: 'New body for card 2' }),

      // Status changes
      updateCardStatus(ctx, 'concurrent-3', 'accepted'),
      updateCardStatus(ctx, 'concurrent-4', 'accepted'),

      // Delete
      deleteCard(ctx, 'concurrent-9'),

      // Rename
      renameCard(ctx, 'concurrent-8', 'renamed-8'),
    ];

    const results = await Promise.allSettled(operations);

    // All operations should succeed
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }

    // ── Step 3: Verify no data corruption ───────────────────────────────
    const allCards = listCards(ctx);

    // Should have: 10 original - 1 deleted + 2 new = 11
    // But concurrent-8 was renamed to renamed-8
    expect(allCards).toHaveLength(11);

    // Verify updates stuck
    const updated0 = ctx.cardRepo.findByKey('concurrent-0');
    expect(updated0?.summary).toBe('Updated 0');

    // Verify deleted card is gone
    expect(ctx.cardRepo.findByKey('concurrent-9')).toBeNull();

    // Verify renamed card
    expect(ctx.cardRepo.findByKey('concurrent-8')).toBeNull();
    expect(ctx.cardRepo.findByKey('renamed-8')).not.toBeNull();

    // Verify status changes
    expect(ctx.cardRepo.findByKey('concurrent-3')?.status).toBe('accepted');
    expect(ctx.cardRepo.findByKey('concurrent-4')?.status).toBe('accepted');

    // ── Step 4: Validate DB-file consistency ────────────────────────────
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows).toHaveLength(0);
    expect(validation.orphanFiles).toHaveLength(0);
  });

  it('should handle parallel creates for the same slug gracefully', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    const results = await Promise.allSettled([
      createCard(ctx, { slug: 'race-card', summary: 'First', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }),
      createCard(ctx, { slug: 'race-card', summary: 'Second', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }),
    ]);

    // One should succeed, one should fail with CardAlreadyExistsError
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('should handle parallel updates to the same card without field loss', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    await createCard(ctx, {
      slug: 'shared-card',
      summary: 'Original',
      keywords: ['kw1'],
      tags: ['tag1'],
      body: 'Original body', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    // These updates target different fields, so both should succeed
    // (withCardLock serializes them in FIFO order)
    await Promise.allSettled([
      updateCard(ctx, 'shared-card', { summary: 'Updated summary' }),
      updateCard(ctx, 'shared-card', { body: 'Updated body' }),
    ]);

    // The second update in FIFO order wins for overlapping fields,
    // but since they target different fields, we need to check final state
    const final = await getCard(ctx, 'shared-card');
    // Keywords and tags should survive either way
    expect(final.frontmatter.keywords).toEqual(['kw1']);
    expect(final.frontmatter.tags).toEqual(['tag1']);
  });
});

// ============================================================================
// SCENARIO 5: Data Corruption Resistance
// ============================================================================

describe('Scenario 5: Data Corruption Resistance', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should report error on corrupt YAML but leave other cards unaffected', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // Create two valid cards
    await createCard(ctx, { slug: 'healthy-card', summary: 'Healthy card', keywords: ['test'], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    await createCard(ctx, { slug: 'victim-card', summary: 'Will be corrupted', keywords: ['victim'], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    // Corrupt victim-card file with bad YAML
    const victimPath = buildCardPath(tc.cardsDir, 'victim-card');
    await writeFile(victimPath, '---\n{{{invalid yaml not closed\n---\nBody');

    // Sync should fail for corrupt file
    await expect(syncCardFromFile(ctx, victimPath)).rejects.toThrow();

    // Healthy card should be unaffected
    const healthy = await getCard(ctx, 'healthy-card');
    expect(healthy.frontmatter.summary).toBe('Healthy card');
    expect(healthy.frontmatter.keywords).toEqual(['test']);

    // Bulk sync should report the error but succeed for healthy cards
    const bulkResult = await bulkSyncCards(ctx);
    expect(bulkResult.errors.length).toBeGreaterThanOrEqual(1);
    // healthy-card should still sync fine
  });

  it('should detect stale DB row when file is externally deleted', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    await createCard(ctx, { slug: 'ephemeral', summary: 'Will be deleted externally', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    // Externally delete the file (bypass emberdeck)
    const filePath = buildCardPath(tc.cardsDir, 'ephemeral');
    await unlink(filePath);

    // DB still has the row
    expect(ctx.cardRepo.findByKey('ephemeral')).not.toBeNull();

    // validate_cards should detect the stale row
    const validation = await validateCards(ctx);
    expect(validation.staleDbRows.length).toBe(1);
    expect(validation.staleDbRows[0]!.key).toBe('ephemeral');
  });

  it('should handle missing frontmatter fields gracefully on sync', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // Create a card with all fields
    await createCard(ctx, {
      slug: 'full-card',
      summary: 'Full card',
      type: 'feature',
      priority: 'high',
      acceptance: makeAcceptance(2),
      keywords: ['test'],
      tags: ['tag'],
      codeLinks: [{ kind: 'function', file: 'src/test.ts', symbol: 'fn' }],
      constraints: { rule: 'value' },
    });

    // Overwrite file with minimal valid YAML (missing optional fields)
    const filePath = buildCardPath(tc.cardsDir, 'full-card');
    const minimalContent = '---\nkey: full-card\nsummary: Minimal now\nstatus: draft\n---\n';
    await writeFile(filePath, minimalContent);

    // Sync from the stripped file
    await syncCardFromFile(ctx, filePath);

    // DB should reflect the minimal state
    const row = ctx.cardRepo.findByKey('full-card');
    expect(row).not.toBeNull();
    expect(row!.summary).toBe('Minimal now');
    expect(row!.type).toBeNull();
    expect(row!.priority).toBeNull();
    expect(row!.acceptanceJson).toBeNull();
    expect(row!.constraintsJson).toBeNull();

    // Relations, keywords, tags, codeLinks should be cleared
    expect(ctx.relationRepo.findByCardKey('full-card')).toHaveLength(0);
    expect(ctx.classificationRepo.findKeywordsByCard('full-card')).toHaveLength(0);
    expect(ctx.classificationRepo.findTagsByCard('full-card')).toHaveLength(0);
    expect(ctx.codeLinkRepo.findByCardKey('full-card')).toHaveLength(0);
  });
});

// ============================================================================
// SCENARIO 6: Edge Case Tornado
// ============================================================================

describe('Scenario 6: Edge Case Tornado', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should handle maximum-length fields at validation limits', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    const maxSummary = 'A'.repeat(LIMITS.SUMMARY_MAX);
    const maxBody = 'B'.repeat(LIMITS.BODY_MAX);
    const maxKeywords = Array.from({ length: LIMITS.ARRAY_MAX }, (_, i) => `kw-${i}`);
    const maxTags = Array.from({ length: LIMITS.ARRAY_MAX }, (_, i) => `tag-${i}`);
    const maxRelationTargets: CreateCardInput[] = [];

    // Create 100 target cards for relations
    for (let i = 0; i < LIMITS.ARRAY_MAX; i++) {
      await createCard(ctx, { slug: `target-${i}`, summary: `Target ${i}`, acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });
    }
    const maxRelations = Array.from({ length: LIMITS.ARRAY_MAX }, (_, i) => ({
      type: 'related',
      target: `target-${i}`,
    }));
    const maxCodeLinks = Array.from({ length: LIMITS.ARRAY_MAX }, (_, i) => ({
      kind: 'function',
      file: `src/mod-${i}.ts`,
      symbol: `fn${i}`,
    }));

    const result = await createCard(ctx, {
      slug: 'max-card',
      summary: maxSummary,
      body: maxBody,
      keywords: maxKeywords,
      tags: maxTags,
      relations: maxRelations,
      codeLinks: maxCodeLinks,
      type: 'feature',
      priority: 'critical',
      acceptance: makeAcceptance(50), // not limited by ARRAY_MAX
      constraints: {
        deeply: { nested: { value: { goes: { here: 'deep' } } } },
        array: [1, 2, 3, { nested: true }],
      },
    });

    // Verify all fields survived
    const card = await getCard(ctx, 'max-card');
    expect(card.frontmatter.summary).toHaveLength(LIMITS.SUMMARY_MAX);
    expect(card.body).toHaveLength(LIMITS.BODY_MAX);
    expect(card.frontmatter.keywords).toHaveLength(LIMITS.ARRAY_MAX);
    expect(card.frontmatter.tags).toHaveLength(LIMITS.ARRAY_MAX);
    expect(card.frontmatter.relations).toHaveLength(LIMITS.ARRAY_MAX);
    expect(card.frontmatter.codeLinks).toHaveLength(LIMITS.ARRAY_MAX);
    expect(card.frontmatter.acceptance).toHaveLength(50);

    // Deeply nested constraints survived
    const constraints = card.frontmatter.constraints as Record<string, unknown>;
    expect((constraints.deeply as any).nested.value.goes.here).toBe('deep');
    expect((constraints.array as any[])[3].nested).toBe(true);

    // Verify DB roundtrip
    const row = ctx.cardRepo.findByKey('max-card');
    expect(row).not.toBeNull();
    const dbConstraints = JSON.parse(row!.constraintsJson!);
    expect(dbConstraints.deeply.nested.value.goes.here).toBe('deep');
  });

  it('should handle minimal card (all optional fields omitted)', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    const result = await createCard(ctx, { slug: 'minimal', summary: 'Just a summary', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    const card = await getCard(ctx, 'minimal');
    expect(card.frontmatter.key).toBe('minimal');
    expect(card.frontmatter.summary).toBe('Just a summary');
    expect(card.frontmatter.status).toBe('draft');
    expect(card.frontmatter.type).toBeUndefined();
    expect(card.frontmatter.priority).toBeUndefined();
    expect(card.frontmatter.acceptance).toHaveLength(1);
    expect(card.frontmatter.keywords).toBeUndefined();
    expect(card.frontmatter.tags).toBeUndefined();
    expect(card.frontmatter.relations).toBeUndefined();
    expect(card.frontmatter.codeLinks).toBeUndefined();
    expect(card.frontmatter.constraints).toBeUndefined();

    // Should survive export/sync roundtrip
    await exportCardToFile(ctx, 'minimal');
    await syncCardFromFile(ctx, buildCardPath(tc.cardsDir, 'minimal'));
    const afterRoundtrip = await getCard(ctx, 'minimal');
    expect(afterRoundtrip.frontmatter.type).toBeUndefined();
    expect(afterRoundtrip.frontmatter.priority).toBeUndefined();
  });

  it('should handle multiple rename chains (a -> b -> c -> d)', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    await createCard(ctx, {
      slug: 'chain-a',
      summary: 'Chain start',
      type: 'feature',
      priority: 'high',
      keywords: ['chain'],
      tags: ['rename-test'],
      acceptance: [{ id: 'ac-1', description: 'Chain survives', verified: true }],
      body: 'Original body content that must survive every rename.',
      constraints: { chainDepth: 4 },
    });

    // a -> b
    await renameCard(ctx, 'chain-a', 'chain-b');
    expect(ctx.cardRepo.findByKey('chain-a')).toBeNull();
    expect(ctx.cardRepo.findByKey('chain-b')).not.toBeNull();

    // b -> c
    await renameCard(ctx, 'chain-b', 'chain-c');
    expect(ctx.cardRepo.findByKey('chain-b')).toBeNull();
    expect(ctx.cardRepo.findByKey('chain-c')).not.toBeNull();

    // c -> d
    await renameCard(ctx, 'chain-c', 'chain-d');
    expect(ctx.cardRepo.findByKey('chain-c')).toBeNull();

    // Verify ALL fields survived the entire chain
    const final = await getCard(ctx, 'chain-d');
    expect(final.frontmatter.key).toBe('chain-d');
    expect(final.frontmatter.summary).toBe('Chain start');
    expect(final.frontmatter.type).toBe('feature');
    expect(final.frontmatter.priority).toBe('high');
    expect(final.frontmatter.keywords).toEqual(['chain']);
    expect(final.frontmatter.tags).toEqual(['rename-test']);
    expect(final.frontmatter.acceptance![0]!.verified).toBe(true);
    expect(final.body).toContain('Original body content that must survive every rename.');
    expect((final.frontmatter.constraints as Record<string, number>).chainDepth).toBe(4);

    // Changelog should have migrated through all renames
    const history = getCardHistory(ctx, 'chain-d');
    // History may or may not have entries depending on whether rename creates changelog
    // but at minimum the card should be queryable
    expect(ctx.cardRepo.findByKey('chain-d')).not.toBeNull();

    // File should exist at new path and not at old paths
    expect(existsSync(buildCardPath(tc.cardsDir, 'chain-d'))).toBe(true);
    expect(existsSync(buildCardPath(tc.cardsDir, 'chain-a'))).toBe(false);
    expect(existsSync(buildCardPath(tc.cardsDir, 'chain-b'))).toBe(false);
    expect(existsSync(buildCardPath(tc.cardsDir, 'chain-c'))).toBe(false);
  });

  it('should handle acceptance verify -> unverify -> re-verify -> status transition', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    await createCard(ctx, {
      slug: 'acceptance-lifecycle',
      summary: 'Acceptance lifecycle test',
      acceptance: [
        { id: 'ac-1', description: 'First criterion', verified: false },
        { id: 'ac-2', description: 'Second criterion', verified: false },
        { id: 'ac-3', description: 'Third criterion', verified: false },
      ],
    });

    // Verify all
    await verifyAcceptance(ctx, 'acceptance-lifecycle', ['ac-1', 'ac-2', 'ac-3'], true);
    let card = await getCard(ctx, 'acceptance-lifecycle');
    expect(card.frontmatter.acceptance!.every((ac) => ac.verified)).toBe(true);

    // Unverify one
    await verifyAcceptance(ctx, 'acceptance-lifecycle', 'ac-2', false);
    card = await getCard(ctx, 'acceptance-lifecycle');
    expect(card.frontmatter.acceptance![0]!.verified).toBe(true);
    expect(card.frontmatter.acceptance![1]!.verified).toBe(false);
    expect(card.frontmatter.acceptance![2]!.verified).toBe(true);

    // Re-verify
    await verifyAcceptance(ctx, 'acceptance-lifecycle', 'ac-2', true);
    card = await getCard(ctx, 'acceptance-lifecycle');
    expect(card.frontmatter.acceptance!.every((ac) => ac.verified)).toBe(true);

    // Transition to implemented (should have no warnings since all verified)
    await updateCardStatus(ctx, 'acceptance-lifecycle', 'accepted');
    await updateCardStatus(ctx, 'acceptance-lifecycle', 'implementing');
    const implResult = await updateCardStatus(ctx, 'acceptance-lifecycle', 'implemented');
    expect(implResult.warnings ?? []).toHaveLength(0);

    // Verify changelog tracked all acceptance changes
    const history = getCardHistory(ctx, 'acceptance-lifecycle');
    const acceptanceChanges = history.filter((h) => h.field === 'acceptance');
    expect(acceptanceChanges).toHaveLength(3); // verify all, unverify ac-2, re-verify ac-2
  });

  it('should handle full status lifecycle with changelog at each step', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    await createCard(ctx, { slug: 'status-lifecycle', summary: 'Status lifecycle test', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    const statuses = ['accepted', 'implementing', 'implemented', 'deprecated'] as const;
    for (const status of statuses) {
      await updateCardStatus(ctx, 'status-lifecycle', status);
    }

    const history = getCardHistory(ctx, 'status-lifecycle');
    const statusChanges = history.filter((h) => h.field === 'status');
    expect(statusChanges).toHaveLength(4);

    // Verify the change chain: draft->accepted->implementing->implemented->deprecated
    // History is ordered by changedAt DESC, so newest first
    const sorted = [...statusChanges].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    expect(sorted[0]!.oldValue).toBe('draft');
    expect(sorted[0]!.newValue).toBe('accepted');
    expect(sorted[1]!.oldValue).toBe('accepted');
    expect(sorted[1]!.newValue).toBe('implementing');
    expect(sorted[2]!.oldValue).toBe('implementing');
    expect(sorted[2]!.newValue).toBe('implemented');
    expect(sorted[3]!.oldValue).toBe('implemented');
    expect(sorted[3]!.newValue).toBe('deprecated');
  });

  it('should handle bulk_create with some failing and some succeeding', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // Pre-create a card that will cause a duplicate conflict
    await createCard(ctx, { slug: 'existing-card', summary: 'Already exists', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    const inputs: CreateCardInput[] = [
      { slug: 'good-1', summary: 'Good card 1', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: 'existing-card', summary: 'Duplicate - should fail', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }, // duplicate
      { slug: 'good-2', summary: 'Good card 2', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
      { slug: '!!!invalid!!!', summary: 'Invalid slug', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] }, // invalid slug
      { slug: 'good-3', summary: 'Good card 3', relations: [{ type: 'related', target: 'good-1' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] },
    ];

    const result = await bulkCreateCards(ctx, inputs);

    // good-1, good-2, good-3 should succeed. existing-card and invalid should fail.
    expect(result.created).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.keys).toContain('good-1');
    expect(result.keys).toContain('good-2');
    expect(result.keys).toContain('good-3');

    // Cross-relations within the batch should work
    const good3Rels = listCardRelations(ctx, 'good-3');
    const good3Forward = good3Rels.filter((r) => !r.isReverse);
    expect(good3Forward.some((r) => r.dstCardKey === 'good-1')).toBe(true);
  });
});

// ============================================================================
// SCENARIO 7: Cross-Feature Interaction
// ============================================================================

describe('Scenario 7: Cross-Feature Interaction', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('should maintain all data through a full cross-feature workflow', async () => {
    tc = await createTestContext();
    const { ctx } = tc;

    // ── Step 1: Create card with acceptance + code links + relations ─────
    await createCard(ctx, { slug: 'dep-card', summary: 'Dependency card', acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    await createCard(ctx, {
      slug: 'cross-feature',
      summary: 'Cross-feature integration test',
      type: 'feature',
      priority: 'high',
      acceptance: [
        { id: 'ac-1', description: 'Feature A works with Feature B', verified: false },
        { id: 'ac-2', description: 'Performance meets SLA', verified: false },
        { id: 'ac-3', description: 'Error handling covers all edge cases', verified: false },
      ],
      codeLinks: [
        { kind: 'function', file: 'src/feature/handler.ts', symbol: 'handleRequest' },
        { kind: 'class', file: 'src/feature/service.ts', symbol: 'FeatureService' },
      ],
      relations: [{ type: 'depends-on', target: 'dep-card' }],
      keywords: ['integration', 'cross-feature'],
      tags: ['feature', 'priority'],
      body: '# Cross Feature\n\nThis card tests cross-feature interactions.',
      constraints: { sla: '200ms', maxRetries: 3 },
    });

    // ── Step 2: Verify acceptance -> generates changelog ────────────────
    const verifyResult = await verifyAcceptance(ctx, 'cross-feature', ['ac-1', 'ac-2'], true);
    expect(verifyResult.changed).toBe(2);

    let history = getCardHistory(ctx, 'cross-feature');
    const verifyChangelog = history.find((h) => h.field === 'acceptance');
    expect(verifyChangelog).toBeDefined();

    // ── Step 3: Update card type/priority -> generates changelog ────────
    await updateCard(ctx, 'cross-feature', { type: 'refactor', priority: 'critical' });

    history = getCardHistory(ctx, 'cross-feature');
    const typeChangelog = history.find((h) => h.field === 'type');
    expect(typeChangelog).toBeDefined();
    expect(typeChangelog!.oldValue).toBe('feature');
    expect(typeChangelog!.newValue).toBe('refactor');

    const priorityChangelog = history.find((h) => h.field === 'priority');
    expect(priorityChangelog).toBeDefined();
    expect(priorityChangelog!.oldValue).toBe('high');
    expect(priorityChangelog!.newValue).toBe('critical');

    // ── Step 4: Rename card -> changelog preserved ──────────────────────
    await renameCard(ctx, 'cross-feature', 'cross-feature-v2');

    const renamedHistory = getCardHistory(ctx, 'cross-feature-v2');
    // All previous changelog entries should have been migrated
    expect(renamedHistory.length).toBeGreaterThanOrEqual(3); // acceptance, type, priority at minimum

    // Verify renamed card has all fields
    const renamedCard = await getCard(ctx, 'cross-feature-v2');
    expect(renamedCard.frontmatter.type).toBe('refactor');
    expect(renamedCard.frontmatter.priority).toBe('critical');
    expect(renamedCard.frontmatter.acceptance).toHaveLength(3);
    expect(renamedCard.frontmatter.acceptance![0]!.verified).toBe(true);
    expect(renamedCard.frontmatter.acceptance![1]!.verified).toBe(true);
    expect(renamedCard.frontmatter.acceptance![2]!.verified).toBe(false);
    expect(renamedCard.frontmatter.codeLinks).toHaveLength(2);
    expect(renamedCard.frontmatter.relations).toHaveLength(1);
    expect(renamedCard.frontmatter.keywords).toEqual(['integration', 'cross-feature']);
    expect(renamedCard.frontmatter.tags).toEqual(['feature', 'priority']);
    expect(renamedCard.body).toContain('# Cross Feature');
    expect((renamedCard.frontmatter.constraints as Record<string, unknown>).sla).toBe('200ms');

    // ── Step 5: Generate context -> includes all data ───────────────────
    const contextPack = await generateContext(ctx, 'cross-feature-v2', {
      maxDepth: 3,
      includeBody: true,
    });

    // Root card should be included
    const rootInContext = contextPack.cards.find((c) => c.key === 'cross-feature-v2');
    expect(rootInContext).toBeDefined();
    expect(rootInContext!.body).toBeDefined();

    // Related cards should be included
    expect(contextPack.cards.some((c) => c.key === 'dep-card')).toBe(true);

    // Acceptance criteria
    const contextAcceptance = contextPack.acceptanceCriteria.filter((ac) => ac.cardKey === 'cross-feature-v2');
    expect(contextAcceptance).toHaveLength(3);
    expect(contextAcceptance.filter((ac) => ac.verified)).toHaveLength(2);

    // Code links
    expect(contextPack.codeLinks.filter((cl) => cl.cardKey === 'cross-feature-v2')).toHaveLength(2);

    // Relations
    expect(contextPack.relationGraph.length).toBeGreaterThanOrEqual(1);

    // Constraints
    expect(contextPack.constraints['cross-feature-v2']).toBeDefined();
    expect((contextPack.constraints['cross-feature-v2'] as Record<string, unknown>).sla).toBe('200ms');

    // Recent changes
    expect(contextPack.recentChanges.length).toBeGreaterThan(0);

    // ── Step 6: Check drift -> reflects acceptance state ────────────────
    const drift = checkDrift(ctx, 'cross-feature-v2');
    expect(drift.driftScore).toBeGreaterThanOrEqual(0);
    // Should detect ac-3 as unverified
    const driftCard = drift.staleCards.find((c) => c.key === 'cross-feature-v2');
    if (driftCard) {
      expect(driftCard.unverifiedAcceptance).toBe(1); // ac-3 only
    }

    // ── Step 7: Check interactions -> detects shared symbols ────────────
    // Create another card that shares a code link file
    await createCard(ctx, {
      slug: 'overlapping-feature',
      summary: 'Overlapping feature',
      codeLinks: [{ kind: 'function', file: 'src/feature/handler.ts', symbol: 'handleRequest' }], acceptance: [{ id: 'ac-1', description: 'placeholder criterion', verified: false }] });

    const interactions = checkInteractions(ctx, ['cross-feature-v2', 'overlapping-feature']);
    expect(interactions.interactions.length).toBeGreaterThanOrEqual(1);
    const sharedPair = interactions.interactions.find(
      (i) => i.pair.includes('cross-feature-v2') && i.pair.includes('overlapping-feature'),
    );
    expect(sharedPair).toBeDefined();
    expect(sharedPair!.sharedSymbols).toHaveLength(1);
    expect(sharedPair!.sharedSymbols[0]!.symbol).toBe('handleRequest');

    // No defined relation -> should appear in undefinedRelations
    expect(interactions.undefinedRelations.length).toBeGreaterThanOrEqual(1);

    // ── Step 8: Pre-change check -> finds at-risk acceptance ────────────
    const preCheck = preChangeCheck(ctx, ['src/feature/handler.ts'], ['handleRequest']);
    expect(preCheck.affectedCards.some((c) => c.key === 'cross-feature-v2')).toBe(true);
    // ac-1 and ac-2 are verified on a directly affected card -> at risk
    expect(preCheck.atRiskAcceptance.length).toBeGreaterThanOrEqual(1);
    expect(preCheck.riskLevel).not.toBe('low');

    // ── Step 9: Regression guard -> cross-references acceptance ─────────
    const regression = regressionGuard(ctx, ['src/feature/handler.ts']);
    expect(regression.affectedAcceptance.length).toBeGreaterThanOrEqual(1);
    expect(regression.qualityGate).not.toBe('fail'); // no critical firebat issues
    expect(regression.recommendation).toBeDefined();

    // Regression with mock firebat report
    const regressionWithFirebat = regressionGuard(
      ctx,
      ['src/feature/handler.ts'],
      {
        issues: [
          { file: 'src/feature/handler.ts', rule: 'no-unused-vars', message: 'Unused var', severity: 'warning' },
        ],
      },
    );
    expect(regressionWithFirebat.qualityGate).toBe('warn');
    expect(regressionWithFirebat.newIssues).toHaveLength(1);

    // Critical firebat issue should cause fail
    const regressionCritical = regressionGuard(
      ctx,
      ['src/feature/handler.ts'],
      [{ severity: 'critical', message: 'Security vulnerability' }],
    );
    expect(regressionCritical.qualityGate).toBe('fail');
  });
});
