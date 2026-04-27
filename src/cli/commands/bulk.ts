/**
 * `ed bulk` subcommands per CLI_PLAN §4.6.
 */

import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { bulkCreateCards } from '../../ops/bulk-create';
import { bulkSyncCards, syncCardFromFile } from '../../ops/sync';
import type { CreateCardInput } from '../../ops/create';
import { CARD_TYPES, CARD_STATUSES, type CardType, type CardStatus } from '../../card/types';
import { startSpinner } from '../spinner';

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

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

export function registerBulk(program: Command): void {
  const bulk = program.command('bulk').description('batch operations');

  // ── bulk create ──
  bulk
    .command('create')
    .description('create multiple cards from YAML/JSON file')
    .requiredOption('--from <file>', 'YAML/JSON file (- for STDIN)')
    .action(async (opts: { from: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const text = opts.from === '-' ? await readStdin() : await readFile(opts.from, 'utf-8');
          const trimmed = text.trim();
          let parsed: unknown;
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = Bun.YAML.parse(text);
            }
          } else {
            parsed = Bun.YAML.parse(text);
          }
          if (!Array.isArray(parsed)) {
            throw new Error('--from FILE must be an array of card inputs');
          }
          // CLI-layer enum validation BEFORE write, mirrors `card create` behavior.
          const validated = validateBulkInput(parsed);
          const spinner = startSpinner(rt.output, `creating ${validated.ok.length} cards...`, { verbose: rt.verbose });
          let result;
          try {
            result = await bulkCreateCards(rt.ctx, validated.ok);
          } finally {
            spinner.stop();
          }
          const errors: CliMessage[] = [
            ...validated.errors.map((e) => ({ code: 'BULK_VALIDATION_FAILED', message: e.message, key: e.key })),
            ...result.errors.map((e) => ({ code: 'BULK_CREATE_FAILED', message: e.message, key: e.key })),
          ];
          const data = {
            succeeded: result.keys,
            partial_keys: result.partialKeys,
            total: parsed.length,
            created: result.created,
            failed: result.failed + validated.errors.length,
            rejected_pre_write: validated.errors.length,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        {
          // bulk create with any failure → exit 2 (CI gate signal). Pure success → exit 0.
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { created: number; failed: number; total: number };
            return `bulk create: ${d.created}/${d.total} created, ${d.failed} failed`;
          },
        },
      );
    });

  // ── bulk sync ──
  bulk
    .command('sync [path]')
    .description('sync card files (directory recursive or single file) → DB')
    .action(async (path: string | undefined, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          if (path) {
            let s;
            try {
              s = await stat(path);
            } catch {
              throw new Error(`path not found: ${path}`);
            }
            if (s.isFile()) {
              await syncCardFromFile(rt.ctx, path);
              return ok({ synced: 1, path, mode: 'file' });
            }
          }
          const spinner = startSpinner(rt.output, `syncing cards from ${path ?? rt.ctx.cardsDir}...`, { verbose: rt.verbose });
          let result;
          try {
            result = await bulkSyncCards(rt.ctx, path);
          } finally {
            spinner.stop();
          }
          const errors: CliMessage[] = result.errors.map((e) => ({
            code: 'SYNC_FAILED',
            message: e.error instanceof Error ? e.error.message : String(e.error),
            details: { file_path: e.filePath },
          }));
          const data = {
            synced: result.synced,
            errors: result.errors.length,
            mode: 'directory',
            path: path ?? rt.ctx.cardsDir,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { synced: number; errors?: number; mode: string; path: string };
            return `bulk sync (${d.mode}): ${d.synced} synced${d.errors ? `, ${d.errors} errors` : ''} from ${d.path}`;
          },
        },
      );
    });
}
