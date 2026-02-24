import { describe, it, expect, mock } from 'bun:test';

import {
  withRetry,
  withCardLock,
  safeWriteOperation,
  CompensationError,
} from '../../index';
import type { EmberdeckContext } from '../../index';

// ── Helpers ───────────────────────────────────────────────────────────────

function sqliteBusyError(): Error {
  return new Error('database is locked');
}

function makeFakeCtx(): EmberdeckContext {
  return {} as EmberdeckContext;
}

// ═════════════════════════════════════════════════════════════════════════
// withRetry
// ═════════════════════════════════════════════════════════════════════════

describe('withRetry', () => {
  // ── Happy Path ────────────────────────────────────────────────────────

  it('should return sync value when fn succeeds immediately', async () => {
    // Arrange
    const fn = () => 42;
    // Act
    const result = await withRetry(fn);
    // Assert
    expect(result).toBe(42);
  });

  it('should resolve async value when fn returns Promise', async () => {
    // Arrange
    const fn = () => Promise.resolve('hello');
    // Act
    const result = await withRetry(fn);
    // Assert
    expect(result).toBe('hello');
  });

  it('should retry once and succeed after SQLITE_BUSY', async () => {
    // Arrange
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt === 1) throw sqliteBusyError();
      return 'ok';
    };
    // Act
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    // Assert
    expect(result).toBe('ok');
    expect(attempt).toBe(2);
  });

  it('should retry twice and succeed after two SQLITE_BUSY', async () => {
    // Arrange
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt <= 2) throw sqliteBusyError();
      return 'success';
    };
    // Act
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    // Assert
    expect(result).toBe('success');
    expect(attempt).toBe(3);
  });

  // ── Negative / Error ──────────────────────────────────────────────────

  it('should throw immediately on non-busy Error', async () => {
    // Arrange
    const fn = () => {
      throw new TypeError('something else');
    };
    // Act & Assert
    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toBeInstanceOf(TypeError);
  });

  it('should throw immediately on non-Error value', async () => {
    // Arrange
    const fn = () => {
      throw 'a string error';
    };
    // Act & Assert
    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toBe('a string error');
  });

  it('should throw lastError when busy exceeds maxRetries', async () => {
    // Arrange
    let attempt = 0;
    const fn = () => {
      attempt++;
      throw sqliteBusyError();
    };
    // Act & Assert
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('database is locked');
    expect(attempt).toBe(3); // initial + 2 retries
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should not retry when maxRetries is 0', async () => {
    // Arrange
    let attempt = 0;
    const fn = () => {
      attempt++;
      throw sqliteBusyError();
    };
    // Act & Assert
    await expect(
      withRetry(fn, { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('database is locked');
    expect(attempt).toBe(1);
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should cap delay at maxDelayMs when calculated delay exceeds it', async () => {
    // Arrange
    const startTime = performance.now();
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt <= 2) throw sqliteBusyError();
      return 'done';
    };
    // Act — baseDelayMs=1000 but maxDelayMs=5 should cap
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5 });
    const elapsed = performance.now() - startTime;
    // Assert
    expect(result).toBe('done');
    // With 2 retries and maxDelayMs=5, total delay should be under 50ms (generous margin)
    expect(elapsed).toBeLessThan(50);
  });

  it('should throw non-busy error on second attempt after retrying first busy', async () => {
    // Arrange
    let attempt = 0;
    const fn = () => {
      attempt++;
      if (attempt === 1) throw sqliteBusyError();
      throw new RangeError('out of range');
    };
    // Act & Assert
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(attempt).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// withCardLock
// ═════════════════════════════════════════════════════════════════════════

describe('withCardLock', () => {
  // ── Happy Path ────────────────────────────────────────────────────────

  it('should execute fn and return result with no prior lock', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    // Act
    const result = await withCardLock(ctx, 'key-a', () => 123);
    // Assert
    expect(result).toBe(123);
  });

  it('should clean up lock after fn completes', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    // Act — first call should complete and release lock
    await withCardLock(ctx, 'key-a', () => 'first');
    // A second call on the same key should execute immediately (no stale lock)
    const result = await withCardLock(ctx, 'key-a', () => 'second');
    // Assert
    expect(result).toBe('second');
  });

  it('should execute different keys in parallel', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    const order: string[] = [];
    // Act — two different keys should not block each other
    const [r1, r2] = await Promise.all([
      withCardLock(ctx, 'key-a', async () => {
        order.push('a-start');
        await Bun.sleep(10);
        order.push('a-end');
        return 'a';
      }),
      withCardLock(ctx, 'key-b', async () => {
        order.push('b-start');
        await Bun.sleep(10);
        order.push('b-end');
        return 'b';
      }),
    ]);
    // Assert
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    // Both should start before either ends (parallel execution)
    expect(order.indexOf('a-start')).toBeLessThan(order.indexOf('a-end'));
    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('b-end'));
    // At least one of the "start" entries should appear before both "end" entries
    const firstEnd = Math.min(order.indexOf('a-end'), order.indexOf('b-end'));
    expect(order.indexOf('a-start')).toBeLessThan(firstEnd);
    expect(order.indexOf('b-start')).toBeLessThan(firstEnd);
  });

  // ── Negative / Error ──────────────────────────────────────────────────

  it('should release lock and re-throw when fn throws', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    // Act & Assert
    await expect(
      withCardLock(ctx, 'key-a', () => {
        throw new Error('fn failed');
      }),
    ).rejects.toThrow('fn failed');
  });

  it('should allow re-entry after fn throws on same key', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    try {
      await withCardLock(ctx, 'key-a', () => {
        throw new Error('first failure');
      });
    } catch {
      // expected
    }
    // Act — same key should be unlocked now
    const result = await withCardLock(ctx, 'key-a', () => 'recovered');
    // Assert
    expect(result).toBe('recovered');
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should create independent locks for different contexts', async () => {
    // Arrange
    const ctx1 = makeFakeCtx();
    const ctx2 = makeFakeCtx();
    const order: string[] = [];
    // Act — same key on different contexts should not block
    const [r1, r2] = await Promise.all([
      withCardLock(ctx1, 'key', async () => {
        order.push('ctx1-start');
        await Bun.sleep(10);
        order.push('ctx1-end');
        return 1;
      }),
      withCardLock(ctx2, 'key', async () => {
        order.push('ctx2-start');
        await Bun.sleep(10);
        order.push('ctx2-end');
        return 2;
      }),
    ]);
    // Assert
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // Both should start before either ends (parallel)
    const firstEnd = Math.min(order.indexOf('ctx1-end'), order.indexOf('ctx2-end'));
    expect(order.indexOf('ctx1-start')).toBeLessThan(firstEnd);
    expect(order.indexOf('ctx2-start')).toBeLessThan(firstEnd);
  });

  // ── Concurrency / Race ────────────────────────────────────────────────

  it('should serialize same-key concurrent calls in FIFO order', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    const order: string[] = [];
    // Act — two concurrent calls on the same key
    const [r1, r2] = await Promise.all([
      withCardLock(ctx, 'key-a', async () => {
        order.push('first-start');
        await Bun.sleep(20);
        order.push('first-end');
        return 'first';
      }),
      withCardLock(ctx, 'key-a', async () => {
        order.push('second-start');
        await Bun.sleep(1);
        order.push('second-end');
        return 'second';
      }),
    ]);
    // Assert — first must complete before second starts
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('should execute waiting call after preceding call errors', async () => {
    // Arrange
    const ctx = makeFakeCtx();
    const order: string[] = [];
    // Act
    const promise1 = withCardLock(ctx, 'key-a', async () => {
      order.push('err-start');
      await Bun.sleep(10);
      order.push('err-end');
      throw new Error('first fails');
    });
    const promise2 = withCardLock(ctx, 'key-a', async () => {
      order.push('ok-start');
      order.push('ok-end');
      return 'recovered';
    });
    // Assert
    await expect(promise1).rejects.toThrow('first fails');
    const result = await promise2;
    expect(result).toBe('recovered');
    expect(order).toEqual(['err-start', 'err-end', 'ok-start', 'ok-end']);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// safeWriteOperation
// ═════════════════════════════════════════════════════════════════════════

describe('safeWriteOperation', () => {
  // ── Happy Path ────────────────────────────────────────────────────────

  it('should return dbAction result when both actions succeed', async () => {
    // Arrange
    const dbAction = () => ({ id: 1, name: 'test' });
    const fileAction = mock(async () => {});
    const compensate = mock(async () => {});
    // Act
    const result = await safeWriteOperation({ dbAction, fileAction, compensate });
    // Assert
    expect(result).toEqual({ id: 1, name: 'test' });
    expect(fileAction).toHaveBeenCalledTimes(1);
    expect(compensate).not.toHaveBeenCalled();
  });

  // ── Negative / Error ──────────────────────────────────────────────────

  it('should throw dbAction error without calling compensate', async () => {
    // Arrange
    const dbAction = () => {
      throw new Error('db failed');
    };
    const fileAction = mock(async () => {});
    const compensate = mock(async () => {});
    // Act & Assert
    await expect(
      safeWriteOperation({ dbAction, fileAction, compensate }),
    ).rejects.toThrow('db failed');
    expect(fileAction).not.toHaveBeenCalled();
    expect(compensate).not.toHaveBeenCalled();
  });

  it('should compensate and re-throw on fileAction failure', async () => {
    // Arrange
    const dbResult = { id: 99 };
    const dbAction = () => dbResult;
    const fileAction = mock(async () => {
      throw new Error('file write failed');
    });
    const compensate = mock(async (_result: unknown) => {});
    // Act & Assert
    await expect(
      safeWriteOperation({ dbAction, fileAction, compensate }),
    ).rejects.toThrow('file write failed');
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(compensate).toHaveBeenCalledWith(dbResult);
  });

  it('should throw CompensationError when both fileAction and compensate fail', async () => {
    // Arrange
    const fileErr = new Error('file failed');
    const compErr = new Error('compensate failed');
    const dbAction = () => 'result';
    const fileAction = mock(async () => {
      throw fileErr;
    });
    const compensate = mock(async () => {
      throw compErr;
    });
    // Act & Assert
    try {
      await safeWriteOperation({ dbAction, fileAction, compensate });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CompensationError);
      const ce = err as InstanceType<typeof CompensationError>;
      expect(ce.originalError).toBe(fileErr);
      expect(ce.compensationError).toBe(compErr);
    }
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should pass dbAction result to compensate including undefined', async () => {
    // Arrange
    const dbAction = () => undefined;
    const fileAction = mock(async () => {
      throw new Error('file error');
    });
    const compensate = mock(async (_result: unknown) => {});
    // Act & Assert
    await expect(
      safeWriteOperation({ dbAction, fileAction, compensate }),
    ).rejects.toThrow('file error');
    expect(compensate).toHaveBeenCalledWith(undefined);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should produce same result on repeated calls', async () => {
    // Arrange
    const dbAction = () => 'stable';
    const fileAction = async () => {};
    const compensate = async () => {};
    // Act
    const r1 = await safeWriteOperation({ dbAction, fileAction, compensate });
    const r2 = await safeWriteOperation({ dbAction, fileAction, compensate });
    // Assert
    expect(r1).toBe('stable');
    expect(r2).toBe('stable');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// CompensationError
// ═════════════════════════════════════════════════════════════════════════

describe('CompensationError', () => {
  it('should store originalError, compensationError, name, and message', () => {
    // Arrange
    const orig = new Error('original');
    const comp = new Error('compensation');
    // Act
    const err = new CompensationError(orig, comp);
    // Assert
    expect(err.originalError).toBe(orig);
    expect(err.compensationError).toBe(comp);
    expect(err.name).toBe('CompensationError');
    expect(err.message).toBe('Compensation failed after operation error');
  });

  it('should be instanceof Error', () => {
    // Arrange & Act
    const err = new CompensationError('orig', 'comp');
    // Assert
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CompensationError);
  });
});
