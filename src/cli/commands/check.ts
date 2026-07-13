/**
 * `ed check` subcommands: drift / coverage / impact / regression / interactions.
 */

import { Command } from 'commander';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { getLinkCoverage, getUncoveredSymbols, suggestCardScope } from '../../ops/spec-sync';
import { checkDrift, checkInteractions } from '../../ops/context';
import { preChangeCheck, regressionGuard } from '../../ops/impact';
import { CliUsageError } from '../usage-error';

export async function checkDriftAction(
  key: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await checkDrift(rt.ctx, key);
    return { data: { health: result.health, cards: result.cards } };
  }, cmd);
}

export async function checkCoverageAction(
  key: string | undefined,
  opts: { uncovered?: boolean; suggest?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    if (opts.suggest) {
      const suggestions = await suggestCardScope(rt.ctx);
      return {
        data: {
          suggestions: suggestions.map((s) => ({
            key: s.suggestedKey,
            type: s.type,
            ...(s.parent ? { parent: s.parent } : {}),
            files: s.files,
            symbols: s.symbols,
            reason: s.reason,
            ...(s.suggestedGlossary ? { suggestedGlossary: s.suggestedGlossary } : {}),
          })),
          total: suggestions.length,
        },
      };
    }
    if (opts.uncovered) {
      const uc = await getUncoveredSymbols(rt.ctx);
      return {
        data: {
          totalSymbols: uc.totalSymbols,
          coveredSymbols: uc.coveredSymbols,
          coverageRatio: uc.coverageRatio,
          uncovered: uc.uncovered,
          uncoveredTotal: uc.uncovered.length,
        },
      };
    }
    if (!key) {
      throw new CliUsageError('coverage requires <key> argument, or use --uncovered / --suggest');
    }
    const cov = await getLinkCoverage(rt.ctx, key);
    return {
      data: {
        key,
        declared: cov.declared,
        resolved: cov.resolved,
        broken: cov.broken,
        coverageRatio: cov.coverage,
        unreferencedSymbols: cov.unreferenced,
        unreferencedTotal: cov.unreferenced.length,
      },
    };
  }, cmd);
}

export async function checkImpactAction(
  files: string[],
  opts: { symbol?: string[] },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await preChangeCheck(rt.ctx, files, opts.symbol);
    return {
      data: {
        riskLevel: result.riskLevel,
        affectedCards: result.affectedCards,
        newUncoveredFiles: result.newUncoveredFiles,
        suggestedActions: result.suggestedActions,
        ...(result.maxFanIn !== undefined ? { maxFanIn: result.maxFanIn } : {}),
        ...(result.maxFanOut !== undefined ? { maxFanOut: result.maxFanOut } : {}),
        ...(result.directDependents ? { directDependents: result.directDependents } : {}),
      },
    };
  }, cmd);
}

export async function checkRegressionAction(
  files: string[],
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await regressionGuard(rt.ctx, files);
    const data = {
      passOrFail: result.passOrFail,
      driftedRatio: result.driftedRatio,
      threshold: result.threshold,
      affected: result.affectedCards,
    };
    return { data, exitCode: result.passOrFail === 'fail' ? 2 : 0 };
  }, cmd);
}

export async function checkInteractionsAction(
  keys: string[],
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await checkInteractions(rt.ctx, keys);
    return {
      data: {
        interactions: result.interactions,
        undefinedRelations: result.undefinedRelations,
      },
    };
  }, cmd);
}

export function registerCheck(program: Command): void {
  const check = program
    .command('check')
    .description('inspect drift, coverage, impact, regressions, and card interactions');

  check
    .command('drift [key]')
    .description('detect drift (broken_link / glossary_broken)')
    .action(checkDriftAction);

  check
    .command('coverage [key]')
    .description('code link coverage for one card; --uncovered for project-wide; --suggest for new card scopes')
    .option('--uncovered', 'list project symbols not covered by any card')
    .option('--suggest', 'suggest new card scopes for uncovered areas')
    .action(checkCoverageAction);

  check
    .command('impact <files...>')
    .description('pre-change impact analysis (direct / transitive)')
    .option('--symbol <names...>', 'optional: restrict to specific symbols')
    .action(checkImpactAction);

  check
    .command('regression <files...>')
    .description('regression guard: drifted ratio of affected cards vs threshold')
    .action(checkRegressionAction);

  check
    .command('interactions <keys...>')
    .description('analyze interactions between cards (shared symbols/files/imports)')
    .action(checkInteractionsAction);
}
