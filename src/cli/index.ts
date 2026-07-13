/**
 * `ed` CLI dispatcher (Commander v14).
 *
 * Top-level structure:
 *   ed card     {create, update, delete, rename, get, list, search, export, set-status, tree, context, relations}
 *   ed glossary {define, lookup, remove, rename}
 *   ed validate {(no arg), cards, links}
 *   ed check    {drift, coverage, impact, regression, interactions}
 *   ed spec     {annotate, sync, sync-symbols}
 *   ed bulk     {create, sync}
 *   ed init
 *   ed analyze
 *   ed reset
 */

import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { registerCard } from './commands/card';
import { registerValidate } from './commands/validate';
import { registerCheck } from './commands/check';
import { registerGlossary } from './commands/glossary';
import { registerSpec } from './commands/spec';
import { registerBulk } from './commands/bulk';
import { registerSingle } from './commands/single';
import { emitError } from './output';
import { errorMessage } from '../util/error';
import { EXIT } from './exit-codes';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ed')
    .description('Emberdeck — card-based design knowledge for AI vibe coding')
    .version(pkg.version)
    // global flags
    .option('--config <path>', 'config file (.emberdeck.jsonc/.json)')
    .option('--dir <path>', 'cards directory (overrides config)')
    .option('--db-path <path>', 'card index database file (overrides config)')
    .option('--project-root <path>', 'project root for source code analysis (overrides config)')
    .option('--quiet, -q', 'compact JSON on stdout; suppress warning/verbose stderr lines')
    .option('--verbose', 'verbose stderr (level:verbose JSON-lines)')
    .option('--read-only', 'open the card index read-only; skip the entry disk→DB sync (write-free: validate on a read-only fs / migration dry-run)')
    .exitOverride();

  registerCard(program);
  registerGlossary(program);
  registerValidate(program);
  registerCheck(program);
  registerSpec(program);
  registerBulk(program);
  registerSingle(program);

  return program;
}

/**
 * Top-level commander fallback. Subcommand actions go through `runner.run`
 * (which owns its own try/catch + emit + exit). This handler only catches
 * commander parse failures (invalid args, unknown options, missing positionals,
 * --help/--version) before any subcommand action runs.
 *
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e instanceof CommanderError) {
      // --help / --version are not errors — exit cleanly.
      if (e.code === 'commander.help' || e.code === 'commander.helpDisplayed' || e.code === 'commander.version') {
        process.exit(EXIT.OK);
      }
      emitError({ code: 'cli-usage-error', message: e.message });
      process.exit(EXIT.VALIDATION_FAILURE);
    }
    // Defensive: any non-CommanderError that reaches here is a bug.
    const msg = errorMessage(e);
    emitError({ code: 'internal-error', message: msg });
    process.exit(EXIT.GENERIC_ERROR);
  }
}
