import { describe, it, expect, afterEach, mock } from 'bun:test';

import { createTestContext, type TestContext } from '../helpers';

// registerEmberdeckTools를 테스트 — 아직 미구현
import { registerEmberdeckTools, createCard } from '../../index';

describe('registerEmberdeckTools', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── HP-1: 19개 tool 등록 ──

  it('should register all 19 tools on the server', async () => {
    // Arrange
    tc = await createTestContext();
    const registered: Array<{ name: string; config: unknown }> = [];
    const mockServer = {
      registerTool: mock((name: string, config: unknown, _cb: unknown) => {
        registered.push({ name, config });
        return {} as any; // RegisteredTool stub
      }),
    };
    // Act
    registerEmberdeckTools(mockServer as any, tc.ctx);
    // Assert
    expect(registered).toHaveLength(19);
    expect(mockServer.registerTool).toHaveBeenCalledTimes(19);

    const names = registered.map((r) => r.name);
    expect(names).toContain('emberdeck_create_card');
    expect(names).toContain('emberdeck_get_card');
    expect(names).toContain('emberdeck_update_card');
    expect(names).toContain('emberdeck_delete_card');
    expect(names).toContain('emberdeck_list_cards');
    expect(names).toContain('emberdeck_search_cards');
  });

  // ── HP-2: create_card handler ──

  it('should create a card via emberdeck_create_card handler and return JSON result', async () => {
    // Arrange
    tc = await createTestContext();
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: mock((name: string, _config: unknown, cb: Function) => {
        handlers.set(name, cb);
        return {} as any;
      }),
    };
    registerEmberdeckTools(mockServer as any, tc.ctx);
    const handler = handlers.get('emberdeck_create_card')!;
    // Act
    const result = await handler({ slug: 'test-card', summary: 'Test summary' });
    // Assert
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.fullKey).toBe('test-card');
    expect(parsed.filePath).toContain('test-card.card.md');
  });

  // ── HP-3: get_card handler ──

  it('should return card data via emberdeck_get_card handler', async () => {
    // Arrange
    tc = await createTestContext();
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: mock((name: string, _config: unknown, cb: Function) => {
        handlers.set(name, cb);
        return {} as any;
      }),
    };
    registerEmberdeckTools(mockServer as any, tc.ctx);
    // 먼저 카드 생성
    await createCard(tc.ctx, { slug: 'read-me', summary: 'Read test' });
    const handler = handlers.get('emberdeck_get_card')!;
    // Act
    const result = await handler({ key: 'read-me' });
    // Assert
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.frontmatter.key).toBe('read-me');
    expect(parsed.frontmatter.summary).toBe('Read test');
  });

  // ── NE-1: get_card 없는 key → isError ──

  it('should return isError true when emberdeck_get_card is called with non-existent key', async () => {
    // Arrange
    tc = await createTestContext();
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: mock((name: string, _config: unknown, cb: Function) => {
        handlers.set(name, cb);
        return {} as any;
      }),
    };
    registerEmberdeckTools(mockServer as any, tc.ctx);
    const handler = handlers.get('emberdeck_get_card')!;
    // Act
    const result = await handler({ key: 'nonexistent' });
    // Assert
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('nonexistent');
  });

  // ── NE-2: create_card 중복 → isError ──

  it('should return isError true when emberdeck_create_card is called with duplicate slug', async () => {
    // Arrange
    tc = await createTestContext();
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: mock((name: string, _config: unknown, cb: Function) => {
        handlers.set(name, cb);
        return {} as any;
      }),
    };
    registerEmberdeckTools(mockServer as any, tc.ctx);
    const handler = handlers.get('emberdeck_create_card')!;
    await handler({ slug: 'dup', summary: 'First' });
    // Act
    const result = await handler({ slug: 'dup', summary: 'Second' });
    // Assert
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('dup');
  });

  // ── ED-1: list_cards 빈 목록 ──

  it('should return empty array via emberdeck_list_cards handler when no cards exist', async () => {
    // Arrange
    tc = await createTestContext();
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: mock((name: string, _config: unknown, cb: Function) => {
        handlers.set(name, cb);
        return {} as any;
      }),
    };
    registerEmberdeckTools(mockServer as any, tc.ctx);
    const handler = handlers.get('emberdeck_list_cards')!;
    // Act
    const result = await handler({});
    // Assert
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([]);
  });
});
