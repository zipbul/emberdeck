import { describe, it, expect, afterEach } from 'bun:test';

import {
  addRelationType,
  removeRelationType,
  listRelationTypes,
  createCard,
  DEFAULT_RELATION_TYPES,
} from '../index';
import { createTestContext, type TestContext } from './helpers';

describe('addRelationType / removeRelationType / listRelationTypes', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // [HP-1] 새 타입 추가 → allowedRelationTypes에 포함
  it('should include the new type when adding a type that does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    addRelationType(tc.ctx, 'custom-type');
    // Assert
    expect(tc.ctx.allowedRelationTypes).toContain('custom-type');
  });

  // [HP-2] 이미 있는 타입 추가 → 중복 없음 (includes guard)
  it('should not add a duplicate when adding a type that already exists', async () => {
    // Arrange
    tc = await createTestContext();
    addRelationType(tc.ctx, 'dup-type');
    const countBefore = tc.ctx.allowedRelationTypes.length;
    // Act
    addRelationType(tc.ctx, 'dup-type');
    // Assert
    expect(tc.ctx.allowedRelationTypes.length).toBe(countBefore);
    expect(tc.ctx.allowedRelationTypes.filter((t) => t === 'dup-type')).toHaveLength(1);
  });

  // [HP-3] 있는 타입 제거 → 목록에서 제거
  it('should remove the type from allowedRelationTypes when it exists', async () => {
    // Arrange
    tc = await createTestContext();
    addRelationType(tc.ctx, 'to-remove');
    expect(tc.ctx.allowedRelationTypes).toContain('to-remove');
    // Act
    removeRelationType(tc.ctx, 'to-remove');
    // Assert
    expect(tc.ctx.allowedRelationTypes).not.toContain('to-remove');
  });

  // [HP-4] 없는 타입 제거 → 무해, 목록 불변
  it('should leave allowedRelationTypes unchanged when removing a type that does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    const before = [...tc.ctx.allowedRelationTypes];
    // Act
    removeRelationType(tc.ctx, 'ghost-type');
    // Assert
    expect([...tc.ctx.allowedRelationTypes]).toEqual(before);
  });

  // [HP-5] listRelationTypes → 현재 배열 반환
  it('should return the current allowed relation types via listRelationTypes', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = listRelationTypes(tc.ctx);
    // Assert
    for (const t of DEFAULT_RELATION_TYPES) {
      expect(result).toContain(t);
    }
  });

  // [HP-6] addRelationType 후 해당 타입으로 createCard → 성공
  it('should allow createCard to use a relation type after it has been added', async () => {
    // Arrange
    tc = await createTestContext();
    addRelationType(tc.ctx, 'proposed-by');
    await createCard(tc.ctx, { slug: 'cfg-target', summary: 'Target' });
    // Act & Assert: should not throw
    await expect(
      createCard(tc.ctx, {
        slug: 'cfg-user',
        summary: 'User card',
        relations: [{ type: 'proposed-by', target: 'cfg-target' }],
      }),
    ).resolves.toBeDefined();
  });

  // [ST-7] add → remove → list → 원래 목록 복원
  it('should restore original allowedRelationTypes after add then remove', async () => {
    // Arrange
    tc = await createTestContext();
    const original = [...tc.ctx.allowedRelationTypes];
    // Act
    addRelationType(tc.ctx, 'transient');
    removeRelationType(tc.ctx, 'transient');
    // Assert
    expect([...listRelationTypes(tc.ctx)]).toEqual(original);
  });

  // [ID-8] addRelationType 두 번 → 목록에 하나만 존재
  it('should contain only one entry when the same type is added twice', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    addRelationType(tc.ctx, 'idempotent-type');
    addRelationType(tc.ctx, 'idempotent-type');
    // Assert
    const matches = [...tc.ctx.allowedRelationTypes].filter((t) => t === 'idempotent-type');
    expect(matches).toHaveLength(1);
  });
});
