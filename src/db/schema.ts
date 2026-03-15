import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const card = sqliteTable(
  'card',
  {
    key: text('key').primaryKey(),
    summary: text('summary').notNull(),
    status: text('status').notNull(),
    type: text('type'),
    priority: text('priority'),
    acceptanceJson: text('acceptance_json'),
    constraintsJson: text('constraints_json'),
    body: text('body'),
    filePath: text('file_path').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_card_status').on(table.status),
    index('idx_card_file_path').on(table.filePath),
    index('idx_card_type').on(table.type),
    index('idx_card_priority').on(table.priority),
  ],
);

export const keyword = sqliteTable('keyword', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const tag = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const cardKeyword = sqliteTable(
  'card_keyword',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keyword.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.keywordId] }),
    index('idx_card_keyword_card').on(table.cardKey),
    index('idx_card_keyword_keyword').on(table.keywordId),
  ],
);

export const cardTag = sqliteTable(
  'card_tag',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.tagId] }),
    index('idx_card_tag_card').on(table.cardKey),
    index('idx_card_tag_tag').on(table.tagId),
  ],
);

export const cardRelation = sqliteTable(
  'card_relation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    srcCardKey: text('src_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dstCardKey: text('dst_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    isReverse: integer('is_reverse', { mode: 'boolean' }).notNull().default(false),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_card_relation_src').on(table.srcCardKey),
    index('idx_card_relation_dst').on(table.dstCardKey),
    index('idx_card_relation_type').on(table.type),
    uniqueIndex('uq_card_relation').on(table.type, table.srcCardKey, table.dstCardKey),
  ],
);

/** FTS5 virtual table mapping. Actual creation/sync is handled by migration SQL + triggers. */
export const cardFts = sqliteTable('card_fts', {
  key: text('key'),
  summary: text('summary'),
  body: text('body'),
});

export const cardChangelog = sqliteTable(
  'card_changelog',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedAt: text('changed_at').notNull(),
    changedBy: text('changed_by').notNull(),
  },
  (table) => [
    index('idx_changelog_card').on(table.cardKey),
    index('idx_changelog_changed_at').on(table.changedAt),
  ],
);

export const codeLink = sqliteTable(
  'code_link',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    kind: text('kind').notNull(),
    file: text('file').notNull(),
    symbol: text('symbol').notNull(),
  },
  (table) => [
    index('idx_code_link_card').on(table.cardKey),
    index('idx_code_link_symbol').on(table.symbol),
    index('idx_code_link_file').on(table.file),
    uniqueIndex('uq_code_link').on(table.cardKey, table.kind, table.file, table.symbol),
  ],
);
