/**
 * `ed glossary` subcommands per CLI_PLAN §4.2.
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { defineGlossary, lookupGlossary, removeGlossary, renameGlossary } from '../../ops/glossary';
import { confirmDestructive } from '../confirm';
import { CliUsageError } from '../usage-error';
import { errorMessage } from '../../util/error';

interface YamlGlossaryItem {
  word?: string;
  definition?: string;
}


function parseDefinitionPair(arg: string): { word: string; definition: string } {
  const idx = arg.indexOf('=');
  if (idx <= 0) throw new CliUsageError(`expected WORD=DEFINITION, got: ${arg}`);
  return { word: arg.slice(0, idx), definition: arg.slice(idx + 1) };
}

async function loadEntriesFromFile(value: string): Promise<Array<{ word: string; definition: string }>> {
  const text = value === '-' ? await Bun.stdin.text() : await readFile(value, 'utf-8');
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (e) {
    throw new CliUsageError(`failed to parse --from as YAML: ${errorMessage(e)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new CliUsageError('--from FILE must be a YAML array of {word, definition} objects');
  }
  return parsed.map((item: YamlGlossaryItem, i: number) => {
    if (!item.word || !item.definition) {
      throw new CliUsageError(`--from FILE entry ${i} missing word or definition`);
    }
    return { word: item.word, definition: item.definition };
  });
}

export function registerGlossary(program: Command): void {
  const glossary = program.command('glossary').description('domain vocabulary single source of truth');

  // ── glossary define ──
  glossary
    .command('define [pairs...]')
    .description('define WORD=DEFINITION pairs (batch up to 50, all-or-nothing)')
    .option('--from <file>', 'read entries from YAML file (- for STDIN)')
    .action(async (pairs: string[], opts: { from?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          let entries: Array<{ word: string; definition: string }> = [];
          if (opts.from) {
            entries = await loadEntriesFromFile(opts.from);
          }
          for (const arg of pairs) entries.push(parseDefinitionPair(arg));
          if (entries.length === 0) throw new CliUsageError('no entries provided (use WORD=DEF args or --from)');
          const result = await defineGlossary(rt.ctx, { entries });
          return ok({
            results: result.results,
            total: result.results.length,
            created: result.results.filter((r) => r.action === 'created').length,
            updated: result.results.filter((r) => r.action === 'updated').length,
          });
        },
        globalFlags,
      );
    });

  // ── glossary lookup ──
  glossary
    .command('lookup [word]')
    .description('look up a word, or list all if WORD omitted')
    .action(async (word: string | undefined, _opts, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = lookupGlossary(rt.ctx, word);
          if (word) {
            return ok({ found: result.found, entry: result.entry ?? null });
          }
          return ok({
            entries: result.entries ?? [],
            total: (result.entries ?? []).length,
          });
        },
        globalFlags,
      );
    });

  // ── glossary remove ──
  glossary
    .command('remove <word>')
    .description('remove a glossary entry (cards referencing it become drifted)')
    .option('--yes', 'skip confirmation prompt (required for non-TTY)')
    .action(async (word: string, opts: { yes?: boolean }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          await confirmDestructive({
            yes: !!opts.yes,
            opName: 'glossary remove',
            prompt: `glossary remove will DELETE word '${word}' (cards referencing it become drifted). Type "yes" to proceed: `,
          });
          const result = await removeGlossary(rt.ctx, word);
          return ok({ removed: result.removed, affected_card_keys: result.affectedCardKeys });
        },
        globalFlags,
      );
    });

  // ── glossary rename ──
  glossary
    .command('rename <oldWord> <newWord>')
    .description('rename a glossary word (auto-updates card glossary fields)')
    .option('--def <text>', 'optional new definition')
    .action(async (oldWord: string, newWord: string, opts: { def?: string }, cmd) => {
      const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
      await run(
        async (rt: CliRuntime) => {
          const result = await renameGlossary(rt.ctx, oldWord, newWord, opts.def);
          const data = {
            renamed_from: result.renamedFrom,
            renamed_to: result.renamedTo,
            definition: result.definition,
            cards_updated: result.cardsUpdated,
            file_write_failures: result.fileWriteFailures,
          };
          if (result.fileWriteFailures.length > 0) {
            const errors: CliMessage[] = result.fileWriteFailures.map((key) => ({
              code: 'GLOSSARY_RENAME_FILE_WRITE_FAILED',
              message: `failed to write updated glossary into card file`,
              key,
            }));
            return partial(data, errors);
          }
          return ok(data);
        },
        globalFlags,
      );
    });
}
