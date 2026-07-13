/**
 * CLI context: build EmberdeckContext from global flags + config file.
 * Each command receives this via Commander's hook.
 */

import { isErr } from '@zipbul/result';
import { setupEmberdeck, teardownEmberdeck } from '../setup';
import { loadConfig, loadConfigFromPath, mergeCliArgs, ConfigLoadError } from '../config-file';
import type { EmberdeckContext } from '../config';
import type { OutputContext } from './output';
import { buildOutputContext, emitWarning } from './output';

export interface GlobalFlags {
  config?: string;
  dir?: string;
  dbPath?: string;
  projectRoot?: string;
  quiet?: boolean;
  verbose?: boolean;
  /** [§10 P1.1] open the card index read-only + skip entry sync (write-free). */
  readonly?: boolean;
}

export interface CliRuntime {
  ctx: EmberdeckContext;
  output: OutputContext;
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
    throw new ConfigLoadError(`config load failed: ${configResult.data.message}`, configResult.data);
  }

  const merged = mergeCliArgs(configResult, {
    dir: flags.dir,
    dbPath: flags.dbPath,
    projectRoot: flags.projectRoot,
  });

  const output = buildOutputContext({ quiet: flags.quiet });

  const ctx = await setupEmberdeck({
    cardsDir: merged.cardsDir,
    dbPath: merged.dbPath,
    projectRoot: merged.projectRoot,
    analysisIgnore: merged.analysisIgnore,
    ignorePatterns: merged.ignorePatterns,
    regressionThreshold: merged.regressionThreshold,
    readonly: flags.readonly,
  });
  // Inject the CLI diagnostic sink so ops can surface non-fatal
  // warnings without importing the CLI layer (the dependency points
  // inward via this abstraction).
  ctx.emitWarning = emitWarning;

  return {
    ctx,
    output,
    cleanup: () => teardownEmberdeck(ctx),
  };
}
