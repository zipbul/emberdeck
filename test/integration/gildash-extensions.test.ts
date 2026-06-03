/**
 * Tests for the gildash integration extensions:
 *   - analyze.health.codeCycles (hasCycle + getCyclePaths)
 *   - syncSpecAnnotations 4-tier tags (@spec/@brief/@principle/@domain)
 */
import { describe, it, expect, afterEach } from 'bun:test';

import {
  analyze,
  syncSpecAnnotations,
  createCard,
} from '../../index';
import {
  createMockTestContext,
  ensure4tierScaffold,
  type TestContext,
} from '../helpers';
import { mockGildash as makeGildash } from '../fixtures/gildash';

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

// ── searchAnnotations 4-tier ─────────────────────────────────────────

describe('syncSpecAnnotations — @spec-only binding (source-as-binding-sot)', () => {
  let tc: TestContext;
  afterEach(async () => { await tc?.cleanup(); });

  it('binds only @spec; @brief/@principle/@domain tags are not scanned', async () => {
    tc = await createMockTestContext();
    await ensure4tierScaffold(tc.ctx, true);
    await createCard(tc.ctx, { key: 'plain-spec', summary: 's', type: 'spec' });
    await createCard(tc.ctx, { key: 'plain-brief', summary: 'b', type: 'brief', parent: '_dom' });
    await createCard(tc.ctx, { key: 'plain-principle', summary: 'p', type: 'principle' });

    const annotationsByTag: Record<string, any[]> = {
      spec: [{ tag: 'spec', value: 'plain-spec', filePath: 'src/x.ts', symbolName: 'fnS', source: 'line' }],
      // These would only matter under the removed 4-tier distortion — they must be ignored now.
      brief: [{ tag: 'brief', value: 'plain-brief', filePath: 'src/x.ts', symbolName: 'fnB', source: 'line' }],
      principle: [{ tag: 'principle', value: 'plain-principle', filePath: 'src/x.ts', symbolName: 'fnP', source: 'line' }],
    };

    tc.ctx.gildash = makeGildash({
      searchAnnotations: (q: { tag: string }) => annotationsByTag[q.tag] ?? [],
      getSymbolsByFile: () => [
        { name: 'fnS', memberName: null, filePath: 'src/x.ts', kind: 'function' },
        { name: 'fnB', memberName: null, filePath: 'src/x.ts', kind: 'function' },
        { name: 'fnP', memberName: null, filePath: 'src/x.ts', kind: 'function' },
      ],
    });

    const result = await syncSpecAnnotations(tc.ctx);
    expect(result.created).toBe(1);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-spec')).toHaveLength(1);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-brief')).toHaveLength(0);
    expect(tc.ctx.codeLinkRepo.findByCardKey('plain-principle')).toHaveLength(0);
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

