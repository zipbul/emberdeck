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
import { startSpinner } from '../spinner';

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
          const spinner = startSpinner(rt.output, `creating ${(parsed as unknown[]).length} cards...`);
          const result = await bulkCreateCards(rt.ctx, parsed as CreateCardInput[]);
          spinner.stop();
          const errors: CliMessage[] = result.errors.map((e) => ({
            code: 'BULK_CREATE_FAILED',
            message: e.message,
            key: e.key,
          }));
          const data = {
            succeeded: result.keys,
            partial_keys: result.partialKeys,
            total: result.created + result.failed,
            created: result.created,
            failed: result.failed,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { created: number; failed: number; total: number };
          return `bulk create: ${d.created}/${d.total} created, ${d.failed} failed`;
        } },
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
            // detect file vs dir
            try {
              const s = await stat(path);
              if (s.isFile()) {
                await syncCardFromFile(rt.ctx, path);
                return ok({ synced: 1, path, mode: 'file' });
              }
            } catch {
              // PATH might not exist
              throw new Error(`path not found: ${path}`);
            }
          }
          const spinner = startSpinner(rt.output, `syncing cards from ${path ?? rt.ctx.cardsDir}...`);
          const result = await bulkSyncCards(rt.ctx, path);
          spinner.stop();
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
        { humanRenderer: (data) => {
          const d = data as { synced: number; errors?: number; mode: string; path: string };
          return `bulk sync (${d.mode}): ${d.synced} synced${d.errors ? `, ${d.errors} errors` : ''} from ${d.path}`;
        } },
      );
    });
}
