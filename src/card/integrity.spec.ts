import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../db/connection';
import type { EmberdeckDb } from '../db/connection';
import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import { DrizzleCodeLinkRepository } from '../db/code-link-repo';
import { DrizzleChangelogRepository } from '../db/changelog-repo';
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

let db: EmberdeckDb;
let ctx: EmberdeckContext;

function makeCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    key: 'test-card',
    summary: 'Test card',
    status: 'draft',
    type: 'spec',
    parent: null,
    boundaryJson: null,
    body: null,
    filePath: '.emberdeck/cards/test-card.card.md',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  const cardRepo = new DrizzleCardRepository(db);
  const relationRepo = new DrizzleRelationRepository(db);
  const classificationRepo = new DrizzleClassificationRepository(db);
  const codeLinkRepo = new DrizzleCodeLinkRepository(db);
  const changelogRepo = new DrizzleChangelogRepository(db);

  ctx = {
    cardsDir: '/tmp/test-cards',
    db,
    cardRepo,
    relationRepo,
    classificationRepo,
    codeLinkRepo,
    changelogRepo,
    ignorePatterns: [],
    regressionThreshold: 0,
    gildash: undefined,
  };
});

afterEach(() => {
  closeDb(db);
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
      makeCard({ key: 'existing-parent', type: 'intent', filePath: '.emberdeck/cards/existing-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentExists(ctx, 'existing-parent')).not.toThrow();
  });
});

// ── validateParentType ──────────────────────────────────────────────────────

describe('validateParentType', () => {
  it('intent parent for intent child: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'arch-parent', type: 'intent', filePath: '.emberdeck/cards/arch-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'intent', 'arch-parent')).not.toThrow();
  });

  it('spec parent for spec child: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'spec-parent', type: 'spec', filePath: '.emberdeck/cards/spec-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'spec', 'spec-parent')).not.toThrow();
  });

  it('intent parent for spec child: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'arch-parent', type: 'intent', filePath: '.emberdeck/cards/arch-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'spec', 'arch-parent')).not.toThrow();
  });

  it('spec parent for intent child: throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'spec-parent', type: 'spec', filePath: '.emberdeck/cards/spec-parent.card.md' }),
    );

    // Act / Assert
    expect(() => validateParentType(ctx, 'intent', 'spec-parent')).toThrow(ParentValidationError);
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
      makeCard({ key: 'card-b', parent: null, type: 'intent', filePath: '.emberdeck/cards/card-b.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-a', parent: 'card-b', type: 'intent', filePath: '.emberdeck/cards/card-a.card.md' }),
    );

    // Act / Assert — trying to set B's parent to A
    expect(() => validateParentCycle(ctx, 'card-b', 'card-a')).toThrow(ParentValidationError);
  });

  it('A->B->C (no cycle): OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-c', parent: null, type: 'intent', filePath: '.emberdeck/cards/card-c.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-b', parent: 'card-c', type: 'intent', filePath: '.emberdeck/cards/card-b.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({ key: 'card-a', parent: 'card-b', type: 'intent', filePath: '.emberdeck/cards/card-a.card.md' }),
    );

    // Act / Assert — setting A's parent to B (already the case, no cycle with C)
    expect(() => validateParentCycle(ctx, 'card-a', 'card-b')).not.toThrow();
  });

  it('self-reference (parent=self): throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'self-ref', parent: null, type: 'intent', filePath: '.emberdeck/cards/self-ref.card.md' }),
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
  it('change arch->spec with intent children: throws ParentValidationError', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'parent', type: 'intent', filePath: '.emberdeck/cards/parent.card.md' }),
    );
    ctx.cardRepo.upsert(
      makeCard({
        key: 'arch-child',
        type: 'intent',
        parent: 'parent',
        filePath: '.emberdeck/cards/arch-child.card.md',
      }),
    );

    // Act / Assert — changing parent from intent to spec
    expect(() => validateChildrenHierarchy(ctx, 'parent', 'spec')).toThrow(ParentValidationError);
  });

  it('change arch->spec with spec children: OK', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'parent', type: 'intent', filePath: '.emberdeck/cards/parent.card.md' }),
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
    expect(() => validateChildrenHierarchy(ctx, 'parent', 'intent')).not.toThrow();
  });

  it('no children: OK for any type change', () => {
    // Arrange
    ctx.cardRepo.upsert(
      makeCard({ key: 'lonely', type: 'intent', filePath: '.emberdeck/cards/lonely.card.md' }),
    );

    // Act / Assert
    expect(() => validateChildrenHierarchy(ctx, 'lonely', 'spec')).not.toThrow();
  });
});

// ── validateActivationGuard ─────────────────────────────────────────────────

describe('validateActivationGuard', () => {
  it('intent type: always passes (no conditions)', async () => {
    // Act / Assert
    await expect(
      validateActivationGuard(ctx, { type: 'intent' }),
    ).resolves.toBeUndefined();
  });

  it('spec type with no codeLinks: throws ActivationGuardError', async () => {
    // Act / Assert
    try {
      await validateActivationGuard(ctx, { type: 'spec', codeLinks: [] });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
      expect((e as ActivationGuardError).unmetConditions).toContain(
        'spec card must have at least 1 codeLink',
      );
    }
  });

  it('spec type with undefined codeLinks: throws ActivationGuardError', async () => {
    // codeLinks not provided → treated as empty
    try {
      await validateActivationGuard(ctx, { type: 'spec' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivationGuardError);
    }
  });

  it('spec type with boundary and no gildash: passes (boundary check skipped)', async () => {
    // Without gildash, boundary check is skipped — anyMatch defaults to true
    await expect(
      validateActivationGuard(ctx, {
        type: 'spec',
        codeLinks: [{ file: 'src/a.ts', symbol: 'x' }],
        boundary: ['src/**'],
      }),
    ).resolves.toBeUndefined();
  });

  it('spec type with codeLinks (gildash=undefined): passes if codeLinks exist', async () => {
    // Without gildash, symbol resolution is skipped — only count check matters
    // Act / Assert
    await expect(
      validateActivationGuard(ctx, {
        type: 'spec',
        codeLinks: [{ file: 'src/foo.ts', symbol: 'bar' }],
      }),
    ).resolves.toBeUndefined();
  });
});

// ── validateTypeChangeActivation ────────────────────────────────────────────

describe('validateTypeChangeActivation', () => {
  it('active arch -> spec with no codeLinks: returns draft', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'active', type: 'intent', codeLinks: [] },
      'spec',
    );

    // Assert
    expect(result).toBe('draft');
  });

  it('active spec -> arch: returns active (arch has no conditions)', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'active', type: 'spec', codeLinks: [{ file: 'src/a.ts', symbol: 'x' }] },
      'intent',
    );

    // Assert
    expect(result).toBe('active');
  });

  it('drifted card: returns drifted unchanged', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'drifted', type: 'spec', codeLinks: [] },
      'intent',
    );

    // Assert — not active, so no re-validation
    expect(result).toBe('drifted');
  });

  it('draft card: returns current status unchanged', async () => {
    // Act
    const result = await validateTypeChangeActivation(
      ctx,
      { status: 'draft', type: 'spec', codeLinks: [] },
      'intent',
    );

    // Assert
    expect(result).toBe('draft');
  });
});
