import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import { systemMetadata } from './schema';

/**
 * Tiny key-value access for the system_metadata table.
 *
 * The table stores cross-invocation watermarks (currently:
 * last_symbol_sync_at). Wrapping it in a repository keeps spec-sync-symbols
 * free of raw `$client.prepare` SQL and matches the abstraction level used by
 * every other persistence write in the codebase.
 */
export class DrizzleSystemMetadataRepository {
  constructor(private readonly db: EmberdeckDb) {}

  /** Return the stored value for `key`, or null when no row exists. */
  get(key: string): string | null {
    const row = this.db
      .select({ value: systemMetadata.value })
      .from(systemMetadata)
      .where(eq(systemMetadata.key, key))
      .get();
    return (row?.value as string | undefined) ?? null;
  }

  /** Insert or update a single key. */
  upsert(key: string, value: string, updatedAt: string): void {
    this.db
      .insert(systemMetadata)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: systemMetadata.key,
        set: { value, updatedAt },
      })
      .run();
  }
}
