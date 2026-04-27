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
 * Build an OutputContext for the catch path when buildRuntime() failed.
 * Honors --no-color, NO_COLOR, CLICOLOR_FORCE, --json/--quiet/--output identically to buildRuntime.
 */
function buildFallbackOutputContext(flags: GlobalFlags): import('./output').OutputContext {
  const mode = (() => {
    if (flags.output === 'json' || flags.json) return 'json' as const;
    if (flags.output === 'quiet' || flags.quiet) return 'quiet' as const;
    if (flags.output === 'human') return 'human' as const;
    return process.stdout.isTTY ? ('human' as const) : ('json' as const);
  })();
  const noColorEnv = process.env.NO_COLOR && process.env.NO_COLOR.length > 0;
  const forceColor = process.env.CLICOLOR_FORCE && process.env.CLICOLOR_FORCE.length > 0;
  const color = !flags.noColor && !noColorEnv && (forceColor ? true : !!process.stdout.isTTY);
  return { mode, color };
}

/**
 * Decide CliResult.status from an error code.
 * Transient/retryable errors → 'unknown' (exit 7); everything else → 'error'.
 * Exported for testability.
 */
export function classifyErrorStatus(code: string): 'unknown' | 'error' {
  // Add codes here when ops layer surfaces transient failures. Currently:
  // - GILDASH_TRANSIENT: gildash search timeout (not yet emitted; reserved)
  // - NETWORK_TRANSIENT: future remote integrations
  if (code === 'GILDASH_TRANSIENT' || code === 'NETWORK_TRANSIENT') return 'unknown';
  return 'error';
}

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

  // Trap SIGINT/SIGTERM: best-effort cleanup (DB close, file handle release) then exit 130.
  const signalHandler = async (sig: string): Promise<void> => {
    try { await rt?.cleanup(); } catch { /* best-effort */ }
    process.stderr.write(`\n${sig} received, exiting\n`);
    process.exit(EXIT.SIGINT);
  };
  const onSigint = (): void => { void signalHandler('SIGINT'); };
  const onSigterm = (): void => { void signalHandler('SIGTERM'); };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  // Verbose only emits structural metadata (paths, status, error class names) —
  // never user input, command args, card body content, or anything containing
  // potential secrets/tokens from frontmatter fields.
  const verboseLog = globalFlags.verbose
    ? (msg: string) => process.stderr.write(`[verbose] ${msg}\n`)
    : (_msg: string) => {};

  try {
    verboseLog(`buildRuntime: config=${globalFlags.config ?? '(auto)'} dir=${globalFlags.dir ?? '(default)'}`);
    rt = await buildRuntime(globalFlags);
    verboseLog(`runtime ready: cardsDir=${rt.ctx.cardsDir} gildash=${rt.ctx.gildash ? 'on' : 'off'}`);
    result = await fn(rt, args);
    verboseLog(`command done: status=${result.status} warnings=${result.warnings.length} errors=${result.errors.length}`);
  } catch (e) {
    // Verbose only emits the error class name; full message goes to user via render(),
    // not duplicated here, to avoid leaking secrets through stderr verbose channel.
    verboseLog(`command threw: ${e instanceof Error ? e.constructor.name : 'unknown'}`);
    const cliErr = toCliError(e);
    result = {
      schemaVersion: { major: 1, minor: 0 },
      status: classifyErrorStatus(cliErr.code),
      data: null,
      warnings: [],
      errors: [],
      error: cliErr,
    };
    // best-effort cleanup
    try { await rt?.cleanup(); } catch {}
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    const ctx = rt?.output ?? buildFallbackOutputContext(globalFlags);
    render(result, ctx);
    process.exit(statusToExitCode(result, options));
  }

  try { await rt.cleanup(); } catch {}
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
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
