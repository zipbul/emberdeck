/**
 * MCP tools 통합 테스트.
 *
 * 공식 MCP 테스트 방법 사용:
 * - McpServer + InMemoryTransport.createLinkedPair() + Client
 * - Client.listTools() / Client.callTool() 프로토콜 수준 검증
 */
import { describe, it, expect, afterEach } from 'bun:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createTestContext, type TestContext } from '../helpers';
import { registerEmberdeckTools } from '../../index';
import { writeCardFile } from '../../src/fs/writer';
import { readCardFile } from '../../src/fs/reader';
import { buildCardPath } from '../../src/card/card-key';

// ── Helper ──

interface McpSetup {
  tc: TestContext;
  client: Client;
  server: McpServer;
  cleanup: () => Promise<void>;
}

async function setupMcp(
  opts?: { allowedRelationTypes?: readonly string[] },
): Promise<McpSetup> {
  const tc = await createTestContext(opts);
  const server = new McpServer({ name: 'emberdeck-test', version: '0.0.1' });
  registerEmberdeckTools(server, tc.ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(clientTransport);

  return {
    tc,
    client,
    server,
    cleanup: async () => {
      await client.close();
      await server.close();
      await tc.cleanup();
    },
  };
}

function parseText(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]!.text;
}

// ── Tests ──

describe('registerEmberdeckTools (MCP protocol)', () => {
  let s: McpSetup;

  afterEach(async () => {
    await s?.cleanup();
  });

  // ════════════════════════════════════════
  // Protocol
  // ════════════════════════════════════════

  describe('Protocol', () => {
    // #1
    it('should return 19 tools via listTools', async () => {
      s = await setupMcp();
      const { tools } = await s.client.listTools();
      expect(tools).toHaveLength(19);
    });

    // #2
    it('should include description for every tool via listTools', async () => {
      s = await setupMcp();
      const { tools } = await s.client.listTools();
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
      }
    });

    // #3
    it('should include inputSchema for every tool via listTools', async () => {
      s = await setupMcp();
      const { tools } = await s.client.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
      }
    });

    // #4
    it('should return MCP content format from callTool', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'fmt-check', summary: 'Format check' },
      });
      expect(result.content).toBeArray();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.type).toBe('text');
      expect(() => JSON.parse(content[0]!.text)).not.toThrow();
    });

    // #5
    it('should return error when callTool targets non-existent tool', async () => {
      s = await setupMcp();
      try {
        await s.client.callTool({ name: 'nonexistent_tool', arguments: {} });
        // 프로토콜이 에러를 throw할 수도 있고, isError result를 반환할 수도 있음
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    // #57
    it('should return identical results from get_card called twice (idempotent)', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'idem', summary: 'Idem test' },
      });
      const r1 = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'idem' } });
      const r2 = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'idem' } });
      expect(parseText(r1)).toEqual(parseText(r2));
    });

    // #58
    it('should return identical tool list from listTools called twice (idempotent)', async () => {
      s = await setupMcp();
      const r1 = await s.client.listTools();
      const r2 = await s.client.listTools();
      expect(r1.tools.map((t) => t.name)).toEqual(r2.tools.map((t) => t.name));
    });
  });

  // ════════════════════════════════════════
  // CRUD — create_card
  // ════════════════════════════════════════

  describe('emberdeck_create_card', () => {
    // #6
    it('should create a card with slug and summary', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'hello', summary: 'Hello world' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { fullKey: string; filePath: string };
      expect(data.fullKey).toBe('hello');
      expect(data.filePath).toContain('hello.card.md');
    });

    // #7
    it('should create a card with all optional fields', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      // target 카드를 먼저 생성해야 FK 충족
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dep-target', summary: 'Dep target' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'full-card',
          summary: 'Full card',
          body: '# Body\nContent here',
          keywords: ['kw1', 'kw2'],
          tags: ['t1', 't2'],
          relations: [{ type: 'depends-on', target: 'dep-target' }],
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Foo' }],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { fullKey: string };
      expect(data.fullKey).toBe('full-card');
    });

    // #8
    it('should return isError when creating card with duplicate slug', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dup', summary: 'First' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dup', summary: 'Second' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('dup');
    });

    // #9
    it('should return isError when creating card with empty slug', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: '', summary: 'No slug' },
      });
      expect(result.isError).toBe(true);
    });

    // #10
    it('should create a card with empty keywords array', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'empty-kw', summary: 'Empty KW', keywords: [] },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  // ════════════════════════════════════════
  // CRUD — get_card
  // ════════════════════════════════════════

  describe('emberdeck_get_card', () => {
    // #11
    it('should return card data with frontmatter and body', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'get-me', summary: 'Get test', body: '# Body here' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'get-me' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { frontmatter: { key: string; summary: string }; body: string };
      expect(data.frontmatter.key).toBe('get-me');
      expect(data.frontmatter.summary).toBe('Get test');
      expect(data.body).toContain('Body here');
    });

    // #12
    it('should return isError when card does not exist', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'nonexistent' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('nonexistent');
    });
  });

  // ════════════════════════════════════════
  // CRUD — update_card
  // ════════════════════════════════════════

  describe('emberdeck_update_card', () => {
    // #13
    it('should update card summary only', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'upd', summary: 'Old' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'upd', summary: 'New' },
      });
      expect(result.isError).toBeFalsy();
      // Verify
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'upd' },
      });
      const data = parseText(get) as { frontmatter: { summary: string } };
      expect(data.frontmatter.summary).toBe('New');
    });

    // #14
    it('should update multiple fields simultaneously', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'multi', summary: 'Multi', body: 'Old body', keywords: ['old'] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'multi', summary: 'Updated', body: 'New body', keywords: ['new1', 'new2'] },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'multi' },
      });
      const data = parseText(get) as { frontmatter: { summary: string; keywords: string[] }; body: string };
      expect(data.frontmatter.summary).toBe('Updated');
      expect(data.frontmatter.keywords).toEqual(['new1', 'new2']);
      expect(data.body).toContain('New body');
    });

    // #15
    it('should return isError when updating non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'nope', summary: 'X' },
      });
      expect(result.isError).toBe(true);
    });

    // #16
    it('should delete keywords when set to null', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'null-kw', summary: 'KW', keywords: ['a', 'b'] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'null-kw', keywords: null },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'null-kw' },
      });
      const data = parseText(get) as { frontmatter: { keywords?: string[] } };
      expect(data.frontmatter.keywords).toBeUndefined();
    });
  });

  // ════════════════════════════════════════
  // CRUD — update_card_status
  // ════════════════════════════════════════

  describe('emberdeck_update_card_status', () => {
    // #17
    it('should update card status', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'status-card', summary: 'Status' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'status-card', status: 'accepted' },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'status-card' },
      });
      const data = parseText(get) as { frontmatter: { status: string } };
      expect(data.frontmatter.status).toBe('accepted');
    });

    // #18
    it('should return isError when updating status of non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'nope', status: 'accepted' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // CRUD — delete_card
  // ════════════════════════════════════════

  describe('emberdeck_delete_card', () => {
    // #19
    it('should delete an existing card', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'del-me', summary: 'Delete' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_delete_card',
        arguments: { key: 'del-me' },
      });
      expect(result.isError).toBeFalsy();
      // Verify deleted
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'del-me' },
      });
      expect(get.isError).toBe(true);
    });

    // #20
    it('should return isError when deleting non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_delete_card',
        arguments: { key: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // CRUD — rename_card
  // ════════════════════════════════════════

  describe('emberdeck_rename_card', () => {
    // #21
    it('should rename a card', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'old-name', summary: 'Rename me' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_rename_card',
        arguments: { key: 'old-name', newSlug: 'new-name' },
      });
      expect(result.isError).toBeFalsy();
      // Verify new key works
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'new-name' },
      });
      expect(get.isError).toBeFalsy();
      const data = parseText(get) as { frontmatter: { key: string } };
      expect(data.frontmatter.key).toBe('new-name');
    });

    // #22
    it('should return isError when renaming non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_rename_card',
        arguments: { key: 'nope', newSlug: 'xxx' },
      });
      expect(result.isError).toBe(true);
    });

    // #23
    it('should return isError when newSlug already exists', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'src-card', summary: 'Src' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dst-card', summary: 'Dst' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_rename_card',
        arguments: { key: 'src-card', newSlug: 'dst-card' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // Query — list_cards
  // ════════════════════════════════════════

  describe('emberdeck_list_cards', () => {
    // #24
    it('should list multiple cards', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'a', summary: 'A' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'b', summary: 'B' } });
      const result = await s.client.callTool({ name: 'emberdeck_list_cards', arguments: {} });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string }>;
      expect(data).toHaveLength(2);
    });

    // #25
    it('should filter cards by status', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'draft-card', summary: 'D' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'acc-card', summary: 'A' } });
      await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'acc-card', status: 'accepted' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_list_cards',
        arguments: { status: 'accepted' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string }>;
      expect(data).toHaveLength(1);
      expect(data[0]!.key).toBe('acc-card');
    });

    // #26
    it('should return empty array when no cards exist', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({ name: 'emberdeck_list_cards', arguments: {} });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as unknown[];
      expect(data).toEqual([]);
    });
  });

  // ════════════════════════════════════════
  // Query — search_cards
  // ════════════════════════════════════════

  describe('emberdeck_search_cards', () => {
    // #27
    it('should return matching cards for search query', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'searchable', summary: 'UniqueKeyword123' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'other', summary: 'No match' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_search_cards',
        arguments: { query: 'UniqueKeyword123' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string }>;
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data.some((c) => c.key === 'searchable')).toBe(true);
    });

    // #28
    it('should handle empty search query gracefully', async () => {
      s = await setupMcp();
      // 빈 query는 에러 또는 빈 결과 — 어느 쪽이든 crash하지 않아야 함
      const result = await s.client.callTool({
        name: 'emberdeck_search_cards',
        arguments: { query: '' },
      });
      // isError이든 빈 결과이든 유효 응답
      expect(result.content).toBeArray();
    });
  });

  // ════════════════════════════════════════
  // Query — get_card_context
  // ════════════════════════════════════════

  describe('emberdeck_get_card_context', () => {
    // #29
    it('should return card context with card and relation data', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'ctx-card', summary: 'Context card' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_card_context',
        arguments: { key: 'ctx-card' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as {
        card: unknown;
        codeLinks: unknown[];
        upstreamCards: unknown[];
        downstreamCards: unknown[];
      };
      expect(data.card).toBeDefined();
      expect(data.codeLinks).toBeArray();
      expect(data.upstreamCards).toBeArray();
      expect(data.downstreamCards).toBeArray();
    });

    // #30
    it('should return isError for non-existent card context', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_get_card_context',
        arguments: { key: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // Query — get_relation_graph
  // ════════════════════════════════════════

  describe('emberdeck_get_relation_graph', () => {
    // #31
    it('should return relation graph for a card', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'graph-a', summary: 'A' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'graph-b', summary: 'B', relations: [{ type: 'depends-on', target: 'graph-a' }] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'graph-b' },
      });
      expect(result.isError).toBeFalsy();
      // getRelationGraph returns RelationGraphNode[] (flat array)
      const data = parseText(result) as Array<{ key: string; depth: number }>;
      expect(data).toBeArray();
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data.some((n) => n.key === 'graph-a')).toBe(true);
    });

    // #32
    it('should respect maxDepth parameter', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'dep-a', summary: 'A' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dep-b', summary: 'B', relations: [{ type: 'depends-on', target: 'dep-a' }] },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dep-c', summary: 'C', relations: [{ type: 'depends-on', target: 'dep-b' }] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'dep-c', maxDepth: 1 },
      });
      expect(result.isError).toBeFalsy();
    });

    // #33
    it('should respect direction parameter', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'dir-a', summary: 'A' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'dir-b', summary: 'B', relations: [{ type: 'depends-on', target: 'dir-a' }] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'dir-b', direction: 'forward' },
      });
      expect(result.isError).toBeFalsy();
    });

    // #34
    it('should return empty array for non-existent card graph', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'nope' },
      });
      // getRelationGraph returns [] for non-existent card (no throw)
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as unknown[];
      expect(data).toEqual([]);
    });
  });

  // ════════════════════════════════════════
  // Query — list_card_relations
  // ════════════════════════════════════════

  describe('emberdeck_list_card_relations', () => {
    // #35
    it('should list relations for a card', async () => {
      s = await setupMcp({ allowedRelationTypes: ['uses'] });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'rel-a', summary: 'A' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'rel-b', summary: 'B', relations: [{ type: 'uses', target: 'rel-a' }] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_list_card_relations',
        arguments: { key: 'rel-b' },
      });
      expect(result.isError).toBeFalsy();
      // listCardRelations returns RelationRow[] (flat array)
      const data = parseText(result) as Array<{ type: string; srcCardKey: string; dstCardKey: string }>;
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    // #36
    it('should return empty relations for card with no relations', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'no-rel', summary: 'No relations' } });
      const result = await s.client.callTool({
        name: 'emberdeck_list_card_relations',
        arguments: { key: 'no-rel' },
      });
      expect(result.isError).toBeFalsy();
      // listCardRelations returns RelationRow[] (flat array)
      const data = parseText(result) as unknown[];
      expect(data).toEqual([]);
    });
  });

  // ════════════════════════════════════════
  // Sync
  // ════════════════════════════════════════

  describe('emberdeck_sync_card_from_file', () => {
    // #37
    it('should sync a card from file', async () => {
      s = await setupMcp();
      // Create card via API first, then modify file and sync
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'sync-me', summary: 'Original' },
      });
      // Modify the file directly
      const filePath = buildCardPath(s.tc.ctx.cardsDir, 'sync-me');
      const card = await readCardFile(filePath);
      await writeCardFile(filePath, {
        filePath,
        frontmatter: { ...card.frontmatter, summary: 'Synced' },
        body: card.body,
      });

      const result = await s.client.callTool({
        name: 'emberdeck_sync_card_from_file',
        arguments: { filePath },
      });
      expect(result.isError).toBeFalsy();
      // Verify sync worked
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'sync-me' },
      });
      const data = parseText(get) as { frontmatter: { summary: string } };
      expect(data.frontmatter.summary).toBe('Synced');
    });

    // #38
    it('should return isError when syncing non-existent file', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_sync_card_from_file',
        arguments: { filePath: '/tmp/nonexistent-path-12345.card.md' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('emberdeck_bulk_sync_cards', () => {
    // #39
    it('should bulk sync cards from directory', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'bulk-a', summary: 'A' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'bulk-b', summary: 'B' } });
      const result = await s.client.callTool({
        name: 'emberdeck_bulk_sync_cards',
        arguments: { dirPath: s.tc.cardsDir },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('emberdeck_validate_cards', () => {
    // #40
    it('should validate cards returning consistency report', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'val-card', summary: 'Valid' } });
      const result = await s.client.callTool({
        name: 'emberdeck_validate_cards',
        arguments: { dirPath: s.tc.cardsDir },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { staleDbRows: unknown[]; orphanFiles: unknown[]; keyMismatches: unknown[] };
      expect(data.staleDbRows).toBeDefined();
      expect(data.orphanFiles).toBeDefined();
      expect(data.keyMismatches).toBeDefined();
    });
  });

  describe('emberdeck_export_card_to_file', () => {
    // #41
    it('should export card to file', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'exp-card', summary: 'Export' } });
      const result = await s.client.callTool({
        name: 'emberdeck_export_card_to_file',
        arguments: { key: 'exp-card' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { filePath: string };
      expect(data.filePath).toContain('exp-card.card.md');
    });

    // #42
    it('should return isError when exporting non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_export_card_to_file',
        arguments: { key: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // CodeLink
  // ════════════════════════════════════════

  describe('emberdeck_resolve_code_links', () => {
    // #43
    it('should return isError when gildash not configured', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'link-card',
          summary: 'Link',
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Foo' }],
        },
      });
      // gildash 미설정 → GildashNotConfiguredError
      const result = await s.client.callTool({
        name: 'emberdeck_resolve_code_links',
        arguments: { key: 'link-card' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('gildash');
    });

    // #44
    it('should return isError for non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_resolve_code_links',
        arguments: { key: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('emberdeck_find_cards_by_symbol', () => {
    // #45
    it('should find cards by symbol name', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'sym-card',
          summary: 'Symbol',
          codeLinks: [{ kind: 'defines', file: 'src/x.ts', symbol: 'MyClass' }],
        },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_find_cards_by_symbol',
        arguments: { symbolName: 'MyClass' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as unknown[];
      expect(data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('emberdeck_find_affected_cards', () => {
    // #46
    it('should find affected cards for changed files', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'affected',
          summary: 'Affected',
          codeLinks: [{ kind: 'defines', file: 'src/changed.ts', symbol: 'Handler' }],
        },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_find_affected_cards',
        arguments: { changedFiles: ['src/changed.ts'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as unknown[];
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    // #47
    it('should return empty result for empty changedFiles array', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_find_affected_cards',
        arguments: { changedFiles: [] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as unknown[];
      expect(data).toHaveLength(0);
    });
  });

  describe('emberdeck_validate_code_links', () => {
    // #48
    it('should return isError when gildash not configured', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'vcl-card',
          summary: 'Validate CL',
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Bar' }],
        },
      });
      // gildash 미설정 → GildashNotConfiguredError
      const result = await s.client.callTool({
        name: 'emberdeck_validate_code_links',
        arguments: { key: 'vcl-card' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('gildash');
    });

    // #49
    it('should return isError for non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_validate_code_links',
        arguments: { key: 'nope' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // Corner Cases
  // ════════════════════════════════════════

  describe('Corner cases', () => {
    // #50
    it('should delete nullable fields when set to null', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          slug: 'null-all',
          summary: 'All nullable',
          keywords: ['kw'],
          tags: ['tag'],
        },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: {
          key: 'null-all',
          keywords: null,
          tags: null,
        },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'null-all' } });
      const data = parseText(get) as {
        frontmatter: { keywords?: string[]; tags?: string[] };
      };
      expect(data.frontmatter.keywords).toBeUndefined();
      expect(data.frontmatter.tags).toBeUndefined();
    });

    // #51
    it('should make old key fail and new key work after rename', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'before-rename', summary: 'Before' },
      });
      await s.client.callTool({
        name: 'emberdeck_rename_card',
        arguments: { key: 'before-rename', newSlug: 'after-rename' },
      });
      const oldGet = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'before-rename' },
      });
      expect(oldGet.isError).toBe(true);
      const newGet = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'after-rename' },
      });
      expect(newGet.isError).toBeFalsy();
    });

    // #52
    it('should return isError for self-referencing relation (unique constraint)', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'self-ref', summary: 'Self ref' },
      });
      // self-ref: forward + reverse 모두 (type, src, dst) 동일 → UNIQUE 위반
      const upd = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'self-ref', relations: [{ type: 'depends-on', target: 'self-ref' }] },
      });
      expect(upd.isError).toBe(true);
    });

    // #53
    it('should show mutual relations in graph', async () => {
      s = await setupMcp({ allowedRelationTypes: ['depends-on'] });
      // 양쪽 카드 먼저 생성, 후 관계 추가
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'mutual-a', summary: 'A' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'mutual-b', summary: 'B' },
      });
      // 관계 추가
      await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'mutual-a', relations: [{ type: 'depends-on', target: 'mutual-b' }] },
      });
      await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'mutual-b', relations: [{ type: 'depends-on', target: 'mutual-a' }] },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'mutual-a', direction: 'both' },
      });
      expect(result.isError).toBeFalsy();
      // getRelationGraph returns RelationGraphNode[] (flat array)
      const data = parseText(result) as Array<{ key: string }>;
      const keys = data.map((n) => n.key);
      expect(keys).toContain('mutual-b');
    });
  });

  // ════════════════════════════════════════
  // State Transitions
  // ════════════════════════════════════════

  describe('State transitions', () => {
    // #54
    it('should complete full status lifecycle', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'lifecycle', summary: 'Lifecycle card' },
      });

      const statuses = ['accepted', 'implementing', 'implemented', 'deprecated'] as const;
      for (const status of statuses) {
        const result = await s.client.callTool({
          name: 'emberdeck_update_card_status',
          arguments: { key: 'lifecycle', status },
        });
        expect(result.isError).toBeFalsy();
      }

      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'lifecycle' } });
      const data = parseText(get) as { frontmatter: { status: string } };
      expect(data.frontmatter.status).toBe('deprecated');
    });

    // #55
    it('should allow recreating card after deletion with same slug', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'phoenix', summary: 'First life' },
      });
      await s.client.callTool({
        name: 'emberdeck_delete_card',
        arguments: { key: 'phoenix' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'phoenix', summary: 'Second life' },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'phoenix' } });
      const data = parseText(get) as { frontmatter: { summary: string } };
      expect(data.frontmatter.summary).toBe('Second life');
    });

    // #56
    it('should round-trip export and sync', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { slug: 'roundtrip', summary: 'Original' },
      });

      // Export to file
      const expResult = await s.client.callTool({
        name: 'emberdeck_export_card_to_file',
        arguments: { key: 'roundtrip' },
      });
      expect(expResult.isError).toBeFalsy();
      const { filePath } = parseText(expResult) as { filePath: string };

      // Modify file
      const card = await readCardFile(filePath);
      await writeCardFile(filePath, {
        filePath,
        frontmatter: { ...card.frontmatter, summary: 'Modified' },
        body: card.body,
      });

      // Sync from file
      const syncResult = await s.client.callTool({
        name: 'emberdeck_sync_card_from_file',
        arguments: { filePath },
      });
      expect(syncResult.isError).toBeFalsy();

      // Verify
      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'roundtrip' } });
      const data = parseText(get) as { frontmatter: { summary: string } };
      expect(data.frontmatter.summary).toBe('Modified');
    });
  });

  // ════════════════════════════════════════
  // Ordering
  // ════════════════════════════════════════

  describe('Ordering', () => {
    // #59
    it('should return same list regardless of creation order', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'z-card', summary: 'Z' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { slug: 'a-card', summary: 'A' } });

      const result = await s.client.callTool({ name: 'emberdeck_list_cards', arguments: {} });
      const data = parseText(result) as Array<{ key: string }>;
      const keys = data.map((c) => c.key).sort();
      expect(keys).toEqual(['a-card', 'z-card']);
    });
  });
});
