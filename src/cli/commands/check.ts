/**
 * `ed check` subcommands. Phase 1: coverage.
 * Other check subcommands (drift, impact, regression, interactions) land in Phase 2.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok } from '../output';
import type { CliRuntime } from '../context';
import { getLinkCoverage, getUncoveredSymbols, suggestCardScope } from '../../ops/spec-sync';

export function registerCheck(program: Command): void {
  const check = program.command('check').description('state reports (descriptive)');

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
            throw new Error('coverage requires <key> argument, or use --uncovered / --suggest');
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
        { humanRenderer: (data) => renderCoverageHuman(data) },
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
    const u = d as { total_symbols: number; covered_symbols: number; coverage_ratio: number; uncovered: Array<{ file: string; symbol: string; kind: string }>; uncovered_total: number };
    const lines = [
      `coverage (project): ${(u.coverage_ratio * 100).toFixed(1)}% (${u.covered_symbols}/${u.total_symbols})`,
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
