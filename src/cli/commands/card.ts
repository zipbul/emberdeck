/**
 * `ed card` subcommands. Phase 1 implements: get, list, create, update.
 * Other card subcommands (delete, rename, search, export, set-status, tree, context, relations)
 * land in Phase 2.
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import type { CardType, CardStatus } from '../../card/types';
import { getCard } from '../../ops/query';
import { createCard, type CreateCardInput } from '../../ops/create';
import { updateCard, type UpdateCardFields } from '../../ops/update';
import { listCards } from '../../ops/query';
import { findCardsBySymbol } from '../../ops/link';
import { findCardsByGlossaryWord } from '../../ops/glossary';

async function readBodyFromOption(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (value === '-') {
    const stdin = Bun.stdin;
    return await stdin.text();
  }
  return await readFile(value, 'utf-8');
}

function parseFields(fieldFlags: string[] | undefined): Record<string, string> {
  if (!fieldFlags || fieldFlags.length === 0) return {};
  const out: Record<string, string> = {};
  for (const f of fieldFlags) {
    const idx = f.indexOf('=');
    if (idx <= 0) throw new Error(`--field expects NAME=VALUE, got: ${f}`);
    out[f.slice(0, idx)] = f.slice(idx + 1);
  }
  return out;
}

export function registerCard(program: Command): void {
  const card = program.command('card').description('card-level operations');

  // ── card get ──
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
        { humanRenderer: (data) => renderCardHuman(data) },
      );
    });

  // ── card list ──
  card
    .command('list')
    .description('list cards (filterable). --symbol/--glossary subsume find_cards_by_symbol / find_cards_by_glossary_word')
    .option('--type <type>', 'filter by type (principle|brief|spec)')
    .option('--status <status>', 'filter by status (draft|active|drifted|retired)')
    .option('--parent <key>', 'filter by parent card key')
    .option('--tag <tag>', 'filter by tag')
    .option('--symbol <name>', 'cards bound to this code symbol (via codeLinks or boundary)')
    .option('--file <path>', 'when used with --symbol, restrict to symbols in this file')
    .option('--glossary <word>', 'cards declaring this glossary word')
    .option('--limit <n>', 'page size (default 50)', (v) => parseInt(v, 10))
    .option('--offset <n>', 'page offset (default 0)', (v) => parseInt(v, 10))
    .action(async (opts: { type?: string; status?: string; parent?: string; tag?: string; symbol?: string; file?: string; glossary?: string; limit?: number; offset?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      await run(
        async (rt: CliRuntime) => {
          if (opts.file && !opts.symbol) {
            throw new Error('--file requires --symbol');
          }
          let rows: Array<{ key: string; type: string; status: string; summary: string; parent: string | null }>;

          if (opts.symbol) {
            // Discover via codeLinks/boundary; then apply other filters in-memory.
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
            // matches only have key+summary; enrich via DB query for type/status
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
        { humanRenderer: (data) => renderListHuman(data) },
      );
    });

  // ── card create ──
  card
    .command('create <key>')
    .description('create a new card')
    .requiredOption('--type <type>', 'card type (principle|brief|spec)')
    .option('--summary <s>', 'one-line summary')
    .option('--from <file>', 'read frontmatter+body from YAML/JSON file (- for STDIN)')
    .option('--status <status>', 'initial status (default: draft)')
    .action(async (key: string, opts: { type: string; summary?: string; from?: string; status?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          let input: CreateCardInput = {
            key,
            type: opts.type as CardType,
            summary: opts.summary ?? '',
            ...(opts.status ? { status: opts.status as CardStatus } : {}),
          };
          if (opts.from) {
            const text = await readBodyFromOption(opts.from);
            if (!text) throw new Error('--from produced empty input');
            const parsed = (await parseInputFile(text)) as Partial<CreateCardInput>;
            const summary = opts.summary ?? parsed.summary ?? '';
            input = { ...parsed, key, type: opts.type as CardType, summary };
          }
          if (!input.summary) {
            throw new Error('--summary or --from with summary field required');
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
        { humanRenderer: (data) => renderCreatedHuman(data) },
      );
    });

  // ── card update ──
  card
    .command('update <key>')
    .description('update a card')
    .option('--patch <file>', 'apply patches from JSON file (- for STDIN)')
    .option('--field <name=value>', 'set frontmatter field (repeatable)', (val: string, prev: string[] = []) => [...prev, val], [] as string[])
    .option('--summary <s>', 'shortcut for --field summary=<s>')
    .option('--body <file>', 'replace body from file (- for STDIN)')
    .action(async (key: string, opts: { patch?: string; field?: string[]; summary?: string; body?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const fields: UpdateCardFields = {};

          if (opts.patch) {
            const text = await readBodyFromOption(opts.patch);
            if (!text) throw new Error('--patch produced empty input');
            const parsed = (await parseInputFile(text)) as UpdateCardFields;
            Object.assign(fields, parsed);
          }

          const fieldMap = parseFields(opts.field);
          if (opts.summary) fieldMap.summary = opts.summary;
          for (const [name, value] of Object.entries(fieldMap)) {
            applyFieldValue(fields, name, value);
          }

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
        { humanRenderer: (data) => renderUpdatedHuman(data) },
      );
    });
}

function applyFieldValue(fields: UpdateCardFields, name: string, value: string): void {
  switch (name) {
    case 'summary':
      fields.summary = value;
      return;
    case 'status':
      fields.status = value as UpdateCardFields['status'];
      return;
    case 'parent':
      fields.parent = value === '' ? null : value;
      return;
    case 'type':
      fields.type = value as UpdateCardFields['type'];
      return;
    default:
      throw new Error(`unsupported --field name: ${name} (allowed: summary, status, parent, type)`);
  }
}

async function parseInputFile(text: string): Promise<unknown> {
  const trimmed = text.trim();
  // try JSON first if starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to YAML
    }
  }
  return Bun.YAML.parse(text);
}

// ── human renderers ──

function renderCardHuman(data: unknown): string {
  const card = data as { key: string; type: string; status: string; summary: string; body?: string; frontmatter?: unknown };
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

// avoid unused export warnings — partial is reserved for future bulk subcommands here
export { partial as _partial };
