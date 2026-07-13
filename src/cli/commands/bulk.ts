/**
 * `ed bulk` subcommands
 */

import { Command } from 'commander';
import { stat, readFile } from 'node:fs/promises';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { bulkCreateCards } from '../../ops/bulk-create';
import { bulkSyncCards, syncCardFromFile } from '../../ops/sync';
import type { CreateCardInput } from '../../ops/create';
import { CARD_TYPES, CARD_STATUSES, isCardType, isCardStatus } from '../../card/types';
import { CliUsageError } from '../usage-error';
import { parseJsonInput } from '../parse-input';
import { errorMessage } from '../../util/error';

interface ValidatedBulk {
  ok: Array<{ originalIndex: number; input: CreateCardInput }>;
  rejected: Array<{ inputIndex: number; key?: string; error: string }>;
}

function validateBulkInput(items: unknown[]): ValidatedBulk {
  const out: ValidatedBulk = { ok: [], rejected: [] };
  items.forEach((item, i) => {
    const it = item as Partial<CreateCardInput>;
    if (!it || typeof it !== 'object') {
      out.rejected.push({ inputIndex: i, error: `item[${i}] not an object` });
      return;
    }
    if (typeof it.key !== 'string' || it.key.length === 0) {
      out.rejected.push({ inputIndex: i, error: `item[${i}] missing/invalid 'key'` });
      return;
    }
    if (typeof it.type !== 'string') {
      out.rejected.push({ inputIndex: i, key: it.key, error: `item[${i}] '${it.key}' missing 'type'` });
      return;
    }
    if (!isCardType(it.type)) {
      out.rejected.push({
        inputIndex: i,
        key: it.key,
        error: `item[${i}] '${it.key}' invalid type '${it.type}' (allowed: ${CARD_TYPES.join('|')})`,
      });
      return;
    }
    if (it.status !== undefined && !isCardStatus(it.status)) {
      out.rejected.push({
        inputIndex: i,
        key: it.key,
        error: `item[${i}] '${it.key}' invalid status '${it.status}' (allowed: ${CARD_STATUSES.join('|')})`,
      });
      return;
    }
    out.ok.push({ originalIndex: i, input: it as CreateCardInput });
  });
  return out;
}

export async function bulkCreateAction(opts: { from: string }, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const text = opts.from === '-' ? await Bun.stdin.text() : await readFile(opts.from, 'utf-8');
    const parsed = parseJsonInput(text);
    if (!Array.isArray(parsed)) throw new CliUsageError('--from FILE must be an array of card inputs');
    if (parsed.length === 0) {
      throw new CliUsageError('--from input contains zero cards (empty array) — nothing to create');
    }

    const validated = validateBulkInput(parsed);

    // Run op only on accepted entries; remap op's `inputIndex` (position within
    // the accepted slice) back to the original input position so output is stable.
    const opResult = await bulkCreateCards(rt.ctx, validated.ok.map((o) => o.input));
    const opIndexToOriginal = new Map<number, number>();
    validated.ok.forEach((o, i) => opIndexToOriginal.set(i, o.originalIndex));

    const created = opResult.created.map((c) => ({
      inputIndex: opIndexToOriginal.get(c.inputIndex) ?? c.inputIndex,
      key: c.key,
      filePath: c.filePath,
    }));
    const opErrors = opResult.errors.map((e) => ({
      inputIndex: opIndexToOriginal.get(e.inputIndex) ?? e.inputIndex,
      ...(e.key !== undefined ? { key: e.key } : {}),
      error: e.message,
    }));
    const failed = [...validated.rejected, ...opErrors].sort((a, b) => a.inputIndex - b.inputIndex);

    const data = {
      created,
      failed,
      partialKeys: opResult.partialKeys,
      total: parsed.length,
    };
    return { data, exitCode: failed.length > 0 ? 2 : 0 };
  }, cmd);
}

export async function bulkSyncAction(
  path: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    if (path) {
      let s;
      try {
        s = await stat(path);
      } catch {
        throw new CliUsageError(`path not found: ${path}`);
      }
      if (s.isFile()) {
        await syncCardFromFile(rt.ctx, path);
        return {
          data: { synced: 1, mode: 'file' as const, path, failed: [] as Array<{ filePath: string; error: string }> },
        };
      }
    }
    const result = await bulkSyncCards(rt.ctx, path);
    const failed = result.errors.map((e) => ({
      filePath: e.filePath,
      error: errorMessage(e.error),
    }));
    const data = {
      synced: result.synced,
      mode: 'directory' as const,
      path: path ?? rt.ctx.cardsDir,
      failed,
    };
    return { data, exitCode: failed.length > 0 ? 2 : 0 };
  }, cmd);
}

export function registerBulk(program: Command): void {
  const bulk = program.command('bulk').description('batch operations');

  bulk
    .command('create')
    .description('create multiple cards from JSON file')
    .requiredOption('--from <file>', 'JSON file (- for STDIN)')
    .action(bulkCreateAction);

  bulk
    .command('sync [path]')
    .description('sync card files (directory recursive or single file) → DB')
    .action(bulkSyncAction);
}
