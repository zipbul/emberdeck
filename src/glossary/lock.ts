import type { EmberdeckContext } from '../config';

/**
 * Global mutex for all glossary write operations (define, remove, rename).
 *
 * Same Promise-chaining pattern as withCardLock in src/ops/safe.ts,
 * but uses a single global lock (not per-key) since glossary is one shared file.
 *
 * Read-only operations (lookup) do NOT acquire this lock.
 *
 * For rename_glossary, the lock scope covers BOTH the DB transaction
 * (card glossary_json updates) and the glossary.yaml file write,
 * preventing interleaved reads of stale file state.
 */

const glossaryLocks = new WeakMap<EmberdeckContext, Promise<void>>();

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

  try {
    return await Promise.resolve(fn());
  } finally {
    release!();
    if (glossaryLocks.get(ctx) === current) {
      glossaryLocks.delete(ctx);
    }
  }
}
