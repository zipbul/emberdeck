/**
 * `ed glossary` subcommands per CLI_PLAN §4.2.
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run, extractGlobalFlags } from '../runner';
import { ok, partial, type CliMessage } from '../output';
import type { CliRuntime } from '../context';
import { defineGlossary, lookupGlossary, removeGlossary, renameGlossary } from '../../ops/glossary';

interface YamlGlossaryItem {
  word?: string;
  definition?: string;
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

function parseDefinitionPair(arg: string): { word: string; definition: string } {
  const idx = arg.indexOf('=');
  if (idx <= 0) throw new Error(`expected WORD=DEFINITION, got: ${arg}`);
  return { word: arg.slice(0, idx), definition: arg.slice(idx + 1) };
}

async function loadEntriesFromFile(value: string): Promise<Array<{ word: string; definition: string }>> {
  const text = value === '-' ? await readStdin() : await readFile(value, 'utf-8');
  const parsed = Bun.YAML.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('--from FILE must be a YAML array of {word, definition} objects');
  }
  return parsed.map((item: YamlGlossaryItem, i: number) => {
    if (!item.word || !item.definition) {
      throw new Error(`--from FILE entry ${i} missing word or definition`);
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
          if (entries.length === 0) throw new Error('no entries provided (use WORD=DEF args or --from)');
          const result = await defineGlossary(rt.ctx, { entries });
          return ok({
            results: result.results,
            total: result.results.length,
            created: result.results.filter((r) => r.action === 'created').length,
            updated: result.results.filter((r) => r.action === 'updated').length,
          });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { total: number; created: number; updated: number };
          return `glossary: ${d.created} created, ${d.updated} updated (${d.total} total)`;
        } },
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
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { entries?: Array<{ word: string; definition: string }>; entry?: { word: string; definition: string } | null; found?: boolean };
          if (d.entries) {
            if (d.entries.length === 0) return '(empty glossary)\n';
            return d.entries.map((e) => `${e.word}: ${e.definition}`).join('\n');
          }
          if (!d.found || !d.entry) return '(not found)\n';
          return `${d.entry.word}: ${d.entry.definition}`;
        } },
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
          if (!opts.yes && !process.stdin.isTTY) {
            throw new Error('glossary remove requires --yes when stdin is not a TTY');
          }
          const result = await removeGlossary(rt.ctx, word);
          return ok({ removed: result.removed, affected_card_keys: result.affectedCardKeys });
        },
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { removed: string; affected_card_keys: string[] };
          const lines = [`removed glossary word '${d.removed}'`];
          if (d.affected_card_keys.length > 0) {
            lines.push(`  ${d.affected_card_keys.length} card(s) affected: ${d.affected_card_keys.join(', ')}`);
          }
          return lines.join('\n');
        } },
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
        [],
        globalFlags,
        { humanRenderer: (data) => {
          const d = data as { renamed_from: string; renamed_to: string; cards_updated: number; file_write_failures: string[] };
          const lines = [`glossary '${d.renamed_from}' → '${d.renamed_to}' (${d.cards_updated} card(s) updated)`];
          if (d.file_write_failures.length > 0) {
            lines.push(`  file write failures: ${d.file_write_failures.join(', ')}`);
          }
          return lines.join('\n');
        } },
      );
    });
}
