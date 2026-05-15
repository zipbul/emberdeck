/**
 * `ed validate` subcommands: aggregate (no args) / cards / links.
 *
 * Note: `validate brief` was removed when the legacy markdown body 8-section
 * path was retired. Brief structure now lives in `frontmatter.brief` namespace
 * and is validated at parse time + activation guard (validateBriefRefs).
 */

import { Command } from 'commander';
import { run } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { validateCards, ensureCardsSynced, detectKeyMismatches } from '../../ops/sync';
import { validateCodeLinks } from '../../ops/link';
import { CardNotFoundError } from '../../card/errors';

export function registerValidate(program: Command): void {
  const validate = program.command('validate').description('integrity gates');

  // ── validate (no args = all) ──
  /** @spec cli-surface/command-routing-and-output/commands/validate-aggregate */
  validate
    .action(async (_opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const cardsResult = await validateCards(rt.ctx);
          const cardErrors: CliMessage[] = cardsResult.warnings.map((w) => ({
            code: w.type.toUpperCase().replace(/-/g, '_'),
            message: w.message,
            ...(w.cardKey ? { key: w.cardKey } : {}),
          }));
          // Build a map of sync failures so orphan-file errors can include the
          // underlying parse error (otherwise the runner's CARD_SYNC_FAILED
          // dedup hides the root cause).
          const syncFailuresByPath = new Map((await ensureCardsSynced(rt.ctx)).map((f) => [f.filePath, f.error]));
          for (const stale of cardsResult.staleDbRows) cardErrors.push({ code: 'STALE_DB_ROW', message: `indexed card has no file: ${stale.filePath}`, key: stale.key, details: { file_path: stale.filePath } });
          for (const orphan of cardsResult.orphanFiles) {
            const syncErr = syncFailuresByPath.get(orphan);
            const msg = syncErr
              ? `file has no indexed card: ${orphan} — sync failed: ${syncErr}`
              : `file has no indexed card: ${orphan}`;
            cardErrors.push({ code: 'ORPHAN_FILE', message: msg, details: { file_path: orphan } });
          }
          for (const km of cardsResult.keyMismatches) {
            cardErrors.push({
              code: 'KEY_MISMATCH',
              message: `card key '${km.row.key}' does not match path-derived '${km.expectedKey}'`,
              key: km.row.key,
              details: { file_path: km.row.filePath },
            });
          }

          // Skip cards whose DB key disagrees with the path-derived key — those
          // are reported as KEY_MISMATCH above, and validateCodeLinks would
          // throw CARD_NOT_FOUND because readCard expects the frontmatter key
          // to match the on-disk slug.
          const mismatchedKeys = new Set(cardsResult.keyMismatches.map((km) => km.row.key));
          const allCards = rt.ctx.cardRepo.list();
          const linkErrors: CliMessage[] = [];
          let linkDeclared = 0;
          let linkBroken = 0;
          for (const c of allCards) {
            if (mismatchedKeys.has(c.key)) continue;
            // Per-card try/catch: a single TOCTOU race (file deleted/permission
            // change between auto-sync and link validation) must not abort the
            // entire envelope. Captured failure surfaces as VALIDATION_FAILED
            // with details.file_path so the runner's CARD_SYNC_FAILED dedup
            // still applies if relevant.
            try {
              const r = await validateCodeLinks(rt.ctx, c.key);
              linkDeclared += r.declared;
              linkBroken += r.broken.length;
              for (const b of r.broken) linkErrors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: c.key });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              linkErrors.push({ code: 'VALIDATION_FAILED', message: `link validation failed for ${c.key}: ${message}`, key: c.key, details: { file_path: c.filePath } });
            }
          }

          const allErrors = [...cardErrors, ...linkErrors];
          const data = {
            cards: { issues: cardErrors.length },
            links: { declared: linkDeclared, broken: linkBroken },
            total_issues: allErrors.length,
          };
          return allErrors.length === 0 ? ok(data) : partial(data, allErrors);
        },
        cmd,
        {
          partialIsFailure: true,
          
        },
      );
    });

  // ── validate links ──
  /** @spec cli-surface/command-routing-and-output/commands/validate-links */
  validate
    .command('links [key]')
    .description('check that every codeLink points to a real source symbol (one card or all)')
    .action(async (key: string | undefined, _opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const errors: CliMessage[] = [];
          let declared = 0;
          let resolved = 0;
          let broken = 0;

          // Explicit-key path: a user typo must surface as CARD_NOT_FOUND
          // (exit 4), not get swallowed by the per-target catch below. The
          // catch is intentionally scoped to the fan-out path where typos
          // cannot happen and TOCTOU is the only realistic failure mode.
          let explicitRow: ReturnType<typeof rt.ctx.cardRepo.findByKey> = null;
          if (key) {
            explicitRow = rt.ctx.cardRepo.findByKey(key);
            if (!explicitRow) throw new CardNotFoundError(key);
          }
          // Fan-out path: skip KEY_MISMATCH cards (readCard would throw
          // CARD_NOT_FOUND for them) but emit one error per skip so the user
          // is not silently misled into thinking every spec validated.
          // detectKeyMismatches is a cheap subset of validateCards (no file
          // reads, no relation walk) suitable for this filter.
          let mismatchedKeys = new Set<string>();
          if (!key) {
            try {
              for (const km of detectKeyMismatches(rt.ctx)) {
                mismatchedKeys.add(km.row.key);
                errors.push({
                  code: 'KEY_MISMATCH_SKIPPED',
                  message: `link validation skipped: card key '${km.row.key}' does not match path-derived '${km.expectedKey}' (run \`ed validate cards\`)`,
                  key: km.row.key,
                  details: { file_path: km.row.filePath },
                });
              }
            } catch (e) {
              // Defensive: the cheap helper has no I/O today but if cardsDir
              // vanishes mid-run we still produce a coherent envelope.
              const message = e instanceof Error ? e.message : String(e);
              errors.push({ code: 'VALIDATION_FAILED', message: `key-mismatch detection failed: ${message}` });
            }
          }
          const targets = explicitRow
            ? [explicitRow]
            : rt.ctx.cardRepo.list().filter((c) => c.type === 'spec' && !mismatchedKeys.has(c.key));
          for (const t of targets) {
            // Per-card try/catch: a single TOCTOU race (file deleted /
            // permission change between auto-sync and link validation) must
            // not abort the entire envelope. Mirrors the aggregate path.
            try {
              const r = await validateCodeLinks(rt.ctx, t.key);
              declared += r.declared;
              resolved += r.valid;
              broken += r.broken.length;
              for (const b of r.broken) errors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: t.key });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              errors.push({ code: 'VALIDATION_FAILED', message: `link validation failed for ${t.key}: ${message}`, key: t.key, details: { file_path: t.filePath } });
            }
          }

          const data = {
            declared,
            resolved,
            broken,
            unresolved: errors.length,
          };
          return errors.length === 0 ? ok(data) : partial(data, errors);
        },
        cmd,
        {
          partialIsFailure: true,
          
        },
      );
    });

  // ── validate cards ──
  /** @spec cli-surface/command-routing-and-output/commands/validate-cards */
  validate
    .command('cards')
    .description('check card integrity: file consistency, hierarchy, glossary references, brief→spec chains')
    .action(async (_opts, cmd) => {
            await run(
        async (rt: CliRuntime) => {
          const result = await validateCards(rt.ctx);
          const errors: CliMessage[] = result.warnings.map((w) => ({
            code: w.type.toUpperCase().replace(/-/g, '_'),
            message: w.message,
            ...(w.cardKey ? { key: w.cardKey } : {}),
          }));
          const syncFailuresByPath2 = new Map((await ensureCardsSynced(rt.ctx)).map((f) => [f.filePath, f.error]));
          for (const stale of result.staleDbRows) {
            errors.push({ code: 'STALE_DB_ROW', message: `indexed card has no file: ${stale.filePath}`, key: stale.key, details: { file_path: stale.filePath } });
          }
          for (const orphan of result.orphanFiles) {
            const syncErr = syncFailuresByPath2.get(orphan);
            const msg = syncErr
              ? `file has no indexed card: ${orphan} — sync failed: ${syncErr}`
              : `file has no indexed card: ${orphan}`;
            errors.push({ code: 'ORPHAN_FILE', message: msg, details: { file_path: orphan } });
          }
          for (const km of result.keyMismatches) {
            errors.push({
              code: 'KEY_MISMATCH',
              message: `card key '${km.row.key}' does not match path-derived '${km.expectedKey}'`,
              key: km.row.key,
              details: { file_path: km.row.filePath },
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
        cmd,
        {
          partialIsFailure: true,
          
        },
      );
    });

  // `validate brief` was removed — namespace structure is validated at parse time
  // (markdown.ts:normalizeBriefBody) and at activation (validateBriefRefs).
}

