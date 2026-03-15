import { eq, and, desc, asc, sql } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CardRepository, CardRow, CardListFilter } from './repository';
import { card } from './schema';

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

export class DrizzleCardRepository implements CardRepository {
  constructor(private db: EmberdeckDb) {}

  findByKey(key: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.key, key)).get();
    return (row as CardRow | undefined) ?? null;
  }

  findByFilePath(filePath: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.filePath, filePath)).get();
    return (row as CardRow | undefined) ?? null;
  }

  upsert(row: CardRow): void {
    this.db
      .insert(card)
      .values(row)
      .onConflictDoUpdate({
        target: card.key,
        set: {
          summary: row.summary,
          status: row.status,
          type: row.type,
          priority: row.priority,
          acceptanceJson: row.acceptanceJson,
          constraintsJson: row.constraintsJson,
          body: row.body,
          filePath: row.filePath,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }

  deleteByKey(key: string): void {
    this.db.delete(card).where(eq(card.key, key)).run();
  }

  existsByKey(key: string): boolean {
    const row = this.db.select({ key: card.key }).from(card).where(eq(card.key, key)).get();
    return row !== undefined;
  }

  list(filter?: CardListFilter): CardRow[] {
    const conditions = [];
    if (filter?.status) conditions.push(eq(card.status, filter.status));
    if (filter?.type) conditions.push(eq(card.type, filter.type));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    if (filter?.sortBy === 'priority') {
      // Sort by priority order: critical > high > medium > low, nulls last
      const priorityCase = sql`CASE ${card.priority} ${PRIORITY_ORDER.map((p, i) => sql`WHEN ${p} THEN ${i}`).reduce((a, b) => sql`${a} ${b}`)} ELSE 999 END`;
      if (where) {
        return this.db.select().from(card).where(where).orderBy(asc(priorityCase)).all() as CardRow[];
      }
      return this.db.select().from(card).orderBy(asc(priorityCase)).all() as CardRow[];
    }

    if (filter?.sortBy === 'updated_at') {
      if (where) {
        return this.db.select().from(card).where(where).orderBy(desc(card.updatedAt)).all() as CardRow[];
      }
      return this.db.select().from(card).orderBy(desc(card.updatedAt)).all() as CardRow[];
    }

    if (where) {
      return this.db.select().from(card).where(where).all() as CardRow[];
    }
    return this.db.select().from(card).all() as CardRow[];
  }

  search(query: string): CardRow[] {
    if (!query) return [];
    return this.db.$client
      .prepare(
        `SELECT c.key, c.summary, c.status,
                c.type, c.priority,
                c.acceptance_json AS acceptanceJson,
                c.constraints_json AS constraintsJson,
                c.body,
                c.file_path AS filePath,
                c.updated_at AS updatedAt
         FROM card c
         JOIN card_fts f ON c.rowid = f.rowid
         WHERE card_fts MATCH ?`,
      )
      .all(query) as CardRow[];
  }
}
