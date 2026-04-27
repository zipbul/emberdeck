/**
 * `ed card` subcommands per CLI_PLAN §4.1 (12 commands, migrate excluded per user decision).
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { CARD_TYPES, CARD_STATUSES, type CardType, type CardStatus } from '../../card/types';
import {
  getCard,
  listCards,
  searchCards,
  listCardRelations,
  getCardTree,
  getCardContext,
} from '../../ops/query';
import { createCard, type CreateCardInput } from '../../ops/create';
import {
  updateCard,
  updateCardStatus,
  type UpdateCardFields,
} from '../../ops/update';
import { deleteCard } from '../../ops/delete';
import { renameCard } from '../../ops/rename';
import { exportCardToFile, buildCardFromDb } from '../../ops/sync';
import { serializeCardMarkdown } from '../../card/markdown';
import { findCardsBySymbol } from '../../ops/link';
import { findCardsByGlossaryWord } from '../../ops/glossary';
import { parsePositiveInt } from '../parsers';
import { confirmDestructive } from '../confirm';
import { CliUsageError } from '../errors';

// ── helpers ──

function validateCardType(value: string): CardType {
  if (!CARD_TYPES.includes(value as CardType)) {
    throw new CliUsageError(`invalid --type '${value}'. Allowed: ${CARD_TYPES.join('|')}`);
  }
  return value as CardType;
}

function validateCardStatus(value: string): CardStatus {
  if (!CARD_STATUSES.includes(value as CardStatus)) {
    throw new CliUsageError(`invalid status '${value}'. Allowed: ${CARD_STATUSES.join('|')}`);
  }
  return value as CardStatus;
}

async function readBodyFromOption(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (value === '-') {
    return await Bun.stdin.text();
  }
  return await readFile(value, 'utf-8');
}

function parseFields(fieldFlags: string[] | undefined): Record<string, string> {
  if (!fieldFlags || fieldFlags.length === 0) return {};
  const out: Record<string, string> = {};
  for (const f of fieldFlags) {
    const idx = f.indexOf('=');
    if (idx <= 0) throw new CliUsageError(`--field expects NAME=VALUE, got: ${f}`);
    out[f.slice(0, idx)] = f.slice(idx + 1);
  }
  return out;
}

function applyFieldValue(fields: UpdateCardFields, name: string, value: string): void {
  switch (name) {
    case 'summary':
      fields.summary = value;
      return;
    case 'status':
      fields.status = validateCardStatus(value);
      return;
    case 'parent':
      fields.parent = value === '' ? null : value;
      return;
    case 'type':
      fields.type = validateCardType(value);
      return;
    default:
      throw new CliUsageError(`unsupported --field name: ${name} (allowed: summary, status, parent, type)`);
  }
}

/**
 * Render card content from DB row WITHOUT touching the original file on disk.
 * Reuses ops/sync.ts buildCardFromDb to avoid logic drift.
 */
function renderCardContentFromDb(rt: CliRuntime, key: string): string {
  const cardFile = buildCardFromDb(rt.ctx, key);
  return serializeCardMarkdown(cardFile.frontmatter, cardFile.body);
}

async function parseInputFile(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to YAML
    }
  }
  try {
    return Bun.YAML.parse(text);
  } catch (e) {
    throw new CliUsageError(`failed to parse --from/--patch input as JSON or YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── register ──

export function registerCard(program: Command): void {
  const card = program.command('card').description('card-level operations');

  card
    .command('get <key>')
    .description('read a card from file')
    .option('--history', 'include changelog history')
    .action(async (key: string, opts: { history?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await getCard(rt.ctx, key, { includeHistory: !!opts.history });
          return ok({
            key: result.card.frontmatter.key,
            type: result.card.frontmatter.type,
            status: result.card.frontmatter.status,
            summary: result.card.frontmatter.summary,
            frontmatter: result.card.frontmatter,
            body: result.card.body,
            ...(result.history ? { history: result.history } : {}),
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderCardHuman },
      );
    });

  card
    .command('list')
    .description('list cards (filterable). --symbol/--glossary subsume find_cards_by_symbol / find_cards_by_glossary_word')
    .option('--type <type>', 'filter by type (principle|brief|spec)')
    .option('--status <status>', 'filter by status (draft|active|drifted|retired)')
    .option('--parent <key>', 'filter by parent card key')
    .option('--tag <tag>', 'filter by tag')
    .option('--symbol <name>', 'cards bound to this code symbol')
    .option('--file <path>', 'when used with --symbol, restrict to symbols in this file')
    .option('--glossary <word>', 'cards declaring this glossary word')
    .option('--limit <n>', 'page size (default 50)', parsePositiveInt('--limit'))
    .option('--offset <n>', 'page offset (default 0)', parsePositiveInt('--offset'))
    .action(async (opts: { type?: string; status?: string; parent?: string; tag?: string; symbol?: string; file?: string; glossary?: string; limit?: number; offset?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      await run(
        async (rt: CliRuntime) => {
          if (opts.file && !opts.symbol) {
            throw new CliUsageError('--file requires --symbol');
          }
          if (opts.type) validateCardType(opts.type);
          if (opts.status) validateCardStatus(opts.status);
          let rows: Array<{ key: string; type: string; status: string; summary: string; parent: string | null }>;
          if (opts.symbol) {
            const matches = await findCardsBySymbol(rt.ctx, opts.symbol, opts.file);
            rows = matches
              .map((m) => ({
                key: m.card.key,
                type: m.card.type,
                status: m.card.status,
                summary: m.card.summary,
                parent: m.card.parent,
              }))
              .filter((r) => !opts.type || r.type === opts.type)
              .filter((r) => !opts.status || r.status === opts.status)
              .filter((r) => !opts.parent || r.parent === opts.parent);
          } else if (opts.glossary) {
            const matches = findCardsByGlossaryWord(rt.ctx, opts.glossary);
            const enriched = matches.map((m) => {
              const row = rt.ctx.cardRepo.findByKey(m.key);
              return {
                key: m.key,
                type: row?.type ?? '',
                status: row?.status ?? '',
                summary: m.summary,
                parent: row?.parent ?? null,
              };
            });
            rows = enriched
              .filter((r) => !opts.type || r.type === opts.type)
              .filter((r) => !opts.status || r.status === opts.status)
              .filter((r) => !opts.parent || r.parent === opts.parent);
          } else {
            const all = listCards(rt.ctx, {
              type: opts.type as CardType | undefined,
              status: opts.status as CardStatus | undefined,
              parent: opts.parent,
              tag: opts.tag,
            });
            rows = all.map((row) => ({
              key: row.key,
              type: row.type,
              status: row.status,
              summary: row.summary,
              parent: row.parent,
            }));
          }
          const total = rows.length;
          const items = rows.slice(offset, offset + limit);
          return ok({
            items,
            total,
            page: { limit, offset, has_more: offset + items.length < total },
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderListHuman },
      );
    });

  card
    .command('create <key>')
    .description('create a new card')
    .requiredOption('--type <type>', 'card type (principle|brief|spec)')
    .option('--summary <s>', 'one-line summary')
    .option('--from <file>', 'read frontmatter+body from YAML/JSON file (- for STDIN)')
    .option('--status <status>', 'initial status (default: draft)')
    .option('--parent <key>', 'parent card key')
    .option('--glossary <words>', 'comma-separated glossary words (or repeat flag)', (val: string, prev: string[] = []) => [...prev, ...val.split(',').map((s) => s.trim()).filter(Boolean)], [] as string[])
    .option('--tag <name>', 'tag (repeatable)', (val: string, prev: string[] = []) => [...prev, val], [] as string[])
    .action(async (key: string, opts: { type: string; summary?: string; from?: string; status?: string; parent?: string; glossary?: string[]; tag?: string[] }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const validatedType = validateCardType(opts.type);
          const validatedStatus = opts.status ? validateCardStatus(opts.status) : undefined;
          let input: CreateCardInput = {
            key,
            type: validatedType,
            summary: opts.summary ?? '',
            ...(validatedStatus ? { status: validatedStatus } : {}),
            ...(opts.parent ? { parent: opts.parent } : {}),
            ...(opts.glossary && opts.glossary.length > 0 ? { glossary: opts.glossary } : {}),
            ...(opts.tag && opts.tag.length > 0 ? { tags: opts.tag } : {}),
          };
          if (opts.from) {
            const text = await readBodyFromOption(opts.from);
            if (!text) throw new CliUsageError('--from produced empty input');
            const parsed = (await parseInputFile(text)) as Partial<CreateCardInput>;
            const summary = opts.summary ?? parsed.summary ?? '';
            input = {
              ...parsed,
              key,
              type: validatedType,
              summary,
              ...(validatedStatus ? { status: validatedStatus } : (parsed.status ? { status: parsed.status } : {})),
              ...(opts.parent ? { parent: opts.parent } : (parsed.parent ? { parent: parsed.parent } : {})),
              ...(opts.glossary && opts.glossary.length > 0 ? { glossary: opts.glossary } : (parsed.glossary ? { glossary: parsed.glossary } : {})),
              ...(opts.tag && opts.tag.length > 0 ? { tags: opts.tag } : (parsed.tags ? { tags: parsed.tags } : {})),
            };
          }
          if (!input.summary) {
            throw new CliUsageError('--summary or --from with summary field required');
          }
          const result = await createCard(rt.ctx, input);
          return ok({
            key: result.fullKey,
            filePath: result.filePath,
            type: result.card.frontmatter.type,
            status: result.card.frontmatter.status,
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderCreatedHuman },
      );
    });

  card
    .command('update <key>')
    .description('update a card')
    .option('--patch <file>', 'apply patches from JSON file (- for STDIN)')
    .option('--field <name=value>', 'set frontmatter field (repeatable)', (val: string, prev: string[] = []) => [...prev, val], [] as string[])
    .option('--summary <s>', 'shortcut for --field summary=<s>')
    .option('--body <file>', 'replace body from file (- for STDIN)')
    .option('--glossary <words>', 'set glossary words (comma-separated or repeated)', (val: string, prev: string[] = []) => [...prev, ...val.split(',').map((s) => s.trim()).filter(Boolean)], [] as string[])
    .option('--tag <name>', 'set tag (repeatable; replaces existing tags)', (val: string, prev: string[] = []) => [...prev, val], [] as string[])
    .action(async (key: string, opts: { patch?: string; field?: string[]; summary?: string; body?: string; glossary?: string[]; tag?: string[] }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const fields: UpdateCardFields = {};
          if (opts.patch) {
            const text = await readBodyFromOption(opts.patch);
            if (!text) throw new CliUsageError('--patch produced empty input');
            const parsed = (await parseInputFile(text)) as UpdateCardFields;
            Object.assign(fields, parsed);
          }
          const fieldMap = parseFields(opts.field);
          if (opts.summary) fieldMap.summary = opts.summary;
          for (const [name, value] of Object.entries(fieldMap)) {
            applyFieldValue(fields, name, value);
          }
          if (opts.glossary && opts.glossary.length > 0) fields.glossary = opts.glossary;
          if (opts.tag && opts.tag.length > 0) fields.tags = opts.tag;
          if (opts.body !== undefined) {
            const body = await readBodyFromOption(opts.body);
            if (body !== undefined) fields.body = body;
          }
          const result = await updateCard(rt.ctx, key, fields);
          const warnings: CliMessage[] = (result.warnings ?? []).map((m) => ({
            code: 'UPDATE_WARNING',
            message: m,
          }));
          return ok(
            {
              key: result.card.frontmatter.key,
              filePath: result.filePath,
              status: result.card.frontmatter.status,
            },
            warnings,
          );
        },
        [],
        globalFlags,
        { humanRenderer: renderUpdatedHuman },
      );
    });

  card
    .command('delete <key>')
    .description('delete a card (DB + file)')
    .option('--force', 'delete even when children exist (cascade)')
    .option('--yes', 'skip confirmation prompt (required for non-TTY invocation)')
    .action(async (key: string, opts: { force?: boolean; yes?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          await confirmDestructive({
            yes: !!opts.yes,
            opName: 'card delete',
            prompt: `card delete will REMOVE card '${key}' (DB row + file)${opts.force ? ' and CASCADE to children' : ''}. Type "yes" to proceed: `,
          });
          const result = await deleteCard(rt.ctx, key, { force: opts.force });
          return ok({ key, filePath: result.filePath });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => `deleted card '${(data as { key: string }).key}'\n  → ${(data as { filePath: string }).filePath}` },
      );
    });

  card
    .command('rename <oldKey> <newKey>')
    .description('rename a card key (FK CASCADE through DB + file move)')
    .action(async (oldKey: string, newKey: string, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await renameCard(rt.ctx, oldKey, newKey);
          const data = {
            old_key: oldKey,
            new_key: result.newFullKey,
            old_path: result.oldFilePath,
            new_path: result.newFilePath,
            body_references: result.bodyReferencesFound ?? [],
            failed_reference_updates: result.failedReferenceUpdates ?? [],
          };
          const failed = result.failedReferenceUpdates ?? [];
          if (failed.length > 0) {
            const errors: CliMessage[] = failed.map((key) => ({
              code: 'CARD_RENAME_REFERENCE_UPDATE_FAILED',
              message: `failed to rewrite body reference to renamed card`,
              key,
            }));
            return partial(data, errors);
          }
          return ok(data);
        },
        [],
        globalFlags,
        { humanRenderer: renderRenameHuman },
      );
    });

  card
    .command('search <query>')
    .description('FTS5 search')
    .option('--type <type>', 'filter by card type')
    .option('--status <status>', 'filter by status')
    .option('--limit <n>', 'page size (default 50)', parsePositiveInt('--limit'))
    .option('--offset <n>', 'page offset (default 0)', parsePositiveInt('--offset'))
    .action(async (query: string, opts: { type?: string; status?: string; limit?: number; offset?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      await run(
        async (rt: CliRuntime) => {
          if (opts.type) validateCardType(opts.type);
          if (opts.status) validateCardStatus(opts.status);
          const all = searchCards(rt.ctx, query, {
            type: opts.type as CardType | undefined,
            status: opts.status as CardStatus | undefined,
          });
          const total = all.length;
          const items = all.slice(offset, offset + limit).map((row) => ({
            key: row.key,
            type: row.type,
            status: row.status,
            summary: row.summary,
            parent: row.parent,
          }));
          return ok({
            items,
            total,
            page: { limit, offset, has_more: offset + items.length < total },
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderListHuman },
      );
    });

  card
    .command('export <key>')
    .description('render card content from DB row. Default: STDOUT (no file side-effects). --out FILE writes to file. --in-place rewrites original.')
    .option('--out <file>', 'write to FILE (use - for STDOUT, default)')
    .option('--in-place', 'rewrite the card\'s original file (DB → file overwrite)')
    .action(async (key: string, opts: { out?: string; inPlace?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          if (opts.inPlace) {
            const filePath = await exportCardToFile(rt.ctx, key);
            return ok({ key, filePath, mode: 'in-place' });
          }
          // STDOUT or --out FILE: build content WITHOUT touching original file.
          const content = renderCardContentFromDb(rt, key);
          if (opts.out && opts.out !== '-') {
            await Bun.write(opts.out, content);
            return ok({ key, filePath: opts.out, mode: 'file' });
          }
          // STDOUT (default).
          // - JSON mode: content goes into data.content (single JSON envelope, jq-friendly)
          // - Human mode: humanRenderer writes raw markdown to stdout
          // - Quiet mode: render() suppresses by default; we still include `key` in data
          return ok({ key, mode: 'stdout', bytes: content.length, content });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { key: string; mode: string; filePath?: string; content?: string };
          if (d.mode === 'stdout') return d.content ?? ''; // raw markdown in human mode
          return `exported '${d.key}' (${d.mode}) → ${d.filePath}`;
        } },
      );
    });

  card
    .command('set-status <key> <status>')
    .description('change card status (draft|active|drifted|retired)')
    .option('--reason <text>', 'reason recorded in changelog')
    .option('--reason-from <file|->', 'read reason from file or STDIN')
    .action(async (key: string, status: string, opts: { reason?: string; reasonFrom?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const validatedStatus = validateCardStatus(status);
          let reason = opts.reason;
          if (opts.reasonFrom) reason = await readBodyFromOption(opts.reasonFrom);
          const result = await updateCardStatus(rt.ctx, key, validatedStatus, reason);
          return ok({
            key: result.card.frontmatter.key,
            status: result.card.frontmatter.status,
            filePath: result.filePath,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { key: string; status: string };
          return `card '${d.key}' status → ${d.status}`;
        } },
      );
    });

  card
    .command('tree <key>')
    .description('parent-child hierarchy starting from KEY')
    .option('--depth <n>', 'max depth (default 10, capped at 20)', parsePositiveInt('--depth'))
    .action(async (key: string, opts: { depth?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const tree = getCardTree(rt.ctx, key, opts.depth);
          return ok(tree);
        },
        [],
        globalFlags,
        { humanRenderer: renderTreeHuman },
      );
    });

  card
    .command('context <key>')
    .description('related cards via parent/relations BFS. Use `card relations` for direction-filtered direct relations.')
    .option('--depth <n>', 'BFS depth (default 1)', parsePositiveInt('--depth'))
    .action(async (key: string, opts: { depth?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          // Note: getCardContext does both forward+backward BFS by design.
          // For direction-filtered traversal, ops/query.ts:getRelationGraph supports it directly;
          // this CLI uses getCardContext which gives card details (file body) at depth 1.
          const ctx = await getCardContext(rt.ctx, key, { depth: opts.depth ?? 1 });
          return ok({
            key: ctx.card.frontmatter.key,
            type: ctx.card.frontmatter.type,
            upstream: ctx.upstreamCards.map((c) => ({ key: c.key, type: c.type, status: c.status })),
            downstream: ctx.downstreamCards.map((c) => ({ key: c.key, type: c.type, status: c.status })),
            related: (ctx.related ?? []).map((r) => ({
              key: r.card.key,
              type: r.card.type,
              depth: r.depth,
              direction: r.direction,
            })),
            truncated: ctx.truncated ?? false,
            code_links_resolved: ctx.codeLinks.filter((cl) => cl.symbol).length,
            code_links_total: ctx.codeLinks.length,
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderContextHuman },
      );
    });

  card
    .command('relations <key>')
    .description('list direct relations (forward + reverse)')
    .action(async (key: string, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const relations = listCardRelations(rt.ctx, key);
          return ok({
            key,
            forward: relations.filter((r) => !r.isReverse).map((r) => r.dstCardKey),
            reverse: relations.filter((r) => r.isReverse).map((r) => r.dstCardKey),
            total: relations.length,
          });
        },
        [],
        globalFlags,
        { humanRenderer: renderRelationsHuman },
      );
    });
}

// ── human renderers ──

function renderCardHuman(data: unknown): string {
  const card = data as { key: string; type: string; status: string; summary: string; body?: string };
  const lines = [
    `key:     ${card.key}`,
    `type:    ${card.type}`,
    `status:  ${card.status}`,
    `summary: ${card.summary}`,
    '',
  ];
  if (card.body && card.body.trim().length > 0) {
    lines.push('--- body ---');
    lines.push(card.body);
  }
  return lines.join('\n');
}

function renderListHuman(data: unknown): string {
  const d = data as { items: Array<{ key: string; type: string; status: string; summary: string }>; total: number; page: { limit: number; offset: number; has_more: boolean } };
  if (d.items.length === 0) return '(no cards)\n';
  const lines: string[] = [];
  const keyW = Math.max(3, ...d.items.map((c) => c.key.length));
  const typeW = Math.max(4, ...d.items.map((c) => c.type.length));
  const statusW = Math.max(6, ...d.items.map((c) => c.status.length));
  for (const c of d.items) {
    lines.push(`${c.key.padEnd(keyW)}  ${c.type.padEnd(typeW)}  ${c.status.padEnd(statusW)}  ${c.summary}`);
  }
  lines.push('');
  lines.push(`(${d.items.length} of ${d.total}, offset ${d.page.offset}, limit ${d.page.limit}${d.page.has_more ? ', --more available' : ''})`);
  return lines.join('\n');
}

function renderCreatedHuman(data: unknown): string {
  const d = data as { key: string; filePath: string; type: string; status: string };
  return `created ${d.type} card '${d.key}' (${d.status})\n  → ${d.filePath}`;
}

function renderUpdatedHuman(data: unknown): string {
  const d = data as { key: string; filePath: string; status: string };
  return `updated card '${d.key}' (${d.status})\n  → ${d.filePath}`;
}

function renderRenameHuman(data: unknown): string {
  const d = data as { old_key: string; new_key: string; new_path: string; body_references: string[]; failed_reference_updates: string[] };
  const lines = [`renamed '${d.old_key}' → '${d.new_key}'`, `  → ${d.new_path}`];
  if (d.body_references.length > 0) lines.push(`  body references found in: ${d.body_references.join(', ')}`);
  if (d.failed_reference_updates.length > 0) lines.push(`  failed reference updates: ${d.failed_reference_updates.join(', ')}`);
  return lines.join('\n');
}

function renderTreeHuman(data: unknown): string {
  const lines: string[] = [];
  const walk = (node: { key: string; type: string; status: string; children: unknown[]; truncated?: boolean }, indent: string): void => {
    lines.push(`${indent}${node.key} (${node.type}, ${node.status})${node.truncated ? ' [truncated]' : ''}`);
    for (const child of node.children) {
      walk(child as Parameters<typeof walk>[0], indent + '  ');
    }
  };
  walk(data as Parameters<typeof walk>[0], '');
  return lines.join('\n');
}

function renderContextHuman(data: unknown): string {
  const d = data as { key: string; upstream: Array<{ key: string }>; downstream: Array<{ key: string }>; related: Array<{ key: string; depth: number; direction: string }>; code_links_resolved: number; code_links_total: number };
  const lines = [`context of '${d.key}':`];
  if (d.upstream.length > 0) lines.push(`  upstream (${d.upstream.length}): ${d.upstream.map((u) => u.key).join(', ')}`);
  if (d.downstream.length > 0) lines.push(`  downstream (${d.downstream.length}): ${d.downstream.map((u) => u.key).join(', ')}`);
  if (d.related.length > 0) {
    lines.push(`  related (${d.related.length}):`);
    for (const r of d.related) lines.push(`    ${r.key} (depth=${r.depth}, ${r.direction})`);
  }
  lines.push(`  codeLinks: ${d.code_links_resolved}/${d.code_links_total} resolved`);
  return lines.join('\n');
}

function renderRelationsHuman(data: unknown): string {
  const d = data as { key: string; forward: string[]; reverse: string[] };
  const lines = [`relations of '${d.key}':`];
  if (d.forward.length > 0) lines.push(`  forward (${d.forward.length}): ${d.forward.join(', ')}`);
  if (d.reverse.length > 0) lines.push(`  reverse (${d.reverse.length}): ${d.reverse.join(', ')}`);
  if (d.forward.length === 0 && d.reverse.length === 0) lines.push('  (none)');
  return lines.join('\n');
}

export { partial as _partial };
