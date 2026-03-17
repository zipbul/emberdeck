---
{key: persistence,summary: "SQLite persistence — schema, WAL mode, FTS5 search, repository pattern with FK cascades",status: draft,type: feature,priority: critical,acceptance: [{id: AC1,description: "SQLite opens with WAL mode, FK enforcement, and 5s busy_timeout",verified: false},{id: AC2,description: "CardRepository supports upsert, findByKey, FTS5 search, and filtered list",verified: false},{id: AC3,description: RelationRepository auto-generates bidirectional reverse rows on insert,verified: false},{id: AC4,description: CodeLinkRepository deduplicates by cardKey+kind+file+symbol (client + DB),verified: false},{id: AC5,description: ChangelogRepository is append-only with ISO timestamps,verified: false}],keywords: [sqlite,drizzle,wal,fts5,repository,cascade,relations],tags: [core,data],relations: [{type: depends-on,target: card-model}],codeLinks: [{kind: defines,file: src/db/schema.ts,symbol: card},{kind: defines,file: src/db/connection.ts,symbol: createEmberdeckDb},{kind: interface,file: src/db/repository.ts,symbol: CardRepository},{kind: class,file: src/db/card-repo.ts,symbol: DrizzleCardRepository},{kind: class,file: src/db/relation-repo.ts,symbol: DrizzleRelationRepository},{kind: class,file: src/db/code-link-repo.ts,symbol: DrizzleCodeLinkRepository},{kind: class,file: src/db/changelog-repo.ts,symbol: DrizzleChangelogRepository}]}
---
## Why

SQLite was chosen because emberdeck is a CLI tool that runs locally — no network daemon, no deployment complexity. Bun's native SQLite bindings + Drizzle ORM provide type-safe queries without runtime dependencies. WAL mode enables concurrent readers during writes; `busy_timeout=5000` prevents SQLITE_BUSY errors in typical CLI usage. FK enforcement (`PRAGMA foreign_keys = ON`) prevents orphaned records — critical because relations, code links, keywords, tags, and changelog all reference the card table.

Relations use bidirectional mirroring: when card A declares `depends-on B`, the DB auto-inserts a reverse row `(depends-on, B, A, isReverse=true)`. This was chosen over storing only forward relations because backward BFS traversal ("what depends on me?") is a hot path in impact analysis. Storing both directions avoids expensive reverse-join queries. The alternative — computing reverse relations at query time — was rejected because it requires scanning all relations to find incoming edges.

FTS5 was chosen over LIKE queries because card search needs to support phrase matching and boolean operators across summary+body text. FTS5 triggers auto-sync the index on INSERT/UPDATE/DELETE, eliminating manual index management. Malformed FTS queries (e.g., unterminated quotes) return empty results instead of throwing — tolerant search over strict errors.

## Invariants

- `card.key` is PRIMARY KEY — globally unique.
- `(type, srcCardKey, dstCardKey, isReverse)` is UNIQUE on relations — no duplicate edges.
- `(cardKey, kind, file, symbol)` is UNIQUE on code links — dual-layer dedup (client-side Set + DB constraint).
- `keyword.name` and `tag.name` are UNIQUE within their tables.
- FK CASCADE on all child tables: deleting a card removes all its relations, code links, keywords, tags, and changelog entries.
- FTS5 sync is trigger-based — direct SQL bypassing triggers will desync the index.
- Changelog is append-only — no UPDATE or DELETE on changelog rows.

## Scope Boundaries

- Does NOT validate relation types — stores any string. Validation is ops layer.
- Does NOT parse JSON blobs (`acceptanceJson`, `constraintsJson`) — caller serializes/deserializes.
- Does NOT wrap multi-operation sequences in transactions — caller uses Drizzle tx if needed.
- Does NOT implement search ranking/scoring — FTS5 returns insertion order, not relevance.
- Does NOT auto-delete orphaned keyword/tag rows — `pruneOrphans()` must be called explicitly.
- Does NOT provide conflict resolution — upsert is INSERT OR REPLACE (last write wins).

## Edge Cases

- FK violation on relation insert (target card doesn't exist): silently skipped, no error.
- FK violation on code link insert: same silent skip behavior.
- `searchCards` with malformed FTS5 syntax (e.g., `unterminated"quote`): returns `[]`, not error.
- Relation self-reference (`A depends-on A`): creates both forward and reverse rows (both valid).
- Changelog `oldValue`/`newValue` can both be null (e.g., body changes log existence only, not content).