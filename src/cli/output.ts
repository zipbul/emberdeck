/**
 * CLI output channel.
 *
 * stdout: JSON of the command's natural data shape (one value per invocation).
 * stderr: JSON-lines, one object per line. Schema:
 *   { level: 'error'|'warning'|'verbose', code: string, message: string, details? }
 *
 * `--quiet` does NOT change shape — only formatting (compact JSON) and
 * suppression of warning/verbose stderr lines.
 *
 * @spec cli-surface/command-routing-and-output/runner-and-output
 */

export interface OutputContext {
  quiet: boolean;
}

export function buildOutputContext(flags: { quiet?: boolean }): OutputContext {
  return { quiet: !!flags.quiet };
}

/**
 * Emit the command's data value to stdout as JSON, then drain the write so a
 * subsequent process.exit doesn't truncate large payloads. EPIPE is silenced
 * per UNIX convention; other write errors propagate to the runner's catch.
 * @spec cli-surface/command-routing-and-output/runner-and-output
 */
export async function emitResult(data: unknown, ctx: OutputContext): Promise<void> {
  let payload: string;
  try {
    payload = JSON.stringify(data, null, ctx.quiet ? undefined : 2) + '\n';
  } catch (e) {
    const err = new Error(`Output encode failed: ${e instanceof Error ? e.message : String(e)}`);
    (err as { _outputEncode?: boolean })._outputEncode = true;
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (err) => {
      if (!err) return resolve();
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return resolve();
      const wrapped = new Error(`stdout write failed: ${err.message}`);
      (wrapped as { _stdoutWrite?: boolean })._stdoutWrite = true;
      reject(wrapped);
    });
  });
}

/** @spec cli-surface/command-routing-and-output/runner-and-output */
export function emitWarning(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'warning', ...obj });
}

/** @spec cli-surface/command-routing-and-output/runner-and-output */
export function emitError(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'error', ...obj });
}

/** @spec cli-surface/command-routing-and-output/runner-and-output */
export function emitVerbose(message: string, details?: Record<string, unknown>): void {
  emitLine({ level: 'verbose', code: 'runtime', message, ...(details ? { details } : {}) });
}

function emitLine(obj: {
  level: 'error' | 'warning' | 'verbose';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): void {
  try {
    process.stderr.write(JSON.stringify(obj) + '\n');
  } catch {
    /* stderr EPIPE — silent (process is shutting down anyway) */
  }
}
