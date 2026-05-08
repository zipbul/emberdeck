/**
 * `safeWriteOperation` is the DB-then-file write primitive used by every op
 * that touches both stores (create / update / delete / rename / glossary). It
 * has three exit paths: happy, file-failure-with-rollback, and the catastrophic
 * file-failure-with-failed-rollback path that surfaces `CompensationError`.
 *
 * This spec exercises all three with synthetic actions — no real DB / fs needed
 * since the contract is purely about call ordering and error wrapping.
 */
import { describe, it, expect } from 'bun:test';
import { safeWriteOperation } from './safe';
import { CompensationError } from '../card/errors';

describe('safeWriteOperation', () => {
  it('runs dbAction first, then fileAction, and returns dbAction result on success', async () => {
    const calls: string[] = [];
    const result = await safeWriteOperation<number>({
      dbAction: () => { calls.push('db'); return 42; },
      fileAction: async () => { calls.push('file'); },
      compensate: () => { calls.push('compensate'); },
    });
    expect(result).toBe(42);
    expect(calls).toEqual(['db', 'file']);
  });

  it('does not call compensate when fileAction succeeds', async () => {
    let compensateCalls = 0;
    await safeWriteOperation<void>({
      dbAction: () => undefined,
      fileAction: async () => undefined,
      compensate: () => { compensateCalls++; },
    });
    expect(compensateCalls).toBe(0);
  });

  it('calls compensate with dbAction result when fileAction throws, then rethrows the file error', async () => {
    const fileErr = new Error('disk full');
    let compensatedWith: unknown;
    await expect(
      safeWriteOperation<{ id: string }>({
        dbAction: () => ({ id: 'card-1' }),
        fileAction: async () => { throw fileErr; },
        compensate: (dbResult) => { compensatedWith = dbResult; },
      }),
    ).rejects.toBe(fileErr);
    expect(compensatedWith).toEqual({ id: 'card-1' });
  });

  it('awaits async compensate before rethrowing', async () => {
    const order: string[] = [];
    await expect(
      safeWriteOperation<void>({
        dbAction: () => undefined,
        fileAction: async () => { throw new Error('file'); },
        compensate: async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push('compensate');
        },
      }),
    ).rejects.toThrow('file');
    expect(order).toEqual(['compensate']);
  });

  it('throws CompensationError when compensate also throws — wrapping both errors', async () => {
    const fileErr = new Error('file write failed');
    const compErr = new Error('rollback failed');
    let thrown: unknown;
    try {
      await safeWriteOperation<void>({
        dbAction: () => undefined,
        fileAction: async () => { throw fileErr; },
        compensate: () => { throw compErr; },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CompensationError);
    const c = thrown as CompensationError;
    expect(c.originalError).toBe(fileErr);
    expect(c.compensationError).toBe(compErr);
  });

  it('CompensationError propagates async compensate failure', async () => {
    const fileErr = new Error('file');
    const compErr = new Error('comp');
    await expect(
      safeWriteOperation<void>({
        dbAction: () => undefined,
        fileAction: async () => { throw fileErr; },
        compensate: async () => { throw compErr; },
      }),
    ).rejects.toBeInstanceOf(CompensationError);
  });

  it('does NOT swallow dbAction errors — fileAction is never called', async () => {
    let fileCalled = false;
    let compensateCalled = false;
    await expect(
      safeWriteOperation<void>({
        dbAction: () => { throw new Error('db failed'); },
        fileAction: async () => { fileCalled = true; },
        compensate: () => { compensateCalled = true; },
      }),
    ).rejects.toThrow('db failed');
    expect(fileCalled).toBe(false);
    expect(compensateCalled).toBe(false);
  });
});
