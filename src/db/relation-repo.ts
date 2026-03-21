import { and, eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { RelationRepository, RelationRow } from './repository';
import { cardRelation } from './schema';

export class DrizzleRelationRepository implements RelationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceForCard(cardKey: string, relations: string[]): void {
    // Delete only the relations owned by this card:
    //   - forward (isReverse=false): relations declared by this card
    //   - reverse mirror (isReverse=true, dstCardKey=cardKey): auto-reverse of this card's declarations
    // Forward relations declared by other cards (dstCardKey=cardKey, isReverse=false) are left untouched
    this.db
      .delete(cardRelation)
      .where(and(eq(cardRelation.srcCardKey, cardKey), eq(cardRelation.isReverse, false)))
      .run();
    this.db
      .delete(cardRelation)
      .where(and(eq(cardRelation.dstCardKey, cardKey), eq(cardRelation.isReverse, true)))
      .run();

    // Insert new relations (forward + reverse)
    // FK guard: if target card does not exist, FK violation → skip
    for (const target of relations) {
      try {
        this.db
          .insert(cardRelation)
          .values({
            srcCardKey: cardKey,
            dstCardKey: target,
            isReverse: false,
          })
          .run();

        this.db
          .insert(cardRelation)
          .values({
            srcCardKey: target,
            dstCardKey: cardKey,
            isReverse: true,
          })
          .run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
        // FK violation: target card does not exist → skip this relation
      }
    }
  }

  findByCardKey(cardKey: string): RelationRow[] {
    return this.db
      .select()
      .from(cardRelation)
      .where(eq(cardRelation.srcCardKey, cardKey))
      .all() as RelationRow[];
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();
  }
}
