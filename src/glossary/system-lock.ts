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

const POLL_INTERVAL_MS = 50;
const TIMEOUT_MS = 5000;

interface LockRow {
  pid: number;
  start_time_ticks: number;
  acquired_at: string;
}

/**
 * Read /proc/<pid>/stat field 22 (start_time in clock ticks since boot).
 * Returns null on non-Linux or read failure.
 */
function readStartTimeTicks(pid: number): number | null {
  try {
    const content = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // Format: pid (comm) state ppid pgrp ... — comm may contain spaces/parens.
    // Find the LAST ')' which closes comm, then split the rest by space.
    const lastParen = content.lastIndexOf(')');
    if (lastParen < 0) return null;
    const after = content.slice(lastParen + 2).split(' ');
    // After "comm" we have state(0) ppid(1) ... start_time is original field 22 = after[19]
    const startTime = after[19];
    if (!startTime) return null;
    const n = parseInt(startTime, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
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

function getMyStartTime(): number {
  return readStartTimeTicks(process.pid) ?? 0;
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
    const msg = e instanceof Error ? e.message : String(e);
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
  if (currentSt == null) return false; // can't verify (non-Linux); assume alive
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
  throw new Error(`failed to acquire system lock '${name}' after ${TIMEOUT_MS}ms`);
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
    return await Promise.resolve(fn());
  } finally {
    releaseSystemLock(ctx, name);
  }
}
