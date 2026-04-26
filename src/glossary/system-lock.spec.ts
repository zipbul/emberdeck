import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupEmberdeck, teardownEmberdeck } from '../setup';
import {
  acquireSystemLock,
  releaseSystemLock,
  withSystemLock,
} from './system-lock';
import type { EmberdeckContext } from '../config';

describe('system-lock', () => {
  let tmp: string;
  let ctx: EmberdeckContext;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sys-lock-'));
    mkdirSync(join(tmp, 'cards'), { recursive: true });
    ctx = await setupEmberdeck({
      cardsDir: join(tmp, 'cards'),
      dbPath: join(tmp, 'data.db'),
    });
  });

  afterEach(async () => {
    await teardownEmberdeck(ctx);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('acquire then release is symmetric', async () => {
    await acquireSystemLock(ctx, 'test');
    const row = ctx.db.$client
      .prepare('SELECT pid FROM system_lock WHERE name = ?')
      .get('test') as { pid: number } | undefined;
    expect(row?.pid).toBe(process.pid);

    releaseSystemLock(ctx, 'test');
    const after = ctx.db.$client
      .prepare('SELECT pid FROM system_lock WHERE name = ?')
      .get('test');
    expect(after ?? null).toBeNull();
  });

  test('release is idempotent (no-op when not held)', () => {
    expect(() => releaseSystemLock(ctx, 'never-acquired')).not.toThrow();
  });

  test('withSystemLock releases on exception', async () => {
    let caught: unknown;
    try {
      await withSystemLock(ctx, 'guarded', () => {
        throw new Error('boom');
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe('boom');
    const after = ctx.db.$client
      .prepare('SELECT pid FROM system_lock WHERE name = ?')
      .get('guarded');
    expect(after ?? null).toBeNull();
  });

  test('stale lock from dead PID is reclaimed', async () => {
    // Insert a fake stale row (PID that definitely does not exist)
    const fakePid = 99999999;
    ctx.db.$client
      .prepare(
        'INSERT INTO system_lock (name, pid, start_time_ticks, acquired_at) VALUES (?, ?, ?, ?)',
      )
      .run('stale', fakePid, 1, new Date().toISOString());

    // Should detect dead PID and replace with our own
    await acquireSystemLock(ctx, 'stale');
    const row = ctx.db.$client
      .prepare('SELECT pid FROM system_lock WHERE name = ?')
      .get('stale') as { pid: number } | undefined;
    expect(row?.pid).toBe(process.pid);

    releaseSystemLock(ctx, 'stale');
  });

  test('integration: glossary mutations through withGlossaryLock acquire system_lock', async () => {
    const { withGlossaryLock } = await import('./lock');
    let lockHeldDuringFn = false;
    await withGlossaryLock(ctx, () => {
      const row = ctx.db.$client
        .prepare('SELECT pid FROM system_lock WHERE name = ?')
        .get('glossary') as { pid: number } | undefined;
      lockHeldDuringFn = row?.pid === process.pid;
    });
    expect(lockHeldDuringFn).toBe(true);

    // After return, lock released
    const after = ctx.db.$client
      .prepare('SELECT pid FROM system_lock WHERE name = ?')
      .get('glossary');
    expect(after ?? null).toBeNull();
  });

  test('alive lock blocks until timeout', async () => {
    // hold the lock with our own PID + start_time so it looks alive
    const myPid = process.pid;
    const myStart = (() => {
      try {
        const stat = require('node:fs').readFileSync(`/proc/${myPid}/stat`, 'utf-8');
        const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return parseInt(after[19] ?? '0', 10);
      } catch {
        return 0;
      }
    })();
    ctx.db.$client
      .prepare(
        'INSERT INTO system_lock (name, pid, start_time_ticks, acquired_at) VALUES (?, ?, ?, ?)',
      )
      .run('busy', myPid, myStart, new Date().toISOString());

    const start = Date.now();
    let caught: unknown;
    try {
      await acquireSystemLock(ctx, 'busy');
    } catch (e) {
      caught = e;
    }
    const elapsed = Date.now() - start;

    expect(caught).toBeDefined();
    expect((caught as Error).message).toContain('failed to acquire');
    // should have waited at least close to timeout (5000ms with 50ms poll)
    expect(elapsed).toBeGreaterThan(4500);

    // cleanup
    ctx.db.$client.prepare('DELETE FROM system_lock WHERE name = ?').run('busy');
  }, 10_000);
});
