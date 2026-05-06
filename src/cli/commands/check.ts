/**
 * `ed check` subcommands: drift / coverage / impact / regression / interactions.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { getLinkCoverage, getUncoveredSymbols, suggestCardScope } from '../../ops/spec-sync';
import { checkDrift, checkInteractions } from '../../ops/context';
import { preChangeCheck, regressionGuard } from '../../ops/impact';
import { parsePositiveInt } from '../parsers';
import { CliUsageError } from '../errors';

export function registerCheck(program: Command): void {
  const check = program.command('check').description('inspect drift, coverage, impact, regressions, and card interactions');

  // ── check drift ──
  check
    .command('drift [key]')
    .description('detect drift (broken_link / boundary_inactive / symbol_changed / glossary_broken / heritage_uncovered / pattern_violation)')
    .option('--max-depth <n>', 'how many relation hops to traverse from KEY (default 3)', parsePositiveInt('--max-depth'))
    .option('--no-auto-transition', 'do not auto-mark active→drifted')
    .action(async (key: string | undefined, opts: { maxDepth?: number; autoTransition?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await checkDrift(rt.ctx, key, {
            maxDepth: opts.maxDepth,
            autoTransition: opts.autoTransition !== false,
          });
          return ok({
            health: result.health,
            cards: result.cards,
            total_drifted: result.health.drifted,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as {
            health: { total: number; active: number; drifted: number; draft: number };
            cards: Array<{
              key: string;
              status: string;
              driftType?: string;
              uncoveredSubclasses?: Array<{ file: string; symbol: string }>;
              patternViolations?: Array<{ id: string; rule: string; matches: number }>;
            }>;
          };
          const lines = [
            `drift: total=${d.health.total} active=${d.health.active} drifted=${d.health.drifted} draft=${d.health.draft}`,
          ];
          for (const c of d.cards.filter((c) => c.driftType)) {
            const types = (c as { driftTypes?: string[] }).driftTypes ?? [c.driftType!];
            lines.push(`  ${c.key}: ${types.join(' + ')}`);
            if (c.uncoveredSubclasses?.length) {
              for (const s of c.uncoveredSubclasses) lines.push(`    └ subclass uncovered: ${s.file}:${s.symbol}`);
            }
            if (c.patternViolations?.length) {
              for (const v of c.patternViolations) lines.push(`    └ ${v.id} (${v.rule}): ${v.matches} match(es)`);
            }
          }
          return lines.join('\n');
        } },
      );
    });

  // ── check coverage ──
  check
    .command('coverage [key]')
    .description('code link coverage for one card; --uncovered for project-wide; --suggest for new card scopes')
    .option('--uncovered', 'list project symbols not covered by any card')
    .option('--suggest', 'suggest new card scopes for uncovered areas')
    .action(async (key: string | undefined, opts: { uncovered?: boolean; suggest?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
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
            const uc = await getUncoveredSymbols(rt.ctx);
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
        [],
        globalFlags,
        { humanRenderer: renderCoverageHuman },
      );
    });

  // ── check impact ──
  check
    .command('impact <files...>')
    .description('pre-change impact analysis (direct / boundary / transitive)')
    .option('--symbol <names...>', 'optional: restrict to specific symbols')
    .action(async (files: string[], opts: { symbol?: string[] }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
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
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { risk_level: string; affected_count: number; affected_cards: Array<{ key: string; linkType: string; affectedLinks: number }>; suggested_actions: string[]; max_fan_in?: number };
          const fanInPart = d.max_fan_in ? `, fan-in=${d.max_fan_in}` : '';
          const lines = [`impact: risk=${d.risk_level}, ${d.affected_count} card(s) affected${fanInPart}`];
          for (const c of d.affected_cards) lines.push(`  ${c.key} (${c.linkType}, ${c.affectedLinks} link(s))`);
          for (const a of d.suggested_actions) lines.push(`  → ${a}`);
          return lines.join('\n');
        } },
      );
    });

  // ── check regression ──
  check
    .command('regression <files...>')
    .description('regression guard: drifted ratio of affected cards vs threshold')
    .action(async (files: string[], _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
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
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { pass_or_fail: string; drifted_ratio: number; threshold: number };
            return `regression: ${d.pass_or_fail} (drifted_ratio=${d.drifted_ratio.toFixed(2)}, threshold=${d.threshold})`;
          },
        },
      );
    });

  // ── check interactions ──
  check
    .command('interactions <keys...>')
    .description('analyze interactions between cards (shared symbols/files/imports)')
    .action(async (keys: string[], _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await checkInteractions(rt.ctx, keys);
          return ok({
            interactions: result.interactions,
            undefined_relations: result.undefinedRelations,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { interactions: Array<{ pair: string[]; sharedSymbols: unknown[]; sharedFiles: string[]; hasRelation: boolean; potentialConflicts: string[] }>; undefined_relations: Array<{ pair: string[] }> };
          if (d.interactions.length === 0) return '(no interactions)\n';
          const lines: string[] = [];
          for (const i of d.interactions) {
            lines.push(`${i.pair[0]} ↔ ${i.pair[1]}: shared symbols=${i.sharedSymbols.length}, shared files=${i.sharedFiles.length}, relation=${i.hasRelation ? 'yes' : 'no'}`);
            for (const c of i.potentialConflicts) lines.push(`  ⚠ ${c}`);
          }
          if (d.undefined_relations.length > 0) lines.push(`\n${d.undefined_relations.length} undefined relation(s):`);
          for (const u of d.undefined_relations) lines.push(`  ${u.pair[0]} ↔ ${u.pair[1]}`);
          return lines.join('\n');
        } },
      );
    });

}

function renderCoverageHuman(data: unknown): string {
  const d = data as Record<string, unknown>;
  if ('suggestions' in d) {
    const sg = d as { suggestions: Array<{ key: string; type: string; parent?: string; reason: string }>; total: number };
    if (sg.suggestions.length === 0) return 'no card suggestions (full coverage)\n';
    const lines = [`${sg.total} suggestion(s):`];
    for (const s of sg.suggestions) {
      lines.push(`  ${s.key} (${s.type}${s.parent ? `, parent=${s.parent}` : ''})`);
      lines.push(`    ${s.reason}`);
    }
    return lines.join('\n');
  }
  if ('total_symbols' in d) {
    const u = d as { total_symbols: number; covered_symbols: number; coverage_ratio: number | null; uncovered: Array<{ file: string; symbol: string; kind: string }>; uncovered_total: number };
    const ratioStr = u.coverage_ratio === null ? 'n/a (no symbols indexed)' : `${(u.coverage_ratio * 100).toFixed(1)}%`;
    const lines = [
      `coverage (project): ${ratioStr} (${u.covered_symbols}/${u.total_symbols})`,
      `uncovered: ${u.uncovered_total} symbol(s)`,
    ];
    for (const x of u.uncovered.slice(0, 20)) {
      lines.push(`  ${x.file}:${x.symbol} (${x.kind})`);
    }
    if (u.uncovered_total > 20) lines.push(`  ... and ${u.uncovered_total - 20} more`);
    return lines.join('\n');
  }
  const c = d as { declared: number; resolved: number; broken: number; coverage_ratio: number; unreferenced_symbols: Array<{ file: string; symbol: string; kind: string }>; unreferenced_total: number };
  const lines = [
    `coverage (card): declared=${c.declared} resolved=${c.resolved} broken=${c.broken} ratio=${(c.coverage_ratio * 100).toFixed(1)}%`,
  ];
  if (c.unreferenced_total > 0) {
    lines.push(`unreferenced symbols in same files: ${c.unreferenced_total}`);
    for (const u of c.unreferenced_symbols.slice(0, 20)) {
      lines.push(`  ${u.file}:${u.symbol} (${u.kind})`);
    }
    if (c.unreferenced_total > 20) lines.push(`  ... and ${c.unreferenced_total - 20} more`);
  }
  return lines.join('\n');
}
