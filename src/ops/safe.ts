import type { EmberdeckContext } from '../config';
import { CompensationError } from '../card/errors';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retries. Default: 3 */
  maxRetries?: number;
  /** Initial retry delay (ms). Used as the base for exponential backoff. Default: 50 */
  baseDelayMs?: number;
  /** Maximum delay (ms). Default: 2000 */
  maxDelayMs?: number;
}

export interface SafeWriteOptions<T> {
  /** DB transaction action. Executed synchronously. */
  dbAction: () => T;
  /** Filesystem action. Executed asynchronously. */
  fileAction: () => Promise<void>;
  /** Compensation (rollback) action when fileAction fails after dbAction succeeds. */
  compensate: (dbResult: T) => void | Promise<void>;
}

// ── Internal ──────────────────────────────────────────────────────────────

function isSqliteBusy(err: unknown): boolean {
  return err instanceof Error && err.message.includes('database is locked');
}

const cardLocks = new WeakMap<EmberdeckContext, Map<string, Promise<void>>>();

function getLocksMap(ctx: EmberdeckContext): Map<string, Promise<void>> {
  let locks = cardLocks.get(ctx);
  if (!locks) {
    locks = new Map();
    cardLocks.set(ctx, locks);
  }
  return locks;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Retries with exponential backoff on SQLITE_BUSY errors.
 * Non-busy errors are re-thrown immediately.
  * @spec dual-storage/mutation-safety
 */
export async function withRetry<T>(
  fn: () => T | Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 50, maxDelayMs = 2000 } = options ?? {};

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await Promise.resolve(fn());
    } catch (err) {
      if (!isSqliteBusy(err)) {
        throw err;
      }
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        await Bun.sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Serializes concurrent calls for the same ctx + key in FIFO order.
 * Uses a WeakMap, so locks are automatically cleaned up when ctx is garbage collected.
  * @spec dual-storage/mutation-safety
 */
export async function withCardLock<T>(
  ctx: EmberdeckContext,
  key: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const locks = getLocksMap(ctx);
  const prev = locks.get(key) ?? Promise.resolve();

  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);

  await prev;

  try {
    return await Promise.resolve(fn());
  } finally {
    release!();
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

/**
 * Executes DB action first, then file action.
 * On file failure, attempts DB rollback via compensate.
 * If compensate also fails, throws CompensationError.
  * @spec dual-storage/mutation-safety
 */
export async function safeWriteOperation<T>(
  options: SafeWriteOptions<T>,
): Promise<T> {
  const { dbAction, fileAction, compensate } = options;

  const result = dbAction();

  try {
    await fileAction();
  } catch (err) {
    try {
      await compensate(result);
    } catch (compErr) {
      throw new CompensationError(err, compErr);
    }
    throw err;
  }

  return result;
}
