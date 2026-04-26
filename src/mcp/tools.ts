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
  getCards,
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
  writeSpecAnnotations,
  syncSymbolChanges,
  getLinkCoverage,
  getUncoveredSymbols,
  suggestCardScope,
} from '../ops/spec-sync';
import { analyze, getOnboardingSummary } from '../ops/analyze';
import { migrateCardToNamespace } from '../ops/migrate';
import { validateBriefRefs } from '../brief/validate-refs';
import { readCardFile } from '../fs/reader';
import {
  defineGlossary,
  lookupGlossary,
  removeGlossary,
  renameGlossary,
  findCardsByGlossaryWord,
  resetEmberdeck,
} from '../ops/glossary';

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
const statusEnum = z.enum(['draft', 'active', 'drifted', 'retired']);
const cardTypeEnum = z.enum(['principle', 'brief', 'spec']);
// Type-specific structured body namespaces. Validated by createCard/updateCard internally
// against the strict TypeScript shapes (BriefBody/SpecBody/PrincipleBody).
const namespaceBodySchema = z.record(z.string(), z.unknown());

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
        'Record a new principle, brief, or spec card before implementation. ' +
        'Use to capture design decisions, constraints, and contracts as a card. ' +
        'The body should contain design rationale, invariants, and scope boundaries — not file listings (use codeLinks for that).',
      inputSchema: z.object({
        key: z.string().describe('Card key used as filename (e.g. "auth-token")'),
        summary: z.string().describe('One-line summary of the card'),
        type: cardTypeEnum.describe('Card type (principle/brief/spec)'),
        status: statusEnum.optional().describe('Initial status (default: draft). If active, activation guard is applied'),
        parent: z.string().optional().describe('Parent card key'),
        boundary: z.array(z.string()).optional().describe('File/directory glob patterns this card is responsible for'),
        body: z.string().optional().describe('Design knowledge: rationale, invariants, scope boundaries, edge cases. Never duplicate codeLinks here.'),
        tags: z.array(z.string()).optional().describe('Tag list for classification'),
        relations: z.array(z.string()).optional().describe('Related card keys'),
        codeLinks: z.array(codeLinkSchema).optional().describe('Code links [{kind, file, symbol}]'),
        glossary: z.array(z.string()).optional().describe('Glossary words declared by this card'),
        principle: namespaceBodySchema.optional().describe('principle namespace body (only when type=principle). Required to activate.'),
        brief: namespaceBodySchema.optional().describe('brief namespace body (only when type=brief). Required to activate.'),
        spec: namespaceBodySchema.optional().describe('spec namespace body (only when type=spec). Required to activate.'),
      }).strict(),
    },
    async (args: {
      key: string;
      summary: string;
      type: 'principle' | 'brief' | 'spec';
      status?: 'draft' | 'active' | 'drifted' | 'retired';
      parent?: string;
      boundary?: string[];
      body?: string;
      tags?: string[];
      relations?: string[];
      codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
      glossary?: string[];
      principle?: Record<string, unknown>;
      brief?: Record<string, unknown>;
      spec?: Record<string, unknown>;
    }) => {
      try {
        const result = await createCard(ctx, args as Parameters<typeof createCard>[1]);
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
        'Use when onboarding a new area or splitting a large spec into multiple cards at once.',
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
          glossary: z.array(z.string()).optional().describe('Glossary words declared by this card'),
          principle: namespaceBodySchema.optional().describe('principle namespace body (required to activate principle cards)'),
          brief: namespaceBodySchema.optional().describe('brief namespace body (required to activate brief cards)'),
          spec: namespaceBodySchema.optional().describe('spec namespace body (required to activate spec cards)'),
        }).strict()).describe('Array of card inputs'),
      }).strict(),
    },
    async (args: {
      cards: Array<{
        key: string;
        summary: string;
        type: 'principle' | 'brief' | 'spec';
        status?: 'draft' | 'active' | 'drifted' | 'retired';
        parent?: string;
        boundary?: string[];
        body?: string;
        tags?: string[];
        relations?: string[];
        codeLinks?: Array<{ kind: string; file: string; symbol: string }>;
        glossary?: string[];
        principle?: Record<string, unknown>;
        brief?: Record<string, unknown>;
        spec?: Record<string, unknown>;
      }>;
    }) => {
      try {
        const result = await bulkCreateCards(ctx, args.cards as Parameters<typeof bulkCreateCards>[1]);
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
    'emberdeck_get_cards',
    {
      description:
        'Read multiple cards in one call. Use after pre_change_check to load all affected cards ' +
        'at once instead of calling get_card repeatedly.',
      inputSchema: z.object({
        keys: z.array(z.string()).describe('Array of card keys to read'),
        includeHistory: z.boolean().optional().describe('Include changelog history for each card (default: false)'),
      }).strict(),
    },
    async (args: { keys: string[]; includeHistory?: boolean }) => {
      try {
        const result = await getCards(ctx, args.keys, {
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
        'Use when a feature extends an existing spec or contracts change after implementation. ' +
        'Only pass the fields you want to change; the rest are preserved. ' +
        'bodyPatches allows efficient partial body edits (search-and-replace); mutually exclusive with body.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        summary: z.string().optional().describe('New summary'),
        type: cardTypeEnum.optional().describe('New card type'),
        status: statusEnum.optional().describe('New status'),
        parent: z.string().nullable().optional().describe('Parent card key (null to remove parent)'),
        boundary: z.array(z.string()).optional().describe('Boundary glob patterns'),
        body: z.string().optional().describe('Full body replacement. Mutually exclusive with bodyPatches.'),
        bodyPatches: z.array(z.object({
          old: z.string().describe('Text to find in the current body (must appear exactly once at apply time)'),
          new: z.string().describe('Replacement text'),
        })).optional().describe('Partial body edits via search-and-replace. Applied sequentially. Mutually exclusive with body.'),
        tags: z.array(z.string()).nullable().optional().describe('Tags (null to remove)'),
        relations: z.array(z.string()).nullable().optional().describe('Related card keys (null to remove)'),
        codeLinks: z.array(codeLinkSchema).nullable().optional().describe('Code links (null to remove)'),
        glossary: z.array(z.string()).optional().describe('Glossary words declared by this card'),
        principle: namespaceBodySchema.nullable().optional().describe('principle namespace body (null to remove)'),
        brief: namespaceBodySchema.nullable().optional().describe('brief namespace body (null to remove)'),
        spec: namespaceBodySchema.nullable().optional().describe('spec namespace body (null to remove)'),
      }).strict(),
    },
    async (args: {
      key: string;
      summary?: string;
      type?: 'principle' | 'brief' | 'spec';
      status?: 'draft' | 'active' | 'drifted' | 'retired';
      parent?: string | null;
      boundary?: string[];
      body?: string;
      bodyPatches?: Array<{ old: string; new: string }>;
      tags?: string[] | null;
      relations?: string[] | null;
      codeLinks?: Array<{ kind: string; file: string; symbol: string }> | null;
      glossary?: string[];
      principle?: Record<string, unknown> | null;
      brief?: Record<string, unknown> | null;
      spec?: Record<string, unknown> | null;
    }) => {
      try {
        const { key, ...fields } = args;
        const result = await updateCard(ctx, key, fields as Parameters<typeof updateCard>[2]);
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
        'Use after implementation is verified to activate a draft, or to mark a card as drifted. ' +
        'Activation guard is applied when transitioning to active.',
      inputSchema: z.object({
        key: z.string().describe('Card key'),
        status: statusEnum.describe('New status'),
        reason: z.string().optional().describe('Reason for the status change (recorded in changelog)'),
      }).strict(),
    },
    async (args: { key: string; status: 'draft' | 'active' | 'drifted' | 'retired'; reason?: string }) => {
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
      status?: 'draft' | 'active' | 'drifted' | 'retired';
      type?: 'principle' | 'brief' | 'spec';
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
    async (args: { query: string; type?: 'principle' | 'brief' | 'spec'; status?: 'draft' | 'active' | 'drifted' | 'retired' }) => {
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
        'Use after bulk changes or when card integrity is uncertain. ' +
        'Detects stale DB rows, orphan files, key mismatches, broken parents, ' +
        'type hierarchy violations, broken relations, and boundary overlaps.',
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
        'Use before modifying code to check if the symbol has a governing spec. ' +
        'Each result includes matchType ("codeLink" or "boundary") indicating how the card was matched.',
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
        const skipped: Record<string, string> = {};
        for (const card of allCards) {
          try {
            results[card.key] = await validateCodeLinks(ctx, card.key);
          } catch (e) {
            skipped[card.key] = e instanceof Error ? e.message : String(e);
          }
        }
        return ok({ results, ...(Object.keys(skipped).length > 0 ? { skipped } : {}) });
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
    'emberdeck_write_spec_annotations',
    {
      description:
        'Reconcile @spec annotations in source files with DB codeLinks. ' +
        'Removes orphan @spec (card deleted, renamed, or DB reset) and inserts missing ones. ' +
        'Idempotent: safe to run repeatedly. Use after card changes or at session start. Requires gildash.',
      inputSchema: z.object({
        key: z.string().optional().describe('Card key to limit annotation to a specific card (omit for all cards)'),
      }).strict(),
    },
    async (args: { key?: string }) => {
      try {
        const result = await writeSpecAnnotations(ctx, args.key);
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
        'Applies ignorePatterns to exclude files from unreferenced list. ' +
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

  // ── Coverage & Analysis ──

  server.registerTool(
    'emberdeck_get_uncovered_symbols',
    {
      description:
        'Find symbols not linked to any card via codeLinks or boundary globs. ' +
        'Use to identify gaps in spec coverage and decide which symbols need cards. ' +
        'Applies ignorePatterns automatically. Requires gildash.',
      inputSchema: z.object({
        files: z.array(z.string()).optional().describe('Specific files to check (default: all indexed files)'),
        kinds: z.array(z.string()).optional().describe('Filter by symbol kind (function, class, interface, etc.)'),
        exportedOnly: z.boolean().optional().describe('Only exported symbols (default: false)'),
        excludePatterns: z.array(z.string()).optional().describe('Additional glob patterns to exclude'),
      }).strict(),
    },
    async (args: {
      files?: string[];
      kinds?: string[];
      exportedOnly?: boolean;
      excludePatterns?: string[];
    }) => {
      try {
        const result = await getUncoveredSymbols(ctx, args);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_suggest_card_scope',
    {
      description:
        'Analyze directory structure and symbols to suggest where new cards should be created. ' +
        'Groups uncovered symbols by directory and suggests brief or spec cards. ' +
        'Does not create cards — returns suggestions for review. Requires gildash.',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory path to analyze (default: project root)'),
        maxDepth: z.number().optional().describe('Max directory depth to explore (default: 3)'),
      }).strict(),
    },
    async (args: { path?: string; maxDepth?: number }) => {
      try {
        const result = await suggestCardScope(ctx, args);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_analyze',
    {
      description:
        'Full project health report: card counts, drift detection, symbol coverage, and stale boundaries. ' +
        'Combines check_drift and coverage analysis into a single view. ' +
        'Use at session start or after bulk changes to understand overall spec health. ' +
        'The driftedCards array supports pagination via offset/limit; driftedCardsTotal always shows the full count.',
      inputSchema: z.object({
        includeBody: z.boolean().optional().describe('Include card body text in drifted card entries (default: false)'),
        offset: z.number().optional().describe('Number of drifted cards to skip (default: 0)'),
        limit: z.number().optional().describe('Maximum number of drifted cards to return (omit for all)'),
      }).strict(),
    },
    async (args: { includeBody?: boolean; offset?: number; limit?: number }) => {
      try {
        const result = await analyze(ctx, args);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Glossary ──

  server.registerTool(
    'emberdeck_define_glossary',
    {
      description:
        'Define or update words in the project glossary. ' +
        'Use when new domain concepts are introduced or existing definitions need refinement. ' +
        'Agent must show the glossary-proposal template (words, definitions, and evidence) to the user and get confirmation before calling.',
      inputSchema: z.object({
        entries: z.array(z.object({
          word: z.string().min(1).max(100).describe('Canonical word'),
          definition: z.string().min(1).max(1000).describe('What it means in this project'),
        })).min(1).max(50).describe('Glossary entries to define or update'),
      }).strict(),
    },
    async (args: { entries: Array<{ word: string; definition: string }> }) => {
      try {
        const result = await defineGlossary(ctx, args);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_lookup_glossary',
    {
      description:
        'Look up a word in the project glossary, or list all entries. ' +
        'Use when encountering an unfamiliar domain concept in code or cards, ' +
        'or when starting a session to understand the project vocabulary.',
      inputSchema: z.object({
        word: z.string().optional().describe('Word to look up (omit to list all entries)'),
      }).strict(),
    },
    async (args: { word?: string }) => {
      try {
        const result = lookupGlossary(ctx, args.word);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_remove_glossary',
    {
      description:
        'Remove a word from the project glossary. ' +
        'Use when a domain concept is eliminated from the project. ' +
        'Cards referencing this word will become drifted.',
      inputSchema: z.object({
        word: z.string().min(1).describe('Word to remove'),
      }).strict(),
    },
    async (args: { word: string }) => {
      try {
        const result = await removeGlossary(ctx, args.word);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_rename_glossary',
    {
      description:
        'Rename a word in the project glossary. ' +
        'Updates the glossary file and all card glossary fields that reference the old word. ' +
        'Card bodies are NOT updated (manual). Use when a domain concept is rebranded.',
      inputSchema: z.object({
        oldWord: z.string().min(1).describe('Current word'),
        newWord: z.string().min(1).max(100).describe('New word'),
        definition: z.string().min(1).max(1000).optional().describe('Updated definition (optional)'),
      }).strict(),
    },
    async (args: { oldWord: string; newWord: string; definition?: string }) => {
      try {
        const result = await renameGlossary(ctx, args.oldWord, args.newWord, args.definition);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_find_cards_by_glossary_word',
    {
      description:
        'Find all cards that declare a specific glossary word in their glossary field. ' +
        'Use to understand which cards are affected by a glossary change or to audit term usage.',
      inputSchema: z.object({
        word: z.string().min(1).describe('Glossary word to search for'),
      }).strict(),
    },
    async (args: { word: string }) => {
      try {
        const result = findCardsByGlossaryWord(ctx, args.word);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_reset',
    {
      description:
        'Reset all emberdeck state: delete all cards (DB + files), clear glossary. ' +
        'Run write_spec_annotations after to remove orphan @spec from source. ' +
        'Use when starting over from scratch.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        const result = await resetEmberdeck(ctx);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Brief Validation ──────────────────────────────────────────────

  server.registerTool(
    'emberdeck_validate_brief',
    {
      description:
        'Validate a brief card structure and cross-references. ' +
        'Checks: (1) brief namespace presence in frontmatter, (2) all required sections (context/scope/flow/design/policy/external/compatibility/limits/criteria/rationale), ' +
        '(3) cross-refs (covers→goals, governs→flow, verifies→flow, addresses→external/limits), ' +
        '(4) coverage (every goal covered, every flow governed+verified), (5) ≥1 happy + ≥1 failure scenario. ' +
        'Use before activating a brief or creating spec cards under it.',
      inputSchema: z.object({
        cardKey: z.string().describe('Brief card key to validate'),
      }).strict(),
    },
    async ({ cardKey }: { cardKey: string }) => {
      try {
        const card = ctx.cardRepo.findByKey(cardKey);
        if (!card) {
          return fail(new Error(`Card not found: "${cardKey}"`));
        }
        if (card.type !== 'brief') {
          return fail(new Error(`Card "${cardKey}" is type "${card.type}", expected "brief"`));
        }
        // Read full file to access frontmatter.brief namespace (DB stores body as text).
        const file = await readCardFile(card.filePath);
        if (!file.frontmatter.brief) {
          return fail(new Error(`Brief card "${cardKey}" is missing required \`brief\` namespace in frontmatter`));
        }
        validateBriefRefs(file.frontmatter.brief);
        return ok({
          cardKey,
          valid: true,
          goals: file.frontmatter.brief.scope.goals.length,
          flow: file.frontmatter.brief.flow.length,
          policy: file.frontmatter.brief.policy.length,
          criteria: file.frontmatter.brief.criteria.length,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_migrate_card_to_namespace',
    {
      description:
        'DRY-RUN: Convert a legacy markdown-body brief card to the structured `brief:` namespace. ' +
        'Parses ## Motivation/Scope/Scenario/Rule/Constraint/Risk/Criteria/Decision sections and emits the proposed BriefBody. ' +
        'Returns proposed namespace + warnings + validationStatus. DOES NOT modify the file. ' +
        'Apply the result manually after review (recommended only for `draft` cards).',
      inputSchema: z.object({
        cardKey: z.string().describe('Brief card key to convert'),
        autoLinkRefs: z.boolean().optional().describe('Auto-fill heuristic cross-refs covers/governs/verifies/addresses (default: false)'),
      }).strict(),
    },
    async ({ cardKey, autoLinkRefs }: { cardKey: string; autoLinkRefs?: boolean }) => {
      try {
        const result = await migrateCardToNamespace(ctx, { cardKey, autoLinkRefs });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'emberdeck_onboarding_summary',
    {
      description:
        'Get a complete overview of the card structure for fresh context onboarding. ' +
        'Shows card hierarchy, type/status distribution, coverage, and drifted cards. ' +
        'Use at the start of a new conversation to understand the full design landscape.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        const result = await getOnboardingSummary(ctx);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

}
