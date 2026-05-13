/**
 * Common command runner: builds runtime, executes command, renders, exits.
 * All command actions go through this.
 */

import type { Command } from 'commander';
import { buildRuntime, type GlobalFlags, type CliRuntime } from './context';
import { render, statusToExitCode, type CliResult } from './output';
import { toCliError } from './errors';
import { EXIT } from './exit-codes';
import { ensureCardsSynced } from '../ops/sync';

export type CommandFn = (rt: CliRuntime) => Promise<CliResult>;

/**
 * Build an OutputContext for the catch path when buildRuntime() failed.
 */
function buildFallbackOutputContext(flags: GlobalFlags): import('./output').OutputContext {
  const mode = flags.quiet ? 'quiet' as const : 'json' as const;
  return { mode };
}

/**
 * Decide CliResult.status from an error code.
 * Transient/retryable errors → 'unknown' (exit 7); everything else → 'error'.
 * Exported for testability.
  * @spec cli-surface/command-routing-and-envelope/runner-and-output
 */
export function classifyErrorStatus(code: string): 'unknown' | 'error' {
  // Add codes here when ops layer surfaces transient failures. Currently:
  // - GILDASH_TRANSIENT: gildash search timeout (not yet emitted; reserved)
  // - NETWORK_TRANSIENT: future remote integrations
  if (code === 'GILDASH_TRANSIENT' || code === 'NETWORK_TRANSIENT') return 'unknown';
  return 'error';
}

/**
 * Merge auto-sync per-file failures into result.warnings as CARD_SYNC_FAILED
 * entries. Suppress any failure whose filePath already appears in
 * result.errors[].details.file_path (see runner-and-output POST-004 / INV-003).
 *
 * Pure function — exported for unit testing. Does not mutate inputs. On the
 * no-op paths (no failures, or all failures suppressed) the input result is
 * returned by reference; callers MUST NOT mutate the returned object.
 * @spec cli-surface/command-routing-and-envelope/runner-and-output
 */
export function mergeCardSyncWarnings(
  result: CliResult,
  syncFailures: ReadonlyArray<{ filePath: string; error: string }>,
): CliResult {
  if (syncFailures.length === 0) return result;
  const reportedPaths = new Set<string>();
  for (const e of result.errors) {
    const fp = e.details?.file_path;
    if (typeof fp === 'string') reportedPaths.add(fp);
  }
  const surfaced = syncFailures.filter((f) => !reportedPaths.has(f.filePath));
  if (surfaced.length === 0) return result;
  return {
    ...result,
    warnings: [
      ...surfaced.map((f) => ({
        code: 'CARD_SYNC_FAILED',
        message: `${f.filePath}: ${f.error}`,
      })),
      ...result.warnings,
    ],
  };
}

/**
 * Execute a command with full lifecycle: build runtime, run, render, exit.
 * Extracts global flags from the Commander instance so callers don't repeat
 * `extractGlobalFlags(cmd.optsWithGlobals())`.
  * @spec cli-surface/command-routing-and-envelope/runner-and-output
 */
export async function run(
  fn: CommandFn,
  cmd: Command,
  options: { partialIsFailure?: boolean } = {},
): Promise<void> {
  const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
  let rt: CliRuntime | undefined;
  let result: CliResult;

  // Trap SIGINT/SIGTERM: best-effort cleanup (DB close, file handle release) then exit 130.
  // Repeated Ctrl+C during cleanup must not re-enter; second signal short-circuits to hard exit.
  let signalInFlight = false;
  const signalHandler = async (sig: string): Promise<void> => {
    if (signalInFlight) {
      process.stderr.write(`\nsecond ${sig} received, hard exit\n`);
      process.exit(EXIT.SIGINT);
    }
    signalInFlight = true;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
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

  // Captured outside try so the catch block can still surface auto-sync
  // warnings even if the command threw before producing its own envelope.
  let syncFailures: Awaited<ReturnType<typeof ensureCardsSynced>> = [];
  try {
    verboseLog(`buildRuntime: config=${globalFlags.config ?? '(auto)'} dir=${globalFlags.dir ?? '(default)'}`);
    rt = await buildRuntime(globalFlags);
    verboseLog(`runtime ready: cardsDir=${rt.ctx.cardsDir} projectRoot=${rt.ctx.projectRoot}`);
    // Card files are SSOT, DB is a derived cache. Sync any external edits
    // before the command runs so reads see the freshest state.
    syncFailures = await ensureCardsSynced(rt.ctx);
    verboseLog(`cards synced: cardsDir=${rt.ctx.cardsDir} failures=${syncFailures.length}`);
    result = mergeCardSyncWarnings(await fn(rt), syncFailures);
    verboseLog(`command done: status=${result.status} warnings=${result.warnings.length} errors=${result.errors.length}`);
  } catch (e) {
    // Verbose only emits the error class name; full message goes to user via render(),
    // not duplicated here, to avoid leaking secrets through stderr verbose channel.
    verboseLog(`command threw: ${e instanceof Error ? e.constructor.name : 'unknown'}`);
    const cliErr = toCliError(e);
    result = mergeCardSyncWarnings({
      schemaVersion: { major: 1, minor: 0 },
      status: classifyErrorStatus(cliErr.code),
      data: null,
      warnings: [],
      errors: [],
      error: cliErr,
    }, syncFailures);
    // best-effort cleanup
    try { await rt?.cleanup(); } catch (ce) {
      verboseLog(`cleanup failed (catch path): ${ce instanceof Error ? ce.constructor.name : 'unknown'}`);
    }
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    const ctx = rt?.output ?? buildFallbackOutputContext(globalFlags);
    render(result, ctx);
    process.exit(statusToExitCode(result, options));
  }

  try { await rt.cleanup(); } catch (ce) {
    verboseLog(`cleanup failed (success path): ${ce instanceof Error ? ce.constructor.name : 'unknown'}`);
  }
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  render(result, rt.output);
  process.exit(statusToExitCode(result, options));
}

/**
 * Extract global flags from Commander's parsed options.
 * Commander stores parent program opts via .optsWithGlobals() or .opts().
 */
function extractGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
  return {
    config: opts.config as string | undefined,
    dir: opts.dir as string | undefined,
    dbPath: opts.dbPath as string | undefined,
    projectRoot: opts.projectRoot as string | undefined,
    quiet: opts.quiet as boolean | undefined,
    verbose: opts.verbose as boolean | undefined,
  };
}
