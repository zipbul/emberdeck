import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { err } from '@zipbul/result';
import type { Gildash } from '@zipbul/gildash';
import type { GildashError } from '@zipbul/gildash';

// ---- Gildash mock ----

const mockGildashOpen = mock(async (_opts: unknown) => undefined as unknown);

mock.module('@zipbul/gildash', () => ({
  Gildash: { open: mockGildashOpen },
}));

// Dynamically import SUT after mock is registered
const { setupEmberdeck, teardownEmberdeck } = await import('../src/setup');
const { DEFAULT_RELATION_TYPES } = await import('../src/config');

// ---- Helpers ----

function makeFakeGildash(): { instance: ReturnType<typeof mock> & { close: ReturnType<typeof mock> }; gildash: Gildash } {
  const closeMock = mock(async () => undefined);
  const instance = { close: closeMock } as unknown as Gildash;
  return { instance: instance as any, gildash: instance };
}

function makeGildashErr(): ReturnType<typeof err<GildashError>> {
  return err<GildashError>({ type: 'watcher', message: 'open failed', cause: undefined, name: 'GildashError' });
}

// ---- Suite ----

describe('setupEmberdeck + teardownEmberdeck', () => {
  const BASE_OPTS = {
    cardsDir: '/tmp/cards',
    dbPath: ':memory:',
  };

  beforeEach(() => {
    mockGildashOpen.mockReset();
    // Default: return success with a fake gildash
    mockGildashOpen.mockImplementation(async () => makeFakeGildash().gildash);
  });

  // 1. [HP] projectRoot not specified → ctx.gildash === undefined
  it('should set gildash to undefined when projectRoot is not provided', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.gildash).toBeUndefined();
    expect(mockGildashOpen).not.toHaveBeenCalled();
    await teardownEmberdeck(ctx);
  });

  // 2. [HP] projectRoot specified + Gildash.open succeeds → ctx.gildash assigned
  it('should assign gildash instance when projectRoot is provided and open succeeds', async () => {
    // Arrange
    const { gildash } = makeFakeGildash();
    mockGildashOpen.mockImplementation(async () => gildash);
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.gildash).toBe(gildash);
    await teardownEmberdeck(ctx);
  });

  // 3. [HP] allowedRelationTypes specified → ctx.allowedRelationTypes as-is
  it('should use provided allowedRelationTypes when specified', async () => {
    // Arrange
    const types = ['custom-a', 'custom-b'] as const;
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, allowedRelationTypes: types });
    // Assert
    expect(ctx.allowedRelationTypes).toEqual(types);
    await teardownEmberdeck(ctx);
  });

  // 4. [HP] allowedRelationTypes not specified → DEFAULT_RELATION_TYPES used
  it('should use DEFAULT_RELATION_TYPES when allowedRelationTypes is not provided', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.allowedRelationTypes).toEqual([...DEFAULT_RELATION_TYPES]);
    await teardownEmberdeck(ctx);
  });

  // 5. [HP] codeLinkRepo always exists (even without projectRoot)
  it('should always provide codeLinkRepo regardless of projectRoot', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.codeLinkRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });

  // 6. [HP] cardRepo, relationRepo, classificationRepo all exist
  it('should provide cardRepo, relationRepo, and classificationRepo', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.cardRepo).toBeDefined();
    expect(ctx.relationRepo).toBeDefined();
    expect(ctx.classificationRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });

  // 7. [HP] teardown: gildash undefined → close not called
  it('should not call gildash.close when gildash is undefined during teardown', async () => {
    // Arrange
    const ctx = await setupEmberdeck(BASE_OPTS);
    expect(ctx.gildash).toBeUndefined();
    // Act / Assert (no throw, no close call)
    await expect(teardownEmberdeck(ctx)).resolves.toBeUndefined();
  });

  // 8. [HP] teardown: gildash mock → close called once
  it('should call gildash.close exactly once during teardown when gildash is set', async () => {
    // Arrange
    const closeMock = mock(async () => undefined);
    const fakeGildash = { close: closeMock } as unknown as Gildash;
    mockGildashOpen.mockImplementation(async () => fakeGildash);
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Act
    await teardownEmberdeck(ctx);
    // Assert
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  // 9. [HP] projectRoot + gildashIgnore specified → values passed to Gildash.open
  it('should pass projectRoot and gildashIgnore to Gildash.open when provided', async () => {
    // Arrange
    const { gildash } = makeFakeGildash();
    mockGildashOpen.mockImplementation(async () => gildash);
    const ignorePatterns = ['node_modules', 'dist'];
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj', gildashIgnore: ignorePatterns });
    // Assert
    expect(mockGildashOpen).toHaveBeenCalledTimes(1);
    const calledWith = mockGildashOpen.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith.projectRoot).toBe('/proj');
    expect(calledWith.ignorePatterns).toEqual(ignorePatterns);
    await teardownEmberdeck(ctx);
  });

  // 10. [NE] Gildash.open returns Err → ctx.gildash = undefined, setup returns normally
  it('should set gildash to undefined and not throw when Gildash.open returns an Err', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => makeGildashErr());
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.gildash).toBeUndefined();
    await teardownEmberdeck(ctx);
  });

  // 11. [NE] Gildash.open returns Err → codeLinkRepo/cardRepo still normal
  it('should still provide codeLinkRepo and cardRepo when Gildash.open returns an Err', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => makeGildashErr());
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.codeLinkRepo).toBeDefined();
    expect(ctx.cardRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });

  // 12. [ED] projectRoot = '' → gildash not initialized
  it('should not initialize gildash when projectRoot is empty string', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '' });
    // Assert
    expect(ctx.gildash).toBeUndefined();
    expect(mockGildashOpen).not.toHaveBeenCalled();
    await teardownEmberdeck(ctx);
  });

  // 13. [ED] allowedRelationTypes = [] → ctx.allowedRelationTypes = []
  it('should set allowedRelationTypes to empty array when provided as empty array', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, allowedRelationTypes: [] });
    // Assert
    expect(ctx.allowedRelationTypes).toEqual([]);
    await teardownEmberdeck(ctx);
  });

  // 14. [CO] projectRoot specified + Gildash.open Err + allowedRelationTypes not set → gildash=undefined + DEFAULT
  it('should fallback to DEFAULT_RELATION_TYPES and undefined gildash when open fails and types not set', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => makeGildashErr());
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.gildash).toBeUndefined();
    expect(ctx.allowedRelationTypes).toEqual([...DEFAULT_RELATION_TYPES]);
    await teardownEmberdeck(ctx);
  });

  // 15. [ST] setup → teardown → re-setup succeeds
  it('should succeed on re-setup after teardown', async () => {
    // Arrange
    const ctx1 = await setupEmberdeck(BASE_OPTS);
    await teardownEmberdeck(ctx1);
    // Act
    const ctx2 = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx2.cardRepo).toBeDefined();
    expect(ctx2.codeLinkRepo).toBeDefined();
    await teardownEmberdeck(ctx2);
  });

  // 16. [ID] teardown called twice → no error
  it('should not throw when teardownEmberdeck is called twice', async () => {
    // Arrange
    const ctx = await setupEmberdeck(BASE_OPTS);
    await teardownEmberdeck(ctx);
    // Act / Assert
    await expect(teardownEmberdeck(ctx)).resolves.toBeUndefined();
  });

  // 17. [NE] Gildash.open throws (reject) → setupEmberdeck does not throw, returns gildash=undefined
  it('should set gildash to undefined and not throw when Gildash.open rejects with an error', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => { throw new Error('open failed unexpectedly'); });
    // Act / Assert
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    expect(ctx.gildash).toBeUndefined();
    await teardownEmberdeck(ctx);
  });

  // 18. [CO] Gildash.open throws + cardRepo/codeLinkRepo still provided normally
  it('should still provide cardRepo and codeLinkRepo when Gildash.open throws', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => { throw new Error('unexpected'); });
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.cardRepo).toBeDefined();
    expect(ctx.codeLinkRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });
});
