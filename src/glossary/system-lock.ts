/**
 * Cross-process advisory lock backed by SQLite system_lock table.
 *
 * See CLI_PLAN §9.1.
 *
 * - Acquire: SELECT existing → liveness check (PID + start_time) → CAS DELETE if stale → INSERT.
 * - Release: DELETE WHERE name + pid match (no-op if already released).
 * - Stale recovery: process.kill(pid, 0) + /proc/<pid>/stat field 22 (Linux).
 *   On macOS or other platforms without /proc, falls back to PID-only check.
 *
 * In-process callers should still use `withGlossaryLock` (in src/glossary/lock.ts) for FIFO
 * serialization within a single process. This system_lock is for cross-process safety.
 */

import { readFileSync } from 'node:fs';
import type { EmberdeckContext } from '../config';
import { errorMessage } from '../util/error';

const POLL_INTERVAL_MS = 50;
const TIMEOUT_MS = 5000;

/**
 * Thrown when acquireSystemLock cannot obtain the lock within TIMEOUT_MS.
 * Surfaced as transient (exit 7) so retry-aware callers/CI can act on it.
 */
export class SystemLockTimeoutError extends Error {
  constructor(name: string, ms: number) {
    super(`failed to acquire system lock '${name}' after ${ms}ms`);
    this.name = 'SystemLockTimeoutError';
  }
}

interface LockRow {
  pid: number;
  start_time_ticks: number;
  acquired_at: string;
}

/**
 * Read process start time as a stable identifier across the process's lifetime.
 *
 * - Linux: /proc/<pid>/stat field 22 (clock ticks since boot)
 * - macOS/BSD: `ps -o lstart= -p <pid>` (date string), parsed to epoch ms
 * - Other platforms: returns 0 (PID-only check, accepts PID-recycle race)
 *
 * The exact unit/scale doesn't matter — only that the value is stable for the
 * process's lifetime and changes when PID is recycled.
 */
function readStartTimeTicks(pid: number): number {
  // Linux: /proc/<pid>/stat
  try {
    const content = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const lastParen = content.lastIndexOf(')');
    if (lastParen >= 0) {
      const after = content.slice(lastParen + 2).split(' ');
      const startTime = after[19];
      if (startTime) {
        const n = parseInt(startTime, 10);
        if (Number.isFinite(n)) return n;
      }
    }
  } catch {
    // fall through to macOS/BSD path
  }

  // macOS / BSD: `ps -o lstart= -p <pid>` returns a date string like "Sun Apr 27 05:50:31 2026"
  if (process.platform === 'darwin' || process.platform.startsWith('freebsd')) {
    try {
      const proc = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(pid)]);
      if (proc.exitCode === 0) {
        const text = proc.stdout?.toString().trim();
        if (text) {
          const ms = Date.parse(text);
          if (Number.isFinite(ms)) return ms;
        }
      }
    } catch {
      // fall through
    }
  }

  // Unsupported platform / error: return 0. PID-recycle protection lost,
  // but lock acquisition still works (just falls back to PID-only liveness).
  return 0;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

let cachedMyStartTime: number | null = null;
function getMyStartTime(): number {
  if (cachedMyStartTime === null) cachedMyStartTime = readStartTimeTicks(process.pid);
  return cachedMyStartTime;
}

function selectLock(ctx: EmberdeckContext, name: string): LockRow | null {
  const row = ctx.db.$client
    .prepare('SELECT pid, start_time_ticks, acquired_at FROM system_lock WHERE name = ?')
    .get(name) as LockRow | undefined;
  return row ?? null;
}

function tryInsert(ctx: EmberdeckContext, name: string, pid: number, st: number): boolean {
  try {
    ctx.db.$client
      .prepare(
        'INSERT INTO system_lock (name, pid, start_time_ticks, acquired_at) VALUES (?, ?, ?, ?)',
      )
      .run(name, pid, st, new Date().toISOString());
    return true;
  } catch (e) {
    const msg = errorMessage(e);
    if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) return false;
    throw e;
  }
}

function casDelete(ctx: EmberdeckContext, name: string, pid: number, st: number): number {
  const result = ctx.db.$client
    .prepare('DELETE FROM system_lock WHERE name = ? AND pid = ? AND start_time_ticks = ?')
    .run(name, pid, st);
  return result.changes;
}

function isStale(holder: LockRow): boolean {
  if (!isAlive(holder.pid)) return true;
  const currentSt = readStartTimeTicks(holder.pid);
  // start_time = 0 means we cannot determine; fall back to PID-only liveness
  // (still safe — PID-recycling race is rare on systems with large pid_max).
  if (currentSt === 0 || holder.start_time_ticks === 0) return false;
  return currentSt !== holder.start_time_ticks;
}

/**
 * Acquire a system lock. Blocks polling up to TIMEOUT_MS.
 * Throws on timeout.
 */
export async function acquireSystemLock(ctx: EmberdeckContext, name: string): Promise<void> {
  const myPid = process.pid;
  const myStart = getMyStartTime();
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const existing = selectLock(ctx, name);
    if (!existing) {
      if (tryInsert(ctx, name, myPid, myStart)) return;
      // INSERT lost race — retry
    } else if (isStale(existing)) {
      // CAS DELETE: only delete if the row still matches (defeats race with another reaper)
      casDelete(ctx, name, existing.pid, existing.start_time_ticks);
      if (tryInsert(ctx, name, myPid, myStart)) return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new SystemLockTimeoutError(name, TIMEOUT_MS);
}

/**
 * Release a system lock. Idempotent — safe to call even if not held.
 */
export function releaseSystemLock(ctx: EmberdeckContext, name: string): void {
  const myPid = process.pid;
  const myStart = getMyStartTime();
  ctx.db.$client
    .prepare('DELETE FROM system_lock WHERE name = ? AND pid = ? AND start_time_ticks = ?')
    .run(name, myPid, myStart);
}

/**
 * Convenience wrapper: acquire → run → release (always).
 */
export async function withSystemLock<T>(
  ctx: EmberdeckContext,
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  await acquireSystemLock(ctx, name);
  try {
    return await fn();
  } finally {
    releaseSystemLock(ctx, name);
  }
}
