/**
 * `ed check` subcommands: drift / coverage / impact / regression / interactions.
 */

import { Command } from 'commander';
import { run } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { getLinkCoverage, getUncoveredSymbols, suggestCardScope } from '../../ops/spec-sync';
import { checkDrift, checkInteractions } from '../../ops/context';
import { preChangeCheck, regressionGuard } from '../../ops/impact';
import { CliUsageError } from '../usage-error';

export function registerCheck(program: Command): void {
  const check = program.command('check').description('inspect drift, coverage, impact, regressions, and card interactions');

  // ── check drift ──
  check
    .command('drift [key]')
    .description('detect drift (broken_link / boundary_inactive / symbol_changed / glossary_broken / heritage_uncovered / pattern_violation)')
    .option('--no-auto-transition', 'do not auto-mark active→drifted')
    .action(async (key: string | undefined, opts: { autoTransition?: boolean }, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const result = await checkDrift(rt.ctx, key, {
            autoTransition: opts.autoTransition !== false,
          });
          return ok({
            health: result.health,
            cards: result.cards,
            total_drifted: result.health.drifted,
          });
        },
        cmd,
      );
    });

  // ── check coverage ──
  check
    .command('coverage [key]')
    .description('code link coverage for one card; --uncovered for project-wide; --suggest for new card scopes')
    .option('--uncovered', 'list project symbols not covered by any card (exported-only by default)')
    .option('--include-internal', 'with --uncovered: also count non-exported symbols')
    .option('--suggest', 'suggest new card scopes for uncovered areas')
    .action(async (key: string | undefined, opts: { uncovered?: boolean; includeInternal?: boolean; suggest?: boolean }, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          if (opts.suggest) {
            const suggestions = await suggestCardScope(rt.ctx);
            return ok({
              suggestions: suggestions.map((s) => ({
                key: s.suggestedKey,
                type: s.type,
                parent: s.parent,
                files: s.files.length,
                symbols: s.symbols.length,
                reason: s.reason,
                suggested_glossary: s.suggestedGlossary ?? [],
              })),
              total: suggestions.length,
            });
          }
          if (opts.uncovered) {
            // Default exported-only: internal symbols (private fields, helpers,
            // constructors) are HOW, not WHAT — counting them violates the
            // self-review rule. `--include-internal` opts in to full surface.
            const uc = await getUncoveredSymbols(rt.ctx, { exportedOnly: !opts.includeInternal });
            return ok({
              total_symbols: uc.totalSymbols,
              covered_symbols: uc.coveredSymbols,
              coverage_ratio: uc.coverageRatio,
              uncovered: uc.uncovered.slice(0, 100),
              uncovered_total: uc.uncovered.length,
            });
          }
          if (!key) {
            throw new CliUsageError('coverage requires <key> argument, or use --uncovered / --suggest');
          }
          const cov = await getLinkCoverage(rt.ctx, key);
          return ok({
            declared: cov.declared,
            resolved: cov.resolved,
            broken: cov.broken,
            coverage_ratio: cov.coverage,
            unreferenced_symbols: cov.unreferenced.slice(0, 100),
            unreferenced_total: cov.unreferenced.length,
          });
        },
        cmd,
      );
    });

  // ── check impact ──
  check
    .command('impact <files...>')
    .description('pre-change impact analysis (direct / boundary / transitive)')
    .option('--symbol <names...>', 'optional: restrict to specific symbols')
    .action(async (files: string[], opts: { symbol?: string[] }, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const result = await preChangeCheck(rt.ctx, files, opts.symbol);
          return ok({
            risk_level: result.riskLevel,
            affected_count: result.affectedCards.length,
            affected_cards: result.affectedCards,
            new_uncovered_files: result.newUncoveredFiles,
            suggested_actions: result.suggestedActions,
            ...(result.maxFanIn !== undefined ? { max_fan_in: result.maxFanIn } : {}),
          });
        },
        cmd,
      );
    });

  // ── check regression ──
  check
    .command('regression <files...>')
    .description('regression guard: drifted ratio of affected cards vs threshold')
    .action(async (files: string[], _opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const result = await regressionGuard(rt.ctx, files);
          if (result.passOrFail === 'fail') {
            const errors: CliMessage[] = result.affectedCards
              .filter((c) => c.driftType || c.status === 'drifted')
              .map((c) => ({ code: 'REGRESSION_DRIFT', message: `${c.key}: ${c.driftType ?? c.status}`, key: c.key }));
            return partial({
              pass_or_fail: result.passOrFail,
              drifted_ratio: result.driftedRatio,
              threshold: result.threshold,
              affected: result.affectedCards,
            }, errors);
          }
          return ok({
            pass_or_fail: result.passOrFail,
            drifted_ratio: result.driftedRatio,
            threshold: result.threshold,
            affected: result.affectedCards,
          });
        },
        cmd,
        {
          partialIsFailure: true,
          
        },
      );
    });

  // ── check interactions ──
  check
    .command('interactions <keys...>')
    .description('analyze interactions between cards (shared symbols/files/imports)')
    .action(async (keys: string[], _opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const result = await checkInteractions(rt.ctx, keys);
          return ok({
            interactions: result.interactions,
            undefined_relations: result.undefinedRelations,
          });
        },
        cmd,
      );
    });

}

