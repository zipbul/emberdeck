import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/sqlite-core';

export const card = sqliteTable(
  'card',
  {
    key: text('key').primaryKey(),
    summary: text('summary').notNull(),
    status: text('status').notNull(),
    type: text('type').notNull(),
    parent: text('parent'),
    namespacesJson: text('namespaces_json'),
    body: text('body'),
    glossaryJson: text('glossary_json').notNull().default('[]'),
    filePath: text('file_path').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_card_status').on(table.status),
    // file_path is functionally unique (each card file ↔ one row). The unique
    // constraint is now enforced at the DB layer so a buggy upsert cannot
    // create two rows pointing at the same file (previously application-layer
    // only via the (key → file_path) bijection in syncCardFromFile /
    // writeCardFile). Tools that rely on file_path as a dedup key (e.g.
    // mergeCardSyncWarnings in src/cli/runner.ts) keep working unchanged.
    uniqueIndex('idx_card_file_path').on(table.filePath),
    index('idx_card_type').on(table.type),
    index('idx_card_parent').on(table.parent),
    foreignKey({ columns: [table.parent], foreignColumns: [table.key] })
      .onUpdate('cascade')
      .onDelete('set null'),
  ],
);

export const tag = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

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
    srcCardKey: text('src_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dstCardKey: text('dst_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    isReverse: integer('is_reverse', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('idx_card_relation_src').on(table.srcCardKey),
    index('idx_card_relation_dst').on(table.dstCardKey),
    uniqueIndex('uq_card_relation').on(table.srcCardKey, table.dstCardKey, table.isReverse),
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

/**
 * Reserved table for a future cross-process advisory lock. The schema column
 * shape supports atomic acquisition via SQLite UNIQUE on `name` plus stale-lock
 * recovery via (pid, start_time_ticks), but the runtime currently performs no
 * lock acquire/release. emberdeck assumes single-process invocation today; see
 * `src/ops/safe.ts` for the explicit no-locking contract. The table is kept so
 * future cross-process safety can be added without a schema migration.
 */
export const systemLock = sqliteTable('system_lock', {
  name: text('name').primaryKey(),
  pid: integer('pid').notNull(),
  startTimeTicks: integer('start_time_ticks').notNull(),
  acquiredAt: text('acquired_at').notNull(),
});

/**
 * Generic key/value store for system-wide metadata (e.g., last_symbol_sync_at).
 * Used by CLI commands that need persistent state outside of cards.
 */
export const systemMetadata = sqliteTable('system_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

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
