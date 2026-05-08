import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { EmberdeckContext } from '../config';
import { setupEmberdeck, teardownEmberdeck } from '../setup';
import { makeCardRow as makeCard } from '../../test/fixtures/card-row';
import { ParentValidationError, ActivationGuardError, CardValidationError } from './errors';
import {
  validateParentExists,
  validateParentType,
  validateParentCycle,
  validateRelationTargets,
  validateChildrenHierarchy,
  validateActivationGuard,
  validateTypeChangeActivation,
} from './validation';

let ctx: EmberdeckContext;
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'emberdeck-integrity-'));
  await mkdir(join(tmpRoot, 'cards'), { recursive: true });
  await writeFile(join(tmpRoot, 'src.ts'), '', 'utf8');
  ctx = await setupEmberdeck({
    cardsDir: join(tmpRoot, 'cards'),
    dbPath: ':memory:',
    projectRoot: tmpRoot,
  });
});

afterEach(async () => {
  await teardownEmberdeck(ctx);
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

// ── validateParentExists ────────────────────────────────────────────────────

describe('validateParentExists', () => {
  it('throws ParentValidationError when parent does not exist', () => {
    // Act / Assert
    expect(() => validateParentExists(ctx, 'nonexistent')).toThrow(ParentValidationError);
  });

  it('does not throw when parent exists', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'existing-parent', type: 'brief', filePath: '.emberdeck/cards/existing-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentExists(ctx, 'existing-parent')).not.toThrow();
  });
});

// ── validateParentType ──────────────────────────────────────────────────────

describe('validateParentType', () => {
  it('domain parent for brief child: OK (4-tier — brief.parent must be domain)', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'arch-parent', type: 'domain', filePath: '.emberdeck/cards/arch-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'brief', 'arch-parent')).not.toThrow();
  });

  it('brief parent for brief child: REJECTED (no brief recursion in 4-tier)', () => {
    ctx.cardRepo.upsert(
      makeCard({ key: 'rec-parent', type: 'brief', filePath: '.emberdeck/cards/rec-parent.card.md' }),
    );
    expect(() => validateParentType(ctx, 'brief', 'rec-parent')).toThrow(ParentValidationError);
  });

  it('spec parent for spec child: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'spec-parent', type: 'spec', filePath: '.emberdeck/cards/spec-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'spec', 'spec-parent')).not.toThrow();
  });

  it('brief parent for spec child: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'arch-parent', type: 'brief', filePath: '.emberdeck/cards/arch-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'spec', 'arch-parent')).not.toThrow();
  });

  it('spec parent for brief child: throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'spec-parent', type: 'spec', filePath: '.emberdeck/cards/spec-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'brief', 'spec-parent')).toThrow(ParentValidationError);
  });

  it('non-existent parent: throws ParentValidationError', () => {
    // Act / Assert
    expect(() => validateParentType(ctx, 'spec', 'ghost')).toThrow(ParentValidationError);
  });
});

// ── validateParentCycle ─────────────────────────────────────────────────────

describe('validateParentCycle', () => {
  it('A->B->A cycle: throws ParentValidationError', () => {
    // Arrange — A exists with parent=B, B exists with parent=null
    // We want to set B.parent = A which would create A->B->A
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-b', parent: null, type: 'brief', filePath: '.emberdeck/cards/card-b.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-a', parent: 'card-b', type: 'brief', filePath: '.emberdeck/cards/card-a.card.md' }),
    );

    // Act / Assert — trying to set B's parent to A
    expect(() => validateParentCycle(ctx, 'card-b', 'card-a')).toThrow(ParentValidationError);
  });

  it('A->B->C (no cycle): OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-c', parent: null, type: 'brief', filePath: '.emberdeck/cards/card-c.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-b', parent: 'card-c', type: 'brief', filePath: '.emberdeck/cards/card-b.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-a', parent: 'card-b', type: 'brief', filePath: '.emberdeck/cards/card-a.card.md' }),
    );

    // Act / Assert — setting A's parent to B (already the case, no cycle with C)
    expect(() => validateParentCycle(ctx, 'card-a', 'card-b')).not.toThrow();
  });

  it('self-reference (parent=self): throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'self-ref', parent: null, type: 'brief', filePath: '.emberdeck/cards/self-ref.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentCycle(ctx, 'self-ref', 'self-ref')).toThrow(ParentValidationError);
  });
});

// ── validateRelationTargets ─────────────────────────────────────────────────

describe('validateRelationTargets', () => {
  it('target exists: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(makeCard({ key: 'src', filePath: '.emberdeck/cards/src.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'dst', filePath: '.emberdeck/cards/dst.card.md' }));

    // Act / Assert
    expect(() => validateRelationTargets(ctx, 'src', ['dst'])).not.toThrow();
  });

  it('target does not exist: throws CardValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(makeCard({ key: 'src', filePath: '.emberdeck/cards/src.card.md' }));

    // Act / Assert
    expect(() => validateRelationTargets(ctx, 'src', ['ghost'])).toThrow(CardValidationError);
  });

  it('self-reference: throws CardValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(makeCard({ key: 'self', filePath: '.emberdeck/cards/self.card.md' }));

    // Act / Assert
    expect(() => validateRelationTargets(ctx, 'self', ['self'])).toThrow(CardValidationError);
  });

  it('empty relations array: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(makeCard({ key: 'src', filePath: '.emberdeck/cards/src.card.md' }));

    // Act / Assert
    expect(() => validateRelationTargets(ctx, 'src', [])).not.toThrow();
  });

  it('multiple targets with one missing: throws CardValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(makeCard({ key: 'src', filePath: '.emberdeck/cards/src.card.md' }));
    ctx.cardRepo.upsert(makeCard({ key: 'exists', filePath: '.emberdeck/cards/exists.card.md' }));

    // Act / Assert
    expect(() => validateRelationTargets(ctx, 'src', ['exists', 'missing'])).toThrow(CardValidationError);
  });
});

// ── validateChildrenHierarchy ───────────────────────────────────────────────

describe('validateChildrenHierarchy', () => {
  it('change arch->spec with brief children: throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'parent', type: 'brief', filePath: '.emberdeck/cards/parent.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({
        key: 'arch-child',
        type: 'brief',
        parent: 'parent',
        filePath: '.emberdeck/cards/arch-child.card.md',
      }),
    );

    // Act / Assert — changing parent from brief to spec
    expect(() => validateChildrenHierarchy(ctx, 'parent', 'spec')).toThrow(ParentValidationError);
  });

  it('change arch->spec with spec children: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'parent', type: 'brief', filePath: '.emberdeck/cards/parent.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({
        key: 'spec-child',
        type: 'spec',
        parent: 'parent',
        filePath: '.emberdeck/cards/spec-child.card.md',
      }),
    );

    // Act / Assert
    expect(() => validateChildrenHierarchy(ctx, 'parent', 'spec')).not.toThrow();
  });

  it('change spec->arch: OK (no restrictions)', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'parent', type: 'spec', filePath: '.emberdeck/cards/parent.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({
        key: 'spec-child',
        type: 'spec',
        parent: 'parent',
        filePath: '.emberdeck/cards/spec-child.card.md',
      }),
    );

    // Act / Assert
    expect(() => validateChildrenHierarchy(ctx, 'parent', 'brief')).not.toThrow();
  });

  it('no children: OK for any type change', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'lonely', type: 'brief', filePath: '.emberdeck/cards/lonely.card.md' }),
    );

    // Act / Assert
    expect(() => validateChildrenHierarchy(ctx, 'lonely', 'spec')).not.toThrow();
  });
});

// ── validateActivationGuard ─────────────────────────────────────────────────

describe('validateActivationGuard', () => {
  // Helpers: set up 4-tier scaffolding directly in the in-memory ctx
  // (createCard isn't used here — these are unit tests of the guard itself).
  function setupDomain(): void {
    ctx.cardRepo.upsert(makeCard({ key: '_dom', type: 'domain', filePath: '/_dom.card.md' }));
  }
  function setupBrief(): void {
    setupDomain();
    ctx.cardRepo.upsert(makeCard({ key: '_br', type: 'brief', parent: '_dom', filePath: '/_br.card.md' }));
  }

  it('brief without parent: rejected (4-tier strict)', async () => {
    try {
      await validateActivationGuard(ctx, { type: 'brief' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/parent=domain/);
    }
  });

  it('spec without parent: rejected (4-tier strict)', async () => {
    try {
      await validateActivationGuard(ctx, { type: 'spec', codeLinks: [{ file: 'a', symbol: 'b' }] });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/parent=brief\|spec/);
    }
  });

  it('brief with non-domain parent: rejected (4-tier strict)', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'p-spec', type: 'spec', filePath: '/p-spec.card.md' }));
    try {
      await validateActivationGuard(ctx, { type: 'brief', parent: 'p-spec' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/parent must be domain/);
    }
  });

  it('principle/domain with parent: rejected (must be root-level)', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'any-parent', type: 'domain', filePath: '/ap.card.md' }));
    try {
      await validateActivationGuard(ctx, { type: 'principle', parent: 'any-parent', principle: { statement: 's', rationale: 'r', applies_to: '*', enforcement: 'blocking' } });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/root-level/);
    }
  });

  it('brief type: requires brief namespace to activate', async () => {
    setupDomain();
    try {
      await validateActivationGuard(ctx, { type: 'brief', parent: '_dom' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/brief.*namespace/);
    }
  });

  it('domain type with no namespace: throws ActivationGuardError', async () => {
    try {
      await validateActivationGuard(ctx, { type: 'domain' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions[0]).toMatch(/domain.*namespace/);
    }
  });

  it('domain type with empty overview/scope: throws', async () => {
    try {
      await validateActivationGuard(ctx, {
        type: 'domain',
        domain: { overview: '', scope: 'something' },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
    }
  });

  it('domain type with cross_domain_dependencies pointing at non-domain: throws', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'not-a-domain', type: 'spec', filePath: '/n.card.md' }));
    try {
      await validateActivationGuard(ctx, {
        type: 'domain',
        key: 'd',
        domain: {
          overview: 'o',
          scope: 's',
          cross_domain_dependencies: [{ domain: 'not-a-domain', relationship: 'r' }],
        },
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.some((m) => m.includes('not-a-domain'))).toBe(true);
    }
  });

  it('domain type with valid namespace + valid cross-deps: passes', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'sibling-dom', type: 'domain', filePath: '/sd.card.md' }));
    await expect(
      validateActivationGuard(ctx, {
        type: 'domain',
        key: 'self-dom',
        domain: {
          overview: 'over',
          scope: 'sc',
          cross_domain_dependencies: [{ domain: 'sibling-dom', relationship: 'r' }],
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('brief type with valid namespace + domain parent: passes', async () => {
    setupDomain();
    const { makeTestBrief } = await import('../../test/helpers');
    await expect(
      validateActivationGuard(ctx, { type: 'brief', parent: '_dom', brief: makeTestBrief() }),
    ).resolves.toBeUndefined();
  });

  it('spec type with no codeLinks: throws ActivationGuardError', async () => {
    setupBrief();
    try {
      await validateActivationGuard(ctx, { type: 'spec', parent: '_br', codeLinks: [] });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions).toContain(
        'spec card must have at least 1 codeLink',
      );
    }
  });

  it('spec type with undefined codeLinks: throws ActivationGuardError', async () => {
    setupBrief();
    try {
      await validateActivationGuard(ctx, { type: 'spec', parent: '_br' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
    }
  });

  it('spec type with boundary and no gildash: passes (boundary check skipped)', async () => {
    setupBrief();
    const { makeTestSpec } = await import('../../test/helpers');
    await expect(
      validateActivationGuard(ctx, {
        type: 'spec',
        parent: '_br',
        codeLinks: [{ file: 'src/a.ts', symbol: 'x' }],
        boundary: ['src/**'],
        spec: makeTestSpec('src/a.ts', 'x'),
      }),
    ).resolves.toBeUndefined();
  });

  it('spec type with codeLinks (gildash=undefined): passes if codeLinks exist', async () => {
    setupBrief();
    const { makeTestSpec } = await import('../../test/helpers');
    await expect(
      validateActivationGuard(ctx, {
        type: 'spec',
        parent: '_br',
        codeLinks: [{ file: 'src/foo.ts', symbol: 'bar' }],
        spec: makeTestSpec('src/foo.ts', 'bar'),
      }),
    ).resolves.toBeUndefined();
  });

  it('spec type without spec namespace: throws ActivationGuardError', async () => {
    setupBrief();
    try {
      await validateActivationGuard(ctx, {
        type: 'spec',
        parent: '_br',
        codeLinks: [{ file: 'src/foo.ts', symbol: 'bar' }],
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/spec.*namespace/);
    }
  });

  it('spec type with non-spec/non-brief parent: rejected', async () => {
    ctx.cardRepo.upsert(makeCard({ key: 'p-dom', type: 'domain', filePath: '/p-dom.card.md' }));
    try {
      await validateActivationGuard(ctx, {
        type: 'spec',
        parent: 'p-dom',
        codeLinks: [{ file: 'src/a.ts', symbol: 'x' }],
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions.join(' ')).toMatch(/spec\.parent must be brief or spec/);
    }
  });
});

// ── validateTypeChangeActivation ────────────────────────────────────────────

describe('validateTypeChangeActivation', () => {
  it('active arch -> spec with no codeLinks: returns draft', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'active', type: 'brief', codeLinks: [] },
      'spec',
    );

    // Assert
    expect(result).toBe('draft');
  });

  it('active spec -> brief: keeps active when brief namespace present', async () => {
    const { makeTestBrief } = await import('../../test/helpers');
    ctx.cardRepo.upsert(makeCard({ key: '_dom', type: 'domain', filePath: '/_dom.card.md' }));
    const result = await validateTypeChangeActivation(
      ctx,
      {
        status: 'active',
        type: 'spec',
        parent: '_dom',
        codeLinks: [{ file: 'src/a.ts', symbol: 'x' }],
        brief: makeTestBrief(),
      },
      'brief',
    );

    expect(result).toBe('active');
  });

  it('active spec -> brief: forces draft when brief namespace missing', async () => {
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'active', type: 'spec', codeLinks: [{ file: 'src/a.ts', symbol: 'x' }] },
      'brief',
    );
    expect(result).toBe('draft');
  });

  it('drifted card: returns drifted unchanged', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'drifted', type: 'spec', codeLinks: [] },
      'brief',
    );

    // Assert — not active, so no re-validation
    expect(result).toBe('drifted');
  });

  it('draft card: returns current status unchanged', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'draft', type: 'spec', codeLinks: [] },
      'brief',
    );

    // Assert
    expect(result).toBe('draft');
  });
});
