/**
 * `ed validate` subcommands: aggregate (no args) / cards / links.
 */

import { Command } from 'commander';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { validateCards, ensureCardsSynced, detectKeyMismatches } from '../../ops/sync';
import { validateCodeLinks, type BrokenLink } from '../../ops/link';
import { CardNotFoundError } from '../../card/errors';

// ── shape helpers ──

interface CardIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface CardsItem {
  key: string;
  filePath?: string;
  issues: CardIssue[];
}

interface FileLevelIssue {
  code: 'orphan-file' | 'stale-db-row' | 'key-mismatch';
  message: string;
  filePath: string;
  key?: string;
}

interface ValidateCardsShape {
  summary: { total: number; byCode: Record<string, number> };
  items: CardsItem[];
  fileLevelIssues: FileLevelIssue[];
}

interface LinkBrokenEntry {
  file: string;
  symbol: string;
  reason: BrokenLink['reason'];
}

interface LinksItem {
  key: string;
  declared: number;
  resolved: number;
  brokenLinks?: LinkBrokenEntry[];
  plannedLinks?: LinkBrokenEntry[];
  skipped?: { reason: 'key-mismatch' };
  ioError?: { message: string };
}

interface ValidateLinksShape {
  summary: {
    total: number;
    ok: number;
    broken: number;
    /** Draft-card links that didn't resolve. Reported but never gates exit code (draft = intentionally incomplete). */
    planned: number;
    skipped: number;
    ioFailed: number;
  };
  items: LinksItem[];
}

async function buildCardsShape(rt: CliRuntime): Promise<ValidateCardsShape> {
  const result = await validateCards(rt.ctx);
  const itemsByKey = new Map<string, CardsItem>();
  const byCode: Record<string, number> = {};

  const bump = (code: string): void => {
    byCode[code] = (byCode[code] ?? 0) + 1;
  };

  for (const w of result.warnings) {
    const key = w.cardKey;
    if (!itemsByKey.has(key)) {
      const row = rt.ctx.cardRepo.findByKey(key);
      itemsByKey.set(key, { key, ...(row?.filePath ? { filePath: row.filePath } : {}), issues: [] });
    }
    itemsByKey.get(key)!.issues.push({ code: w.type, message: w.message });
    bump(w.type);
  }

  const fileLevelIssues: FileLevelIssue[] = [];
  for (const stale of result.staleDbRows) {
    fileLevelIssues.push({
      code: 'stale-db-row',
      message: `indexed card has no file: ${stale.filePath}`,
      filePath: stale.filePath,
      key: stale.key,
    });
    bump('stale-db-row');
  }
  const syncFailuresByPath = new Map(
    (await ensureCardsSynced(rt.ctx)).map((f) => [f.filePath, f.error]),
  );
  for (const orphan of result.orphanFiles) {
    const syncErr = syncFailuresByPath.get(orphan);
    fileLevelIssues.push({
      code: 'orphan-file',
      message: syncErr
        ? `file has no indexed card: ${orphan} — sync failed: ${syncErr}`
        : `file has no indexed card: ${orphan}`,
      filePath: orphan,
    });
    bump('orphan-file');
  }
  for (const km of result.keyMismatches) {
    fileLevelIssues.push({
      code: 'key-mismatch',
      message: `card key '${km.row.key}' does not match path-derived '${km.expectedKey}'`,
      filePath: km.row.filePath,
      key: km.row.key,
    });
    bump('key-mismatch');
  }

  const total = Object.values(byCode).reduce((a, b) => a + b, 0);
  return {
    summary: { total, byCode },
    items: [...itemsByKey.values()],
    fileLevelIssues,
  };
}

async function buildLinksShape(rt: CliRuntime, key?: string): Promise<ValidateLinksShape> {
  const items: LinksItem[] = [];
  let total = 0;
  let okCount = 0;
  let broken = 0;
  let planned = 0;
  let skipped = 0;
  let ioFailed = 0;

  let explicitRow: ReturnType<typeof rt.ctx.cardRepo.findByKey> = null;
  if (key) {
    explicitRow = rt.ctx.cardRepo.findByKey(key);
    if (!explicitRow) throw new CardNotFoundError(key);
  }

  const mismatchedKeys = new Set<string>();
  if (!key) {
    try {
      for (const km of detectKeyMismatches(rt.ctx)) {
        mismatchedKeys.add(km.row.key);
        items.push({
          key: km.row.key,
          declared: 0,
          resolved: 0,
          skipped: { reason: 'key-mismatch' },
        });
        skipped++;
      }
    } catch (e) {
      items.push({
        key: '__internal__',
        declared: 0,
        resolved: 0,
        ioError: { message: e instanceof Error ? e.message : String(e) },
      });
      ioFailed++;
    }
  }

  // spec-sync tracks @spec/@brief/@principle/@domain annotations into the
  // code_link cache (all 4 tiers can carry source bindings). validate-links
  // must check every type, not just spec, or non-spec bindings rot silently.
  const TRACKED_LINK_TYPES = new Set(['spec', 'brief', 'principle', 'domain']);
  const targets = explicitRow
    ? [explicitRow]
    : rt.ctx.cardRepo.list().filter((c) => TRACKED_LINK_TYPES.has(c.type) && !mismatchedKeys.has(c.key));

  for (const t of targets) {
    try {
      const r = await validateCodeLinks(rt.ctx, t.key);
      total += r.declared;
      okCount += r.valid;
      broken += r.broken.length;
      planned += r.planned.length;
      const item: LinksItem = {
        key: t.key,
        declared: r.declared,
        resolved: r.valid,
      };
      if (r.broken.length > 0) {
        item.brokenLinks = r.broken.map((b) => ({
          file: b.link.file,
          symbol: b.link.symbol,
          reason: b.reason,
        }));
      }
      if (r.planned.length > 0) {
        item.plannedLinks = r.planned.map((b) => ({
          file: b.link.file,
          symbol: b.link.symbol,
          reason: b.reason,
        }));
      }
      items.push(item);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      items.push({
        key: t.key,
        declared: 0,
        resolved: 0,
        ioError: { message },
      });
      ioFailed++;
    }
  }

  return {
    summary: { total, ok: okCount, broken, planned, skipped, ioFailed },
    items,
  };
}

/** @spec cli-surface/command-routing-and-output/commands/validate-aggregate */
export async function validateAggregateAction(_opts: unknown, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const cards = await buildCardsShape(rt);
    const links = await buildLinksShape(rt);
    const failed = cards.summary.total > 0 || links.summary.broken > 0 || links.summary.ioFailed > 0;
    return { data: { cards, links }, exitCode: failed ? 2 : 0 };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/validate-cards */
export async function validateCardsAction(_opts: unknown, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const data = await buildCardsShape(rt);
    return { data, exitCode: data.summary.total > 0 ? 2 : 0 };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/validate-links */
export async function validateLinksAction(
  key: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const data = await buildLinksShape(rt, key);
    const failed = data.summary.broken > 0 || data.summary.ioFailed > 0;
    return { data, exitCode: failed ? 2 : 0 };
  }, cmd);
}

export function registerValidate(program: Command): void {
  const validate = program.command('validate').description('integrity gates');

  validate.action(validateAggregateAction);

  validate
    .command('links [key]')
    .description('check that every codeLink points to a real source symbol (one card or all)')
    .action(validateLinksAction);

  validate
    .command('cards')
    .description('check card integrity: file consistency, hierarchy, glossary references, brief→spec chains')
    .action(validateCardsAction);
}
