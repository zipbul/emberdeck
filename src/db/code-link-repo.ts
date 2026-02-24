import { eq, and } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CodeLinkRepository, CodeLinkRow } from './repository';
import type { CodeLink } from '../card/types';
import { codeLink } from './schema';

export class DrizzleCodeLinkRepository implements CodeLinkRepository {
  constructor(private db: EmberdeckDb) {}

  replaceForCard(cardKey: string, links: CodeLink[]): void {
    this.db.delete(codeLink).where(eq(codeLink.cardKey, cardKey)).run();
    if (links.length === 0) return;

    for (const link of links) {
      try {
        this.db
          .insert(codeLink)
          .values({ cardKey, kind: link.kind, file: link.file, symbol: link.symbol })
          .run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
        console.warn(`[emberdeck] code link skipped (FK violation): ${msg}`);
        // FK violation: 대상 카드 미존재 → 해당 link만 스킵
      }
    }
  }

  findByCardKey(cardKey: string): CodeLinkRow[] {
    return this.db
      .select()
      .from(codeLink)
      .where(eq(codeLink.cardKey, cardKey))
      .all() as CodeLinkRow[];
  }

  findBySymbol(symbolName: string, filePath?: string): CodeLinkRow[] {
    if (filePath !== undefined) {
      return this.db
        .select()
        .from(codeLink)
        .where(and(eq(codeLink.symbol, symbolName), eq(codeLink.file, filePath)))
        .all() as CodeLinkRow[];
    }
    return this.db
      .select()
      .from(codeLink)
      .where(eq(codeLink.symbol, symbolName))
      .all() as CodeLinkRow[];
  }

  findByFile(filePath: string): CodeLinkRow[] {
    return this.db
      .select()
      .from(codeLink)
      .where(eq(codeLink.file, filePath))
      .all() as CodeLinkRow[];
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(codeLink).where(eq(codeLink.cardKey, cardKey)).run();
  }
}
