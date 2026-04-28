import type { CardStatus } from '../card/types';

// ---- Row types ----

export interface CardRow {
  key: string;
  summary: string;
  status: string;
  type: string;
  parent: string | null;
  boundaryJson: string | null;
  /** JSON-serialized {principle?, brief?, spec?} namespaces from frontmatter. NULL when card has no namespace structures. */
  namespacesJson: string | null;
  body: string | null;
  glossaryJson: string;
  filePath: string;
  updatedAt: string;
}

export interface ChangelogRow {
  id: number;
  cardKey: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
  changedBy: string;
}

export interface RelationRow {
  id: number;
  srcCardKey: string;
  dstCardKey: string;
  isReverse: boolean;
}

export interface CodeLinkRow {
  id: number;
  cardKey: string;
  kind: string;
  file: string;
  symbol: string;
}

export interface CardListFilter {
  status?: CardStatus;
  type?: string;
  parent?: string;
  tag?: string;
  roots?: boolean;
  updatedSince?: string;
  sortBy?: 'updated_at';
}

// ---- Repository interfaces ----

export interface CardRepository {
  findByKey(key: string): CardRow | null;
  findByFilePath(filePath: string): CardRow | null;
  upsert(row: CardRow): void;
  deleteByKey(key: string): void;
  existsByKey(key: string): boolean;
  list(filter?: CardListFilter): CardRow[];
  search(query: string): CardRow[];
  findChildren(key: string): CardRow[];
  findAncestors(key: string): CardRow[];
}

export interface RelationRepository {
  /** Replace all relations for a card. Automatically handles bidirectional isReverse entries. Returns keys of targets that failed (FK violation). */
  replaceForCard(cardKey: string, relations: string[]): string[];
  findByCardKey(cardKey: string): RelationRow[];
  /** Bulk read — returns every row in the relation table. Used to avoid N+1 in validateCards. */
  findAll(): RelationRow[];
  deleteByCardKey(cardKey: string): void;
}

export interface ClassificationRepository {
  /** Replace all tag mappings for a card. Unregistered tags are auto-created. */
  replaceTags(cardKey: string, names: string[]): void;
  findTagsByCard(cardKey: string): string[];
  deleteByCardKey(cardKey: string): void;
  /** Delete tag rows not linked to any card. */
  pruneOrphans(): void;
}

export interface ChangelogRepository {
  insert(entry: Omit<ChangelogRow, 'id'>): void;
  findByCardKey(cardKey: string, limit?: number): ChangelogRow[];
}

export interface CodeLinkRepository {
  /** Replace all codeLink entries for a card. */
  replaceForCard(cardKey: string, links: import('../card/types').CodeLink[]): void;
  findByCardKey(cardKey: string): CodeLinkRow[];
  /** Look up by symbol name. If filePath is specified, filter to that file. */
  findBySymbol(symbolName: string, filePath?: string): CodeLinkRow[];
  /** Find all code links referencing a specific file path. */
  findByFile(filePath: string): CodeLinkRow[];
  deleteByCardKey(cardKey: string): void;
}
