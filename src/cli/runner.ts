/**
 * Common command runner: builds runtime, executes command, renders, exits.
 * All command actions go through this.
 */

import { buildRuntime, type GlobalFlags, type CliRuntime } from './context';
import { render, statusToExitCode, type CliResult } from './output';
import { toCliError } from './errors';
import { EXIT } from './exit-codes';

export type CommandFn = (rt: CliRuntime, args: unknown[]) => Promise<CliResult>;

/**
 * Execute a command with full lifecycle: build runtime, run, render, exit.
 *
 * @param fn - Command implementation
 * @param args - Positional + option args from Commander
 * @param globalFlags - Global flags (already extracted)
 * @param options - render/exit overrides
 */
export async function run(
  fn: CommandFn,
  args: unknown[],
  globalFlags: GlobalFlags,
  options: { humanRenderer?: (data: unknown) => string; partialIsFailure?: boolean } = {},
): Promise<void> {
  let rt: CliRuntime | undefined;
  let result: CliResult;

  try {
    rt = await buildRuntime(globalFlags);
    result = await fn(rt, args);
  } catch (e) {
    const cliErr = toCliError(e);
    result = {
      schemaVersion: { major: 1, minor: 0 },
      status: 'error',
      data: null,
      warnings: [],
      errors: [],
      error: cliErr,
    };
    // best-effort cleanup
    try { await rt?.cleanup(); } catch {}
    const ctx = rt?.output ?? { mode: process.stdout.isTTY ? 'human' as const : 'json' as const, color: !!process.stdout.isTTY };
    render(result, ctx);
    process.exit(statusToExitCode(result, options));
  }

  try { await rt.cleanup(); } catch {}
  render(result, rt.output, options.humanRenderer);
  process.exit(statusToExitCode(result, options));
}

/**
 * Extract global flags from Commander's parsed options.
 * Commander stores parent program opts via .optsWithGlobals() or .opts().
 */
export function extractGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
  return {
    config: opts.config as string | undefined,
    dir: opts.dir as string | undefined,
    dbPath: opts.dbPath as string | undefined,
    projectRoot: opts.projectRoot as string | undefined,
    output: opts.output as string | undefined,
    json: opts.json as boolean | undefined,
    quiet: opts.quiet as boolean | undefined,
    noColor: opts.color === false,
    verbose: opts.verbose as boolean | undefined,
  };
}

export { EXIT };
