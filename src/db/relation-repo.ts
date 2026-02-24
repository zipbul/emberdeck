import { and, eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { RelationRepository, RelationRow } from './repository';
import { cardRelation } from './schema';

export class DrizzleRelationRepository implements RelationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceForCard(cardKey: string, relations: { type: string; target: string }[]): void {
    // 이 카드가 소유한 관계만 삭제:
    //   - 정방향(isReverse=false): 이 카드가 선언한 relation
    //   - 역방향 mirror(isReverse=true, dstCardKey=cardKey): 이 카드 선언의 자동 역방향
    // 다른 카드가 선언한 forward relation(dstCardKey=cardKey, isReverse=false)은 건드리지 않음
    this.db
      .delete(cardRelation)
      .where(and(eq(cardRelation.srcCardKey, cardKey), eq(cardRelation.isReverse, false)))
      .run();
    this.db
      .delete(cardRelation)
      .where(and(eq(cardRelation.dstCardKey, cardKey), eq(cardRelation.isReverse, true)))
      .run();

    // 2. 새 관계 삽입 (정방향 + 역방향)
    // FK 방어: 대상 카드 미존재 시 FK 위반 → 스킵
    for (const rel of relations) {
      try {
        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: cardKey,
            dstCardKey: rel.target,
            isReverse: false,
          })
          .run();

        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: rel.target,
            dstCardKey: cardKey,
            isReverse: true,
          })
          .run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
        console.warn(`[emberdeck] relation skipped (FK violation): ${msg}`);
        // FK violation: 대상 카드 미존재 → 해당 relation만 스킵 (정상)
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
