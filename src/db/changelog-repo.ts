import { eq, desc } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { ChangelogRepository, ChangelogRow } from './repository';
import { cardChangelog } from './schema';

/**
 * Canonical values for the `changed_by` column. Ops paths that record a
 * changelog entry import CHANGED_BY.AGENT instead of repeating the string.
 */
export const CHANGED_BY = {
  /** Mutation initiated by an automation agent (the default for CLI runs). */
  AGENT: 'agent',
} as const;

export class DrizzleChangelogRepository implements ChangelogRepository {
  constructor(private db: EmberdeckDb) {}

  insert(entry: Omit<ChangelogRow, 'id'>): void {
    this.db
      .insert(cardChangelog)
      .values({
        cardKey: entry.cardKey,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        changedAt: entry.changedAt,
        changedBy: entry.changedBy,
      })
      .run();
  }

  findByCardKey(cardKey: string, limit = 100): ChangelogRow[] {
    return this.db
      .select()
      .from(cardChangelog)
      .where(eq(cardChangelog.cardKey, cardKey))
      .orderBy(desc(cardChangelog.changedAt))
      .limit(limit)
      .all() as ChangelogRow[];
  }
}
