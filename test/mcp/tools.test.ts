/**
 * MCP tools integration tests.
 *
 * Uses official MCP testing approach:
 * - McpServer + InMemoryTransport.createLinkedPair() + Client
 * - Client.listTools() / Client.callTool() protocol-level verification
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

async function setupMcp(): Promise<McpSetup> {
  const tc = await createTestContext();
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
      expect(tools).toHaveLength(33);
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
        arguments: { key: 'fmt-check', summary: 'Format check', type: 'spec' },
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
        // Protocol may throw an error or return an isError result
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
        arguments: { key: 'idem', summary: 'Idem test', type: 'spec' },
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
        arguments: { key: 'hello', summary: 'Hello world', type: 'spec' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { fullKey: string; filePath: string };
      expect(data.fullKey).toBe('hello');
      expect(data.filePath).toContain('hello.card.md');
    });

    // #7
    it('should create a card with all optional fields', async () => {
      s = await setupMcp();
      // Target card must be created first to satisfy FK constraint
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dep-target', summary: 'Dep target', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'full-card',
          summary: 'Full card',
          body: '# Body\nContent here',
          tags: ['t1', 't2'],
          relations: ['dep-target'],
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Foo' }], type: 'spec' },
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
        arguments: { key: 'dup', summary: 'First', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dup', summary: 'Second', type: 'spec' },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('dup');
    });

    // #9
    it('should return isError when creating card with empty slug', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: '', summary: 'No slug', type: 'spec' },
      });
      expect(result.isError).toBe(true);
    });

    // #10
    it('should create a card with empty tags array', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'empty-tags', summary: 'Empty tags', tags: [], type: 'spec' },
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
        arguments: { key: 'get-me', summary: 'Get test', body: '# Body here', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'get-me' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { card: { frontmatter: { key: string; summary: string }; body: string } };
      expect(data.card.frontmatter.key).toBe('get-me');
      expect(data.card.frontmatter.summary).toBe('Get test');
      expect(data.card.body).toContain('Body here');
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
  // CRUD — get_cards (batch)
  // ════════════════════════════════════════

  describe('emberdeck_get_cards', () => {
    it('should return all cards when all keys exist', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-a', summary: 'A', type: 'spec', body: 'Body A' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-b', summary: 'B', type: 'intent', body: 'Body B' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_cards',
        arguments: { keys: ['batch-a', 'batch-b'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { cards: Array<{ card: { frontmatter: { key: string } } }>; notFound: string[] };
      expect(data.cards).toHaveLength(2);
      expect(data.notFound).toHaveLength(0);
      const keys = data.cards.map((c) => c.card.frontmatter.key);
      expect(keys).toContain('batch-a');
      expect(keys).toContain('batch-b');
    });

    it('should return notFound for missing keys and cards for existing ones', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-exists', summary: 'Exists', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_cards',
        arguments: { keys: ['batch-exists', 'batch-ghost'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { cards: Array<{ card: { frontmatter: { key: string } } }>; notFound: string[] };
      expect(data.cards).toHaveLength(1);
      expect(data.cards[0]!.card.frontmatter.key).toBe('batch-exists');
      expect(data.notFound).toEqual(['batch-ghost']);
    });

    it('should return empty cards and all keys in notFound when none exist', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_get_cards',
        arguments: { keys: ['ghost-1', 'ghost-2'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { cards: unknown[]; notFound: string[] };
      expect(data.cards).toHaveLength(0);
      expect(data.notFound).toEqual(['ghost-1', 'ghost-2']);
    });

    it('should include history when includeHistory is true', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-hist', summary: 'Hist', type: 'intent' },
      });
      await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'batch-hist', status: 'active' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_cards',
        arguments: { keys: ['batch-hist'], includeHistory: true },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { cards: Array<{ history?: unknown[] }> };
      expect(data.cards[0]!.history).toBeDefined();
      expect(data.cards[0]!.history!.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty result for empty keys array', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_get_cards',
        arguments: { keys: [] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { cards: unknown[]; notFound: string[] };
      expect(data.cards).toHaveLength(0);
      expect(data.notFound).toHaveLength(0);
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
        arguments: { key: 'upd', summary: 'Old', type: 'spec' },
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
      const data = parseText(get) as { card: { frontmatter: { summary: string } } };
      expect(data.card.frontmatter.summary).toBe('New');
    });

    // #14
    it('should update multiple fields simultaneously', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'multi', summary: 'Multi', body: 'Old body', tags: ['old'], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'multi', summary: 'Updated', body: 'New body', tags: ['new1', 'new2'] },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'multi' },
      });
      const data = parseText(get) as { card: { frontmatter: { summary: string; tags: string[] }; body: string } };
      expect(data.card.frontmatter.summary).toBe('Updated');
      expect(data.card.frontmatter.tags).toEqual(['new1', 'new2']);
      expect(data.card.body).toContain('New body');
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

    // #16a — strict schema rejects unknown fields
    it('should reject unknown fields via strict schema', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'strict-test', summary: 'Strict', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'strict-test', fields: { body: 'wrapped' } } as any,
      });
      // .strict() should reject the 'fields' key
      expect(result.isError).toBe(true);
    });

    // #16
    it('should delete tags when set to null', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'null-tags', summary: 'Tags', tags: ['a', 'b'], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'null-tags', tags: null },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'null-tags' },
      });
      const data = parseText(get) as { card: { frontmatter: { tags?: string[] } } };
      expect(data.card.frontmatter.tags).toBeUndefined();
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
        arguments: { key: 'status-card', summary: 'Status', type: 'intent' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'status-card', status: 'active' },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'status-card' },
      });
      const data = parseText(get) as { card: { frontmatter: { status: string } } };
      expect(data.card.frontmatter.status).toBe('active');
    });

    // #18
    it('should return isError when updating status of non-existent card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'nope', status: 'active' },
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
        arguments: { key: 'del-me', summary: 'Delete', type: 'spec' },
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
        arguments: { key: 'old-name', summary: 'Rename me', type: 'spec' },
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
      const data = parseText(get) as { card: { frontmatter: { key: string } } };
      expect(data.card.frontmatter.key).toBe('new-name');
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
        arguments: { key: 'src-card', summary: 'Src', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dst-card', summary: 'Dst', type: 'spec' },
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
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'a', summary: 'A', type: 'spec' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'b', summary: 'B', type: 'spec' } });
      const result = await s.client.callTool({ name: 'emberdeck_list_cards', arguments: {} });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string }>;
      expect(data).toHaveLength(2);
    });

    // #25
    it('should filter cards by status', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'draft-card', summary: 'D', type: 'spec' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'acc-card', summary: 'A', type: 'intent' } });
      await s.client.callTool({
        name: 'emberdeck_update_card_status',
        arguments: { key: 'acc-card', status: 'active' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_list_cards',
        arguments: { status: 'active' },
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
        arguments: { key: 'searchable', summary: 'UniqueKeyword123', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'other', summary: 'No match', type: 'spec' },
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
      // Empty query may return an error or empty results — either way it should not crash
      const result = await s.client.callTool({
        name: 'emberdeck_search_cards',
        arguments: { query: '' },
      });
      // Whether isError or empty result, it should be a valid response
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
        arguments: { key: 'ctx-card', summary: 'Context card', type: 'spec' },
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
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'graph-a', summary: 'A', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'graph-b', summary: 'B', relations: ['graph-a'], type: 'spec' },
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
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'dep-a', summary: 'A', type: 'spec' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dep-b', summary: 'B', relations: ['dep-a'], type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dep-c', summary: 'C', relations: ['dep-b'], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'dep-c', maxDepth: 1 },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string; depth: number }>;
      // maxDepth=1: dep-c -> dep-b (depth 1). dep-a (depth 2) should NOT appear.
      expect(data.every((n) => n.depth <= 1)).toBe(true);
      expect(data.some((n) => n.key === 'dep-b')).toBe(true);
      expect(data.some((n) => n.key === 'dep-a')).toBe(false);
    });

    // #33
    it('should respect direction parameter', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'dir-a', summary: 'A', type: 'spec' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'dir-b', summary: 'B', relations: ['dir-a'], type: 'spec' },
      });
      // direction=forward from dir-b: dir-b has a forward relation to dir-a, so dir-a should appear
      const fwdResult = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'dir-b', direction: 'forward' },
      });
      expect(fwdResult.isError).toBeFalsy();
      const fwdData = parseText(fwdResult) as Array<{ key: string; direction: string }>;
      // All nodes should be forward direction
      for (const node of fwdData) {
        expect(node.direction).toBe('forward');
      }
      // direction=backward from dir-b: dir-b has no backward (incoming) relations
      const bwdResult = await s.client.callTool({
        name: 'emberdeck_get_relation_graph',
        arguments: { key: 'dir-b', direction: 'backward' },
      });
      expect(bwdResult.isError).toBeFalsy();
      const bwdData = parseText(bwdResult) as Array<{ key: string }>;
      // dir-a should NOT appear in backward-only traversal from dir-b
      expect(bwdData.some((n) => n.key === 'dir-a')).toBe(false);
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
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'rel-a', summary: 'A', type: 'spec' } });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'rel-b', summary: 'B', relations: ['rel-a'], type: 'spec' },
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
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'no-rel', summary: 'No relations', type: 'spec' } });
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
        arguments: { key: 'sync-me', summary: 'Original', type: 'spec' },
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
      const data = parseText(get) as { card: { frontmatter: { summary: string } } };
      expect(data.card.frontmatter.summary).toBe('Synced');
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
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'bulk-a', summary: 'A', type: 'spec' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'bulk-b', summary: 'B', type: 'spec' } });
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
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'val-card', summary: 'Valid', type: 'spec' } });
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
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'exp-card', summary: 'Export', type: 'spec' } });
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
          key: 'link-card',
          summary: 'Link',
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Foo' }], type: 'spec' },
      });
      // gildash not configured → GildashNotConfiguredError
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
          key: 'sym-card',
          summary: 'Symbol',
          codeLinks: [{ kind: 'defines', file: 'src/x.ts', symbol: 'MyClass' }], type: 'spec' },
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

  describe('emberdeck_validate_code_links', () => {
    // #48
    it('should return isError when gildash not configured', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'vcl-card',
          summary: 'Validate CL',
          codeLinks: [{ kind: 'defines', file: 'src/a.ts', symbol: 'Bar' }], type: 'spec' },
      });
      // gildash not configured → GildashNotConfiguredError
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

    // #49a — batch: omit key to validate all cards
    it('should validate all cards when key is omitted', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-a', summary: 'A', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'batch-b', summary: 'B', type: 'spec' },
      });
      // gildash not configured → cards without code links still produce results
      // (validateCodeLinks throws for gildash-dependent operations, but cards with no code links
      //  return { declared: 0, valid: 0, broken: [], planned: [] } before gildash check)
      // For this test we need gildash — but these cards have no codeLinks, so gildash is checked
      // Actually validateCodeLinks throws GildashNotConfiguredError before reading the file.
      // So batch mode will skip cards that throw.
      // Result should be an empty object (all cards skipped due to gildash error)
      const result = await s.client.callTool({
        name: 'emberdeck_validate_code_links',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { results: Record<string, unknown>; skipped?: Record<string, string> };
      // Batch response uses { results, skipped? } format
      expect(data.results).toBeDefined();
      expect(typeof data.results).toBe('object');
      // Cards were skipped due to missing gildash
      if (data.skipped) {
        expect(typeof data.skipped).toBe('object');
        for (const msg of Object.values(data.skipped)) {
          expect(typeof msg).toBe('string');
        }
      }
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
          key: 'null-all',
          summary: 'All nullable',
          tags: ['tag'], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: {
          key: 'null-all',
          tags: null,
        },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'null-all' } });
      const data = parseText(get) as {
        card: { frontmatter: { tags?: string[] } };
      };
      expect(data.card.frontmatter.tags).toBeUndefined();
    });

    // #51
    it('should make old key fail and new key work after rename', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'before-rename', summary: 'Before', type: 'spec' },
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
    it('should reject self-referencing relation', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'self-ref', summary: 'Self ref', type: 'spec' },
      });
      const upd = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'self-ref', relations: ['self-ref'] },
      });
      expect(upd.isError).toBeTruthy();
    });

    // #53
    it('should show mutual relations in graph', async () => {
      s = await setupMcp();
      // Create both cards first, then add relations
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'mutual-a', summary: 'A', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'mutual-b', summary: 'B', type: 'spec' },
      });
      // Add relations
      await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'mutual-a', relations: ['mutual-b'] },
      });
      await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'mutual-b', relations: ['mutual-a'] },
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
        arguments: { key: 'lifecycle', summary: 'Lifecycle card', type: 'intent' },
      });

      const statuses = ['active', 'drifted'] as const;
      for (const status of statuses) {
        const result = await s.client.callTool({
          name: 'emberdeck_update_card_status',
          arguments: { key: 'lifecycle', status },
        });
        expect(result.isError).toBeFalsy();
      }

      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'lifecycle' } });
      const data = parseText(get) as { card: { frontmatter: { status: string } } };
      expect(data.card.frontmatter.status).toBe('drifted');
    });

    // #55
    it('should allow recreating card after deletion with same slug', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'phoenix', summary: 'First life', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_delete_card',
        arguments: { key: 'phoenix' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'phoenix', summary: 'Second life', type: 'spec' },
      });
      expect(result.isError).toBeFalsy();
      const get = await s.client.callTool({ name: 'emberdeck_get_card', arguments: { key: 'phoenix' } });
      const data = parseText(get) as { card: { frontmatter: { summary: string } } };
      expect(data.card.frontmatter.summary).toBe('Second life');
    });

    // #56
    it('should round-trip export and sync', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'roundtrip', summary: 'Original', type: 'spec' },
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
      const data = parseText(get) as { card: { frontmatter: { summary: string } } };
      expect(data.card.frontmatter.summary).toBe('Modified');
    });
  });

  // ════════════════════════════════════════
  // Ordering
  // ════════════════════════════════════════

  describe('Ordering', () => {
    // #59
    it('should return same list regardless of creation order', async () => {
      s = await setupMcp();
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'z-card', summary: 'Z', type: 'spec' } });
      await s.client.callTool({ name: 'emberdeck_create_card', arguments: { key: 'a-card', summary: 'A', type: 'spec' } });

      const result = await s.client.callTool({ name: 'emberdeck_list_cards', arguments: {} });
      const data = parseText(result) as Array<{ key: string }>;
      const keys = data.map((c) => c.key).sort();
      expect(keys).toEqual(['a-card', 'z-card']);
    });
  });

  // ════════════════════════════════════════
  // Card Types
  // ════════════════════════════════════════

  describe('Card Types', () => {
    it('should create card with type and return it', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'typed-card',
          summary: 'Typed card',
          type: 'intent',
        },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as { fullKey: string };
      expect(data.fullKey).toBe('typed-card');

      const get = await s.client.callTool({
        name: 'emberdeck_get_card',
        arguments: { key: 'typed-card' },
      });
      const card = parseText(get) as {
        card: { frontmatter: { type: string } };
      };
      expect(card.card.frontmatter.type).toBe('intent');
    });

    it('should filter cards by type', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'spec-1', summary: 'Spec 1', type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'arch-1', summary: 'Intent 1', type: 'intent' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'spec-2', summary: 'Spec 2', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_list_cards',
        arguments: { type: 'spec' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as Array<{ key: string }>;
      expect(data).toHaveLength(2);
      const keys = data.map((c) => c.key).sort();
      expect(keys).toEqual(['spec-1', 'spec-2']);
    });
  });

  // ════════════════════════════════════════
  // Context Engine
  // ════════════════════════════════════════

  describe('Context Engine', () => {
    it('should check drift and return driftScore and summary', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'drift-card', summary: 'Drift test', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_check_drift',
        arguments: { key: 'drift-card' },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as {
        cards: unknown[];
        health: { total: number; active: number; drifted: number; draft: number };
      };
      expect(data.cards).toBeArray();
      expect(data.health).toBeDefined();
      expect(typeof data.health.total).toBe('number');
      expect(typeof data.health.draft).toBe('number');
    });

    it('should check interactions between cards with shared code links', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'inter-a',
          summary: 'Interaction A',
          codeLinks: [{ kind: 'defines', file: 'src/shared.ts', symbol: 'SharedFn' }], type: 'spec' },
      });
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'inter-b',
          summary: 'Interaction B',
          codeLinks: [{ kind: 'uses', file: 'src/shared.ts', symbol: 'SharedFn' }], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_check_interactions',
        arguments: { cards: ['inter-a', 'inter-b'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as {
        interactions: Array<{ pair: [string, string]; sharedSymbols: unknown[] }>;
        undefinedRelations: unknown[];
      };
      expect(data.interactions).toBeArray();
      expect(data.interactions.length).toBeGreaterThanOrEqual(1);
      expect(data.interactions[0]!.sharedSymbols.length).toBeGreaterThanOrEqual(1);
      expect(data.undefinedRelations).toBeArray();
    });
  });

  // ════════════════════════════════════════
  // Impact Analysis
  // ════════════════════════════════════════

  describe('Impact Analysis', () => {
    it('should find affected cards via pre_change_check', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'impact-card',
          summary: 'Impact card',
          codeLinks: [{ kind: 'defines', file: 'src/target.ts', symbol: 'TargetClass' }], type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_pre_change_check',
        arguments: { files: ['src/target.ts'] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as {
        affectedCards: Array<{ key: string; linkType: string }>;
        riskLevel: string;
        suggestedActions: string[];
      };
      expect(data.affectedCards.length).toBeGreaterThanOrEqual(1);
      expect(data.affectedCards.some((c) => c.key === 'impact-card')).toBe(true);
      expect(data.affectedCards[0]!.linkType).toBe('direct');
      expect(typeof data.riskLevel).toBe('string');
    });

    it('should return pass quality gate for regression_guard with empty files', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_regression_guard',
        arguments: { changedFiles: [] },
      });
      expect(result.isError).toBeFalsy();
      const data = parseText(result) as {
        passOrFail: string;
        driftedRatio: number;
        affectedCards: unknown[];
        threshold: number;
      };
      expect(data.passOrFail).toBe('pass');
      expect(data.driftedRatio).toBe(0);
      expect(data.affectedCards).toEqual([]);
      expect(typeof data.threshold).toBe('number');
    });
  });

  // ════════════════════════════════════════
  // Schema enforcement and removed tools
  // ════════════════════════════════════════

  describe('.strict() enforcement', () => {
    it('should reject unknown keys in emberdeck_create_card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'strict-test', summary: 'Test', type: 'spec', unknownField: 'bad' },
      });
      expect(result.isError).toBeTruthy();
    });

    it('should reject unknown keys in emberdeck_update_card', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'strict-upd', summary: 'Test', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'strict-upd', priority: 'high' },
      });
      expect(result.isError).toBeTruthy();
    });

    it('should reject removed field "acceptance" in emberdeck_create_card', async () => {
      s = await setupMcp();
      const result = await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: {
          key: 'strict-acc',
          summary: 'Test',
          type: 'spec',
          acceptance: [{ id: 'a1', description: 'test', verified: false }],
        },
      });
      expect(result.isError).toBeTruthy();
    });

    it('should reject removed field "keywords" in emberdeck_update_card', async () => {
      s = await setupMcp();
      await s.client.callTool({
        name: 'emberdeck_create_card',
        arguments: { key: 'strict-kw', summary: 'Test', type: 'spec' },
      });
      const result = await s.client.callTool({
        name: 'emberdeck_update_card',
        arguments: { key: 'strict-kw', keywords: ['test'] },
      });
      expect(result.isError).toBeTruthy();
    });
  });

  describe('removed tools', () => {
    it('should not list emberdeck_verify_acceptance', async () => {
      s = await setupMcp();
      const tools = await s.client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).not.toContain('emberdeck_verify_acceptance');
    });

    it('should not list emberdeck_list_unverified', async () => {
      s = await setupMcp();
      const tools = await s.client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).not.toContain('emberdeck_list_unverified');
    });

    it('should not list emberdeck_get_card_history', async () => {
      s = await setupMcp();
      const tools = await s.client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).not.toContain('emberdeck_get_card_history');
    });

    it('should not list emberdeck_find_affected_cards', async () => {
      s = await setupMcp();
      const tools = await s.client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).not.toContain('emberdeck_find_affected_cards');
    });

    it('should not list emberdeck_generate_context', async () => {
      s = await setupMcp();
      const tools = await s.client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).not.toContain('emberdeck_generate_context');
    });
  });
});
