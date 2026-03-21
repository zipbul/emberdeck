import { eq, inArray, sql } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { ClassificationRepository } from './repository';
import { tag, cardTag } from './schema';

export class DrizzleClassificationRepository implements ClassificationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceTags(cardKey: string, names: string[]): void {
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
    if (names.length === 0) return;

    for (const name of names) {
      this.db.insert(tag).values({ name }).onConflictDoNothing().run();
    }

    const rows = this.db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(inArray(tag.name, names))
      .all();

    for (const row of rows) {
      this.db.insert(cardTag).values({ cardKey, tagId: row.id }).run();
    }
  }

  findTagsByCard(cardKey: string): string[] {
    const rows = this.db
      .select({ name: tag.name })
      .from(cardTag)
      .innerJoin(tag, eq(cardTag.tagId, tag.id))
      .where(eq(cardTag.cardKey, cardKey))
      .all();
    return rows.map((r) => r.name);
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
  }

  pruneOrphans(): void {
    this.db.run(sql`DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM card_tag)`);
  }
}
