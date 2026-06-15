import { eq, and, desc, isNull, gte } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CardRepository, CardRow, CardListFilter, SearchOptions } from './repository';
import { FtsSyntaxError } from '../card/errors';
import { card, cardTag, tag } from './schema';

export class DrizzleCardRepository implements CardRepository {
  constructor(private readonly db: EmberdeckDb) {}

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
          parent: row.parent,
          namespacesJson: row.namespacesJson,
          body: row.body,
          glossaryJson: row.glossaryJson,
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
    if (filter?.parent) conditions.push(eq(card.parent, filter.parent));
    if (filter?.roots) conditions.push(isNull(card.parent));
    if (filter?.updatedSince) conditions.push(gte(card.updatedAt, filter.updatedSince));

    // tag filter requires JOIN through card_tag → tag
    if (filter?.tag) {
      conditions.push(eq(tag.name, filter.tag.toLowerCase()));
      const where = and(...conditions);
      const base = this.db
        .select({
          key: card.key,
          summary: card.summary,
          status: card.status,
          type: card.type,
          parent: card.parent,
          namespacesJson: card.namespacesJson,
          body: card.body,
          glossaryJson: card.glossaryJson,
          filePath: card.filePath,
          updatedAt: card.updatedAt,
        })
        .from(card)
        .innerJoin(cardTag, eq(cardTag.cardKey, card.key))
        .innerJoin(tag, eq(tag.id, cardTag.tagId))
        .where(where);
      if (filter.sortBy === 'updated_at') {
        return base.orderBy(desc(card.updatedAt)).all() as CardRow[];
      }
      return base.all() as CardRow[];
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

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

  search(query: string, options?: SearchOptions): CardRow[] {
    if (!query) return [];
    // Push limit/offset to FTS5 so a large result set isn't fully materialized
    // when the caller only wants the first page. When neither is given, return
    // the full ranked list (back-compat: prior callers didn't paginate at the
    // DB layer).
    const hasPaging = options?.limit !== undefined || options?.offset !== undefined;
    const limit = options?.limit;
    const offset = options?.offset ?? 0;
    try {
      const sql = `SELECT c.key, c.summary, c.status, c.type, c.parent,
                  c.namespaces_json AS namespacesJson,
                  c.body,
                  c.glossary_json AS glossaryJson,
                  c.file_path AS filePath, c.updated_at AS updatedAt,
                  snippet(card_fts, -1, '', '', '…', 12) AS snippet,
                  bm25(card_fts) AS rank
           FROM card c
           JOIN card_fts f ON c.rowid = f.rowid
           WHERE card_fts MATCH ?
           ORDER BY rank${hasPaging ? ` LIMIT ? OFFSET ?` : ''}`;
      return this.db.$client
        .prepare(sql)
        .all(...(hasPaging ? [query, limit ?? -1, offset] : [query])) as CardRow[];
    } catch (e) {
      // FTS5 syntax errors → throw FtsSyntaxError so CLI shows a usage-style
      // message instead of silently returning [] (which previously masked
      // user typos like unmatched quotes). "no such column" covers queries
      // FTS5 parses as a column filter (e.g. `4-tier` → `tier:`, `tier:foo`):
      // these are query-syntax failures, not internal errors.
      if (
        e instanceof Error &&
        (e.message.includes('fts5') ||
          e.message.includes('unterminated') ||
          e.message.includes('unknown special query') ||
          e.message.includes('parse error') ||
          e.message.includes('no such column'))
      ) {
        throw new FtsSyntaxError(query, e.message);
      }
      throw e;
    }
  }

  findChildren(key: string): CardRow[] {
    return this.db.select().from(card).where(eq(card.parent, key)).all() as CardRow[];
  }

  updateKeyAndPath(oldKey: string, newKey: string, newFilePath: string, updatedAt: string): void {
    this.db
      .update(card)
      .set({ key: newKey, filePath: newFilePath, updatedAt })
      .where(eq(card.key, oldKey))
      .run();
  }
}
