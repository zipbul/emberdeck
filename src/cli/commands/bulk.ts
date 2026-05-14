/**
 * `ed bulk` subcommands
 */

import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { run } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { bulkCreateCards } from '../../ops/bulk-create';
import { bulkSyncCards, syncCardFromFile } from '../../ops/sync';
import type { CreateCardInput } from '../../ops/create';
import { CARD_TYPES, CARD_STATUSES, type CardType, type CardStatus } from '../../card/types';
import { CliUsageError } from '../usage-error';
import { parseJsonInput } from '../parse-input';
import { errorMessage } from '../../util/error';

function validateBulkInput(items: unknown[]): { ok: CreateCardInput[]; errors: Array<{ index: number; key?: string; message: string }> } {
  const ok: CreateCardInput[] = [];
  const errors: Array<{ index: number; key?: string; message: string }> = [];
  items.forEach((item, i) => {
    const it = item as Partial<CreateCardInput>;
    if (!it || typeof it !== 'object') {
      errors.push({ index: i, message: `item[${i}] not an object` });
      return;
    }
    if (typeof it.key !== 'string' || it.key.length === 0) {
      errors.push({ index: i, message: `item[${i}] missing/invalid 'key'` });
      return;
    }
    if (typeof it.type !== 'string') {
      errors.push({ index: i, key: it.key, message: `item[${i}] '${it.key}' missing 'type'` });
      return;
    }
    if (!CARD_TYPES.includes(it.type as CardType)) {
      errors.push({ index: i, key: it.key, message: `item[${i}] '${it.key}' invalid type '${it.type}' (allowed: ${CARD_TYPES.join('|')})` });
      return;
    }
    if (it.status !== undefined && !CARD_STATUSES.includes(it.status as CardStatus)) {
      errors.push({ index: i, key: it.key, message: `item[${i}] '${it.key}' invalid status '${it.status}' (allowed: ${CARD_STATUSES.join('|')})` });
      return;
    }
    ok.push(it as CreateCardInput);
  });
  return { ok, errors };
}

export function registerBulk(program: Command): void {
  const bulk = program.command('bulk').description('batch operations');

  // ── bulk create ──
  bulk
    .command('create')
    .description('create multiple cards from JSON file')
    .requiredOption('--from <file>', 'JSON file (- for STDIN)')
    .action(async (opts: { from: string }, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const text = opts.from === '-' ? await Bun.stdin.text() : await readFile(opts.from, 'utf-8');
          const parsed = parseJsonInput(text);
          if (!Array.isArray(parsed)) {
            throw new CliUsageError('--from FILE must be an array of card inputs');
          }
          if (parsed.length === 0) {
            throw new CliUsageError('--from input contains zero cards (empty array) — nothing to create');
          }
          // CLI-layer enum validation BEFORE write, mirrors `card create` behavior.
          const validated = validateBulkInput(parsed);
          const result = await bulkCreateCards(rt.ctx, validated.ok);
          // §1.7 bulk-create shape (C4): {created:[], failed:[{input_index,...}], total}
          // Merge pre-write validation failures + op-time errors; sort by input_index.
          const failed: Array<{ input_index: number; key?: string; error: string }> = [
            ...validated.errors.map((e) => ({ input_index: e.index, key: e.key, error: e.message })),
            ...result.errors.map((e) => ({ input_index: e.input_index, key: e.key, error: e.message })),
          ].sort((a, b) => a.input_index - b.input_index);
          const data = {
            created: result.created.map((c) => ({ input_index: c.input_index, key: c.key, filePath: c.filePath })),
            failed,
            total: parsed.length,
            ...(result.partialKeys.length > 0 ? { partial_keys: result.partialKeys } : {}),
          };
          // partialIsFailure routes any failed entry to exit 2.
          const errors: CliMessage[] = failed.map((f) => ({
            code: 'BULK_CREATE_FAILED',
            message: f.error,
            ...(f.key ? { key: f.key } : {}),
          }));
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        cmd,
        {
          // bulk create with any failure → exit 2 (CI gate signal). Pure success → exit 0.
          partialIsFailure: true,
        },
      );
    });

  // ── bulk sync ──
  bulk
    .command('sync [path]')
    .description('sync card files (directory recursive or single file) → DB')
    .action(async (path: string | undefined, _opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          if (path) {
            let s;
            try {
              s = await stat(path);
            } catch {
              throw new CliUsageError(`path not found: ${path}`);
            }
            if (s.isFile()) {
              await syncCardFromFile(rt.ctx, path);
              // §1.7 bulk-sync shape (C4): always include `failed:[]` even in file mode.
              return ok({ synced: 1, mode: 'file', path, failed: [] });
            }
          }
          const result = await bulkSyncCards(rt.ctx, path);
          const failed = result.errors.map((e) => ({ filePath: e.filePath, error: errorMessage(e.error) }));
          const errors: CliMessage[] = result.errors.map((e) => ({
            code: 'SYNC_FAILED',
            message: errorMessage(e.error),
            details: { file_path: e.filePath },
          }));
          const data = {
            synced: result.synced,
            mode: 'directory' as const,
            path: path ?? rt.ctx.cardsDir,
            failed,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        cmd,
        {
          partialIsFailure: true,
          
        },
      );
    });
}
