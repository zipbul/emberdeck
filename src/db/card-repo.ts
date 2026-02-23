import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CardRepository, CardRow, CardListFilter } from './repository';
import { card } from './schema';

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
    if (filter?.status) {
      return this.db.select().from(card).where(eq(card.status, filter.status)).all() as CardRow[];
    }
    return this.db.select().from(card).all() as CardRow[];
  }

  search(query: string): CardRow[] {
    if (!query) return [];
    return this.db.$client
      .prepare(
        `SELECT c.key, c.summary, c.status,
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
