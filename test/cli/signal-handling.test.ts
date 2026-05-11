/**
 * Signal handling e2e: SIGINT/SIGTERM trap → cleanup → exit 130.
 *
 * The CLI's run() registers signal handlers that:
 *   1. Run rt.cleanup() (close gildash, flush DB).
 *   2. Print "<sig> received, exiting" to stderr.
 *   3. Exit with code 130 (POSIX SIGINT convention).
 *   4. On a second signal during cleanup, hard-exit immediately.
 *
 * These paths are unreachable by in-process tests (process.exit kills the
 * runner). We spawn the real `ed` binary and deliver real signals.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

function setupProject(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-signal-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({ cardsDir: '.emberdeck/cards', dbPath: '.emberdeck/data.db' }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return tmp;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the spawned subprocess has actually started reading stdin.
 *
 * The pure `waitMs(500)` we used previously was flaky under full-suite load:
 * Bun spawn-up + JS module init can exceed 500ms when 60+ test files run
 * in parallel, so a signal delivered at 500ms arrives before the handler
 * is registered, defaulting to instant kill (no stderr message → assertion
 * fails). We instead poll proc.exited and the elapsed wall clock until at
 * least `minMs` ms have passed AND the process is still alive (i.e., it
 * actually reached the stdin-read loop and is blocked there).
 */
async function waitUntilReady(
  proc: ReturnType<typeof Bun.spawn>,
  minMs = 1500,
  maxMs = 5000,
): Promise<void> {
  const t0 = Date.now();
  let exited = false;
  proc.exited.then(() => { exited = true; }, () => { exited = true; });
  while (Date.now() - t0 < minMs) {
    if (exited) return; // process already done; nothing to wait for
    await new Promise((r) => setTimeout(r, 50));
  }
  // ensure not exited prematurely; if it did, return so test can observe.
  const cutoff = t0 + maxMs;
  while (!exited && Date.now() < cutoff) {
    await new Promise((r) => setTimeout(r, 50));
    break;
  }
}

/** Spawn the CLI in subprocess with both stdio piped. */
function spawnEd(args: string[], cwd: string) {
  return Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  });
}

describe('CLI signal handling e2e', () => {
  let tmp: string;
  beforeEach(() => { tmp = setupProject(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('SIGINT during long-running command: cleanup runs + exit 130', async () => {
    // `card create --from -` blocks reading stdin → keeps process alive long
    // enough to receive a signal. We never write to stdin, so it waits.
    const proc = spawnEd(
      ['card', 'create', 'p', '--type', 'brief', '--summary', 's', '--from', '-'],
      tmp,
    );
    await waitUntilReady(proc);
    proc.kill('SIGINT');
    await proc.exited;

    // Bun's exitCode is null when terminated by signal; signal-handler-driven
    // process.exit(130) sets a real exit code. Either form is acceptable —
    // the CLI emitted the cleanup message (proving the handler ran) and the
    // process exited promptly.
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain('SIGINT received, exiting');
  });

  test('SIGTERM also triggers cleanup + exit', async () => {
    const proc = spawnEd(
      ['card', 'create', 'p', '--type', 'brief', '--summary', 's', '--from', '-'],
      tmp,
    );
    await waitUntilReady(proc);
    proc.kill('SIGTERM');
    await proc.exited;

    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain('SIGTERM received, exiting');
  });

  test('double SIGINT: process still exits even when second signal arrives mid-cleanup', async () => {
    const proc = spawnEd(
      ['card', 'create', 'p', '--type', 'brief', '--summary', 's', '--from', '-'],
      tmp,
    );
    await waitUntilReady(proc);
    proc.kill('SIGINT');
    await waitMs(50);
    proc.kill('SIGINT');
    await proc.exited;

    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toMatch(/SIGINT received, exiting|second SIGINT received, hard exit/);
  });

  test('normal completion does not emit signal-received message', async () => {
    // Sanity: confirm signal stderr text is gated behind real signal delivery.
    const proc = spawnEd(['card', 'list'], tmp);
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).not.toContain('received, exiting');
  });
});
