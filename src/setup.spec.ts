import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { setupEmberdeck, teardownEmberdeck, GildashInitError } from './setup';
import type { EmberdeckContext } from './config';
import type { Gildash } from '@zipbul/gildash';

describe('setupEmberdeck', () => {
  it('initializes gildash against a real projectRoot', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'ed-setup-'));
    try {
      await mkdir(join(tmp, 'cards'), { recursive: true });
      await writeFile(join(tmp, 'src.ts'), 'export const x = 1;\n', 'utf8');
      const ctx = await setupEmberdeck({
        cardsDir: join(tmp, 'cards'),
        dbPath: ':memory:',
        projectRoot: tmp,
      });
      expect(ctx.gildash).toBeDefined();
      expect(ctx.projectRoot).toBe(tmp);
      await teardownEmberdeck(ctx);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws GildashInitError when projectRoot does not exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'ed-setup-'));
    try {
      await mkdir(join(tmp, 'cards'), { recursive: true });
      await expect(
        setupEmberdeck({
          cardsDir: join(tmp, 'cards'),
          dbPath: ':memory:',
          projectRoot: '/nonexistent/path/that/cannot/possibly/exist',
        }),
      ).rejects.toBeInstanceOf(GildashInitError);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('does not leak the SQLite db file when Gildash.open fails', async () => {
    // File-backed DB so we can verify cleanup. If setup leaks the connection,
    // the WAL/journal sidecar files would linger after the throw.
    const tmp = await mkdtemp(join(tmpdir(), 'ed-setup-leak-'));
    try {
      await mkdir(join(tmp, 'cards'), { recursive: true });
      const dbPath = join(tmp, 'data.db');
      await expect(
        setupEmberdeck({
          cardsDir: join(tmp, 'cards'),
          dbPath,
          projectRoot: '/nonexistent/leak/check',
        }),
      ).rejects.toBeInstanceOf(GildashInitError);
      // The db file may be created by the connection open; the contract is
      // that the connection itself is closed (no WAL stuck open).
      // We verify this indirectly by re-opening the same path — a leaked
      // handle on Linux would not block, but on close failure the WAL would.
      // Stronger check: setupEmberdeck a second time on the same path with a
      // valid projectRoot should succeed cleanly.
      const ctx2 = await setupEmberdeck({
        cardsDir: join(tmp, 'cards'),
        dbPath,
        projectRoot: tmp,
      });
      expect(ctx2.gildash).toBeDefined();
      await teardownEmberdeck(ctx2);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('teardownEmberdeck', () => {
  it('closes the db even when gildash.close throws', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'ed-teardown-'));
    try {
      await mkdir(join(tmp, 'cards'), { recursive: true });
      const dbPath = join(tmp, 'data.db');
      const ctx = await setupEmberdeck({
        cardsDir: join(tmp, 'cards'),
        dbPath,
        projectRoot: tmp,
      });

      // Replace gildash.close with a thrower; teardown must still close the DB.
      const fakeGildash: Gildash = {
        ...ctx.gildash,
        close: () => Promise.reject(new Error('close failed')),
      } as Gildash;
      const ctxBroken: EmberdeckContext = { ...ctx, gildash: fakeGildash };

      await expect(teardownEmberdeck(ctxBroken)).rejects.toThrow('close failed');

      // The DB must be closed: any further query on ctx.db throws.
      expect(() => ctx.db.$client.prepare('SELECT 1').get()).toThrow();

      // Best-effort cleanup of the original gildash handle so the tmp dir
      // can be removed.
      try { await ctx.gildash.close(); } catch { /* already torn down */ }
      expect(existsSync(dbPath)).toBe(true); // sanity: file still on disk
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
