/**
 * Tests for the gildash integration extensions:
 *   - analyze.health.codeCycles (hasCycle + getCyclePaths)
 *   - preChangeCheck.maxFanIn + risk promotion (getFanMetrics)
 *   - checkDrift heritage_uncovered drift (getHeritageChain)
 *   - syncSpecAnnotations 4-tier tags (@spec/@brief/@principle/@domain)
 *   - checkDrift pattern_violation drift (findPattern + spec.code_patterns)
 */
import { describe, it, expect, afterEach } from 'bun:test';

import {
  analyze,
  checkDrift,
  preChangeCheck,
  syncSpecAnnotations,
  createCard,
  updateCardStatus,
} from '../../index';
import {
  createMockTestContext,
  ensure4tierScaffold,
  SPEC_BODY,
  makeTestSpec,
  type TestContext,
} from '../helpers';

function makeGildash(overrides: Record<string, unknown> = {}) {
  const defaults = {
    reindex: async () => ({}),
    close: async () => undefined,
    listIndexedFiles: () => [],
    getSymbolsByFile: () => [],
    searchSymbols: () => [],
    searchAnnotations: () => [],
    getSymbolChanges: () => [],
    getDependencies: () => [],
    hasCycle: async () => false,
    getCyclePaths: async () => [],
    getFanMetrics: async () => ({ filePath: '', fanIn: 0, fanOut: 0 }),
    getHeritageChain: async () => ({ symbolName: '', filePath: '', children: [] }),
    searchRelations: () => [],
    findPattern: async () => [],
  };
  return { ...defaults, ...overrides } as any;
}

// ── codeCycles in analyze ────────────────────────────────────────────

describe('analyze — health.codeCycles', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('reports cycle count and samples when hasCycle is true', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = makeGildash({
      hasCycle: async () => true,
      getCyclePaths: async () => [['a.ts', 'b.ts', 'a.ts'], ['c.ts', 'd.ts', 'c.ts']],
    });
    const result = await analyze(tc.ctx);
    expect(result.health.codeCycles).toBeDefined();
    expect(result.health.codeCycles!.count).toBe(2);
    expect(result.health.codeCycles!.samples).toHaveLength(2);
  });

  it('reports zero cycles when hasCycle is false', async () => {
    tc = await createMockTestContext();
    tc.ctx.gildash = makeGildash({ hasCycle: async () => false });
    const result = await analyze(tc.ctx);
    expect(result.health.codeCycles).toEqual({ count: 0, samples: [] });
  });

});

// ── getFanMetrics → preChangeCheck risk promotion ────────────────────

describe('preChangeCheck — maxFanIn risk promotion', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('promotes risk one tier when fan-in ≥ 10', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'hot-card',
      summary: 'Hot card',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/hot.ts', symbol: 'hot' }],
    });
    tc.ctx.gildash = makeGildash({
      getFanMetrics: async () => ({ filePath: 'src/hot.ts', fanIn: 25, fanOut: 0 }),
    });
    const result = await preChangeCheck(tc.ctx, ['src/hot.ts']);
    // base: 1 affected card → 'medium'; with fanIn=25 promote to 'high'
    expect(result.maxFanIn).toBe(25);
    expect(result.riskLevel).toBe('high');
  });

  it('does not promote when fan-in < threshold', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, {
      key: 'warm-card',
      summary: 'Warm',
      type: 'spec',
      codeLinks: [{ kind: 'function', file: 'src/warm.ts', symbol: 'warm' }],
    });
    tc.ctx.gildash = makeGildash({
      getFanMetrics: async () => ({ filePath: 'src/warm.ts', fanIn: 3, fanOut: 0 }),
    });
    const result = await preChangeCheck(tc.ctx, ['src/warm.ts']);
    expect(result.riskLevel).toBe('medium');
  });

  it('caps promotion at critical', async () => {
    tc = await createMockTestContext();
    // Create 5+ affected cards to start at 'critical'
    for (let i = 0; i < 6; i++) {
      await createCard(tc.ctx, {
        key: `crit-${i}`,
        summary: `c${i}`,
        type: 'spec',
        codeLinks: [{ kind: 'function', file: 'src/crit.ts', symbol: `s${i}` }],
      });
    }
    tc.ctx.gildash = makeGildash({
      getFanMetrics: async () => ({ filePath: 'src/crit.ts', fanIn: 100, fanOut: 0 }),
    });
    const result = await preChangeCheck(tc.ctx, ['src/crit.ts']);
    expect(result.riskLevel).toBe('critical');
  });
});

// ── getHeritageChain → checkDrift heritage_uncovered ─────────────────

describe('checkDrift — heritage_uncovered', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('flags subclasses not covered by any spec card', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'base-spec',
      summary: 'Base class spec',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'class', file: 'src/base.ts', symbol: 'Base' }],
      spec: makeTestSpec('src/base.ts', 'Base'),
    });
    await updateCardStatus(tc.ctx, 'base-spec', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) => {
        if (file === 'src/base.ts') return [{ name: 'Base', memberName: null, filePath: 'src/base.ts', kind: 'class' }];
        return [];
      },
      listIndexedFiles: () => [{ filePath: 'src/base.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      // searchRelations({type:'extends', dstFilePath}) returns relations where
      // src is a subclass and dst is the linked class. Mock one such row.
      searchRelations: () => [
        {
          type: 'extends',
          srcFilePath: 'src/derived.ts',
          srcSymbolName: 'Derived',
          dstFilePath: 'src/base.ts',
          dstSymbolName: 'Base',
          dstProject: null,
          isExternal: false,
          specifier: null,
        },
      ],
    });

    const result = await checkDrift(tc.ctx, 'base-spec', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'base-spec');
    expect(card?.driftType).toBe('heritage_uncovered');
    expect(card?.uncoveredSubclasses).toEqual([{ file: 'src/derived.ts', symbol: 'Derived' }]);
  });

  it('does not flag when subclass has its own spec card', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'covered-base',
      summary: 'Base',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'class', file: 'src/base.ts', symbol: 'Base' }],
      spec: makeTestSpec('src/base.ts', 'Base'),
    });
    await updateCardStatus(tc.ctx, 'covered-base', 'active');
    await createCard(tc.ctx, {
      key: 'covered-derived',
      summary: 'Derived',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'class', file: 'src/derived.ts', symbol: 'Derived' }],
      spec: makeTestSpec('src/derived.ts', 'Derived'),
    });

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) => {
        if (file === 'src/base.ts') return [{ name: 'Base', memberName: null, filePath: 'src/base.ts', kind: 'class' }];
        if (file === 'src/derived.ts') return [{ name: 'Derived', memberName: null, filePath: 'src/derived.ts', kind: 'class' }];
        return [];
      },
      listIndexedFiles: () => [
        { filePath: 'src/base.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 },
        { filePath: 'src/derived.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 },
      ],
      searchRelations: () => [
        {
          type: 'extends',
          srcFilePath: 'src/derived.ts',
          srcSymbolName: 'Derived',
          dstFilePath: 'src/base.ts',
          dstSymbolName: 'Base',
          dstProject: null,
          isExternal: false,
          specifier: null,
        },
      ],
    });

    const result = await checkDrift(tc.ctx, 'covered-base', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'covered-base');
    expect(card?.driftType).toBeUndefined();
  });
});

// ── searchAnnotations 4-tier ─────────────────────────────────────────

describe('syncSpecAnnotations — 4-tier annotation tags', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('creates code links for @brief/@principle/@domain tags too', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    // Use the existing scaffold cards that ensure4tierScaffold creates
    // Here we just verify the tag-routing: each tag finds a matching card.
    await createCard(tc.ctx, { key: 'plain-brief', summary: 'b', type: 'brief', parent: '_dom' });
    await createCard(tc.ctx, { key: 'plain-principle', summary: 'p', type: 'principle' });
    await createCard(tc.ctx, { key: 'plain-domain', summary: 'd', type: 'domain' });

    const annotationsByTag: Record<string, any[]> = {
      spec: [],
      brief: [{ tag: 'brief', value: 'plain-brief', filePath: 'src/x.ts', symbolName: 'fnB', source: 'line' }],
      principle: [{ tag: 'principle', value: 'plain-principle', filePath: 'src/x.ts', symbolName: 'fnP', source: 'line' }],
      domain: [{ tag: 'domain', value: 'plain-domain', filePath: 'src/x.ts', symbolName: 'fnD', source: 'line' }],
    };

    tc.ctx.gildash = makeGildash({
      searchAnnotations: ({ tag }: { tag: string }) => annotationsByTag[tag] ?? [],
      getSymbolsByFile: () => [
        { name: 'fnB', memberName: null, filePath: 'src/x.ts', kind: 'function' },
        { name: 'fnP', memberName: null, filePath: 'src/x.ts', kind: 'function' },
        { name: 'fnD', memberName: null, filePath: 'src/x.ts', kind: 'function' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(3);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-brief')).toHaveLength(1);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-principle')).toHaveLength(1);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-domain')).toHaveLength(1);
  });

  it('dedupes when a mock returns the same annotation across tag queries', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'dup-card', summary: 's', type: 'spec' });
    const ann = { tag: 'spec', value: 'dup-card', filePath: 'src/d.ts', symbolName: 'dup', source: 'line' };
    tc.ctx.gildash = makeGildash({
      // Mock returns the same annotation regardless of which tag is queried
      searchAnnotations: () => [ann],
      getSymbolsByFile: () => [{ name: 'dup', memberName: null, filePath: 'src/d.ts', kind: 'function' }],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    // Despite 4 tag queries returning the same annotation, only one link is created.
    expect(result.created).toBe(1);
  });
});

// ── findPattern → checkDrift pattern_violation ────────────────────────

describe('checkDrift — pattern_violation', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('flags forbidden pattern with matches', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/p.ts', 'fn');
    spec.code_patterns = [
      { id: 'PAT-001', pattern: 'console.log($$$)', rule: 'forbidden' },
    ];
    await createCard(tc.ctx, {
      key: 'pat-forbid',
      summary: 'No console.log',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/p.ts', symbol: 'fn' }],
      spec,
    });
    await updateCardStatus(tc.ctx, 'pat-forbid', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) =>
        file === 'src/p.ts'
          ? [{ name: 'fn', memberName: null, filePath: 'src/p.ts', kind: 'function' }]
          : [],
      listIndexedFiles: () => [{ filePath: 'src/p.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      findPattern: async () => [
        { filePath: 'src/p.ts', line: 5, column: 0, matched: 'console.log(x)' },
      ],
    });

    const result = await checkDrift(tc.ctx, 'pat-forbid', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'pat-forbid');
    expect(card?.driftType).toBe('pattern_violation');
    expect(card?.patternViolations).toEqual([{ id: 'PAT-001', rule: 'forbidden', matches: 1 }]);
  });

  it('flags required pattern with zero matches', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/r.ts', 'fn');
    spec.code_patterns = [
      { id: 'PAT-002', pattern: 'logger.info($$$)', rule: 'required' },
    ];
    await createCard(tc.ctx, {
      key: 'pat-require',
      summary: 'Must log',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/r.ts', symbol: 'fn' }],
      spec,
    });
    await updateCardStatus(tc.ctx, 'pat-require', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) =>
        file === 'src/r.ts'
          ? [{ name: 'fn', memberName: null, filePath: 'src/r.ts', kind: 'function' }]
          : [],
      listIndexedFiles: () => [{ filePath: 'src/r.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      findPattern: async () => [],
    });

    const result = await checkDrift(tc.ctx, 'pat-require', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'pat-require');
    expect(card?.driftType).toBe('pattern_violation');
    expect(card?.patternViolations).toEqual([{ id: 'PAT-002', rule: 'required', matches: 0 }]);
  });

  it('passes when forbidden pattern has zero matches and required has matches', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/ok.ts', 'fn');
    spec.code_patterns = [
      { id: 'PAT-003', pattern: 'console.log($$$)', rule: 'forbidden' },
      { id: 'PAT-004', pattern: 'logger.info($$$)', rule: 'required' },
    ];
    await createCard(tc.ctx, {
      key: 'pat-ok',
      summary: 'OK',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/ok.ts', symbol: 'fn' }],
      spec,
    });
    await updateCardStatus(tc.ctx, 'pat-ok', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) =>
        file === 'src/ok.ts'
          ? [{ name: 'fn', memberName: null, filePath: 'src/ok.ts', kind: 'function' }]
          : [],
      listIndexedFiles: () => [{ filePath: 'src/ok.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      findPattern: async (pattern: string) =>
        pattern === 'logger.info($$$)'
          ? [{ filePath: 'src/ok.ts', line: 1, column: 0, matched: 'logger.info(x)' }]
          : [],
    });

    const result = await checkDrift(tc.ctx, 'pat-ok', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'pat-ok');
    expect(card?.driftType).toBeUndefined();
  });
});

// ── multi-detection (driftTypes[]) ───────────────────────────────────

describe('checkDrift — multi-detection', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('reports both broken_link and pattern_violation simultaneously', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/m.ts', 'gone');
    spec.code_patterns = [{ id: 'PAT-1', pattern: 'console.log($$$)', rule: 'forbidden' }];
    await createCard(tc.ctx, {
      key: 'multi-d',
      summary: 'Multi drift',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/m.ts', symbol: 'gone' }],
      spec,
    });
    await updateCardStatus(tc.ctx, 'multi-d', 'active');

    tc.ctx.gildash = makeGildash({
      // gone is NOT in symbol list → broken_link
      getSymbolsByFile: () => [{ name: 'other', memberName: null, filePath: 'src/m.ts', kind: 'function' }],
      listIndexedFiles: () => [{ filePath: 'src/m.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      // pattern matches → pattern_violation
      findPattern: async () => [{ filePath: 'src/m.ts', line: 1, column: 0, matched: 'console.log(x)' }],
    });

    const result = await checkDrift(tc.ctx, 'multi-d', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'multi-d');
    expect(card?.driftType).toBe('broken_link');
    expect(card?.driftTypes).toEqual(['broken_link', 'pattern_violation']);
    expect(card?.brokenLinks).toBe(1);
    expect(card?.patternViolations).toEqual([{ id: 'PAT-1', rule: 'forbidden', matches: 1 }]);
  });

  it('driftTypes empty when no drift detected', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'clean',
      summary: 'Clean',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/c.ts', symbol: 'ok' }],
      spec: makeTestSpec('src/c.ts', 'ok'),
    });
    await updateCardStatus(tc.ctx, 'clean', 'active');
    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: () => [{ name: 'ok', memberName: null, filePath: 'src/c.ts', kind: 'function' }],
      listIndexedFiles: () => [{ filePath: 'src/c.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
    });
    const result = await checkDrift(tc.ctx, 'clean', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'clean');
    expect(card?.driftType).toBeUndefined();
    expect(card?.driftTypes).toBeUndefined();
  });

  it('priority order: broken_link before boundary_inactive', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'prio',
      summary: 'Priority test',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      boundary: ['src/nowhere/**'],
      codeLinks: [{ kind: 'function', file: 'src/p.ts', symbol: 'missing' }],
      spec: makeTestSpec('src/p.ts', 'missing'),
    });
    await updateCardStatus(tc.ctx, 'prio', 'active');
    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: () => [],
      listIndexedFiles: () => [{ filePath: 'src/p.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
    });
    const result = await checkDrift(tc.ctx, 'prio', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'prio');
    expect(card?.driftType).toBe('broken_link');
    expect(card?.driftTypes?.[0]).toBe('broken_link');
    expect(card?.driftTypes).toContain('boundary_inactive');
  });
});

// ── auto-transition for new drift types ──────────────────────────────

describe('checkDrift — auto-transition for new drift types', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('auto-transitions active→drifted on heritage_uncovered when autoTransition=true', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'auto-her',
      summary: 'Auto her',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'class', file: 'src/b.ts', symbol: 'B' }],
      spec: makeTestSpec('src/b.ts', 'B'),
    });
    await updateCardStatus(tc.ctx, 'auto-her', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) =>
        file === 'src/b.ts' ? [{ name: 'B', memberName: null, filePath: 'src/b.ts', kind: 'class' }] : [],
      listIndexedFiles: () => [{ filePath: 'src/b.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      searchRelations: () => [
        {
          type: 'extends',
          srcFilePath: 'src/d.ts',
          srcSymbolName: 'D',
          dstFilePath: 'src/b.ts',
          dstSymbolName: 'B',
          dstProject: null,
          isExternal: false,
          specifier: null,
        },
      ],
    });

    const result = await checkDrift(tc.ctx, 'auto-her', { autoTransition: true });
    const card = result.cards.find((c) => c.key === 'auto-her');
    expect(card?.driftType).toBe('heritage_uncovered');
    expect(card?.status).toBe('drifted');
    const row = tc.ctx.cardRepo.findByKey('auto-her');
    expect(row?.status).toBe('drifted');
  });

  it('auto-transitions active→drifted on pattern_violation when autoTransition=true', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/v.ts', 'fn');
    spec.code_patterns = [{ id: 'PAT-X', pattern: 'console.log($$$)', rule: 'forbidden' }];
    await createCard(tc.ctx, {
      key: 'auto-pat',
      summary: 'Auto pat',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/v.ts', symbol: 'fn' }],
      spec,
    });
    await updateCardStatus(tc.ctx, 'auto-pat', 'active');

    tc.ctx.gildash = makeGildash({
      getSymbolsByFile: (file: string) =>
        file === 'src/v.ts' ? [{ name: 'fn', memberName: null, filePath: 'src/v.ts', kind: 'function' }] : [],
      listIndexedFiles: () => [{ filePath: 'src/v.ts', project: 'p', mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }],
      findPattern: async () => [{ filePath: 'src/v.ts', line: 1, column: 0, matched: 'console.log(x)' }],
    });

    const result = await checkDrift(tc.ctx, 'auto-pat', { autoTransition: true });
    const card = result.cards.find((c) => c.key === 'auto-pat');
    expect(card?.driftType).toBe('pattern_violation');
    expect(card?.status).toBe('drifted');
  });
});

// ── monorepo: per-project routing for all 7 gildash APIs ─────────────

describe('monorepo — gildash API routing across projects', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  // Helper: build a multi-project mock where each project hosts disjoint
  // file/symbol/relation/pattern data. Verifies emberdeck iterates projects.
  function makeMultiProjectGildash(spec: {
    projects: string[];
    filesByProject: Record<string, string[]>;
    symbolsByProjectFile?: Record<string, Record<string, Array<{ name: string; kind: string }>>>;
    annotationsByProjectTag?: Record<string, Record<string, Array<{ value: string; filePath: string; symbolName: string }>>>;
    extendsByProjectFile?: Record<string, Record<string, Array<{ src: string; srcSym: string; dstSym: string }>>>;
    patternMatchesByProject?: Record<string, number>;
    fanByProjectFile?: Record<string, Record<string, { fanIn: number; fanOut: number }>>;
    dependentsByProjectFile?: Record<string, Record<string, string[]>>;
    affectedByProject?: Record<string, string[]>;
    symbolChangesByProject?: Record<string, Array<{ filePath: string; symbolName: string; changedAt: string }>>;
  }) {
    return {
      projects: spec.projects.map((p) => ({ project: p, dir: `dir-${p}` })),
      reindex: async () => ({}),
      close: async () => undefined,
      listIndexedFiles: (project?: string) => {
        const p = (project ?? spec.projects[0]) as string;
        const files = (spec.filesByProject[p] ?? []) as string[];
        return files.map((f: string) => ({ filePath: f, project: p, mtimeMs: 0, size: 0, contentHash: '', updatedAt: '', lineCount: 0 }));
      },
      getSymbolsByFile: (file: string, project?: string) => {
        const p = (project ?? spec.projects[0]) as string;
        const syms = (spec.symbolsByProjectFile?.[p]?.[file] ?? []) as Array<{ name: string; kind: string }>;
        return syms.map((s, i: number) => ({ ...s, id: i + 1, memberName: null, filePath: file, span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }, signature: null, fingerprint: null, detail: {} }));
      },
      searchAnnotations: ({ tag, project }: { tag: string; project?: string }) => {
        const p = (project ?? spec.projects[0]) as string;
        return ((spec.annotationsByProjectTag?.[p]?.[tag] ?? []) as Array<{ value: string; filePath: string; symbolName: string }>).map((a) => ({ ...a, tag, source: 'line' as const, lineNumber: 1, columnNumber: 0 }));
      },
      searchRelations: ({ type, dstFilePath, project }: { type: string; dstFilePath?: string; project?: string }) => {
        const p = (project ?? spec.projects[0]) as string;
        const fileMap = (spec.extendsByProjectFile?.[p] ?? {}) as Record<string, Array<{ src: string; srcSym: string; dstSym: string }>>;
        const out: any[] = [];
        for (const [dst, rels] of Object.entries(fileMap)) {
          if (dstFilePath && dst !== dstFilePath) continue;
          for (const r of rels) out.push({ type, srcFilePath: r.src, srcSymbolName: r.srcSym, dstFilePath: dst, dstSymbolName: r.dstSym, dstProject: p, isExternal: false, specifier: null });
        }
        return out;
      },
      findPattern: async (_pattern: string, opts?: { project?: string }) => {
        const p = (opts?.project ?? spec.projects[0]) as string;
        const n = spec.patternMatchesByProject?.[p] ?? 0;
        return Array.from({ length: n }, (_, i) => ({ filePath: `m-${i}.ts`, line: 1, column: 0, matched: '' }));
      },
      getFanMetrics: async (file: string, project?: string) => {
        const p = (project ?? spec.projects[0]) as string;
        return spec.fanByProjectFile?.[p]?.[file] ?? { fanIn: 0, fanOut: 0 };
      },
      getDependents: (file: string, project?: string) => {
        const p = (project ?? spec.projects[0]) as string;
        return spec.dependentsByProjectFile?.[p]?.[file] ?? [];
      },
      getDependencies: (_file: string, _project?: string) => [],
      getAffected: async (changedFiles: string[], project?: string) => {
        const p = (project ?? spec.projects[0]) as string;
        return [...changedFiles, ...(spec.affectedByProject?.[p] ?? [])];
      },
      getSymbolChanges: (_since: any, opts?: { project?: string }) => {
        const p = (opts?.project ?? spec.projects[0]) as string;
        return (spec.symbolChangesByProject?.[p] ?? []).map((c) => ({ ...c, changeType: 'modified' as const, symbolKind: 'function', oldName: null, oldFilePath: null, fingerprint: null, isFullIndex: false, indexRunId: 'r1' }));
      },
      getStats: () => ({ symbolCount: 0, fileCount: 0 }),
      hasCycle: async () => false,
      getCyclePaths: async () => [],
    } as any;
  }

  it('SymbolFileCache unions symbols from each project', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, {
      key: 'union-card',
      summary: 'union',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/u.ts', symbol: 'fnFromB' }],
      spec: makeTestSpec('src/u.ts', 'fnFromB'),
    });
    await updateCardStatus(tc.ctx, 'union-card', 'active');
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: ['src/u.ts'], projB: ['src/u.ts'] },
      symbolsByProjectFile: {
        projA: { 'src/u.ts': [{ name: 'fnFromA', kind: 'function' }] },
        projB: { 'src/u.ts': [{ name: 'fnFromB', kind: 'function' }] },
      },
    });
    const result = await checkDrift(tc.ctx, 'union-card', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'union-card');
    // fnFromB exists in projB → broken_link should NOT fire (cache union).
    expect(card?.brokenLinks).toBe(0);
  });

  it('searchAnnotations iterates projects (4-tier × N-project)', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, { key: 'multi-spec', summary: 's', type: 'spec', parent: '_br', body: SPEC_BODY, codeLinks: [{ kind: 'function', file: 'src/x.ts', symbol: 'fn' }], spec: makeTestSpec('src/x.ts', 'fn') });
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: [], projB: [] },
      symbolsByProjectFile: { projA: { 'src/x.ts': [{ name: 'fn', kind: 'function' }] }, projB: { 'src/x.ts': [{ name: 'fn', kind: 'function' }] } },
      annotationsByProjectTag: {
        projA: { spec: [{ value: 'multi-spec', filePath: 'src/x.ts', symbolName: 'fn' }] },
        projB: {},
      },
    });
    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.alreadyLinked + result.created).toBeGreaterThanOrEqual(1);
  });

  it('findPattern sums matches across projects (pattern_violation)', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/p.ts', 'fn');
    spec.code_patterns = [{ id: 'PAT-A', pattern: 'console.log($$$)', rule: 'forbidden' }];
    await createCard(tc.ctx, { key: 'pat-multi', summary: 'p', type: 'spec', parent: '_br', body: SPEC_BODY, codeLinks: [{ kind: 'function', file: 'src/p.ts', symbol: 'fn' }], spec });
    await updateCardStatus(tc.ctx, 'pat-multi', 'active');
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: ['src/p.ts'], projB: ['src/p.ts'] },
      symbolsByProjectFile: { projA: { 'src/p.ts': [{ name: 'fn', kind: 'function' }] }, projB: { 'src/p.ts': [{ name: 'fn', kind: 'function' }] } },
      patternMatchesByProject: { projA: 3, projB: 4 },
    });
    const result = await checkDrift(tc.ctx, 'pat-multi', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'pat-multi');
    expect(card?.driftType).toBe('pattern_violation');
    expect(card?.patternViolations?.[0]?.matches).toBe(7); // 3 + 4 across projects
  });

  it('searchRelations heritage_uncovered iterates projects', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, { key: 'her-multi', summary: 'h', type: 'spec', parent: '_br', body: SPEC_BODY, codeLinks: [{ kind: 'class', file: 'src/c.ts', symbol: 'Base' }], spec: makeTestSpec('src/c.ts', 'Base') });
    await updateCardStatus(tc.ctx, 'her-multi', 'active');
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: ['src/c.ts'], projB: ['src/c.ts'] },
      symbolsByProjectFile: { projA: { 'src/c.ts': [{ name: 'Base', kind: 'class' }] }, projB: { 'src/c.ts': [{ name: 'Base', kind: 'class' }] } },
      // Subclass only declared in projB
      extendsByProjectFile: { projA: {}, projB: { 'src/c.ts': [{ src: 'src/d.ts', srcSym: 'Derived', dstSym: 'Base' }] } },
    });
    const result = await checkDrift(tc.ctx, 'her-multi', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'her-multi');
    expect(card?.uncoveredSubclasses).toEqual([{ file: 'src/d.ts', symbol: 'Derived' }]);
  });

  it('preChangeCheck max fan-in picks max across projects', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'fan-multi', summary: 'f', type: 'spec', codeLinks: [{ kind: 'function', file: 'src/h.ts', symbol: 'h' }] });
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: ['src/h.ts'], projB: ['src/h.ts'] },
      symbolsByProjectFile: { projA: { 'src/h.ts': [{ name: 'h', kind: 'function' }] }, projB: { 'src/h.ts': [{ name: 'h', kind: 'function' }] } },
      fanByProjectFile: {
        projA: { 'src/h.ts': { fanIn: 5, fanOut: 1 } },
        projB: { 'src/h.ts': { fanIn: 25, fanOut: 3 } },
      },
    });
    const result = await preChangeCheck(tc.ctx, ['src/h.ts']);
    expect(result.maxFanIn).toBe(25); // max across projects
    expect(result.maxFanOut).toBe(3);
    // 1 affected card (medium) + fanIn≥10 → high
    expect(result.riskLevel).toBe('high');
  });

  it('expandAffectedFiles unions across projects', async () => {
    tc = await createMockTestContext();
    await createCard(tc.ctx, { key: 'imp-card', summary: 'i', type: 'spec', codeLinks: [{ kind: 'function', file: 'src/imp.ts', symbol: 'imp' }] });
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: [], projB: [] },
      affectedByProject: {
        projA: ['src/imp.ts', 'src/from-A.ts'],
        projB: ['src/from-B.ts'],
      },
    });
    const result = await preChangeCheck(tc.ctx, ['src/imp.ts']);
    // The expanded file set should include from-A and from-B; the imp-card
    // links to src/imp.ts which is in the expanded set, so it's affected.
    expect(result.affectedCards.some((c) => c.key === 'imp-card')).toBe(true);
  });

  it('getSymbolChanges unions across projects (symbol_changed drift)', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, { key: 'sym-multi', summary: 'sm', type: 'spec', parent: '_br', body: SPEC_BODY, boundary: ['src/changed/**'], codeLinks: [{ kind: 'function', file: 'src/changed/x.ts', symbol: 'fn' }], spec: makeTestSpec('src/changed/x.ts', 'fn') });
    await updateCardStatus(tc.ctx, 'sym-multi', 'active');
    // Backdate updatedAt
    const row = tc.ctx.cardRepo.findByKey('sym-multi')!;
    tc.ctx.cardRepo.upsert({ ...row, updatedAt: '2020-01-01T00:00:00.000Z' });
    tc.ctx.gildash = makeMultiProjectGildash({
      projects: ['projA', 'projB'],
      filesByProject: { projA: ['src/changed/x.ts'], projB: ['src/changed/x.ts'] },
      symbolsByProjectFile: { projA: { 'src/changed/x.ts': [{ name: 'fn', kind: 'function' }] }, projB: { 'src/changed/x.ts': [{ name: 'fn', kind: 'function' }] } },
      // Change reported only by projB
      symbolChangesByProject: {
        projA: [],
        projB: [{ filePath: 'src/changed/x.ts', symbolName: 'fn', changedAt: '2025-01-01T00:00:00.000Z' }],
      },
    });
    const result = await checkDrift(tc.ctx, 'sym-multi', { autoTransition: false });
    const card = result.cards.find((c) => c.key === 'sym-multi');
    expect(card?.driftType).toBe('symbol_changed');
  });
});

// ── code_patterns round-trip ─────────────────────────────────────────

describe('SpecBody.code_patterns — round-trip', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('preserves code_patterns through DB serialize/deserialize', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    const spec = makeTestSpec('src/rt.ts', 'fn');
    spec.code_patterns = [
      { id: 'PAT-RT', pattern: 'foo($$$)', rule: 'forbidden', description: 'no foo' },
    ];
    await createCard(tc.ctx, {
      key: 'rt-card',
      summary: 'RT',
      type: 'spec',
      parent: '_br',
      body: SPEC_BODY,
      codeLinks: [{ kind: 'function', file: 'src/rt.ts', symbol: 'fn' }],
      spec,
    });
    const row = tc.ctx.cardRepo.findByKey('rt-card');
    expect(row).toBeDefined();
    const ns = JSON.parse(row!.namespacesJson!);
    expect(ns.spec.code_patterns).toEqual([
      { id: 'PAT-RT', pattern: 'foo($$$)', rule: 'forbidden', description: 'no foo' },
    ]);
  });
});
