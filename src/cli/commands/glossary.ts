/**
 * `ed glossary` subcommands
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { defineGlossary, lookupGlossary, removeGlossary, renameGlossary } from '../../ops/glossary';
import { validateGlossaryEntry } from '../../glossary/validation';
import { confirmDestructive } from '../confirm';
import { CliUsageError } from '../usage-error';
import { errorMessage } from '../../util/error';

interface GlossaryItem {
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
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CliUsageError(`failed to parse --from as JSON: ${errorMessage(e)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new CliUsageError('--from FILE must be a JSON array of {word, definition} objects');
  }
  return parsed.map((item: GlossaryItem, i: number) => {
    if (!item.word || !item.definition) {
      throw new CliUsageError(`--from FILE entry ${i} missing word or definition`);
    }
    return { word: item.word, definition: item.definition };
  });
}

export async function glossaryDefineAction(
  pairs: string[],
  opts: { from?: string },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    // These commands write glossary.yaml; --read-only must not mutate the
    // project, so refuse rather than write and report success.
    if (rt.ctx.readonly) {
      throw new CliUsageError('glossary define writes glossary.yaml and cannot run with --read-only');
    }
    let entries: Array<{ word: string; definition: string }> = [];
    if (opts.from) entries = await loadEntriesFromFile(opts.from);
    for (const arg of pairs) entries.push(parseDefinitionPair(arg));
    if (entries.length === 0) throw new CliUsageError('no entries provided (use WORD=DEF args or --from)');

    // Per-entry pre-validation: failures go into `failed[]` (CLI helper splits),
    // surviving entries are passed to the op for all-or-nothing write.
    const accepted: Array<{ word: string; definition: string; inputIndex: number }> = [];
    const failed: Array<{ inputIndex: number; reason: string }> = [];
    entries.forEach((entry, i) => {
      try {
        validateGlossaryEntry(entry);
        accepted.push({ ...entry, inputIndex: i });
      } catch (e) {
        failed.push({ inputIndex: i, reason: errorMessage(e) });
      }
    });

    const defined: Array<{ word: string; definition: string; action: 'created' | 'updated' }> = [];
    if (accepted.length > 0) {
      try {
        const result = await defineGlossary(rt.ctx, {
          entries: accepted.map(({ word, definition }) => ({ word, definition })),
        });
        for (const r of result.results) {
          defined.push({ word: r.word, definition: r.definition, action: r.action });
        }
      } catch (e) {
        // op still throws all-or-nothing on hard validation errors — convert to
        // a single failed entry covering the whole batch so the agent sees it.
        for (const a of accepted) {
          failed.push({ inputIndex: a.inputIndex, reason: errorMessage(e) });
        }
      }
    }

    const data = { defined, failed, total: entries.length };
    return { data, exitCode: failed.length > 0 ? 2 : 0 };
  }, cmd);
}

export async function glossaryLookupAction(
  word: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = lookupGlossary(rt.ctx, word);
    let entries: Array<{ word: string; definition: string }> = [];
    if (word) {
      entries = result.entry ? [{ word: result.entry.word, definition: result.entry.definition }] : [];
    } else {
      entries = (result.entries ?? []).map((e) => ({ word: e.word, definition: e.definition }));
    }
    return { data: { entries, total: entries.length } };
  }, cmd);
}

export async function glossaryRemoveAction(
  word: string,
  opts: { yes?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    // These commands write glossary.yaml; --read-only must not mutate the
    // project, so refuse rather than write and report success.
    if (rt.ctx.readonly) {
      throw new CliUsageError('glossary remove writes glossary.yaml and cannot run with --read-only');
    }
    await confirmDestructive({
      yes: !!opts.yes,
      opName: 'glossary remove',
      prompt: `glossary remove will DELETE word '${word}' (cards referencing it become drifted). Type "yes" to proceed: `,
    });
    const result = await removeGlossary(rt.ctx, word);
    return { data: { word: result.removed, affectedCardKeys: result.affectedCardKeys } };
  }, cmd);
}

export async function glossaryRenameAction(
  oldWord: string,
  newWord: string,
  opts: { def?: string },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    // These commands write glossary.yaml; --read-only must not mutate the
    // project, so refuse rather than write and report success.
    if (rt.ctx.readonly) {
      throw new CliUsageError('glossary rename writes glossary.yaml and cannot run with --read-only');
    }
    const result = await renameGlossary(rt.ctx, oldWord, newWord, opts.def);
    const data: {
      oldWord: string;
      newWord: string;
      affectedCardKeys: string[];
      failedFileWrites?: string[];
    } = {
      oldWord: result.renamedFrom,
      newWord: result.renamedTo,
      affectedCardKeys: result.affectedCardKeys,
    };
    if (result.fileWriteFailures.length > 0) {
      data.failedFileWrites = result.fileWriteFailures;
      return { data, exitCode: 2 };
    }
    return { data };
  }, cmd);
}

export function registerGlossary(program: Command): void {
  const glossary = program.command('glossary').description('domain vocabulary single source of truth');

  glossary
    .command('define [pairs...]')
    .description('define WORD=DEFINITION pairs (batch up to 50)')
    .option('--from <file>', 'read entries from JSON file (- for STDIN)')
    .action(glossaryDefineAction);

  glossary
    .command('lookup [word]')
    .description('look up a word, or list all if WORD omitted')
    .action(glossaryLookupAction);

  glossary
    .command('remove <word>')
    .description('remove a glossary entry (cards referencing it become drifted)')
    .option('--yes', 'skip confirmation prompt (required for non-TTY)')
    .action(glossaryRemoveAction);

  glossary
    .command('rename <oldWord> <newWord>')
    .description('rename a glossary word (auto-updates card glossary fields)')
    .option('--def <text>', 'optional new definition')
    .action(glossaryRenameAction);
}
