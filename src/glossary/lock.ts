import type { EmberdeckContext } from '../config';
import { acquireSystemLock, releaseSystemLock } from './system-lock';

/**
 * Global mutex for all glossary write operations (define, remove, rename).
 *
 * Two layers:
 * 1. In-process: Promise chaining (FIFO within same process). Same pattern as withCardLock.
 * 2. Cross-process: SQLite system_lock table (CLI_PLAN §9.1) — defeats PID recycling
 *    via (pid, start_time_ticks) tuple, CAS DELETE on stale recovery.
 *
 * Read-only operations (lookup) do NOT acquire this lock.
 *
 * For rename_glossary, the lock scope covers BOTH the DB transaction
 * (card glossary_json updates) and the glossary.yaml file write,
 * preventing interleaved reads of stale file state.
 */

const glossaryLocks = new WeakMap<EmberdeckContext, Promise<void>>();
const GLOSSARY_LOCK_NAME = 'glossary';

export async function withGlossaryLock<T>(
  ctx: EmberdeckContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev = glossaryLocks.get(ctx) ?? Promise.resolve();

  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  glossaryLocks.set(ctx, current);

  await prev;

  // Cross-process lock — only after in-process FIFO order is established.
  // If acquireSystemLock throws, we must still release the in-process slot
  // or every later glossary op in this process hangs forever.
  try {
    await acquireSystemLock(ctx, GLOSSARY_LOCK_NAME);
  } catch (e) {
    release!();
    if (glossaryLocks.get(ctx) === current) {
      glossaryLocks.delete(ctx);
    }
    throw e;
  }

  try {
    return await Promise.resolve(fn());
  } finally {
    releaseSystemLock(ctx, GLOSSARY_LOCK_NAME);
    release!();
    if (glossaryLocks.get(ctx) === current) {
      glossaryLocks.delete(ctx);
    }
  }
}
