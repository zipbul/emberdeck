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
import { validateCodeLinks } from '../../ops/link';
import { startSpinner } from '../spinner';

export function registerValidate(program: Command): void {
  const validate = program.command('validate').description('integrity gates');

  // ── validate (no args = all) ──
  validate
    .action(async (_opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const cardsResult = await validateCards(rt.ctx);
          const cardErrors: CliMessage[] = cardsResult.warnings.map((w) => ({
            code: w.type.toUpperCase().replace(/-/g, '_'),
            message: w.message,
            ...(w.cardKey ? { key: w.cardKey } : {}),
          }));
          for (const stale of cardsResult.staleDbRows) cardErrors.push({ code: 'STALE_DB_ROW', message: `DB row has no file: ${stale.filePath}`, key: stale.key });
          for (const orphan of cardsResult.orphanFiles) cardErrors.push({ code: 'ORPHAN_FILE', message: `file has no DB row: ${orphan}` });

          // links validation: per-card iteration
          const allCards = rt.ctx.cardRepo.list();
          const linkErrors: CliMessage[] = [];
          let linkDeclared = 0;
          let linkBroken = 0;
          if (rt.ctx.gildash) {
            for (const c of allCards) {
              const r = await validateCodeLinks(rt.ctx, c.key);
              linkDeclared += r.declared;
              linkBroken += r.broken.length;
              for (const b of r.broken) linkErrors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: c.key });
            }
          }

          // brief validation: per active brief
          const briefErrors: CliMessage[] = [];
          for (const c of allCards) {
            if (c.type !== 'brief' || c.status === 'draft') continue;
            try {
              const r = validateBrief(rt.ctx, c.key);
              if (!r.complete) {
                for (const m of r.missing) briefErrors.push({ code: 'BRIEF_SECTION_MISSING', message: `[${c.key}] missing: ${m}`, key: c.key });
              }
            } catch (e) {
              briefErrors.push({ code: 'BRIEF_VALIDATION_ERROR', message: String((e as Error).message), key: c.key });
            }
          }

          const allErrors = [...cardErrors, ...linkErrors, ...briefErrors];
          const data = {
            cards: { issues: cardErrors.length },
            links: { declared: linkDeclared, broken: linkBroken },
            briefs: { issues: briefErrors.length },
            total_issues: allErrors.length,
          };
          return allErrors.length === 0 ? ok(data) : partial(data, allErrors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { cards: { issues: number }; links: { declared: number; broken: number }; briefs: { issues: number }; total_issues: number };
            return `validate: cards=${d.cards.issues} links=${d.links.broken}/${d.links.declared} briefs=${d.briefs.issues} total=${d.total_issues}`;
          },
        },
      );
    });

  // ── validate links ──
  validate
    .command('links [key]')
    .description('validate code links resolve via gildash (one card or all)')
    .action(async (key: string | undefined, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const errors: CliMessage[] = [];
          let declared = 0;
          let resolved = 0;
          let broken = 0;

          const targets = key ? [{ key }] : rt.ctx.cardRepo.list().filter((c) => c.type === 'spec').map((c) => ({ key: c.key }));
          const spinner = startSpinner(rt.output, `validating ${targets.length} card(s)...`, { verbose: rt.verbose });
          try {
            let i = 0;
            for (const t of targets) {
              i++;
              spinner.update(`validating links: ${i}/${targets.length} (${t.key})`);
              const r = await validateCodeLinks(rt.ctx, t.key);
              declared += r.declared;
              resolved += r.valid;
              broken += r.broken.length;
              for (const b of r.broken) errors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: t.key });
            }
          } finally {
            spinner.stop();
          }

          const data = { declared, resolved, broken, unresolved: errors.length };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { declared: number; resolved: number; broken: number };
            return `validate links: declared=${d.declared} resolved=${d.resolved} broken=${d.broken}`;
          },
        },
      );
    });

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
