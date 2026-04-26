/**
 * `ed spec` subcommands per CLI_PLAN §4.5.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { writeSpecAnnotations, syncSpecAnnotations, syncSymbolChanges } from '../../ops/spec-sync';

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
    .description('apply renamed/moved symbols from gildash to codeLinks')
    .option('--since <ts>', 'ISO 8601 or epoch ms (default: 24h ago)')
    .action(async (opts: { since?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const since = opts.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const result = await syncSymbolChanges(rt.ctx, since);
          return ok({
            updated: result.updated,
            broken: result.broken,
            changes: result.changes,
            since,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { updated: number; broken: number; changes: unknown[]; since: string };
          return `spec sync-symbols (since ${d.since}): ${d.updated} updated, ${d.broken} broken`;
        } },
      );
    });
}
