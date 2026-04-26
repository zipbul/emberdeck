/**
 * `ed` CLI dispatcher (Commander v14).
 *
 * Top-level structure (per CLI_PLAN §4):
 *   ed card     {create, update, delete, rename, get, list, search, export, set-status, tree, context, relations}
 *   ed glossary {define, lookup, remove, rename}
 *   ed validate {(no arg), cards, links, brief}
 *   ed check    {drift, coverage, impact, regression, interactions}
 *   ed spec     {annotate, sync, sync-symbols}
 *   ed bulk     {create, sync}
 *   ed analyze
 *   ed reset
 *
 * Phase 1 implements: card {get, list, create, update}, validate {cards, brief}, check coverage.
 * Other commands return "not yet implemented" stub in Phase 1.
 */

import { Command } from 'commander';
import { registerCard } from './commands/card';
import { registerValidate } from './commands/validate';
import { registerCheck } from './commands/check';
import { registerGlossary } from './commands/glossary';
import { registerSpec } from './commands/spec';
import { registerBulk } from './commands/bulk';
import { registerSingle } from './commands/single';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('ed')
    .description('Emberdeck — card-based design knowledge for AI vibe coding')
    .version('0.3.0-cli')
    // global flags
    .option('--config <path>', 'config file (.emberdeck.jsonc/.json)')
    .option('--dir <path>', 'cards directory (overrides config)')
    .option('--db-path <path>', 'SQLite DB file (overrides config)')
    .option('--project-root <path>', 'project root for gildash (overrides config)')
    .option('--output <mode>', 'output mode: human | json | quiet (default auto: TTY=human, pipe=json)')
    .option('--json', 'shortcut for --output=json')
    .option('--quiet, -q', 'shortcut for --output=quiet')
    .option('--no-color', 'disable color output')
    .option('--verbose', 'verbose stderr logging')
    // for help: showHelpAfterError so users see usage on bad invocation
    .showHelpAfterError('(run `ed --help` for full usage)');

  registerCard(program);
  registerGlossary(program);
  registerValidate(program);
  registerCheck(program);
  registerSpec(program);
  registerBulk(program);
  registerSingle(program);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
