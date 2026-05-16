/**
 * Common command runner: builds runtime, runs the command, emits stdout/stderr
 * channels per §1.1, exits via §1.5 EXIT enum.
 *
 * Per-command actions return `{ data?, exitCode? }`; runner owns lifecycle
 * (cleanup, signal traps, stdout drain, exit).
 *
 * @spec cli-surface/command-routing-and-output/runner-and-output
 */

import type { Command } from 'commander';
import { buildRuntime, type GlobalFlags, type CliRuntime } from './context';
import { errorMessage } from '../util/error';
import { emitResult, emitError, emitVerbose, emitWarning, buildOutputContext} from './output';
import { toCliError, ERROR_CODE_TO_EXIT } from './errors';
import { EXIT, type ExitCode } from './exit-codes';
import { ensureCardsSynced } from '../ops/sync';

export type CommandReturn = { data?: unknown; exitCode?: ExitCode } | undefined;
export type CommandFn = (rt: CliRuntime) => Promise<CommandReturn>;

/**
 * Execute a command with full lifecycle: build runtime, run, emit, exit.
 *
 * @spec cli-surface/command-routing-and-output/runner-and-output
 */
export async function run(fn: CommandFn, cmd: Command): Promise<void> {
  const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
  const outCtx = buildOutputContext(globalFlags);

  let rt: CliRuntime | undefined;

  // Trap SIGINT/SIGTERM: best-effort cleanup then exit 130. A second signal
  // during cleanup short-circuits to hard exit.
  let inSignal = false;
  const onSig = async (sig: string): Promise<void> => {
    if (inSignal) process.exit(EXIT.SIGINT);
    inSignal = true;
    try {
      await rt?.cleanup();
    } catch (cleanupErr) {
      emitWarning({
        code: 'cleanup-failed',
        message: errorMessage(cleanupErr),
      });
    }
    emitError({ code: 'sigint', message: `${sig} received, exiting` });
    process.exit(EXIT.SIGINT);
  };
  const onSigint = (): void => { void onSig('SIGINT'); };
  const onSigterm = (): void => { void onSig('SIGTERM'); };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const verbose = globalFlags.verbose
    ? (m: string, d?: Record<string, unknown>) => emitVerbose(m, d)
    : (_: string, _d?: Record<string, unknown>) => { /* suppressed */ };

  let exitCode: ExitCode = EXIT.OK;
  try {
    verbose('buildRuntime', { config: globalFlags.config, dir: globalFlags.dir });
    rt = await buildRuntime(globalFlags);
    verbose('runtime ready', { cardsDir: rt.ctx.cardsDir, projectRoot: rt.ctx.projectRoot });

    // Card files are SSOT; sync external edits before commands read DB.
    const syncFailures = await ensureCardsSynced(rt.ctx);
    if (!outCtx.quiet) {
      for (const f of syncFailures) {
        emitWarning({
          code: 'card-sync-failed',
          message: `${f.filePath}: ${f.error}`,
          details: { filePath: f.filePath },
        });
      }
    }
    verbose('cards synced', { failures: syncFailures.length });

    const ret = await fn(rt);
    if (ret && ret.data !== undefined) {
      await emitResult(ret.data, outCtx);
    }
    exitCode = ret?.exitCode ?? EXIT.OK;
    verbose('command done', { exitCode });
  } catch (e) {
    const tagged = e as { _outputEncode?: boolean; _stdoutWrite?: boolean };
    if (tagged?._outputEncode) {
      emitError({ code: 'output-encode-failed', message: (e as Error).message });
      exitCode = EXIT.GENERIC_ERROR;
    } else if (tagged?._stdoutWrite) {
      emitError({ code: 'stdout-write-failed', message: (e as Error).message });
      exitCode = EXIT.PERMISSION_OR_IO;
    } else {
      const cliErr = toCliError(e);
      emitError({
        code: cliErr.code,
        message: cliErr.message,
        ...(cliErr.details ? { details: cliErr.details } : {}),
      });
      exitCode = (ERROR_CODE_TO_EXIT[cliErr.code] ?? EXIT.GENERIC_ERROR) as ExitCode;
    }
  }

  try {
    await rt?.cleanup();
  } catch (cleanupErr) {
    emitWarning({
      code: 'cleanup-failed',
      message: errorMessage(cleanupErr),
    });
  }
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  process.exit(exitCode);
}

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
