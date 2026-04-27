/**
 * Interactive confirmation prompt for destructive ops (reset / card delete / glossary remove).
 *
 * Behavior:
 *   - non-TTY without --yes → throws (caller must opt in)
 *   - TTY without --yes      → prompt; user must type the expected token (case-insensitive)
 *   - --yes                  → no-op
 */

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

export async function confirmDestructive(opts: {
  yes: boolean;
  opName: string;
  prompt: string;
  expected?: string;
}): Promise<void> {
  if (opts.yes) return;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(`${opts.opName} requires --yes when not running in interactive TTY (DESTRUCTIVE op)`);
  }
  const expected = (opts.expected ?? 'yes').toLowerCase();
  process.stderr.write(opts.prompt);
  const answer = (await readLineFromStdin()).trim().toLowerCase();
  if (answer !== expected) {
    throw new Error(`${opts.opName} aborted by user`);
  }
}
