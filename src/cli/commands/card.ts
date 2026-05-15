/**
 * `ed card` subcommands (12 commands).
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run } from '../runner';
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
import { serializeCard } from '../../card/serialize';
import { findCardsBySymbol } from '../../ops/link';
import { findCardsByGlossaryWord } from '../../ops/glossary';
import { parsePositiveInt, collectCsv, collectRepeated } from '../parsers';
import { confirmDestructive } from '../confirm';
import { CliUsageError } from '../usage-error';
import { atomicWrite } from '../../fs/writer';
import { parseJsonInput } from '../parse-input';

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
  if (value === '-') return await Bun.stdin.text();
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
    case 'summary': fields.summary = value; return;
    case 'status': fields.status = validateCardStatus(value); return;
    case 'parent': fields.parent = value === '' ? null : value; return;
    case 'type': fields.type = validateCardType(value); return;
    default:
      throw new CliUsageError(`unsupported --field name: ${name} (allowed: summary, status, parent, type)`);
  }
}

function rowToSummary(row: {
  key: string; summary: string; type: string; status: string; parent: string | null;
}): { key: string; summary: string; type: string; status: string; parent: string | null } {
  return { key: row.key, summary: row.summary, type: row.type, status: row.status, parent: row.parent };
}

// ── actions ──

/** @spec cli-surface/command-routing-and-output/commands/card-get */
export async function cardGetAction(
  key: string,
  opts: { history?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await getCard(rt.ctx, key, { includeHistory: !!opts.history });
    const fm = result.card.frontmatter;
    const row = rt.ctx.cardRepo.findByKey(fm.key);
    const data: Record<string, unknown> = {
      key: fm.key,
      summary: fm.summary,
      status: fm.status,
      type: fm.type,
      parent: fm.parent ?? null,
      glossary: fm.glossary ?? [],
    };
    if (fm.relations) data.relations = fm.relations;
    if (fm.tags) data.tags = fm.tags;
    if (fm.principle) data.principle = fm.principle;
    if (fm.domain) data.domain = fm.domain;
    if (fm.brief) data.brief = fm.brief;
    if (fm.spec) data.spec = fm.spec;
    if (result.card.filePath) data.filePath = result.card.filePath;
    if (row?.updatedAt) data.updatedAt = row.updatedAt;
    if (result.history) {
      data.history = {
        entries: result.history.map((h) => ({
          field: h.field,
          oldValue: h.oldValue,
          newValue: h.newValue,
          changedAt: h.changedAt,
          changedBy: h.changedBy,
        })),
      };
    }
    return { data };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-list */
export async function cardListAction(
  opts: {
    type?: string; status?: string; parent?: string; tag?: string; symbol?: string;
    file?: string; glossary?: string; limit?: number; offset?: number;
  },
  cmd: Command,
): Promise<void> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  await run(async (rt: CliRuntime) => {
    if (opts.file && !opts.symbol) throw new CliUsageError('--file requires --symbol');
    if (opts.symbol && opts.glossary) {
      throw new CliUsageError('--symbol and --glossary are mutually exclusive');
    }
    if ((opts.symbol || opts.glossary) && opts.tag) {
      throw new CliUsageError('--tag cannot be combined with --symbol/--glossary');
    }
    if (opts.type) validateCardType(opts.type);
    if (opts.status) validateCardStatus(opts.status);

    let rows: Array<{ key: string; type: string; status: string; summary: string; parent: string | null }>;
    if (opts.symbol) {
      const matches = await findCardsBySymbol(rt.ctx, opts.symbol, opts.file);
      rows = matches
        .map((m) => rowToSummary(m.card))
        .filter((r) => !opts.type || r.type === opts.type)
        .filter((r) => !opts.status || r.status === opts.status)
        .filter((r) => !opts.parent || r.parent === opts.parent);
    } else if (opts.glossary) {
      const matches = findCardsByGlossaryWord(rt.ctx, opts.glossary);
      rows = matches
        .map((m) => {
          const row = rt.ctx.cardRepo.findByKey(m.key);
          return {
            key: m.key,
            type: row?.type ?? '',
            status: row?.status ?? '',
            summary: m.summary,
            parent: row?.parent ?? null,
          };
        })
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
      rows = all.map(rowToSummary);
    }
    const total = rows.length;
    const items = rows.slice(offset, offset + limit);
    return {
      data: {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-create */
export async function cardCreateAction(
  key: string,
  opts: {
    type: string; summary?: string; from?: string; status?: string; parent?: string;
    glossary?: string[]; tag?: string[];
  },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
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
      const parsedRaw = await parseJsonInput(text);
      if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
        throw new CliUsageError('--from must be a JSON object (got non-object root)');
      }
      const parsed = parsedRaw as Partial<CreateCardInput>;
      const summary = opts.summary ?? parsed.summary ?? '';
      input = {
        ...parsed,
        key,
        type: validatedType,
        summary,
        ...(validatedStatus ? { status: validatedStatus } : (parsed.status ? { status: parsed.status } : {})),
        ...(opts.parent ? { parent: opts.parent } : (parsed.parent ? { parent: parsed.parent } : {})),
        ...(opts.glossary && opts.glossary.length > 0
          ? { glossary: opts.glossary }
          : (parsed.glossary ? { glossary: parsed.glossary } : {})),
        ...(opts.tag && opts.tag.length > 0
          ? { tags: opts.tag }
          : (parsed.tags ? { tags: parsed.tags } : {})),
      };
    }
    if (!input.summary) {
      throw new CliUsageError('--summary or --from with summary field required');
    }
    const result = await createCard(rt.ctx, input);
    return {
      data: {
        key: result.fullKey,
        filePath: result.filePath,
        status: result.card.frontmatter.status,
        type: result.card.frontmatter.type,
        parent: result.card.frontmatter.parent ?? null,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-update */
export async function cardUpdateAction(
  key: string,
  opts: { patch?: string; field?: string[]; summary?: string; glossary?: string[]; tag?: string[] },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const fields: UpdateCardFields = {};
    if (opts.patch) {
      const text = await readBodyFromOption(opts.patch);
      if (!text) throw new CliUsageError('--patch produced empty input');
      const parsedRaw = await parseJsonInput(text);
      if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
        throw new CliUsageError('--patch must be a JSON object (got non-object root)');
      }
      const allowed = new Set<keyof UpdateCardFields>([
        'summary', 'type', 'status', 'parent', 'tags', 'relations', 'glossary',
        'principle', 'domain', 'brief', 'spec',
      ]);
      const unknown = Object.keys(parsedRaw as object).filter((k) => !allowed.has(k as keyof UpdateCardFields));
      if (unknown.length > 0) {
        throw new CliUsageError(
          `--patch root keys must be UpdateCardFields names (${[...allowed].join('/')}). Got unknown keys: ${unknown.join(', ')}.`,
        );
      }
      Object.assign(fields, parsedRaw as UpdateCardFields);
    }
    const fieldMap = parseFields(opts.field);
    if (opts.summary) fieldMap.summary = opts.summary;
    for (const [name, value] of Object.entries(fieldMap)) applyFieldValue(fields, name, value);
    if (opts.glossary && opts.glossary.length > 0) fields.glossary = opts.glossary;
    if (opts.tag && opts.tag.length > 0) fields.tags = opts.tag;
    if (Object.keys(fields).length === 0) {
      throw new CliUsageError('card update: no changes specified — pass --field/--summary/--patch/--glossary/--tag');
    }
    const result = await updateCard(rt.ctx, key, fields);
    return {
      data: {
        key: result.card.frontmatter.key,
        filePath: result.filePath,
        status: result.card.frontmatter.status,
        validationNotes: result.warnings ?? [],
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-delete */
export async function cardDeleteAction(
  key: string,
  opts: { force?: boolean; yes?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    await confirmDestructive({
      yes: !!opts.yes,
      opName: 'card delete',
      prompt: `card delete will REMOVE card '${key}' (file + index entry)${opts.force ? ' and detach all children' : ''}. Type "yes" to proceed: `,
    });
    const result = await deleteCard(rt.ctx, key, { force: opts.force });
    return {
      data: {
        key,
        filePath: result.filePath,
        detachedChildren: result.detachedChildren,
        removedCrossDomainRefs: result.removedCrossDomainRefs,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-rename */
export async function cardRenameAction(
  oldKey: string,
  newKey: string,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await renameCard(rt.ctx, oldKey, newKey);
    const failed = result.failedReferenceUpdates ?? [];
    const data = {
      oldKey,
      newKey: result.newFullKey,
      oldPath: result.oldFilePath,
      newPath: result.newFilePath,
      failedReferenceUpdates: failed,
    };
    return { data, exitCode: failed.length > 0 ? 2 : 0 };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-search */
export async function cardSearchAction(
  query: string,
  opts: { type?: string; status?: string; limit?: number; offset?: number },
  cmd: Command,
): Promise<void> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  await run(async (rt: CliRuntime) => {
    if (opts.type) validateCardType(opts.type);
    if (opts.status) validateCardStatus(opts.status);
    const all = searchCards(rt.ctx, query, {
      type: opts.type as CardType | undefined,
      status: opts.status as CardStatus | undefined,
    });
    const total = all.length;
    const items = all.slice(offset, offset + limit).map((row) => ({
      key: row.key,
      summary: row.summary,
      type: row.type,
      status: row.status,
      parent: row.parent,
      snippet: row.snippet,
      rank: row.rank,
    }));
    return { data: { items, total } };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-export */
export async function cardExportAction(
  key: string,
  opts: { out?: string; inPlace?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    if (opts.inPlace) {
      const { filePath, bytes } = await exportCardToFile(rt.ctx, key);
      return { data: { key, mode: 'in-place' as const, filePath, bytes } };
    }
    const cardFile = buildCardFromDb(rt.ctx, key);
    const content = serializeCard(cardFile.frontmatter);
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (opts.out && opts.out !== '-') {
      await atomicWrite(opts.out, content);
      return { data: { key, mode: 'file' as const, filePath: opts.out, bytes } };
    }
    return { data: { key, mode: 'stdout' as const, bytes, content } };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-set-status */
export async function cardSetStatusAction(
  key: string,
  status: string,
  opts: { reason?: string; reasonFrom?: string },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const validatedStatus = validateCardStatus(status);
    let reason = opts.reason;
    if (opts.reasonFrom) reason = await readBodyFromOption(opts.reasonFrom);
    const result = await updateCardStatus(rt.ctx, key, validatedStatus, reason);
    return {
      data: {
        key: result.card.frontmatter.key,
        oldStatus: result.oldStatus,
        newStatus: result.card.frontmatter.status,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-tree */
export async function cardTreeAction(
  key: string,
  opts: { depth?: number },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const tree = getCardTree(rt.ctx, key, opts.depth);
    return { data: tree };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-context */
export async function cardContextAction(
  key: string,
  opts: { depth?: number },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const ctxResult = await getCardContext(rt.ctx, key, { depth: opts.depth ?? 1 });
    const fm = ctxResult.card.frontmatter;
    const data: Record<string, unknown> = {
      key: fm.key,
      summary: fm.summary,
      status: fm.status,
      type: fm.type,
      parent: fm.parent ?? null,
      glossary: fm.glossary ?? [],
    };
    if (fm.relations) data.relations = fm.relations;
    if (fm.tags) data.tags = fm.tags;
    if (fm.principle) data.principle = fm.principle;
    if (fm.domain) data.domain = fm.domain;
    if (fm.brief) data.brief = fm.brief;
    if (fm.spec) data.spec = fm.spec;
    data.upstream = ctxResult.upstreamCards.map((c) => rowToSummary(c));
    data.downstream = ctxResult.downstreamCards.map((c) => rowToSummary(c));
    data.parentChain = ctxResult.parentChain.map((c) => rowToSummary(c));
    if (ctxResult.related) {
      data.related = ctxResult.related.map((r) => ({
        card: rowToSummary(r.card),
        depth: r.depth,
        direction: r.direction,
      }));
    }
    if (ctxResult.truncated) data.truncated = true;
    data.codeLinks = {
      resolved: ctxResult.codeLinks.filter((cl) => cl.symbol).length,
      total: ctxResult.codeLinks.length,
    };
    return { data };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/card-relations */
export async function cardRelationsAction(
  key: string,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const relations = listCardRelations(rt.ctx, key);
    return {
      data: {
        key,
        forward: relations.forward,
        reverse: relations.reverse,
        total: relations.forward.length + relations.reverse.length,
      },
    };
  }, cmd);
}

// ── register ──

export function registerCard(program: Command): void {
  const card = program.command('card').description('card-level operations');

  card.command('get <key>').description('read a card from file')
    .option('--history', 'include changelog history')
    .action(cardGetAction);

  card.command('list').description('list cards')
    .option('--type <type>', 'filter by type (principle|domain|brief|spec)')
    .option('--status <status>', 'filter by status (draft|active|drifted)')
    .option('--parent <key>', 'filter by parent card key')
    .option('--tag <tag>', 'filter by tag')
    .option('--symbol <name>', 'cards bound to this code symbol')
    .option('--file <path>', 'when used with --symbol, restrict to symbols in this file')
    .option('--glossary <word>', 'cards declaring this glossary word')
    .option('--limit <n>', 'page size (default 50)', parsePositiveInt('--limit'))
    .option('--offset <n>', 'page offset (default 0)', parsePositiveInt('--offset'))
    .action(cardListAction);

  card.command('create <key>').description('create a new card')
    .requiredOption('--type <type>', 'card type (principle|domain|brief|spec)')
    .option('--summary <s>', 'one-line summary')
    .option('--from <file>', 'read frontmatter from JSON file (- for STDIN)')
    .option('--status <status>', 'initial status (default: draft)')
    .option('--parent <key>', 'parent card key')
    .option('--glossary <words>', 'comma-separated glossary words (or repeat flag)', collectCsv, [] as string[])
    .option('--tag <name>', 'tag (repeatable)', collectRepeated, [] as string[])
    .action(cardCreateAction);

  card.command('update <key>').description('update a card')
    .option('--patch <file>', 'apply patches from JSON file (- for STDIN)')
    .option('--field <name=value>', 'set frontmatter field (repeatable)', collectRepeated, [] as string[])
    .option('--summary <s>', 'shortcut for --field summary=<s>')
    .option('--glossary <words>', 'set glossary words (comma-separated or repeated)', collectCsv, [] as string[])
    .option('--tag <name>', 'set tag (repeatable; replaces existing tags)', collectRepeated, [] as string[])
    .action(cardUpdateAction);

  card.command('delete <key>').description('delete a card and its file')
    .option('--force', 'delete even when children exist (children are detached, not deleted)')
    .option('--yes', 'skip confirmation prompt (required for non-TTY invocation)')
    .action(cardDeleteAction);

  card.command('rename <oldKey> <newKey>').description('rename a card key')
    .action(cardRenameAction);

  card.command('search <query>').description('full-text search')
    .option('--type <type>', 'filter by card type')
    .option('--status <status>', 'filter by status')
    .option('--limit <n>', 'page size (default 50)', parsePositiveInt('--limit'))
    .option('--offset <n>', 'page offset (default 0)', parsePositiveInt('--offset'))
    .action(cardSearchAction);

  card.command('export <key>').description('render the canonical card content')
    .option('--out <file>', 'write to FILE (use - for STDOUT, default)')
    .option('--in-place', `rewrite the card's original file`)
    .action(cardExportAction);

  card.command('set-status <key> <status>').description('change card status (draft|active|drifted)')
    .option('--reason <text>', 'reason recorded in changelog')
    .option('--reason-from <file|->', 'read reason from file or STDIN')
    .action(cardSetStatusAction);

  card.command('tree <key>').description('parent-child hierarchy starting from KEY')
    .option('--depth <n>', 'max depth (default 10, capped at 20)', parsePositiveInt('--depth'))
    .action(cardTreeAction);

  card.command('context <key>').description('show related cards (parent chain + relations)')
    .option('--depth <n>', 'how many relation hops to traverse (default 1)', parsePositiveInt('--depth'))
    .action(cardContextAction);

  card.command('relations <key>').description('list direct relations (forward + reverse)')
    .action(cardRelationsAction);
}
