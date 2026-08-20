/**
 * `ed validate` subcommands: aggregate (no args) / cards / links.
 */

import { Command } from 'commander';
import { run } from '../runner';
import { EXIT, type ExitCode } from '../exit-codes';
import type { CliRuntime } from '../context';
import { validateCards, ensureCardsSynced, detectKeyMismatches } from '../../ops/sync';
import { validateCodeLinks, type BrokenLink } from '../../ops/link';
import { TRACKED_ANNOTATION_TAGS } from '../../ops/spec-sync';
import { CardNotFoundError } from '../../card/errors';
import { errorMessage } from '../../util/error';

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
  code: 'orphan-file' | 'stale-db-row' | 'key-mismatch' | 'card-sync-failed';
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

/** Codes reported in output but excluded from the exit gate (warning-level). §10 Phase 1.2 / 3.2 */
const CARDS_WARNING_CODES = new Set(['glossary-unused', 'principle-violation-warning', 'bidirectional-cross-domain-dep']);

/**
 * Exit code for `ed validate cards`: 2 if any *gating* (non-warning) issue exists, else 0.
 * `glossary-unused` is warning-level — still counted in byCode/output but non-gating
 * (protects the "define glossary term first, reference later" backfill workflow);
 * `glossary-broken` stays an error.
 */
export function cardsExitCode(byCode: Record<string, number>): ExitCode {
  const gating = Object.entries(byCode)
    .filter(([code]) => !CARDS_WARNING_CODES.has(code))
    .reduce((sum, [, n]) => sum + n, 0);
  return gating > 0 ? EXIT.VALIDATION_FAILURE : EXIT.OK;
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
  // A sync failure on a file that is NOT an orphan (it still has an indexed
  // row) is otherwise reported only as a stderr warning — invisible in the
  // structured result, erased by -q, and exit 0. The file and the index have
  // diverged and nothing else names it, so it gates here.
  const unreadablePaths = new Set(
    result.warnings.filter((w) => w.type === 'unreadable-card')
      .map((w) => rt.ctx.cardRepo.findByKey(w.cardKey)?.filePath)
      .filter((p): p is string => Boolean(p)),
  );
  const orphanSet = new Set(result.orphanFiles);
  for (const [filePath, error] of syncFailuresByPath) {
    if (orphanSet.has(filePath)) continue;
    // A file that already surfaced as unreadable is not reported twice — the
    // parse failure is the more specific finding.
    if (unreadablePaths.has(filePath)) continue;
    fileLevelIssues.push({
      code: 'card-sync-failed',
      message: `file could not be synced into the index: ${filePath} — ${error}`,
      filePath,
    });
    bump('card-sync-failed');
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
        ioError: { message: errorMessage(e) },
      });
      ioFailed++;
    }
  }

  // Only spec cards bind to code (@spec — source-as-binding-sot), so only specs
  // have links to validate. TRACKED_ANNOTATION_TAGS is single-sourced from
  // spec-sync (now ['spec']).
  const trackedTypes = new Set<string>(TRACKED_ANNOTATION_TAGS);
  const targets = explicitRow
    ? [explicitRow]
    : rt.ctx.cardRepo.list().filter((c) => trackedTypes.has(c.type) && !mismatchedKeys.has(c.key));

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
      const message = errorMessage(e);
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

export async function validateAggregateAction(_opts: unknown, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const cards = await buildCardsShape(rt);
    const links = await buildLinksShape(rt);
    // Reuse the cards gate (warning-level codes excluded) so `ed validate` and
    // `ed validate cards` agree: a deck with only glossary-unused / warning
    // principle-violations must not fail the aggregate when `cards` passes.
    const cardsFail = cardsExitCode(cards.summary.byCode) !== EXIT.OK;
    const failed = cardsFail || links.summary.broken > 0 || links.summary.ioFailed > 0;
    return { data: { cards, links }, exitCode: failed ? EXIT.VALIDATION_FAILURE : EXIT.OK };
  }, cmd);
}

/** @spec validation/card-integrity/validate-cards */
export async function validateCardsAction(_opts: unknown, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const data = await buildCardsShape(rt);
    return { data, exitCode: cardsExitCode(data.summary.byCode) };
  }, cmd);
}

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
