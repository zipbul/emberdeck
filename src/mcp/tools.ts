/**
 * MCP tool registration module.
 *
 * Exposes all emberdeck public APIs as MCP tools.
 * An external MCP server passes its McpServer instance and this function registers all tool definitions.
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
import { bulkCreateCards } from '../ops/bulk-create';
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
import {
  verifyAcceptance,
  listUnverified,
  getCardHistory,
} from '../ops/acceptance';
import {
  generateContext,
  checkDrift,
  checkInteractions,
} from '../ops/context';
import {
  preChangeCheck,
  regressionGuard,
} from '../ops/impact';
import {
  syncSpecAnnotations,
  syncSymbolChanges,
  getLinkCoverage,
} from '../ops/spec-sync';

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
const cardTypeEnum = z.enum(['feature', 'bug', 'refactor', 'spike', 'decision']);
const priorityEnum = z.enum(['critical', 'high', 'medium', 'low']);
const acceptanceSchema = z.object({
  id: z.string(),
  description: z.string(),
  verified: z.boolean().default(false),
});

// ---- McpServer Type ----

/**
 * Minimal interface for McpServer.registerTool.
 * Structurally typed to avoid direct import of @modelcontextprotocol/sdk.
 */
interface McpServerLike {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  registerTool(name: string, config: Record<string, unknown>, cb: Function): unknown;
}

// ---- Registration ----

/**
 * Registers all emberdeck tools on the given McpServer.
 *
 * @param server - McpServer instance (or any object with a compatible registerTool method)
 * @param ctx - EmberdeckContext created by setupEmberdeck()
 */
export function registerEmberdeckTools(server: McpServerLike, ctx: EmberdeckContext): void {
  // ── CRUD ──

  server.registerTool(
    'emberdeck_create_card',
    {
      description:
        'Record a new feature, decision, or spec before implementation. ' +
        'Use this to capture design knowledge as a card. ' +
        'Before calling: gather context by reading relevant code and asking the user about policies/constraints. ' +
        'The body should contain design rationale, invariants, and scope boundaries — not file listings (use codeLinks for that).',
      inputSchema: {
        slug: z.string().describe('Card slug used as filename (e.g. "auth-token")'),
        summary: z.string().describe('One-line summary of the card'),
        type: cardTypeEnum.optional().describe('Card type (feature/bug/refactor/spike/decision)'),
        priority: priorityEnum.optional().describe('Priority (critical/high/medium/low)'),
        acceptance: z.array(acceptanceSchema).describe('Acceptance criteria [{id, description, verified}] — required, at least one'),
        body: z.string().optional().describe('Design knowledge: rationale (why this approach, what alternatives were rejected), invariants (what must not break), scope boundaries (what this deliberately does NOT do), edge cases. Never duplicate codeLinks here.'),
        keywords: z.array(z.string()).optional().describe('Keyword list for search'),
        tags: z.array(z.string()).optional().describe('Tag list for classification'),
        relations: z.array(relationSchema).optional().describe('Relations [{type, target}]'),
        codeLinks: z.array(codeLinkSchema).optional().describe('Code links [{kind, file, symbol}]'),
        constraints: z.record(z.string(), z.unknown()).optional().describe('Constraints (key-value)'),
      },
    },
    async (args: {
      slug: string;
      summary: string;
      type?: 'feature' | 'bug' | 'refactor' | 'spike' | 'decision';
      priority?: 'critical' | 'high' | 'medium' | 'low';
      acceptance: Array<{ id: string; description: string; verified: boolean }>;
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
    'emberdeck_bulk_create_cards',
    {
      description:
        'Create multiple cards at once. Relations between cards in the same batch are resolved regardless of order. ' +
        'Partially succeeds on item failure. ' +
        'Each card still requires substantive body content — read the relevant code and gather design knowledge before calling. ' +
        'Do not use this to mass-produce shallow cards.',
      inputSchema: {
        cards: z.array(z.object({
          slug: z.string().describe('Card slug (e.g. "auth-token")'),
          summary: z.string().describe('One-line summary'),
          type: cardTypeEnum.optional().describe('Card type'),
          priority: priorityEnum.optional().describe('Priority'),
          acceptance: z.array(acceptanceSchema).describe('Acceptance criteria — required'),
          body: z.string().optional().describe('Design knowledge: rationale, invariants, scope boundaries, edge cases. Never duplicate codeLinks here.'),
          keywords: z.array(z.string()).optional().describe('Keywords'),
          tags: z.array(z.string()).optional().describe('Tags'),
          relations: z.array(relationSchema).optional().describe('Relations [{type, target}]'),
          codeLinks: z.array(codeLinkSchema).optional().describe('Code links [{kind, file, symbol}]'),
          constraints: z.record(z.string(), z.unknown()).optional().describe('Constraints'),
        })).describe('Array of card inputs (same schema as create_card)'),
      },
    },
    async (args: {
      cards: Array<{
        slug: string;
        summary: string;
        type?: 'feature' | 'bug' | 'refactor' | 'spike' | 'decision';
        priority?: 'critical' | 'high' | 'medium' | 'low';
        acceptance: Array<{ id: string; description: string; verified: boolean }>;
        body?: string;
        keywords?: string[];
        tags?: string[];
        relations?: Array<{ type: string; target: string }>;
        codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
        constraints?: Record<string, unknown>;
      }>;
    }) => {
      try {
        const result = await bulkCreateCards(ctx, args.cards);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_card',
    {
      description:
        'Read a card\'s full content (frontmatter + body). ' +
        'Use before implementation to review the spec, or to inspect card details.',
      inputSchema: {
        key: z.string().describe('Card key (e.g. "auth-token")'),
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
      description:
        'Update card fields when the spec evolves or needs refinement. ' +
        'Only pass the fields you want to change; the rest are preserved. ' +
        'When updating body, ensure it contains design knowledge — not file listings.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        summary: z.string().optional().describe('New summary'),
        type: cardTypeEnum.nullable().optional().describe('Card type (null to remove)'),
        priority: priorityEnum.nullable().optional().describe('Priority (null to remove)'),
        acceptance: z.array(acceptanceSchema).nullable().optional().describe('Acceptance criteria (null to remove)'),
        body: z.string().optional().describe('Design knowledge: rationale, invariants, scope boundaries, edge cases. Never duplicate codeLinks here.'),
        keywords: z.array(z.string()).nullable().optional().describe('Keywords (null to remove)'),
        tags: z.array(z.string()).nullable().optional().describe('Tags (null to remove)'),
        relations: z.array(relationSchema).nullable().optional().describe('Relations (null to remove)'),
        codeLinks: z.array(codeLinkSchema).nullable().optional().describe('Code links (null to remove)'),
        constraints: z.record(z.string(), z.unknown()).optional().describe('Constraints'),
      }).strict(),
    },
    async (args: {
      key: string;
      summary?: string;
      type?: 'feature' | 'bug' | 'refactor' | 'spike' | 'decision' | null;
      priority?: 'critical' | 'high' | 'medium' | 'low' | null;
      acceptance?: Array<{ id: string; description: string; verified: boolean }> | null;
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
      description:
        'Transition a card through its lifecycle (draft/accepted/implementing/implemented/deprecated). ' +
        'Use after review to accept a spec, or after implementation to mark it done.',
      inputSchema: {
        key: z.string().describe('Card key'),
        status: statusEnum.describe('New status'),
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
      description:
        'Permanently remove a card (DB + file). ' +
        'Use when a spec is no longer relevant. Prefer deprecating over deleting if history matters.',
      inputSchema: {
        key: z.string().describe('Card key'),
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
      description:
        'Rename a card key (moves file + updates DB). ' +
        'Use when the original slug no longer reflects the card\'s scope.',
      inputSchema: {
        key: z.string().describe('Current card key'),
        newSlug: z.string().describe('New slug'),
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
      description:
        'List all cards, optionally filtered by status. ' +
        'Use at session start to see what specs exist, or to find cards in a specific lifecycle stage.',
      inputSchema: {
        status: statusEnum.optional().describe('Filter by status (optional)'),
        type: cardTypeEnum.optional().describe('Filter by card type (optional)'),
        sortBy: z.enum(['priority', 'updated_at']).optional().describe('Sort order (optional)'),
      },
    },
    async (args: {
      status?: 'draft' | 'accepted' | 'implementing' | 'implemented' | 'deprecated';
      type?: 'feature' | 'bug' | 'refactor' | 'spike' | 'decision';
      sortBy?: 'priority' | 'updated_at';
    }) => {
      try {
        const filter: Record<string, unknown> = {};
        if (args.status) filter.status = args.status;
        if (args.type) filter.type = args.type;
        if (args.sortBy) filter.sortBy = args.sortBy;
        const result = listCards(ctx, Object.keys(filter).length > 0 ? filter as any : undefined);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_search_cards',
    {
      description:
        'Full-text search over card summaries and bodies. ' +
        'Use before implementing a feature or fixing a bug to check if a related spec already exists.',
      inputSchema: {
        query: z.string().describe('Search query text'),
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
      description:
        'Get a single card\'s full context: the card itself, its relations, and code links. ' +
        'Use for a quick look at one card\'s dependencies and connected symbols.',
      inputSchema: {
        key: z.string().describe('Card key'),
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
      description:
        'BFS-traverse the card relation graph from a starting card. ' +
        'Use to understand how specs connect to each other and to find transitive dependencies.',
      inputSchema: {
        key: z.string().describe('Starting card key'),
        maxDepth: z.number().optional().describe('Max traversal depth'),
        direction: z.enum(['forward', 'backward', 'both']).optional().describe('Traversal direction'),
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
      description:
        'List all relations for a card (forward + reverse). ' +
        'Use to quickly check what a card depends on and what depends on it.',
      inputSchema: {
        key: z.string().describe('Card key'),
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
      description:
        'Sync a card file that was edited outside emberdeck into the DB. ' +
        'Use after manual file edits to keep DB in sync.',
      inputSchema: {
        filePath: z.string().describe('Absolute path to the .card.md file'),
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
      description:
        'Scan a directory for all .card.md files and sync them into the DB. ' +
        'Use after bulk file changes or initial project setup to ensure DB reflects disk state.',
      inputSchema: {
        dirPath: z.string().optional().describe('Directory to scan (defaults to cardsDir)'),
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
      description:
        'Check consistency between card files and DB (read-only). ' +
        'Use to detect stale DB rows, orphan files, or key mismatches before making changes.',
      inputSchema: {
        dirPath: z.string().optional().describe('Directory to validate (defaults to cardsDir)'),
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
      description:
        'Regenerate a card file from DB state (reverse sync). ' +
        'Use when DB is the source of truth and the file needs to be recreated.',
      inputSchema: {
        key: z.string().describe('Card key'),
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
      description:
        'Resolve a card\'s code links against the symbol index. Requires gildash. ' +
        'Use to verify that declared code links point to real symbols in the codebase.',
      inputSchema: {
        key: z.string().describe('Card key'),
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
      description:
        'Find cards that reference a given symbol name. ' +
        'Use when investigating a symbol to discover its related specs.',
      inputSchema: {
        symbolName: z.string().describe('Symbol name to search for'),
        filePath: z.string().optional().describe('File path filter (optional)'),
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
      description:
        'Given a list of changed files, find cards whose code links reference symbols in those files. ' +
        'Use after code changes to identify which specs may need review or updates.',
      inputSchema: {
        changedFiles: z.array(z.string()).describe('Array of changed file paths'),
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
      description:
        'Validate that code links exist in the current symbol index. Requires gildash. ' +
        'Use to detect broken links after code refactoring or symbol renames. ' +
        'Omit key to validate all cards at once.',
      inputSchema: {
        key: z.string().optional().describe('Card key (omit to validate all cards)'),
      },
    },
    async (args: { key?: string }) => {
      try {
        if (args.key) {
          const result = await validateCodeLinks(ctx, args.key);
          return ok(result);
        }
        // Batch: validate all cards
        const allCards = ctx.cardRepo.list();
        const results: Record<string, Awaited<ReturnType<typeof validateCodeLinks>>> = {};
        for (const card of allCards) {
          try {
            results[card.key] = await validateCodeLinks(ctx, card.key);
          } catch {
            // Skip cards whose files are missing
          }
        }
        return ok(results);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Acceptance & History ──

  server.registerTool(
    'emberdeck_verify_acceptance',
    {
      description:
        'Mark one or more acceptance criteria as verified (or unverified). ' +
        'Use after implementing and testing a criterion to track verification progress.',
      inputSchema: {
        key: z.string().describe('Card key'),
        criterionIds: z.union([z.string(), z.array(z.string())]).describe('Criterion ID(s) to update'),
        verified: z.boolean().optional().describe('Verified status (default: true)'),
      },
    },
    async (args: { key: string; criterionIds: string | string[]; verified?: boolean }) => {
      try {
        const result = await verifyAcceptance(ctx, args.key, args.criterionIds, args.verified ?? true);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_list_unverified',
    {
      description:
        'List all cards with unverified acceptance criteria. ' +
        'Use at session start to find specs that still need verification, or before a release.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = listUnverified(ctx);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_card_history',
    {
      description:
        'Get the changelog history for a card (field changes with timestamps and actors). ' +
        'Use to understand why a spec changed or to review recent modifications.',
      inputSchema: {
        key: z.string().describe('Card key'),
        limit: z.number().optional().describe('Max entries to return (default: 100)'),
      },
    },
    async (args: { key: string; limit?: number }) => {
      try {
        const result = getCardHistory(ctx, args.key, args.limit);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Context Engine ──

  server.registerTool(
    'emberdeck_generate_context',
    {
      description:
        'Generate a multi-card context pack from a starting card via BFS relation traversal. ' +
        'Use at session start or when context degrades to quickly restore project context. ' +
        'Returns card summaries, relation graph, acceptance criteria, code links, and recent changes.',
      inputSchema: {
        key: z.string().describe('Starting card key'),
        maxCards: z.number().optional().describe('Max cards to include (default: 20)'),
        maxDepth: z.number().optional().describe('Max BFS depth (default: 3)'),
        includeBody: z.boolean().optional().describe('Include the starting card body (default: false)'),
      },
    },
    async (args: { key: string; maxCards?: number; maxDepth?: number; includeBody?: boolean }) => {
      try {
        const result = await generateContext(ctx, args.key, {
          maxCards: args.maxCards,
          maxDepth: args.maxDepth,
          includeBody: args.includeBody,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_check_drift',
    {
      description:
        'Calculate a drift score (0=synchronized, 1=completely stale) for a card and its relation graph. ' +
        'Use before marking a card as implemented, at session start for project health, or to find stale areas. ' +
        'Omit key to check all cards.',
      inputSchema: {
        key: z.string().optional().describe('Starting card key (omit for all cards)'),
        maxDepth: z.number().optional().describe('Max BFS depth (default: 3)'),
      },
    },
    async (args: { key?: string; maxDepth?: number }) => {
      try {
        const result = checkDrift(ctx, args.key, { maxDepth: args.maxDepth });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_check_interactions',
    {
      description:
        'Analyze interactions between a set of cards. Detects shared code symbols, ' +
        'existing relations, and potential conflicts. ' +
        'Use before modifying multiple related features to understand cross-card dependencies.',
      inputSchema: {
        cards: z.array(z.string()).describe('Array of card keys to analyze'),
      },
    },
    async (args: { cards: string[] }) => {
      try {
        const result = checkInteractions(ctx, args.cards);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Impact Analysis ──

  server.registerTool(
    'emberdeck_pre_change_check',
    {
      description:
        'Analyze impact before changing specific files or symbols. ' +
        'Returns directly and transitively affected cards, at-risk acceptance criteria, and risk level. ' +
        'Use before code changes to understand what specs may need review.',
      inputSchema: {
        files: z.array(z.string()).describe('File paths that will be changed'),
        symbols: z.array(z.string()).optional().describe('Specific symbols being changed (optional)'),
      },
    },
    async (args: { files: string[]; symbols?: string[] }) => {
      try {
        const result = preChangeCheck(ctx, args.files, args.symbols);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_regression_guard',
    {
      description:
        'Quality gate combining changed file analysis with optional Firebat scan results. ' +
        'Use after code changes to check for regressions. Pass Firebat output directly without format conversion.',
      inputSchema: {
        changedFiles: z.array(z.string()).describe('Changed file paths'),
        firebatReport: z.unknown().optional().describe('Firebat scan result (pass as-is, any format)'),
      },
    },
    async (args: { changedFiles: string[]; firebatReport?: unknown }) => {
      try {
        const result = regressionGuard(ctx, args.changedFiles, args.firebatReport);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Code Link Automation ──

  server.registerTool(
    'emberdeck_sync_spec_annotations',
    {
      description:
        'Scan @spec annotations in source code and auto-create code links for matching cards. ' +
        'Use after adding @spec comments to source files, or during bulk sync to discover code-spec connections. ' +
        'Requires gildash. Manual links are preserved.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await syncSpecAnnotations(ctx);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_sync_symbol_changes',
    {
      description:
        'Update code links after symbol renames/moves detected by gildash. ' +
        'Use after refactoring to keep code links in sync with renamed or moved symbols. ' +
        'Requires gildash. Deleted symbols are reported but not auto-removed.',
      inputSchema: {
        since: z.string().describe('ISO timestamp — sync changes after this time'),
      },
    },
    async (args: { since: string }) => {
      try {
        const result = syncSymbolChanges(ctx, args.since);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_link_coverage',
    {
      description:
        'Check code link coverage for a card: how many links resolve, how many are broken, ' +
        'and what symbols in linked files are not yet connected. ' +
        'Use to find gaps in code-spec traceability. Requires gildash.',
      inputSchema: {
        key: z.string().describe('Card key'),
      },
    },
    async (args: { key: string }) => {
      try {
        const result = await getLinkCoverage(ctx, args.key);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
