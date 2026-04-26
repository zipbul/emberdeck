/**
 * Single top-level commands: analyze, reset.
 * Per CLI_PLAN §4.7.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok } from '../output';
import type { CliRuntime } from '../context';
import { analyze } from '../../ops/analyze';
import { resetEmberdeck } from '../../ops/glossary';
import { startSpinner } from '../spinner';

async function readLineFromStdin(): Promise<string> {
  // Read a single line from stdin (TTY-safe — does not block forever).
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes('\n')) break;
  }
  reader.releaseLock();
  return buf.split('\n')[0] ?? '';
}

export function registerSingle(program: Command): void {
  // ── analyze ──
  program
    .command('analyze')
    .description('full project analysis (drift + coverage + glossary)')
    .option('--include-body', 'include body of drifted cards')
    .option('--drifted-limit <n>', 'paginate drifted cards (default: all)', (v) => parseInt(v, 10))
    .option('--drifted-offset <n>', 'drifted cards offset', (v) => parseInt(v, 10))
    .action(async (opts: { includeBody?: boolean; driftedLimit?: number; driftedOffset?: number }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const spinner = startSpinner(rt.output, 'analyzing project...', { verbose: rt.verbose });
          let result;
          try {
            result = await analyze(rt.ctx, {
              includeBody: opts.includeBody,
              limit: opts.driftedLimit,
              offset: opts.driftedOffset,
            });
          } finally {
            spinner.stop();
          }
          return ok({
            health: result.health,
            coverage: result.coverage,
            drifted: {
              cards: result.driftedCards,
              total: result.driftedCardsTotal,
            },
            glossary: result.glossary,
            unlinked_symbols: result.unlinkedSymbols,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { health: { total: number; active: number; drifted: number; draft: number; brokenLinks: number }; coverage: { totalSymbols: number; covered: number; ratio: number }; drifted: { total: number }; glossary: { totalWords: number } };
          return [
            `analyze:`,
            `  cards:    total=${d.health.total} active=${d.health.active} drifted=${d.health.drifted} draft=${d.health.draft}`,
            `  coverage: ${(d.coverage.ratio * 100).toFixed(1)}% (${d.coverage.covered}/${d.coverage.totalSymbols})`,
            `  drifted:  ${d.drifted.total} cards`,
            `  glossary: ${d.glossary.totalWords} words`,
            `  broken links: ${d.health.brokenLinks}`,
          ].join('\n');
        } },
      );
    });

  // ── reset ──
  program
    .command('reset')
    .description('delete ALL cards (DB + files), clear glossary. DESTRUCTIVE.')
    .option('--yes', 'skip confirmation prompt (required for non-TTY)')
    .action(async (opts: { yes?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          if (!opts.yes) {
            if (!process.stdin.isTTY || !process.stderr.isTTY) {
              throw new Error('reset requires --yes when not running in interactive TTY (DESTRUCTIVE op)');
            }
            process.stderr.write('reset will DELETE ALL cards and glossary. Type "yes" to proceed: ');
            const answer = (await readLineFromStdin()).trim();
            if (answer !== 'yes') {
              throw new Error('reset aborted by user');
            }
          }
          const result = await resetEmberdeck(rt.ctx);
          return ok({
            cards_deleted: result.cardsDeleted,
            glossary_cleared: result.glossaryCleared,
            db_reset: result.dbReset,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { cards_deleted: number; glossary_cleared: boolean };
          return `reset: ${d.cards_deleted} cards deleted, glossary cleared=${d.glossary_cleared}`;
        } },
      );
    });
}
