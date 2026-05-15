/**
 * `ed spec` subcommands
 */

import { Command } from 'commander';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { syncSpecAnnotations, syncSymbolChanges } from '../../ops/spec-sync';
import { CliUsageError } from '../usage-error';
import { errorMessage } from '../../util/error';

/** @spec cli-surface/command-routing-and-output/commands/spec-sync */
export async function specSyncAction(_opts: unknown, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await syncSpecAnnotations(rt.ctx);
    return {
      data: {
        alreadyLinked: result.alreadyLinked,
        linkMissing: result.linkMissing,
        unmatched: result.unmatched,
        markerMissing: result.markerMissing,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/spec-sync-symbols */
export async function specSyncSymbolsAction(opts: { since?: string }, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const META_KEY = 'last_symbol_sync_at';
    let since: string;
    let sinceSource: 'flag' | 'last-sync' | 'default-24h';
    if (opts.since) {
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
        sinceSource = 'last-sync';
      } else {
        since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        sinceSource = 'default-24h';
      }
    }

    const result = await syncSymbolChanges(rt.ctx, since);

    // Record next watermark; upsert failure surfaces as a synthetic skipped entry.
    const now = new Date().toISOString();
    const skipped = [...result.skipped];
    let nextSyncMarker: string | null = now;
    try {
      rt.ctx.db.$client
        .prepare(
          'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(META_KEY, now, now);
    } catch (e) {
      nextSyncMarker = null;
      skipped.push({
        reason: 'metadata-write-failed' as never,
        details: { message: errorMessage(e) },
      });
    }

    return {
      data: {
        applied: result.applied,
        skipped,
        total: result.applied.length + skipped.length,
        since,
        sinceSource,
        nextSyncMarker,
      },
    };
  }, cmd);
}

export function registerSpec(program: Command): void {
  const spec = program.command('spec').description('source code ↔ card binding sync');

  spec
    .command('sync')
    .description('reconcile DB codeLinks from @spec annotations in source')
    .action(specSyncAction);

  spec
    .command('sync-symbols')
    .description('update card code links when source symbols are renamed or moved. --since defaults to the last sync time (or 24h ago on first run)')
    .option('--since <ts>', 'ISO 8601 or epoch ms (overrides stored last_symbol_sync_at)')
    .action(specSyncSymbolsAction);
}
