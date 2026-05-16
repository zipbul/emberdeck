/**
 * In-process CLI test harness.
 *
 * Exercises the same `program.parseAsync(argv)` path that the binary entry uses,
 * but without spawning a subprocess. ~10× faster and lets bun:test share the
 * Bun runtime + module cache across tests.
 *
 * Use only for tests that don't depend on OS-level subprocess behavior:
 *   - JSON envelope on stdout      → use this (capture via stdout.write spy)
 *   - exit-code mapping            → use this (intercept process.exit)
 *   - flag/config parsing          → use this
 *
 * Real subprocess remains required for:
 *   - SIGINT/SIGTERM trap          (real signal delivery)
 *   - PTY-driven confirm prompts   (real terminal)
 *   - Cross-process system_lock    (separate process IDs)
 */

import { spyOn } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../../src/cli';

class ExitInvoked extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `ed <args>` against `cwd` in-process. Intercepts process.exit + stdout/stderr.
 */
export async function runEd(args: string[], cwd: string): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;

  // Real chdir, not just process.cwd() spy — relative paths in --from FILE
  // / --patch FILE are resolved by node:fs which calls the real syscall
  // (not process.cwd()), so spying alone doesn't redirect them.
  const prevCwd = process.cwd();
  process.chdir(cwd);

  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new ExitInvoked(exitCode);
  }) as never);
  // emitResult passes a node-style callback to process.stdout.write and awaits
  // it via Promise; if the mock ignores the callback the test hangs forever.
  // Invoke the callback synchronously on the next tick (no error).
  const outSpy = spyOn(process.stdout, 'write').mockImplementation(((s: string | Uint8Array, ...rest: unknown[]) => {
    stdout.push(typeof s === 'string' ? s : Buffer.from(s).toString());
    const cb = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    if (cb) queueMicrotask(() => cb(null));
    return true;
  }) as never);
  const errSpy = spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array, ...rest: unknown[]) => {
    stderr.push(typeof s === 'string' ? s : Buffer.from(s).toString());
    const cb = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    if (cb) queueMicrotask(() => cb(null));
    return true;
  }) as never);

  try {
    const program = buildProgram();
    program.exitOverride();  // commander throws CommanderError on usage error instead of process.exit
    // Help/version output goes through Commander's writer, not process.stdout.
    // Route them into our capture so tests can assert on them.
    program.configureOutput({
      writeOut: (s) => { stdout.push(s); },
      writeErr: (s) => { stderr.push(s); },
    });
    await program.parseAsync(['node', 'ed', ...args]);
  } catch (e: unknown) {
    if (e instanceof ExitInvoked) { /* normal exit path through our runner */ }
    else if (e && typeof e === 'object' && 'code' in e) {
      // CommanderError: help/version/usage events. exitOverride routes these
      // here instead of letting commander call process.exit. Map to commander's
      // documented exit codes (0 for help/version, 1+ for usage errors).
      const code = (e as Record<string, unknown>).code as string;
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        exitCode = 0;
      } else {
        exitCode = (e as Record<string, unknown>).exitCode as number ?? 2;
      }
      stderr.push(e instanceof Error ? e.message : String(e));
    } else {
      throw e;
    }
  } finally {
    process.chdir(prevCwd);
    exitSpy.mockRestore();
    outSpy.mockRestore();
    errSpy.mockRestore();
  }

  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
}

/**
 * Create a tmp project dir with `.emberdeck.jsonc` + `cardsDir`. Caller cleans up.
 */
export function setupTmpProject(options?: {
  projectRoot?: string;
  configExtra?: Record<string, unknown>;
}): { tmp: string; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'ed-it-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'h', version: '0.0.0' }));
  writeFileSync(
    join(tmp, '.emberdeck.jsonc'),
    JSON.stringify({
      cardsDir: '.emberdeck/cards',
      dbPath: '.emberdeck/data.db',
      ...(options?.projectRoot ? { projectRoot: options.projectRoot } : {}),
      ...options?.configExtra,
    }),
  );
  mkdirSync(join(tmp, '.emberdeck/cards'), { recursive: true });
  return {
    tmp,
    cleanup: () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} },
  };
}

/**
 * Parse newline-delimited JSON from stderr. Non-JSON lines are skipped.
 * Returns array of `{level, code, message, details?}` entries.
 */
export interface StderrLine {
  level: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
export function parseJsonLines(stderr: string): StderrLine[] {
  const out: StderrLine[] = [];
  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && typeof obj.level === 'string') {
        out.push(obj as StderrLine);
      }
    } catch { /* skip non-JSON noise (e.g. raw error messages) */ }
  }
  return out;
}

/**
 * Subprocess spawn of the CLI. Required when tests depend on real
 * signal/EPIPE/stdout-buffer behavior (in-process `runEd` cannot model these).
 */
export async function spawnCli(args: string[], cwd: string): Promise<RunResult> {
  const CLI = join(import.meta.dir, '../../cli.ts');
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout: stdoutText, stderr: stderrText };
}
