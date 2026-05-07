/**
 * Integration tests against a REAL Gildash instance — not the partial mock.
 *
 * Why: existing integration tests substitute `ctx.gildash = createMockGildash(...)`,
 * which leaves us blind to behaviors that depend on real gildash semantics
 * (project boundaries, annotation extraction, symbol kinds, getDependents,
 * heritage chains, etc). These tests use the bundled fixture project to
 * exercise the real code paths so that future refactors of `ops/link.ts`,
 * `ops/spec-sync.ts`, and `ops/context.ts` aren't validated only against mocks.
 *
 * The fixture project is a tiny TS workspace under
 * `test/fixtures/sample-ts-project/` with @spec/@brief annotations on classes
 * and a mix of imports across two domain folders (auth, billing).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { mkdtemp, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck } from '../../index';
import type { EmberdeckContext } from '../../src/config';
import { createCard } from '../../src/ops/create';
import { syncSpecAnnotations, getUncoveredSymbols, getLinkCoverage } from '../../src/ops/spec-sync';
import { findCardsBySymbol, validateCodeLinks, expandAffectedFiles } from '../../src/ops/link';
import { checkDrift } from '../../src/ops/context';
import { analyze } from '../../src/ops/analyze';
import { preChangeCheck } from '../../src/ops/impact';

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/sample-ts-project');

describe('integration: real Gildash + fixture project', () => {
  let ctx: EmberdeckContext;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Copy fixture to a tmp dir so concurrent test runs don't fight over
    // the shared .gildash/ SQLite cache that Gildash.open writes into projectRoot.
    const tmp = await mkdtemp(join(tmpdir(), 'ed-real-gildash-'));
    const cardsDir = join(tmp, 'cards');
    const projectRoot = join(tmp, 'project');
    await mkdir(cardsDir, { recursive: true });
    await cp(FIXTURE_SRC, projectRoot, { recursive: true });
    ctx = await setupEmberdeck({
      cardsDir,
      dbPath: ':memory:',
      projectRoot,
    });
    cleanup = async () => {
      await teardownEmberdeck(ctx);
      await rm(tmp, { recursive: true, force: true });
    };
    if (!ctx.gildash) throw new Error('Gildash failed to initialize against fixture');
  });

  afterAll(async () => {
    await cleanup();
  });

  it('gildash discovers fixture files', () => {
    const files = ctx.gildash!.listIndexedFiles();
    const paths = files.map((f) => f.filePath).sort();
    expect(paths.some((p) => p.endsWith('jwt.ts'))).toBe(true);
    expect(paths.some((p) => p.endsWith('session.ts'))).toBe(true);
    expect(paths.some((p) => p.endsWith('invoice.ts'))).toBe(true);
  });

  it('gildash extracts @spec annotations from fixture source', () => {
    const annotations = ctx.gildash!.searchAnnotations({ tag: 'spec', limit: 100 });
    const values = annotations.map((a) => a.value).sort();
    expect(values).toContain('auth/jwt-token');
    expect(values).toContain('auth/session');
  });

  it('@brief annotation also discoverable', () => {
    const annotations = ctx.gildash!.searchAnnotations({ tag: 'brief', limit: 100 });
    const values = annotations.map((a) => a.value);
    expect(values).toContain('billing/invoicing');
  });

  it('syncSpecAnnotations links cards to symbols when card exists', async () => {
    // Create card without codeLinks; syncSpecAnnotations should populate them
    // from the @spec annotations gildash discovered.
    await createCard(ctx, {
      key: 'auth/jwt-token',
      type: 'spec',
      summary: 'JWT issuance',
      status: 'draft',
    });
    const result = await syncSpecAnnotations(ctx);
    expect(result.created + result.alreadyLinked).toBeGreaterThan(0);
    const links = ctx.codeLinkRepo.findByCardKey('auth/jwt-token');
    expect(links.some((l) => l.file.endsWith('jwt.ts'))).toBe(true);
  });

  it('syncSpecAnnotations reports unmatched annotations for missing cards', async () => {
    const result = await syncSpecAnnotations(ctx);
    // billing/invoicing has @brief but no card created
    expect(result.unmatched.some((u) => u.cardKey === 'billing/invoicing')).toBe(true);
  });

  it('validateCodeLinks resolves a real symbol against gildash index', async () => {
    // validateCodeLinks reads codeLinks from the FILE frontmatter (not DB),
    // so we create the card with the link declared inline.
    await createCard(ctx, {
      key: 'auth/jwt-link',
      type: 'spec',
      summary: 'jwt link test',
      status: 'draft',
      codeLinks: [{ kind: 'class', file: 'src/auth/jwt.ts', symbol: 'JwtIssuer' }],
    });
    const result = await validateCodeLinks(ctx, 'auth/jwt-link');
    expect(result.declared).toBe(1);
    // status='draft' routes mismatches to planned[], not broken[].
    expect(result.broken).toEqual([]);
    // JwtIssuer exists → resolved successfully
    expect(result.valid).toBe(1);
  });

  it('validateCodeLinks routes missing-symbol to planned[] for draft cards', async () => {
    await createCard(ctx, {
      key: 'auth/missing-draft',
      type: 'spec',
      summary: 'broken',
      status: 'draft',
      codeLinks: [{ kind: 'class', file: 'src/auth/jwt.ts', symbol: 'NonexistentSymbol' }],
    });
    const result = await validateCodeLinks(ctx, 'auth/missing-draft');
    expect(result.broken).toEqual([]);
    expect(result.planned.length).toBeGreaterThan(0);
    expect(result.planned[0]!.reason).toBe('symbol-not-found');
  });

  it('findCardsBySymbol matches direct codeLinks', async () => {
    const matches = await findCardsBySymbol(ctx, 'JwtIssuer');
    expect(matches.some((m) => m.card.key === 'auth/jwt-token')).toBe(true);
  });

  it('findCardsBySymbol with file path matches boundary', async () => {
    await createCard(ctx, {
      key: 'auth/boundary-card',
      type: 'spec',
      summary: 'auth boundary',
      status: 'draft',
      boundary: ['src/auth/**'],
    });
    const matches = await findCardsBySymbol(ctx, 'whatever', 'src/auth/jwt.ts');
    expect(matches.some((m) => m.card.key === 'auth/boundary-card' && m.matchType === 'boundary')).toBe(true);
  });

  it('getUncoveredSymbols returns symbols not bound to any card', async () => {
    const result = await getUncoveredSymbols(ctx);
    expect(result.totalSymbols).toBeGreaterThan(0);
    // billing/invoicing has no card, so its exports are uncovered
    expect(result.uncovered.some((u) => u.file.endsWith('invoice.ts'))).toBe(true);
  });

  it('getLinkCoverage computes ratio for a card', async () => {
    const result = await getLinkCoverage(ctx, 'auth/jwt-token');
    expect(result.declared).toBeGreaterThan(0);
    expect(result.coverage).toBeGreaterThanOrEqual(0);
    expect(result.coverage).toBeLessThanOrEqual(1);
  });

  it('expandAffectedFiles propagates through real dependency graph', async () => {
    // session.ts imports from jwt.ts → editing jwt.ts affects session.ts
    const out = await expandAffectedFiles(ctx, ['src/auth/jwt.ts']);
    expect(out.some((p) => p.endsWith('jwt.ts'))).toBe(true);
    expect(out.some((p) => p.endsWith('session.ts'))).toBe(true);
  });

  it('checkDrift skips draft cards (not in result.cards, counted in health.draft)', async () => {
    await createCard(ctx, {
      key: 'auth/draft-card',
      type: 'spec',
      summary: 'draft',
      status: 'draft',
      boundary: ['src/auth/**'],
      codeLinks: [{ kind: 'class', file: 'src/auth/jwt.ts', symbol: 'JwtIssuer' }],
    });
    const result = await checkDrift(ctx, 'auth/draft-card', { autoTransition: false });
    expect(result.cards.find((c) => c.key === 'auth/draft-card')).toBeUndefined();
    expect(result.health.draft).toBeGreaterThan(0);
  });

  it('analyze produces non-trivial report against real index', async () => {
    const result = await analyze(ctx);
    expect(result.health.total).toBeGreaterThan(0);
    expect(result.coverage.totalSymbols).toBeGreaterThan(0);
    expect(result.coverage.ratio).not.toBeNull();
  });

  it('preChangeCheck identifies cards affected by file changes', async () => {
    const result = await preChangeCheck(ctx, ['src/auth/jwt.ts']);
    expect(result.affectedCards.length).toBeGreaterThan(0);
    // auth/jwt-token has a code link to jwt.ts
    expect(result.affectedCards.some((c) => c.key === 'auth/jwt-token')).toBe(true);
  });

  // ── Broader symbol-pattern coverage to catch gildash version regressions ──

  it('gildash indexes abstract class with generic type parameter', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'BaseRepository', exact: true });
    expect(syms.length).toBeGreaterThan(0);
    expect(syms[0]!.kind).toBe('class');
  });

  it('gildash indexes class extending a generic base', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'UserRepository', exact: true });
    expect(syms.length).toBeGreaterThan(0);
    const sym = syms[0]!;
    expect(sym.kind).toBe('class');
    expect(sym.filePath.endsWith('repository.ts')).toBe(true);
  });

  it('gildash indexes methods inside a class (UserController.list via getSymbolsByFile)', () => {
    // Method members may not be top-level searchable; query the file directly.
    const syms = ctx.gildash!.searchSymbols({ text: 'UserController', exact: true });
    expect(syms.length).toBeGreaterThan(0);
    const filePath = syms[0]!.filePath;
    const fileSyms = ctx.gildash!.getSymbolsByFile(filePath);
    // The file should contain at least the class itself plus interface RouteHandler
    expect(fileSyms.length).toBeGreaterThan(1);
  });

  it('gildash indexes namespace exports', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'Types', exact: true });
    expect(syms.length).toBeGreaterThan(0);
  });

  it('gildash exposes interfaces as searchable symbols', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'InvoiceLine', exact: true });
    expect(syms.length).toBeGreaterThan(0);
    expect(syms[0]!.kind).toBe('interface');
  });

  it('gildash exposes type aliases', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'StringOrNumber', exact: true });
    expect(syms.length).toBeGreaterThan(0);
  });

  it('gildash exposes top-level const exports', () => {
    const syms = ctx.gildash!.searchSymbols({ text: 'VERSION', exact: true });
    expect(syms.length).toBeGreaterThan(0);
  });

  it('@spec annotation on abstract class is extracted', async () => {
    const annotations = ctx.gildash!.searchAnnotations({ tag: 'spec', limit: 100 });
    expect(annotations.map((a) => a.value.trim())).toContain('generic/repository');
  });

  it('@spec annotation on namespaced controller is extracted', async () => {
    const annotations = ctx.gildash!.searchAnnotations({ tag: 'spec', limit: 100 });
    expect(annotations.map((a) => a.value.trim())).toContain('api/controller');
  });

  it('@brief annotation on namespace export is extracted', async () => {
    const annotations = ctx.gildash!.searchAnnotations({ tag: 'brief', limit: 100 });
    expect(annotations.map((a) => a.value.trim())).toContain('domain/types');
  });
});

// ── Separate suite: writeSpecAnnotations against a FRESH project must NOT
//    delete author-written @spec/@brief annotations whose target cards don't
//    exist yet. Regression for a destructive bug found via fresh-agent test.
describe('integration: spec annotate is non-destructive on fresh project', () => {
  let ctx: EmberdeckContext;
  let cleanup: () => Promise<void>;
  let projectRoot: string;

  beforeAll(async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'ed-fresh-annot-'));
    const cardsDir = join(tmp, 'cards');
    projectRoot = join(tmp, 'project');
    await mkdir(cardsDir, { recursive: true });
    await cp(FIXTURE_SRC, projectRoot, { recursive: true });
    ctx = await setupEmberdeck({ cardsDir, dbPath: ':memory:', projectRoot });
    cleanup = async () => {
      await teardownEmberdeck(ctx);
      await rm(tmp, { recursive: true, force: true });
    };
    if (!ctx.gildash) throw new Error('Gildash failed to initialize');
  });

  afterAll(async () => { await cleanup(); });

  it('writeSpecAnnotations on fresh project (no cards) preserves @spec annotations in source', async () => {
    const { writeSpecAnnotations } = await import('../../src/ops/spec-sync');
    // No cards have been created yet. Annotations exist in fixture sources.
    const result = await writeSpecAnnotations(ctx);
    // Must NOT remove any annotation — every @spec value points to a card
    // that doesn't exist in DB yet, which means the author wrote them as
    // intent hints, not as managed markers.
    expect(result.removed).toBe(0);
    // Verify by re-reading source: the @spec line is still there.
    const jwtSrc = await Bun.file(join(projectRoot, 'src/auth/jwt.ts')).text();
    expect(jwtSrc).toContain('@spec auth/jwt-token');
    const sessionSrc = await Bun.file(join(projectRoot, 'src/auth/session.ts')).text();
    expect(sessionSrc).toContain('@spec auth/session');
  });
});
