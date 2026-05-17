/**
 * Interactive confirmation prompt for destructive ops (reset / card delete / glossary remove).
 *
 * Behavior:
 *   - non-TTY without --yes → throws (caller must opt in)
 *   - TTY without --yes      → prompt; user must type the expected token (case-insensitive)
 *   - --yes                  → no-op
 */

import { CliUsageError } from './usage-error';

async function readLineFromStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes('\n')) break;
  }
  reader.releaseLock();
  return buf.split('\n')[0] ?? '';
}

/**
 * Optional injection seams used by tests to drive the function without
 * monkey-patching `process.stdin.isTTY` globally. Production callers omit
 * `env` and the defaults read from `process` as before.
 */
export interface ConfirmEnv {
  stdinIsTTY: boolean;
  stderrIsTTY: boolean;
  readLine: () => Promise<string>;
  write: (s: string) => void;
}

function defaultEnv(): ConfirmEnv {
  return {
    stdinIsTTY: process.stdin.isTTY ?? false,
    stderrIsTTY: process.stderr.isTTY ?? false,
    readLine: readLineFromStdin,
    write: (s) => { process.stderr.write(s); },
  };
}

export async function confirmDestructive(
  opts: {
    yes: boolean;
    opName: string;
    prompt: string;
    expected?: string;
  },
  env: ConfirmEnv = defaultEnv(),
): Promise<void> {
  if (opts.yes) return;
  if (!env.stdinIsTTY || !env.stderrIsTTY) {
    throw new CliUsageError(`${opts.opName} requires --yes when not running in interactive TTY (DESTRUCTIVE op)`);
  }
  const expected = (opts.expected ?? 'yes').toLowerCase();
  env.write(opts.prompt);
  const answer = (await env.readLine()).trim().toLowerCase();
  if (answer !== expected) {
    throw new CliUsageError(`${opts.opName} aborted by user`);
  }
}
