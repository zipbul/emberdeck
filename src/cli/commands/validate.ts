/**
 * `ed validate` subcommands: aggregate (no args) / cards / links.
 *
 * Note: `validate brief` was removed when the legacy markdown body 8-section
 * path was retired. Brief structure now lives in `frontmatter.brief` namespace
 * and is validated at parse time + activation guard (validateBriefRefs).
 */

import { Command } from 'commander';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { validateCards } from '../../ops/sync';
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
          const spinner = startSpinner(rt.output, 'validating cards...', { verbose: rt.verbose });
          let cardErrors: CliMessage[];
          let linkErrors: CliMessage[];
          let linkDeclared = 0;
          let linkBroken = 0;
          try {
            const cardsResult = await validateCards(rt.ctx);
            cardErrors = cardsResult.warnings.map((w) => ({
              code: w.type.toUpperCase().replace(/-/g, '_'),
              message: w.message,
              ...(w.cardKey ? { key: w.cardKey } : {}),
            }));
            for (const stale of cardsResult.staleDbRows) cardErrors.push({ code: 'STALE_DB_ROW', message: `indexed card has no file: ${stale.filePath}`, key: stale.key });
            for (const orphan of cardsResult.orphanFiles) cardErrors.push({ code: 'ORPHAN_FILE', message: `file has no indexed card: ${orphan}` });
            for (const km of cardsResult.keyMismatches) {
              cardErrors.push({
                code: 'KEY_MISMATCH',
                message: `card key '${km.row.key}' does not match path-derived '${km.expectedKey}'`,
                key: km.row.key,
              });
            }

            // links validation: per-card iteration
            const allCards = rt.ctx.cardRepo.list();
            linkErrors = [];
            if (rt.ctx.gildash) {
              let i = 0;
              for (const c of allCards) {
                i++;
                spinner.update(`validating links: ${i}/${allCards.length} (${c.key})`);
                const r = await validateCodeLinks(rt.ctx, c.key);
                linkDeclared += r.declared;
                linkBroken += r.broken.length;
                for (const b of r.broken) linkErrors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: c.key });
              }
            }

          } finally {
            spinner.stop();
          }

          const allErrors = [...cardErrors, ...linkErrors];
          const data = {
            cards: { issues: cardErrors.length },
            links: { declared: linkDeclared, broken: linkBroken },
            total_issues: allErrors.length,
          };
          return allErrors.length === 0 ? ok(data) : partial(data, allErrors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { cards: { issues: number }; links: { declared: number; broken: number }; total_issues: number };
            return `validate: cards=${d.cards.issues} links=${d.links.broken}/${d.links.declared} total=${d.total_issues}`;
          },
        },
      );
    });

  // ── validate links ──
  validate
    .command('links [key]')
    .description('check that every codeLink points to a real source symbol (one card or all)')
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
          let internalCount = 0;
          const internalDetails: Array<{ key: string; file: string; symbol: string }> = [];
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
              if (r.internalLinks) {
                internalCount += r.internalLinks.length;
                for (const il of r.internalLinks) internalDetails.push({ key: t.key, file: il.file, symbol: il.symbol });
              }
            }
          } finally {
            spinner.stop();
          }

          const data = {
            declared,
            resolved,
            broken,
            unresolved: errors.length,
            ...(internalCount > 0 ? { internal_links: internalCount, internal_details: internalDetails } : {}),
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        [],
        globalFlags,
        {
          partialIsFailure: true,
          humanRenderer: (data) => {
            const d = data as { declared: number; resolved: number; broken: number; internal_links?: number };
            const base = `validate links: declared=${d.declared} resolved=${d.resolved} broken=${d.broken}`;
            return d.internal_links ? `${base} internal=${d.internal_links}` : base;
          },
        },
      );
    });

  // ── validate cards ──
  validate
    .command('cards')
    .description('check card integrity: file consistency, hierarchy, glossary references, brief→spec chains')
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
            errors.push({ code: 'STALE_DB_ROW', message: `indexed card has no file: ${stale.filePath}`, key: stale.key });
          }
          for (const orphan of result.orphanFiles) {
            errors.push({ code: 'ORPHAN_FILE', message: `file has no indexed card: ${orphan}` });
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

  // `validate brief` was removed — namespace structure is validated at parse time
  // (markdown.ts:normalizeBriefBody) and at activation (validateBriefRefs).
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

