import { describe, it, expect, afterEach } from 'bun:test';

import {
  createCard,
} from '../index';
import { createTestContext, type TestContext } from './helpers';

describe('setupEmberdeck / teardownEmberdeck basic config', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // [HP-1] Setup creates a usable context with cardRepo
  it('should create a usable context after setup', async () => {
    tc = await createTestContext();
    expect(tc.ctx.cardRepo).toBeDefined();
    expect(tc.ctx.relationRepo).toBeDefined();
    expect(tc.ctx.classificationRepo).toBeDefined();
  });

  // [HP-2] Cards can be created after setup
  it('should allow creating a card after setup', async () => {
    tc = await createTestContext();
    const result = await createCard(tc.ctx, { key: 'cfg-card', summary: 'Config test', type: 'spec' });
    expect(result.card.frontmatter.key).toBe('cfg-card');
  });

  // [HP-3] Relations work as string arrays (no type/target objects)
  it('should create relations as string arrays', async () => {
    tc = await createTestContext();
    await createCard(tc.ctx, { key: 'cfg-target', summary: 'Target', type: 'spec' });
    await createCard(tc.ctx, {
      key: 'cfg-user',
      summary: 'User card',
      type: 'spec',
      relations: ['cfg-target'],
    });
    const rows = tc.ctx.relationRepo.findByCardKey('cfg-user');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'cfg-target')).toBe(true);
  });
});
