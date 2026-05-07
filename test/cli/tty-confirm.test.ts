/**
 * TTY interactive confirmation e2e.
 *
 * `confirmDestructive` has three branches:
 *   1. --yes → skip prompt
 *   2. non-TTY without --yes → throw CliUsageError
 *   3. TTY without --yes → prompt; accept user 'yes' or abort
 *
 * Branches 1 and 2 are covered by existing tests. Branch 3 requires a pty,
 * which we allocate via `script -qfc <cmd> /dev/null` (util-linux). The
 * subprocess sees stdin/stderr as TTYs, so the prompt path runs.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');
const HAS_SCRIPT = existsSync('/usr/bin/script');

interface RunResult {
  exitCode: number;
  stdout: string;
}

/**
 * Run `bun ed ...` inside a pty (via util-linux `script`) so the CLI sees
 * stdin/stderr as TTYs. Pipe `userInput` to the pty's stdin.
 */
async function runInPty(args: string[], cwd: string, userInput: string): Promise<RunResult> {
  const cmd = ['bun', CLI, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  // `script -q -e -f -c <cmd> /dev/null`:
  //   -q: suppress banner
  //   -e: return child's exit code (default would be 0)
  //   -f: flush after each write so stdin/stdout interleave correctly
  const proc = Bun.spawn(['script', '-q', '-e', '-f', '-c', cmd, '/dev/null'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(userInput);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout };
}

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-tty-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

/**
 * `script` writes the pty session as a typescript log to stdout; the actual
 * CLI JSON output is mixed in. Extract the JSON object by finding the first
 * `{` and matching braces.
 */
function extractJson(combined: string): unknown {
  const start = combined.indexOf('{');
  if (start < 0) throw new Error(`no JSON in pty output: ${combined.slice(0, 200)}`);
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < combined.length; i++) {
    const c = combined[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(combined.slice(start, i + 1));
    }
  }
  throw new Error(`unbalanced JSON in pty output`);
}

const describeIfPty = HAS_SCRIPT ? describe : describe.skip;

describeIfPty('TTY interactive confirm e2e', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('user types "yes" → reset proceeds', async () => {
    const r = await runInPty(['reset'], tmp, 'yes\n');
    expect(r.exitCode).toBe(0);
    const env = extractJson(r.stdout) as { status: string };
    expect(env.status).toBe('ok');
  });

  test('user types "no" → reset aborts with CLI_USAGE_ERROR', async () => {
    const r = await runInPty(['reset'], tmp, 'no\n');
    expect(r.exitCode).toBe(2);
    const env = extractJson(r.stdout) as { status: string; error: { code: string } };
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('CLI_USAGE_ERROR');
  });

  test('user types empty (just enter) → aborts', async () => {
    const r = await runInPty(['reset'], tmp, '\n');
    expect(r.exitCode).toBe(2);
    const env = extractJson(r.stdout) as { status: string };
    expect(env.status).toBe('error');
  });

  test('user types "YES" (uppercase) → proceeds (case-insensitive match)', async () => {
    const r = await runInPty(['reset'], tmp, 'YES\n');
    expect(r.exitCode).toBe(0);
  });

  test('--yes flag bypasses prompt entirely (no stdin needed)', async () => {
    const r = await runInPty(['reset', '--yes'], tmp, '');
    expect(r.exitCode).toBe(0);
  });
});
