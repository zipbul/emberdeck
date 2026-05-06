/**
 * `ed spec` subcommands per CLI_PLAN §4.5.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { writeSpecAnnotations, syncSpecAnnotations, syncSymbolChanges } from '../../ops/spec-sync';
import { CliUsageError } from '../errors';

export function registerSpec(program: Command): void {
  const spec = program.command('spec').description('source code ↔ card binding sync');

  // ── spec annotate ──
  spec
    .command('annotate [key]')
    .description('write @spec card-key JSDoc tags into source code (idempotent)')
    .action(async (key: string | undefined, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await writeSpecAnnotations(rt.ctx, key);
          const data = {
            annotated: result.annotated,
            already_present: result.alreadyPresent,
            symbol_not_found: result.symbolNotFound,
            removed: result.removed,
          };
          if (result.symbolNotFound > 0) {
            return partial(data, [
              { code: 'SYMBOL_NOT_FOUND', message: `${result.symbolNotFound} symbol(s) could not be located` },
            ]);
          }
          return ok(data);
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { annotated: number; already_present: number; symbol_not_found: number; removed: number };
          return `spec annotate: +${d.annotated} new, ${d.already_present} already present, -${d.removed} orphans removed${d.symbol_not_found > 0 ? `, ${d.symbol_not_found} symbol(s) not found` : ''}`;
        } },
      );
    });

  // ── spec sync ──
  spec
    .command('sync')
    .description('reconcile DB codeLinks from @spec annotations in source')
    .action(async (_opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await syncSpecAnnotations(rt.ctx);
          const errors: CliMessage[] = result.unmatched.map((u) => ({
            code: 'UNMATCHED_ANNOTATION',
            message: `@spec ${u.cardKey} at ${u.file}:${u.symbol} — no card with this key`,
          }));
          const data = {
            created: result.created,
            already_linked: result.alreadyLinked,
            unmatched: result.unmatched.length,
            marker_missing: result.markerMissing.length,
            link_missing: result.linkMissing.length,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { created: number; already_linked: number; unmatched: number; marker_missing: number; link_missing: number };
          return `spec sync: +${d.created} new, ${d.already_linked} already linked, ${d.unmatched} unmatched, ${d.marker_missing} markers missing in source`;
        } },
      );
    });

  // ── spec sync-symbols ──
  spec
    .command('sync-symbols')
    .description('update card code links when source symbols are renamed or moved. --since defaults to the last sync time (or 24h ago on first run)')
    .option('--since <ts>', 'ISO 8601 or epoch ms (overrides stored last_symbol_sync_at)')
    .action(async (opts: { since?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const META_KEY = 'last_symbol_sync_at';
          let since: string;
          let sinceSource: string;
          if (opts.since) {
            // Validate that --since parses as either ISO 8601 or numeric epoch ms.
            // Without this, garbage strings flow into gildash and surface as
            // confusing internal errors instead of a clean usage error.
            const epochMs = /^\d+$/.test(opts.since) ? parseInt(opts.since, 10) : Date.parse(opts.since);
            if (!Number.isFinite(epochMs)) {
              throw new CliUsageError(`--since must be ISO 8601 timestamp or epoch ms (got '${opts.since}')`);
            }
            since = opts.since;
            sinceSource = 'flag';
          } else {
            const row = rt.ctx.db.$client
              .prepare('SELECT value FROM system_metadata WHERE key = ?')
              .get(META_KEY) as { value: string } | undefined;
            if (row?.value) {
              since = row.value;
              sinceSource = 'last_sync';
            } else {
              since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
              sinceSource = 'default_24h';
            }
          }

          const result = await syncSymbolChanges(rt.ctx, since);
          // Record current time AFTER successful sync. If upsert fails (DB locked etc.),
          // the sync already happened — next invocation may re-process some changes.
          // We still surface the upsert error as a warning rather than failing the whole op.
          const now = new Date().toISOString();
          let upsertWarning: string | null = null;
          try {
            rt.ctx.db.$client
              .prepare(
                'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
              )
              .run(META_KEY, now, now);
          } catch (e) {
            upsertWarning = `failed to record next_sync_marker: ${e instanceof Error ? e.message : String(e)}. Next --since=auto run may re-process changes.`;
          }

          const data = {
            updated: result.updated,
            broken: result.broken,
            changes: result.changes,
            since,
            since_source: sinceSource,
            next_sync_marker: upsertWarning ? null : now,
          };
          return upsertWarning
            ? ok(data, [{ code: 'METADATA_WRITE_FAILED', message: upsertWarning }])
            : ok(data);
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { updated: number; broken: number; since: string; since_source: string };
          return `spec sync-symbols (since ${d.since} [${d.since_source}]): ${d.updated} updated, ${d.broken} broken`;
        } },
      );
    });
}
