import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
  updateCard,
  deleteCard,
  renameCard,
  CardAlreadyExistsError,
  CardNotFoundError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('ops concurrency', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── CR-1: createCard 동시 같은 slug → 직렬화, 두 번째 AlreadyExistsError ──

  it('[CR] should serialize concurrent createCard with same slug and reject the second', async () => {
    // Arrange
    tc = await createTestContext();
    // Act — 두 개 동시 실행
    const results = await Promise.allSettled([
      createCard(tc.ctx, { slug: 'dup', summary: 'First' }),
      createCard(tc.ctx, { slug: 'dup', summary: 'Second' }),
    ]);
    // Assert — 정확히 하나만 성공, 하나는 AlreadyExistsError
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardAlreadyExistsError);
  });

  // ── CR-2: updateCard 동시 같은 key → 직렬화(둘 다 성공) ──

  it('[CR] should serialize concurrent updateCard on the same key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'target', summary: 'Original' });
    // Act
    const results = await Promise.allSettled([
      updateCard(tc.ctx, 'target', { summary: 'Update-A' }),
      updateCard(tc.ctx, 'target', { summary: 'Update-B' }),
    ]);
    // Assert — 둘 다 성공 (직렬화되어 순차 실행)
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // 마지막 쓴 값이 DB에 반영
    const row = tc.ctx.cardRepo.findByKey('target');
    expect(row).not.toBeNull();
    expect(['Update-A', 'Update-B']).toContain(row!.summary);
  });

  // ── CR-3: createCard 다른 slug 동시 → 병렬(둘 다 성공) ──

  it('[CR] should allow concurrent createCard with different slugs', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const results = await Promise.allSettled([
      createCard(tc.ctx, { slug: 'alpha', summary: 'Alpha' }),
      createCard(tc.ctx, { slug: 'beta', summary: 'Beta' }),
    ]);
    // Assert — 둘 다 성공
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    expect(tc.ctx.cardRepo.findByKey('alpha')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('beta')).not.toBeNull();
  });

  // ── CR-4: deleteCard + updateCard 같은 key → 직렬화, 두 번째 NotFound ──

  it('[CR] should serialize concurrent deleteCard and updateCard on the same key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'gone', summary: 'Will be gone' });
    // Act
    const results = await Promise.allSettled([
      deleteCard(tc.ctx, 'gone'),
      updateCard(tc.ctx, 'gone', { summary: 'Too late' }),
    ]);
    // Assert — 정확히 하나 성공, 하나 NotFound
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });

  // ── CR-5: renameCard 동시 같은 old key → 직렬화, 두 번째 NotFound ──

  it('[CR] should serialize concurrent renameCard on the same old key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'orig', summary: 'Original' });
    // Act
    const results = await Promise.allSettled([
      renameCard(tc.ctx, 'orig', 'new-a'),
      renameCard(tc.ctx, 'orig', 'new-b'),
    ]);
    // Assert — 하나 성공, 하나 NotFound
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });
});
