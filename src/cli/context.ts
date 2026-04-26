/**
 * CLI context: build EmberdeckContext from global flags + config file.
 * Each command receives this via Commander's hook.
 */

import { isErr } from '@zipbul/result';
import { setupEmberdeck, teardownEmberdeck } from '../setup';
import { loadConfig, loadConfigFromPath, mergeCliArgs } from '../config-file';
import type { EmberdeckContext } from '../config';
import type { OutputContext } from './output';
import { resolveOutputMode } from './output';

export interface GlobalFlags {
  config?: string;
  dir?: string;
  dbPath?: string;
  projectRoot?: string;
  output?: string;
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  verbose?: boolean;
}

export interface CliRuntime {
  ctx: EmberdeckContext;
  output: OutputContext;
  verbose: boolean;
  cleanup: () => Promise<void>;
}

/**
 * Build CliRuntime from global flags. Loads config, sets up EmberdeckContext.
 * Throws on config load failure.
 */
export async function buildRuntime(flags: GlobalFlags): Promise<CliRuntime> {
  const configResult = flags.config
    ? await loadConfigFromPath(flags.config)
    : await loadConfig();

  if (isErr(configResult)) {
    throw new Error(`config load failed: ${configResult.data.message}`);
  }

  const merged = mergeCliArgs(configResult, {
    dir: flags.dir,
    dbPath: flags.dbPath,
    projectRoot: flags.projectRoot,
  });

  const ctx = await setupEmberdeck({
    cardsDir: merged.cardsDir,
    dbPath: merged.dbPath,
    projectRoot: merged.projectRoot,
    gildashIgnore: merged.gildashIgnore,
    ignorePatterns: merged.ignorePatterns,
    regressionThreshold: merged.regressionThreshold,
  });

  const mode = resolveOutputMode({
    output: flags.output,
    json: flags.json,
    quiet: flags.quiet,
  });

  const color = !flags.noColor && process.stdout.isTTY;

  return {
    ctx,
    output: { mode, color },
    verbose: !!flags.verbose,
    cleanup: () => teardownEmberdeck(ctx),
  };
}
