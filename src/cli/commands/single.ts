/**
 * Single top-level commands: init, analyze, reset.
 */

import { mkdir, writeFile, readFile, stat, appendFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { Command } from 'commander';
import { run } from '../runner';
import type { CliRuntime } from '../context';
import { analyze } from '../../ops/analyze';
import { resetEmberdeck } from '../../ops/glossary';
import { parsePositiveInt } from '../parsers';
import { confirmDestructive } from '../confirm';

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** @spec cli-surface/command-routing-and-output/commands/init */
export async function initAction(
  opts: { projectRoot?: string; cardsDir?: string; gitignore?: boolean; force?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (_rt: CliRuntime) => {
    const cwd = process.cwd();
    const projectRoot = opts.projectRoot ? resolve(opts.projectRoot) : cwd;
    const cardsDir = opts.cardsDir ? resolve(opts.cardsDir) : resolve(cwd, '.emberdeck/cards');
    const configPath = resolve(cwd, '.emberdeck.jsonc');
    const glossaryPath = resolve(dirname(cardsDir), 'glossary.yaml');
    const gitignorePath = resolve(cwd, '.gitignore');

    const created: string[] = [];
    const skipped: string[] = [];

    if (await pathExists(cardsDir)) {
      skipped.push(relative(cwd, cardsDir));
    } else {
      await mkdir(cardsDir, { recursive: true });
      created.push(relative(cwd, cardsDir));
    }

    const configExists = await pathExists(configPath);
    if (configExists && !opts.force) {
      skipped.push(relative(cwd, configPath));
    } else {
      const cardsDirRel = relative(cwd, cardsDir);
      const projectRootRel = relative(cwd, projectRoot) || '.';
      const config = `// Emberdeck configuration
// See \`ed --help\` for available commands.
{
  // Where card files live (.md with YAML frontmatter)
  "cardsDir": ${JSON.stringify(cardsDirRel)},

  // Project root for source code analysis. Set to the directory containing
  // your tsconfig.json. Use "." for the current directory.
  "projectRoot": ${JSON.stringify(projectRootRel)},

  // Glob patterns for files to exclude from coverage and indexing.
  "ignorePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**"
  ],

  // Drifted-card ratio threshold for \`ed check regression\` (0.0 - 1.0).
  "regressionThreshold": 0
}
`;
      await writeFile(configPath, config, 'utf-8');
      created.push(relative(cwd, configPath));
    }

    if (await pathExists(glossaryPath) && !opts.force) {
      skipped.push(relative(cwd, glossaryPath));
    } else {
      await writeFile(glossaryPath, '[]\n', 'utf-8');
      created.push(relative(cwd, glossaryPath));
    }

    let gitignoreUpdated = false;
    if (opts.gitignore !== false && (await pathExists(gitignorePath))) {
      const existing = await readFile(gitignorePath, 'utf-8');
      const lines = existing.split('\n');
      const want = ['.gildash/', '.emberdeck/data.db', '.emberdeck/data.db-journal', '.emberdeck/data.db-shm', '.emberdeck/data.db-wal'];
      const missing = want.filter((p) => !lines.includes(p));
      if (missing.length > 0) {
        const block = `\n# emberdeck\n${missing.join('\n')}\n`;
        await appendFile(gitignorePath, block, 'utf-8');
        gitignoreUpdated = true;
      }
    }

    return {
      data: {
        projectRoot,
        cardsDir,
        configPath,
        glossaryPath,
        created,
        skipped,
        gitignoreUpdated,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/analyze */
export async function analyzeAction(
  opts: { driftedLimit?: number; driftedOffset?: number },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => {
    const result = await analyze(rt.ctx, {
      limit: opts.driftedLimit,
      offset: opts.driftedOffset,
    });
    const offset = opts.driftedOffset ?? 0;
    const limit = opts.driftedLimit ?? result.driftedCardsTotal;
    return {
      data: {
        health: result.health,
        coverage: result.coverage,
        drifted: {
          cards: result.driftedCards,
          total: result.driftedCardsTotal,
          limit,
          offset,
          hasMore: offset + result.driftedCards.length < result.driftedCardsTotal,
        },
        glossary: result.glossary,
        unlinkedSymbols: result.unlinkedSymbols,
      },
    };
  }, cmd);
}

/** @spec cli-surface/command-routing-and-output/commands/reset */
export async function resetAction(opts: { yes?: boolean }, cmd: Command): Promise<void> {
  await run(async (rt: CliRuntime) => {
    await confirmDestructive({
      yes: !!opts.yes,
      opName: 'reset',
      prompt: 'reset will DELETE ALL cards and glossary. Type "yes" to proceed: ',
    });
    const result = await resetEmberdeck(rt.ctx);
    return {
      data: {
        cardsDeleted: result.cardsDeleted,
        glossaryCleared: result.glossaryCleared,
        failedFileDeletes: result.failedFileDeletes,
      },
      exitCode: result.failedFileDeletes.length > 0 ? 2 : 0,
    };
  }, cmd);
}

export function registerSingle(program: Command): void {
  program
    .command('init')
    .description('scaffold an emberdeck project (config file, cards directory, glossary, .gitignore entries). Idempotent.')
    .option('--project-root <path>', 'project root for source code analysis (default: cwd)')
    .option('--cards-dir <path>', 'where to store card files (default: .emberdeck/cards)')
    .option('--no-gitignore', 'skip .gitignore update')
    .option('--force', 'overwrite existing config / glossary')
    .action(initAction);

  program
    .command('analyze')
    .description('full project analysis (drift + coverage + glossary)')
    .option('--drifted-limit <n>', 'paginate drifted cards (default: all)', parsePositiveInt('--drifted-limit'))
    .option('--drifted-offset <n>', 'drifted cards offset', parsePositiveInt('--drifted-offset'))
    .action(analyzeAction);

  program
    .command('reset')
    .description('delete every card and clear the glossary. DESTRUCTIVE.')
    .option('--yes', 'skip confirmation prompt (required for non-TTY)')
    .action(resetAction);
}
