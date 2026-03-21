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

  // ── CR-1: concurrent createCard with same key -> serialized, second gets AlreadyExistsError ──

  it('[CR] should serialize concurrent createCard with same key and reject the second', async () => {
    tc = await createTestContext();
    const results = await Promise.allSettled([
      createCard(tc.ctx, { key: 'dup', summary: 'First', type: 'spec' }),
      createCard(tc.ctx, { key: 'dup', summary: 'Second', type: 'spec' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardAlreadyExistsError);
  });

  // ── CR-2: concurrent updateCard on same key -> serialized (both succeed) ──

  it('[CR] should serialize concurrent updateCard on the same key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'target', summary: 'Original', type: 'spec' });
    const results = await Promise.allSettled([
      updateCard(tc.ctx, 'target', { summary: 'Update-A' }),
      updateCard(tc.ctx, 'target', { summary: 'Update-B' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const row = tc.ctx.cardRepo.findByKey('target');
    expect(row).not.toBeNull();
    expect(['Update-A', 'Update-B']).toContain(row!.summary);
  });

  // ── CR-3: concurrent createCard with different keys -> parallel (both succeed) ──

  it('[CR] should allow concurrent createCard with different keys', async () => {
    tc = await createTestContext();
    const results = await Promise.allSettled([
      createCard(tc.ctx, { key: 'alpha', summary: 'Alpha', type: 'spec' }),
      createCard(tc.ctx, { key: 'beta', summary: 'Beta', type: 'spec' }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    expect(tc.ctx.cardRepo.findByKey('alpha')).not.toBeNull();
    expect(tc.ctx.cardRepo.findByKey('beta')).not.toBeNull();
  });

  // ── CR-4: deleteCard + updateCard on same key -> serialized, second gets NotFound ──

  it('[CR] should serialize concurrent deleteCard and updateCard on the same key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'gone', summary: 'Will be gone', type: 'spec' });
    const results = await Promise.allSettled([
      deleteCard(tc.ctx, 'gone'),
      updateCard(tc.ctx, 'gone', { summary: 'Too late' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });

  // ── CR-5: concurrent createCard + renameCard to same target key ──

  it('[CR] should allow exactly one of concurrent createCard and renameCard targeting the same key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'old-name', summary: 'Will be renamed', type: 'spec' });
    const results = await Promise.allSettled([
      createCard(tc.ctx, { key: 'target', summary: 'Created directly', type: 'spec' }),
      renameCard(tc.ctx, 'old-name', 'target'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(tc.ctx.cardRepo.findByKey('target')).not.toBeNull();
  });

  // ── CR-6: concurrent renameCard on same old key -> serialized, second gets NotFound ──

  it('[CR] should serialize concurrent renameCard on the same old key', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'orig', summary: 'Original', type: 'spec' });
    const results = await Promise.allSettled([
      renameCard(tc.ctx, 'orig', 'new-a'),
      renameCard(tc.ctx, 'orig', 'new-b'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CardNotFoundError);
  });
});
