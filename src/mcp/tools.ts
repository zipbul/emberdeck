/**
 * MCP Tool 등록 모듈.
 *
 * emberdeck의 모든 public API를 MCP tool로 노출한다.
 * 외부 MCP 서버가 McpServer 인스턴스를 전달하면, 이 함수가 tool 정의를 일괄 등록한다.
 *
 * @example
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { setupEmberdeck, registerEmberdeckTools } from 'emberdeck';
 *
 * const ctx = await setupEmberdeck({ cardsDir: './cards', dbPath: './cards.db' });
 * const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 * registerEmberdeckTools(server, ctx);
 * ```
 */

import { z } from 'zod/v4';

import type { EmberdeckContext } from '../config';
import { createCard } from '../ops/create';
import { updateCard, updateCardStatus } from '../ops/update';
import { deleteCard } from '../ops/delete';
import { renameCard } from '../ops/rename';
import {
  getCard,
  listCards,
  searchCards,
  listCardRelations,
  getCardContext,
  getRelationGraph,
} from '../ops/query';
import {
  syncCardFromFile,
  bulkSyncCards,
  validateCards,
  exportCardToFile,
} from '../ops/sync';
import {
  resolveCardCodeLinks,
  findCardsBySymbol,
  findAffectedCards,
  validateCodeLinks,
} from '../ops/link';

// ---- Helpers ----

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

// ---- Shared Schemas ----

const relationSchema = z.object({ type: z.string(), target: z.string() });
const codeLinkSchema = z.object({ kind: z.string(), file: z.string(), symbol: z.string() });
const statusEnum = z.enum(['draft', 'accepted', 'implementing', 'implemented', 'deprecated']);

// ---- McpServer Type ----

/**
 * McpServer의 registerTool에 필요한 최소 인터페이스.
 * @modelcontextprotocol/sdk를 직접 import하지 않고 구조적 타이핑으로 호환.
 */
interface McpServerLike {
  registerTool(name: string, config: Record<string, unknown>, cb: Function): unknown;
}

// ---- Registration ----

/**
 * McpServer에 emberdeck의 모든 tool을 등록한다.
 *
 * @param server - McpServer 인스턴스 (또는 registerTool을 가진 호환 객체)
 * @param ctx - setupEmberdeck()로 생성된 EmberdeckContext
 */
export function registerEmberdeckTools(server: McpServerLike, ctx: EmberdeckContext): void {
  // ── CRUD ──

  server.registerTool(
    'emberdeck_create_card',
    {
      description: '새 설계 카드를 생성한다. slug(파일명), summary(한줄 요약)이 필수.',
      inputSchema: {
        slug: z.string().describe('카드 slug (파일명, e.g. "auth-token")'),
        summary: z.string().describe('카드 한줄 요약'),
        body: z.string().optional().describe('마크다운 본문'),
        keywords: z.array(z.string()).optional().describe('키워드 목록'),
        tags: z.array(z.string()).optional().describe('태그 목록'),
        relations: z.array(relationSchema).optional().describe('관계 목록 [{type, target}]'),
        codeLinks: z.array(codeLinkSchema).optional().describe('코드 링크 [{kind, file, symbol}]'),
        constraints: z.record(z.string(), z.unknown()).optional().describe('제약 조건 (key-value)'),
      },
    },
    async (args: {
      slug: string;
      summary: string;
      body?: string;
      keywords?: string[];
      tags?: string[];
      relations?: Array<{ type: string; target: string }>;
      codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
      constraints?: Record<string, unknown>;
    }) => {
      try {
        const result = await createCard(ctx, args);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_card',
    {
      description: '카드 키로 카드 파일(frontmatter + body)을 읽는다.',
      inputSchema: {
        key: z.string().describe('카드 키 (e.g. "auth-token")'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await getCard(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_update_card',
    {
      description: '기존 카드의 필드를 업데이트한다. 변경할 필드만 전달.',
      inputSchema: {
        key: z.string().describe('카드 키'),
        summary: z.string().optional().describe('새 한줄 요약'),
        body: z.string().optional().describe('새 본문'),
        keywords: z.array(z.string()).nullable().optional().describe('키워드 (null=삭제)'),
        tags: z.array(z.string()).nullable().optional().describe('태그 (null=삭제)'),
        relations: z.array(relationSchema).nullable().optional().describe('관계 (null=삭제)'),
        codeLinks: z.array(codeLinkSchema).nullable().optional().describe('코드 링크 (null=삭제)'),
        constraints: z.record(z.string(), z.unknown()).optional().describe('제약 조건'),
      },
    },
    async (args: {
      key: string;
      summary?: string;
      body?: string;
      keywords?: string[] | null;
      tags?: string[] | null;
      relations?: Array<{ type: string; target: string }> | null;
      codeLinks?: Array<{ kind: string; file: string; symbol: string }> | null;
      constraints?: Record<string, unknown>;
    }) => {
      try {
        const { key, ...fields } = args;
        const result = await updateCard(ctx, key, fields);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_update_card_status',
    {
      description: '카드 상태를 변경한다 (draft/accepted/implementing/implemented/deprecated).',
      inputSchema: {
        key: z.string().describe('카드 키'),
        status: statusEnum.describe('새 상태'),
      },
    },
    async (args: { key: string; status: 'draft' | 'accepted' | 'implementing' | 'implemented' | 'deprecated' }) => {
      try {
        const result = await updateCardStatus(ctx, args.key, args.status);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_delete_card',
    {
      description: '카드를 삭제한다 (DB + 파일).',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await deleteCard(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_rename_card',
    {
      description: '카드 이름(key)을 변경한다. 파일 이동 + DB 갱신.',
      inputSchema: {
        key: z.string().describe('현재 카드 키'),
        newSlug: z.string().describe('새 slug'),
      },
    },
    async (args: { key: string; newSlug: string }) => {
      try {
        const result = await renameCard(ctx, args.key, args.newSlug);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Query ──

  server.registerTool(
    'emberdeck_list_cards',
    {
      description: '카드 목록을 조회한다. status 필터 선택 가능.',
      inputSchema: {
        status: statusEnum.optional().describe('상태 필터 (선택)'),
      },
    },
    async (args: { status?: 'draft' | 'accepted' | 'implementing' | 'implemented' | 'deprecated' }) => {
      try {
        const filter = args.status ? { status: args.status } : undefined;
        const result = listCards(ctx, filter);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_search_cards',
    {
      description: '카드를 텍스트 검색한다 (summary, body).',
      inputSchema: {
        query: z.string().describe('검색어'),
      },
    },
    async (args: { query: string }) => {
      try {
        const result = searchCards(ctx, args.query);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_card_context',
    {
      description: '카드의 전체 컨텍스트를 반환한다 (카드 + 관계 + 코드 링크).',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await getCardContext(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_relation_graph',
    {
      description: '카드의 관계 그래프를 BFS로 탐색한다.',
      inputSchema: {
        key: z.string().describe('시작 카드 키'),
        maxDepth: z.number().optional().describe('최대 탐색 깊이'),
        direction: z.enum(['forward', 'backward', 'both']).optional().describe('탐색 방향'),
      },
    },
    async (args: { key: string; maxDepth?: number; direction?: 'forward' | 'backward' | 'both' }) => {
      try {
        const result = getRelationGraph(ctx, args.key, {
          maxDepth: args.maxDepth,
          direction: args.direction,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_list_card_relations',
    {
      description: '카드의 관계 목록을 반환한다 (forward + reverse).',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = listCardRelations(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Sync ──

  server.registerTool(
    'emberdeck_sync_card_from_file',
    {
      description: '외부 변경된 카드 파일을 DB에 동기화한다.',
      inputSchema: {
        filePath: z.string().describe('카드 파일 절대 경로'),
      },
    },
    async (args: { filePath: string }) => {
      try {
        await syncCardFromFile(ctx, args.filePath);
        return ok({ success: true });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_bulk_sync_cards',
    {
      description: '디렉토리의 모든 .card.md 파일을 DB에 일괄 동기화한다.',
      inputSchema: {
        dirPath: z.string().optional().describe('스캔 디렉토리 (미지정 시 cardsDir)'),
      },
    },
    async (args: { dirPath?: string }) => {
      try {
        const result = await bulkSyncCards(ctx, args.dirPath);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_validate_cards',
    {
      description: '카드 파일과 DB의 일관성을 검증한다 (read-only).',
      inputSchema: {
        dirPath: z.string().optional().describe('검증 디렉토리 (미지정 시 cardsDir)'),
      },
    },
    async (args: { dirPath?: string }) => {
      try {
        const result = await validateCards(ctx, args.dirPath);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_export_card_to_file',
    {
      description: 'DB 상태를 기준으로 카드 파일을 재생성한다 (역방향 동기화).',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const filePath = await exportCardToFile(ctx, args.key);
        return ok({ filePath });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Code Link ──

  server.registerTool(
    'emberdeck_resolve_code_links',
    {
      description: '카드의 codeLink를 심볼 인덱스에서 조회하여 반환한다. gildash 필요.',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await resolveCardCodeLinks(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_find_cards_by_symbol',
    {
      description: '심볼 이름으로 해당 심볼을 참조하는 카드 목록을 반환한다.',
      inputSchema: {
        symbolName: z.string().describe('심볼 이름'),
        filePath: z.string().optional().describe('파일 경로 필터 (선택)'),
      },
    },
    async (args: { symbolName: string; filePath?: string }) => {
      try {
        const result = findCardsBySymbol(ctx, args.symbolName, args.filePath);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_find_affected_cards',
    {
      description: '변경된 파일 목록 → 해당 파일의 심볼을 codeLink로 참조하는 카드 목록.',
      inputSchema: {
        changedFiles: z.array(z.string()).describe('변경된 파일 경로 배열'),
      },
    },
    async (args: { changedFiles: string[] }) => {
      try {
        const result = await findAffectedCards(ctx, args.changedFiles);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_validate_code_links',
    {
      description: '카드의 codeLink가 현재 심볼 인덱스에 존재하는지 검증한다. gildash 필요.',
      inputSchema: {
        key: z.string().describe('카드 키'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await validateCodeLinks(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
