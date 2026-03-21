/**
 * MCP tool registration module.
 *
 * Exposes all emberdeck public APIs as MCP tools.
 * An external MCP server passes its McpServer instance and this function registers all tool definitions.
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
  getCardTree,
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
  validateCodeLinks,
} from '../ops/link';
import {
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

const codeLinkSchema = z.object({ kind: z.string(), file: z.string(), symbol: z.string() });
const statusEnum = z.enum(['draft', 'active', 'drifted']);
const cardTypeEnum = z.enum(['architecture', 'spec']);

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
        'Record a new architecture or spec card before implementation. ' +
        'Use this to capture design knowledge as a card. ' +
        'Before calling: gather context by reading relevant code and asking the user about policies/constraints. ' +
        'The body should contain design rationale, invariants, and scope boundaries — not file listings (use codeLinks for that).',
      inputSchema: z.object({
        key: z.string().describe('Card key used as filename (e.g. "auth-token")'),
        summary: z.string().describe('One-line summary of the card'),
        type: cardTypeEnum.describe('Card type (architecture/spec)'),
        status: statusEnum.optional().describe('Initial status (default: draft). If active, activation guard is applied'),
        parent: z.string().optional().describe('Parent card key'),
        boundary: z.array(z.string()).optional().describe('File/directory glob patterns this card is responsible for'),
        body: z.string().optional().describe('Design knowledge: rationale, invariants, scope boundaries, edge cases. Never duplicate codeLinks here.'),
        tags: z.array(z.string()).optional().describe('Tag list for classification'),
        relations: z.array(z.string()).optional().describe('Related card keys'),
        codeLinks: z.array(codeLinkSchema).optional().describe('Code links [{kind, file, symbol}]'),
      }).strict(),
    },
    async (args: {
      key: string;
      summary: string;
      type: 'architecture' | 'spec';
      status?: 'draft' | 'active' | 'drifted';
      parent?: string;
      boundary?: string[];
      body?: string;
      tags?: string[];
      relations?: string[];
      codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
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
        'Create multiple cards at once. Cards are topologically sorted by parent dependency. ' +
        'Relations are applied after all cards are created to handle intra-batch references. ' +
        'Each card requires careful analysis of the relevant code before creation.',
      inputSchema: z.object({
        cards: z.array(z.object({
          key: z.string().describe('Card key (e.g. "auth-token")'),
          summary: z.string().describe('One-line summary'),
          type: cardTypeEnum.describe('Card type'),
          status: statusEnum.optional().describe('Initial status (default: draft)'),
          parent: z.string().optional().describe('Parent card key'),
          boundary: z.array(z.string()).optional().describe('Boundary glob patterns'),
          body: z.string().optional().describe('Design knowledge'),
          tags: z.array(z.string()).optional().describe('Tags'),
          relations: z.array(z.string()).optional().describe('Related card keys'),
          codeLinks: z.array(codeLinkSchema).optional().describe('Code links [{kind, file, symbol}]'),
        }).strict()).describe('Array of card inputs'),
      }).strict(),
    },
    async (args: {
      cards: Array<{
        key: string;
        summary: string;
        type: 'architecture' | 'spec';
        status?: 'draft' | 'active' | 'drifted';
        parent?: string;
        boundary?: string[];
        body?: string;
        tags?: string[];
        relations?: string[];
        codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
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
        'Use before implementation to review the spec, or to inspect card details. ' +
        'Set includeHistory=true to also get the changelog.',
      inputSchema: z.object({
        key: z.string().describe('Card key (e.g. "auth-token")'),
        includeHistory: z.boolean().optional().describe('Include changelog history (default: false)'),
      }).strict(),
    },
    async (args: { key: string; includeHistory?: boolean }) => {
      try {
        const result = await getCard(ctx, args.key, {
          includeHistory: args.includeHistory,
        });
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
        type: cardTypeEnum.optional().describe('New card type'),
        status: statusEnum.optional().describe('New status'),
        parent: z.string().nullable().optional().describe('Parent card key (null to remove parent)'),
        boundary: z.array(z.string()).optional().describe('Boundary glob patterns'),
        body: z.string().optional().describe('Design knowledge: rationale, invariants, scope boundaries, edge cases.'),
        tags: z.array(z.string()).nullable().optional().describe('Tags (null to remove)'),
        relations: z.array(z.string()).nullable().optional().describe('Related card keys (null to remove)'),
        codeLinks: z.array(codeLinkSchema).nullable().optional().describe('Code links (null to remove)'),
      }).strict(),
    },
    async (args: {
      key: string;
      summary?: string;
      type?: 'architecture' | 'spec';
      status?: 'draft' | 'active' | 'drifted';
      parent?: string | null;
      boundary?: string[];
      body?: string;
      tags?: string[] | null;
      relations?: string[] | null;
      codeLinks?: Array<{ kind: string; file: string; symbol: string }> | null;
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
        'Transition a card through its lifecycle (draft/active/drifted). ' +
        'Activation guard is applied when transitioning to active. ' +
        'Use reason to document why the status changed.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        status: statusEnum.describe('New status'),
        reason: z.string().optional().describe('Reason for the status change (recorded in changelog)'),
      }).strict(),
    },
    async (args: { key: string; status: 'draft' | 'active' | 'drifted'; reason?: string }) => {
      try {
        const result = await updateCardStatus(ctx, args.key, args.status, args.reason);
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
        'Use when a spec is no longer relevant. ' +
        'Set force=true to delete even if the card has children (children will become orphans).',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        force: z.boolean().optional().describe('Force delete even with children (default: false)'),
      }).strict(),
    },
    async (args: { key: string; force?: boolean }) => {
      try {
        const result = await deleteCard(ctx, args.key, { force: args.force });
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
        'Rename a card key (moves file + updates DB + updates referencing cards). ' +
        'Use when the original slug no longer reflects the card\'s scope. ' +
        'Returns bodyReferencesFound if other cards mention the old key in their body text.',
      inputSchema: z.object({
        key: z.string().describe('Current card key'),
        newSlug: z.string().describe('New slug'),
      }).strict(),
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
        'List all cards, optionally filtered by status, type, parent, tag, or roots. ' +
        'Use at session start to see what specs exist, or to find cards in a specific lifecycle stage.',
      inputSchema: z.object({
        status: statusEnum.optional().describe('Filter by status'),
        type: cardTypeEnum.optional().describe('Filter by card type'),
        parent: z.string().optional().describe('Filter by parent card key'),
        tag: z.string().optional().describe('Filter by tag name'),
        roots: z.boolean().optional().describe('Only root cards (no parent)'),
        updatedSince: z.string().optional().describe('ISO timestamp — only cards updated after this time'),
        sortBy: z.enum(['updated_at']).optional().describe('Sort order'),
      }).strict(),
    },
    async (args: {
      status?: 'draft' | 'active' | 'drifted';
      type?: 'architecture' | 'spec';
      parent?: string;
      tag?: string;
      roots?: boolean;
      updatedSince?: string;
      sortBy?: 'updated_at';
    }) => {
      try {
        const filter: Record<string, unknown> = {};
        if (args.status) filter.status = args.status;
        if (args.type) filter.type = args.type;
        if (args.parent) filter.parent = args.parent;
        if (args.tag) filter.tag = args.tag;
        if (args.roots) filter.roots = args.roots;
        if (args.updatedSince) filter.updatedSince = args.updatedSince;
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
        'Use before implementing a feature or fixing a bug to check if a related spec already exists. ' +
        'Optionally filter results by type and status.',
      inputSchema: z.object({
        query: z.string().describe('Search query text'),
        type: cardTypeEnum.optional().describe('Filter by card type'),
        status: statusEnum.optional().describe('Filter by status'),
      }).strict(),
    },
    async (args: { query: string; type?: 'architecture' | 'spec'; status?: 'draft' | 'active' | 'drifted' }) => {
      try {
        const result = searchCards(ctx, args.query, {
          type: args.type,
          status: args.status,
        });
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
        'Get a card\'s context: the card itself, relations, code links, and optionally deeper graph. ' +
        'depth=1 (default) returns direct relations. depth>1 does BFS traversal for multi-hop context. ' +
        'Response includes truncated=true when the depth limit cuts off further nodes.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        depth: z.number().optional().describe('BFS traversal depth (default: 1 = direct relations only)'),
      }).strict(),
    },
    async (args: { key: string; depth?: number }) => {
      try {
        const result = await getCardContext(ctx, args.key, { depth: args.depth });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_get_card_tree',
    {
      description:
        'Get the parent/child hierarchy tree starting from a card. ' +
        'Use to visualize the card structure and understand how specs are organized. ' +
        'Returns a recursive tree with key, summary, type, status, depth, and children.',
      inputSchema: z.object({
        key: z.string().describe('Root card key'),
        maxDepth: z.number().optional().describe('Max tree depth (default: 10, max: 20)'),
      }).strict(),
    },
    async (args: { key: string; maxDepth?: number }) => {
      try {
        const result = getCardTree(ctx, args.key, args.maxDepth);
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
      inputSchema: z.object({
        key: z.string().describe('Starting card key'),
        maxDepth: z.number().optional().describe('Max traversal depth'),
        direction: z.enum(['forward', 'backward', 'both']).optional().describe('Traversal direction'),
      }).strict(),
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
      inputSchema: z.object({
        key: z.string().describe('Card key'),
      }).strict(),
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
      inputSchema: z.object({
        filePath: z.string().describe('Absolute path to the .card.md file'),
      }).strict(),
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
        'Detects duplicate keys and reports them as errors. ' +
        'Use after bulk file changes or initial project setup.',
      inputSchema: z.object({
        dirPath: z.string().optional().describe('Directory to scan (defaults to cardsDir)'),
      }).strict(),
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
        'Detects stale DB rows, orphan files, key mismatches, broken parents, ' +
        'type hierarchy violations, broken relations, boundary overlaps, and rework dependencies.',
      inputSchema: z.object({
        dirPath: z.string().optional().describe('Directory to validate (defaults to cardsDir)'),
      }).strict(),
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
      inputSchema: z.object({
        key: z.string().describe('Card key'),
      }).strict(),
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
      inputSchema: z.object({
        key: z.string().describe('Card key'),
      }).strict(),
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
        'Find cards that reference a given symbol name via codeLinks or boundary patterns. ' +
        'Each result includes matchType ("codeLink" or "boundary") indicating how the card was matched. ' +
        'Provide filePath to also match cards whose boundary globs cover that file.',
      inputSchema: z.object({
        symbolName: z.string().describe('Symbol name to search for'),
        filePath: z.string().optional().describe('File path — also matches boundary patterns when provided'),
      }).strict(),
    },
    async (args: { symbolName: string; filePath?: string }) => {
      try {
        const result = await findCardsBySymbol(ctx, args.symbolName, args.filePath);
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
        'Omit key to validate all cards at once. ' +
        'Active cards with broken links are automatically transitioned to drifted.',
      inputSchema: z.object({
        key: z.string().optional().describe('Card key (omit to validate all cards)'),
      }).strict(),
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

  // ── Context Engine ──

  server.registerTool(
    'emberdeck_check_drift',
    {
      description:
        'Detect drift for cards — broken code links, inactive boundaries, or changed symbols. ' +
        'Returns per-card drift status and project health summary. ' +
        'Set autoTransition=false to report only without transitioning active→drifted. ' +
        'Omit key to check all cards.',
      inputSchema: z.object({
        key: z.string().optional().describe('Starting card key (omit for all cards)'),
        maxDepth: z.number().optional().describe('Max BFS depth (default: 3)'),
        autoTransition: z.boolean().optional().describe('Auto-transition active→drifted (default: true)'),
      }).strict(),
    },
    async (args: { key?: string; maxDepth?: number; autoTransition?: boolean }) => {
      try {
        const result = await checkDrift(ctx, args.key, {
          maxDepth: args.maxDepth,
          autoTransition: args.autoTransition,
        });
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
        'shared files, import dependencies, existing relations, and potential conflicts. ' +
        'Use before modifying multiple related features to understand cross-card dependencies.',
      inputSchema: z.object({
        cards: z.array(z.string()).describe('Array of card keys to analyze'),
      }).strict(),
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
        'Returns directly affected, boundary-matched, and transitively affected cards. ' +
        'Includes per-card link status and lists uncovered files. ' +
        'Use before code changes to understand what specs may need review.',
      inputSchema: z.object({
        files: z.array(z.string()).describe('File paths that will be changed'),
        symbols: z.array(z.string()).optional().describe('Specific symbols being changed (optional)'),
      }).strict(),
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
        'Quality gate based on drifted card ratio among affected cards. ' +
        'Fails if the drifted ratio exceeds the configured threshold (default: 0 = any drift fails). ' +
        'Use after code changes to verify design alignment before committing.',
      inputSchema: z.object({
        changedFiles: z.array(z.string()).describe('Changed file paths'),
      }).strict(),
    },
    async (args: { changedFiles: string[] }) => {
      try {
        const result = await regressionGuard(ctx, args.changedFiles);
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
        'Use after adding @spec comments to source files, or during bulk sync. ' +
        'Requires gildash. Manual links are preserved. ' +
        'Also detects marker-missing (link exists but no @spec) and link-missing (@spec but no link).',
      inputSchema: z.object({}).strict(),
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
      inputSchema: z.object({
        since: z.string().describe('ISO timestamp — sync changes after this time'),
      }).strict(),
    },
    async (args: { since: string }) => {
      try {
        const result = await syncSymbolChanges(ctx, args.since);
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
        'Applies coverageIgnore patterns to exclude files from unreferenced list. ' +
        'Use to find gaps in code-spec traceability. Requires gildash.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
      }).strict(),
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
