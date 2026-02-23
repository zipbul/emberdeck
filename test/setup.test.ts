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
  return err<GildashError>({ type: 'watcher', message: 'open failed', cause: undefined });
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

  // 1. [HP] projectRoot 미지정 → ctx.gildash === undefined
  it('should set gildash to undefined when projectRoot is not provided', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.gildash).toBeUndefined();
    expect(mockGildashOpen).not.toHaveBeenCalled();
    await teardownEmberdeck(ctx);
  });

  // 2. [HP] projectRoot 지정 + Gildash.open 성공 → ctx.gildash 할당됨
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

  // 3. [HP] allowedRelationTypes 지정 → ctx.allowedRelationTypes 그대로
  it('should use provided allowedRelationTypes when specified', async () => {
    // Arrange
    const types = ['custom-a', 'custom-b'] as const;
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, allowedRelationTypes: types });
    // Assert
    expect(ctx.allowedRelationTypes).toEqual(types);
    await teardownEmberdeck(ctx);
  });

  // 4. [HP] allowedRelationTypes 미지정 → DEFAULT_RELATION_TYPES 사용
  it('should use DEFAULT_RELATION_TYPES when allowedRelationTypes is not provided', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.allowedRelationTypes).toEqual([...DEFAULT_RELATION_TYPES]);
    await teardownEmberdeck(ctx);
  });

  // 5. [HP] codeLinkRepo 항상 존재 (projectRoot 없어도)
  it('should always provide codeLinkRepo regardless of projectRoot', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.codeLinkRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });

  // 6. [HP] cardRepo, relationRepo, classificationRepo 모두 존재
  it('should provide cardRepo, relationRepo, and classificationRepo', async () => {
    // Arrange / Act
    const ctx = await setupEmberdeck(BASE_OPTS);
    // Assert
    expect(ctx.cardRepo).toBeDefined();
    expect(ctx.relationRepo).toBeDefined();
    expect(ctx.classificationRepo).toBeDefined();
    await teardownEmberdeck(ctx);
  });

  // 7. [HP] teardown: gildash undefined → close 미호출
  it('should not call gildash.close when gildash is undefined during teardown', async () => {
    // Arrange
    const ctx = await setupEmberdeck(BASE_OPTS);
    expect(ctx.gildash).toBeUndefined();
    // Act / Assert (no throw, no close call)
    await expect(teardownEmberdeck(ctx)).resolves.toBeUndefined();
  });

  // 8. [HP] teardown: gildash mock → close 1회 호출
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

  // 9. [HP] projectRoot + gildashIgnore 지정 → Gildash.open에 해당 값 전달
  it('should pass projectRoot and gildashIgnore to Gildash.open when provided', async () => {
    // Arrange
    const { gildash } = makeFakeGildash();
    mockGildashOpen.mockImplementation(async () => gildash);
    const ignorePatterns = ['node_modules', 'dist'];
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj', gildashIgnore: ignorePatterns });
    // Assert
    expect(mockGildashOpen).toHaveBeenCalledTimes(1);
    const calledWith = mockGildashOpen.mock.calls[0][0] as Record<string, unknown>;
    expect(calledWith.projectRoot).toBe('/proj');
    expect(calledWith.ignorePatterns).toEqual(ignorePatterns);
    await teardownEmberdeck(ctx);
  });

  // 10. [NE] Gildash.open Err 반환 → ctx.gildash = undefined, setup 정상 반환
  it('should set gildash to undefined and not throw when Gildash.open returns an Err', async () => {
    // Arrange
    mockGildashOpen.mockImplementation(async () => makeGildashErr());
    // Act
    const ctx = await setupEmberdeck({ ...BASE_OPTS, projectRoot: '/proj' });
    // Assert
    expect(ctx.gildash).toBeUndefined();
    await teardownEmberdeck(ctx);
  });

  // 11. [NE] Gildash.open Err 반환 → codeLinkRepo/cardRepo 정상
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

  // 12. [ED] projectRoot = '' → gildash 미초기화
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

  // 14. [CO] projectRoot 지정 + Gildash.open Err + allowedRelationTypes 미지정 → gildash=undefined + DEFAULT
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

  // 15. [ST] setup → teardown → re-setup 성공
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

  // 16. [ID] teardown 두 번 → 에러 없음
  it('should not throw when teardownEmberdeck is called twice', async () => {
    // Arrange
    const ctx = await setupEmberdeck(BASE_OPTS);
    await teardownEmberdeck(ctx);
    // Act / Assert
    await expect(teardownEmberdeck(ctx)).resolves.toBeUndefined();
  });
});
