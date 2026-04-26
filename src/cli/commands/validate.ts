/**
 * `ed validate` subcommands. Phase 1: cards, brief.
 * `links` and aggregate `validate` (all) land in Phase 2.
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { validateCards } from '../../ops/sync';
import { validateBrief } from '../../brief/validate';

export function registerValidate(program: Command): void {
  const validate = program.command('validate').description('integrity gates');

  // ── validate cards ──
  validate
    .command('cards')
    .description('validate card collection (file/DB consistency, glossary, chains)')
    .action(async (_opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await validateCards(rt.ctx);
          const errors: CliMessage[] = result.warnings.map((w) => ({
            code: w.type.toUpperCase().replace(/-/g, '_'),
            message: w.message,
            ...(w.cardKey ? { key: w.cardKey } : {}),
          }));
          for (const stale of result.staleDbRows) {
            errors.push({ code: 'STALE_DB_ROW', message: `DB row has no file: ${stale.filePath}`, key: stale.key });
          }
          for (const orphan of result.orphanFiles) {
            errors.push({ code: 'ORPHAN_FILE', message: `file has no DB row: ${orphan}` });
          }
          for (const km of result.keyMismatches) {
            errors.push({
              code: 'KEY_MISMATCH',
              message: `card key '${km.row.key}' does not match path-derived '${km.expectedKey}'`,
              key: km.row.key,
            });
          }

          const data = {
            warnings: result.warnings.length,
            stale_db_rows: result.staleDbRows.length,
            orphan_files: result.orphanFiles.length,
            key_mismatches: result.keyMismatches.length,
            total_issues: errors.length,
          };
          if (errors.length === 0) return ok(data);
          return partial(data, errors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => renderValidateCardsHuman(data),
        },
      );
    });

  // ── validate brief ──
  validate
    .command('brief <key>')
    .description('validate brief card structure (8 sections + content quality)')
    .action(async (key: string, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = validateBrief(rt.ctx, key);
          const errors: CliMessage[] = [];
          for (const missing of result.missing) {
            errors.push({ code: 'BRIEF_SECTION_MISSING', message: `missing section: ${missing}` });
          }
          for (const [name, section] of Object.entries(result.sections)) {
            if (section.status === 'error') {
              for (const e of section.errors) {
                errors.push({ code: 'BRIEF_SECTION_ERROR', message: `[${name}] ${e}`, key: section.cardKey });
              }
            }
          }

          const warnings: CliMessage[] = [];
          for (const [name, section] of Object.entries(result.sections)) {
            for (const w of section.warnings) {
              warnings.push({ code: 'BRIEF_SECTION_WARNING', message: `[${name}] ${w}`, key: section.cardKey });
            }
          }

          const data = {
            complete: result.complete,
            present: result.present,
            missing: result.missing,
            quality_errors: result.qualityErrors,
            quality_warnings: result.qualityWarnings,
          };
          if (errors.length === 0) return ok(data, warnings);
          return partial(data, errors, warnings);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => renderValidateBriefHuman(data),
        },
      );
    });
}

function renderValidateCardsHuman(data: unknown): string {
  const d = data as { total_issues: number; warnings: number; stale_db_rows: number; orphan_files: number; key_mismatches: number };
  if (d.total_issues === 0) return 'validate cards: ok (0 issues)\n';
  return [
    `validate cards: ${d.total_issues} issue(s)`,
    `  warnings:        ${d.warnings}`,
    `  stale db rows:   ${d.stale_db_rows}`,
    `  orphan files:    ${d.orphan_files}`,
    `  key mismatches:  ${d.key_mismatches}`,
  ].join('\n');
}

function renderValidateBriefHuman(data: unknown): string {
  const d = data as { complete: boolean; present: string[]; missing: string[]; quality_errors: number; quality_warnings: number };
  const lines = [
    `validate brief: ${d.complete ? 'complete' : 'incomplete'}`,
    `  present (${d.present.length}): ${d.present.join(', ')}`,
  ];
  if (d.missing.length > 0) lines.push(`  missing (${d.missing.length}): ${d.missing.join(', ')}`);
  lines.push(`  quality:   ${d.quality_errors} error(s), ${d.quality_warnings} warning(s)`);
  return lines.join('\n');
}
