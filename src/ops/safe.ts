import type { EmberdeckContext } from '../config';
import { CompensationError } from '../card/errors';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** 최대 재시도 횟수. 기본값: 3 */
  maxRetries?: number;
  /** 첫 재시도 대기 시간(ms). 지수 백오프 기준. 기본값: 50 */
  baseDelayMs?: number;
  /** 최대 대기 시간(ms). 기본값: 2000 */
  maxDelayMs?: number;
}

export interface SafeWriteOptions<T> {
  /** DB 트랜잭션 액션. 동기 실행. */
  dbAction: () => T;
  /** 파일시스템 액션. 비동기 실행. */
  fileAction: () => Promise<void>;
  /** dbAction 성공 후 fileAction 실패 시 보상(rollback) 액션. */
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
 * SQLITE_BUSY 에러 시 지수 백오프로 재시도.
 * Non-busy 에러는 즉시 re-throw.
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
 * 동일 ctx + 동일 key에 대한 동시 호출을 FIFO로 직렬화.
 * WeakMap 기반이므로 ctx GC 시 자동 정리.
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
 * DB 액션 → 파일 액션 순서로 실행.
 * 파일 실패 시 compensate로 DB 롤백 시도.
 * compensate도 실패하면 CompensationError.
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
