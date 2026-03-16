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

  // ── CR-1: concurrent createCard with same slug → serialized, second gets AlreadyExistsError ──

  it('[CR] should serialize concurrent createCard with same slug and reject the second', async () => {
    // Arrange
    tc = await createTestContext();
    // Act — execute two concurrently
    const results = await Promise.allSettled([
      createCard(tc.ctx, { slug: 'dup', summary: 'First' }),
      createCard(tc.ctx, { slug: 'dup', summary: 'Second' }),
    ]);
    // Assert — exactly one succeeds, one gets AlreadyExistsError
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardAlreadyExistsError);
  });

  // ── CR-2: concurrent updateCard on same key → serialized (both succeed) ──

  it('[CR] should serialize concurrent updateCard on the same key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'target', summary: 'Original' });
    // Act
    const results = await Promise.allSettled([
      updateCard(tc.ctx, 'target', { summary: 'Update-A' }),
      updateCard(tc.ctx, 'target', { summary: 'Update-B' }),
    ]);
    // Assert — both succeed (serialized, executed sequentially)
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Last written value is reflected in DB
    const row = tc.ctx.cardRepo.findByKey('target');
    expect(row).not.toBeNull();
    expect(['Update-A', 'Update-B']).toContain(row!.summary);
  });

  // ── CR-3: concurrent createCard with different slugs → parallel (both succeed) ──

  it('[CR] should allow concurrent createCard with different slugs', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const results = await Promise.allSettled([
      createCard(tc.ctx, { slug: 'alpha', summary: 'Alpha' }),
      createCard(tc.ctx, { slug: 'beta', summary: 'Beta' }),
    ]);
    // Assert — both succeed
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    expect(tc.ctx.cardRepo.findByKey('alpha')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('beta')).not.toBeNull();
  });

  // ── CR-4: deleteCard + updateCard on same key → serialized, second gets NotFound ──

  it('[CR] should serialize concurrent deleteCard and updateCard on the same key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'gone', summary: 'Will be gone' });
    // Act
    const results = await Promise.allSettled([
      deleteCard(tc.ctx, 'gone'),
      updateCard(tc.ctx, 'gone', { summary: 'Too late' }),
    ]);
    // Assert — exactly one succeeds, one gets NotFound
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });

  // ── CR-5: concurrent createCard + renameCard to same target key ──

  it('[CR] should allow exactly one of concurrent createCard and renameCard targeting the same key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'old-name', summary: 'Will be renamed' });
    // Act — createCard("target") and renameCard("old-name", "target") race
    const results = await Promise.allSettled([
      createCard(tc.ctx, { slug: 'target', summary: 'Created directly' }),
      renameCard(tc.ctx, 'old-name', 'target'),
    ]);
    // Assert — exactly one succeeds, one fails
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The target key should exist in DB
    expect(tc.ctx.cardRepo.findByKey('target')).not.toBeNull();
  });

  // ── CR-6: concurrent renameCard on same old key → serialized, second gets NotFound ──

  it('[CR] should serialize concurrent renameCard on the same old key', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'orig', summary: 'Original' });
    // Act
    const results = await Promise.allSettled([
      renameCard(tc.ctx, 'orig', 'new-a'),
      renameCard(tc.ctx, 'orig', 'new-b'),
    ]);
    // Assert — one succeeds, one gets NotFound
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });
});
