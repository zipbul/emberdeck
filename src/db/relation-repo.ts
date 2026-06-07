import { errorMessage } from '../util/error';
import { and, eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { RelationRepository, RelationRow } from './repository';
import { cardRelation } from './schema';

export class DrizzleRelationRepository implements RelationRepository {
  constructor(private readonly db: EmberdeckDb) {}

  replaceForCard(cardKey: string, relations: string[]): string[] {
    // Store FORWARD edges only — reverse is derived on read (design Principle 3:
    // expose, don't store). The `is_reverse` column is vestigial (always false on
    // stored rows); the DB is a disposable cache rebuilt from card files, so no
    // migration is needed. We also defensively purge any legacy reverse rows that
    // touch this card so an upgraded-in-place DB converges to forward-only.
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db
      .delete(cardRelation)
      .where(and(eq(cardRelation.dstCardKey, cardKey), eq(cardRelation.isReverse, true)))
      .run();

    const failedTargets: string[] = [];
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
      } catch (e) {
        const msg = errorMessage(e);
        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
        failedTargets.push(target);
      }
    }
    return failedTargets;
  }

  findByCardKey(cardKey: string): RelationRow[] {
    // Forward = edges this card declared. Reverse = other cards' forward edges
    // pointing here, synthesized as {src: cardKey, dst: <other>, isReverse: true}
    // so consumers read the same shape they did when reverse rows were stored.
    const forward = this.db
      .select()
      .from(cardRelation)
      .where(and(eq(cardRelation.srcCardKey, cardKey), eq(cardRelation.isReverse, false)))
      .all() as RelationRow[];
    const incoming = this.db
      .select()
      .from(cardRelation)
      .where(and(eq(cardRelation.dstCardKey, cardKey), eq(cardRelation.isReverse, false)))
      .all() as RelationRow[];
    const reverse: RelationRow[] = incoming.map((r) => ({
      id: -1, // derived row — no stored identity (never consumed)
      srcCardKey: cardKey,
      dstCardKey: r.srcCardKey,
      isReverse: true,
    }));
    return [...forward, ...reverse];
  }

  findAll(): RelationRow[] {
    // Real stored edges only (forward). Reverse is never stored — callers that
    // need reverse derive it by indexing these rows on dstCardKey.
    return this.db
      .select()
      .from(cardRelation)
      .where(eq(cardRelation.isReverse, false))
      .all() as RelationRow[];
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();
  }
}
