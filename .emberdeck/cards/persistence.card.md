---
{key: persistence,summary: "Dual-write persistence: SQLite database schema, Drizzle ORM repositories, and file system sync",status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: Every card exists as both a .card.md file AND a row in the SQLite cards table. Neither alone is sufficient.,verified: true},{id: ac-2,description: "DB schema has 7 tables: card, keyword, tag, card_keyword, card_tag, card_relation, code_link, card_changelog, plus card_fts (FTS5 virtual table).",verified: true},{id: ac-3,description: "Relations are bidirectional: inserting a forward relation auto-creates a reverse (isReverse=true) entry.",verified: true},{id: ac-4,description: "All repositories implement interface-based contracts (CardRepository, RelationRepository, etc.) for testability.",verified: true},{id: ac-5,description: "CASCADE deletes: removing a card cascades to relations, classifications, code links, and changelog.",verified: true},{id: ac-6,description: "FTS5 full-text search indexes key, summary, and body fields.",verified: true},{id: ac-7,description: Migrations are managed by Drizzle Kit and stored in the drizzle/ directory.,verified: true}],keywords: [SQLite,Drizzle,repository,schema,FTS5,dual-write,CardRepository,RelationRepository],tags: [core,database,persistence],relations: [{type: depends-on,target: card-model}],codeLinks: [{kind: variable,file: src/db/schema.ts,symbol: card},{kind: variable,file: src/db/schema.ts,symbol: cardRelation},{kind: variable,file: src/db/schema.ts,symbol: codeLink},{kind: variable,file: src/db/schema.ts,symbol: cardChangelog},{kind: variable,file: src/db/schema.ts,symbol: cardFts},{kind: type,file: src/db/repository.ts,symbol: CardRepository},{kind: type,file: src/db/repository.ts,symbol: RelationRepository},{kind: type,file: src/db/repository.ts,symbol: CodeLinkRepository},{kind: type,file: src/db/repository.ts,symbol: ChangelogRepository}]}
---
## Rationale

Emberdeck uses a dual-write architecture: every mutation writes to both SQLite (for fast queries) and the filesystem (for git tracking). This is deliberate — the .card.md files are the source of truth for humans, while SQLite is the source of truth for queries and relations.

### Why not file-only?
- FTS5 search across hundreds of cards requires an index
- Relation graph traversal (BFS) needs indexed lookups, not file scanning
- Classification (tags/keywords) queries are O(1) with junction tables

### Why not DB-only?
- Cards must be git-tracked for version control and collaboration
- Human readability: developers browse .card.md files directly
- Portability: the cards directory can be copied without the DB (DB is rebuilt via sync)

## Key Invariants

- **DB-first writes**: All mutations write to DB inside a transaction first, then write the file. If the file write fails, the DB is rolled back via compensation (see `card-crud`).
- **File is canonical for content**: On conflict, `syncCardFromFile` rebuilds DB rows from .card.md files.
- **Unique constraints**: `card.key` is the primary key. `card_relation` has a unique index on (type, src, dst, isReverse). `code_link` has a unique index on (cardKey, kind, file, symbol).
- **Repository pattern**: All DB access goes through repository interfaces. No raw SQL in ops layer. Drizzle implementations (`DrizzleCardRepository`, etc.) are the only concrete implementations.

## Scope Boundaries

- This card covers the storage layer only. Write orchestration (transactions + file writes) is in `card-crud`.
- The `card_fts` table is a virtual FTS5 table. Its sync is handled by SQLite triggers defined in migration SQL, not by application code.
- The `card_changelog` table is append-only. There is no purge/rotation mechanism yet.
