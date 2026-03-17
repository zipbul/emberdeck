---
{key: card-queries,summary: "Card query operations: get, list, search (FTS5), relation graph traversal (BFS), and card context assembly",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: getCard reads from file (not DB) to return the canonical card content.,verified: true},{id: ac-2,description: "listCards reads from DB only (lightweight, no file I/O) and supports filter by status, type, and sortBy.",verified: true},{id: ac-3,description: searchCards uses FTS5 full-text search. Empty query returns empty array.,verified: true},{id: ac-4,description: getRelationGraph performs BFS traversal with configurable maxDepth (default 3) and direction (forward/backward/both).,verified: true},{id: ac-5,description: BFS skips cards that no longer exist in DB (dangling relation references are tolerated).,verified: true},{id: ac-6,description: getCardContext assembles card + resolved code links + upstream cards + downstream cards in a single call.,verified: true},{id: ac-7,description: listCardRelations returns both forward (isReverse=false) and reverse (isReverse=true) relations.,verified: true}],keywords: [getCard,listCards,searchCards,getRelationGraph,getCardContext,BFS,FTS5],tags: [core,operations,query],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-model}],codeLinks: [{kind: function,file: src/ops/query.ts,symbol: getCard},{kind: function,file: src/ops/query.ts,symbol: listCards},{kind: function,file: src/ops/query.ts,symbol: searchCards},{kind: function,file: src/ops/query.ts,symbol: getRelationGraph},{kind: function,file: src/ops/query.ts,symbol: getCardContext},{kind: function,file: src/ops/query.ts,symbol: listCardRelations}]}
---
## Rationale

Query operations are split between file reads and DB reads based on the data needed:

- **getCard**: Reads from file because the file is the canonical source for frontmatter + body content.
- **listCards/searchCards**: Read from DB because they need indexed queries (status filter, FTS5 search) and must be fast for large card sets.
- **getRelationGraph**: Reads from DB because graph traversal requires indexed lookups on the card_relation table.

This split means `listCards` returns `CardRow` (DB shape) while `getCard` returns `CardFile` (file shape). These are intentionally different types.

## Key Invariants

- **BFS maxDepth default is 3**: This prevents runaway traversal in large graphs. The caller can override but the default was chosen to balance completeness vs. performance.
- **Visited set**: BFS uses a `Set<string>` to prevent cycles. The root key is pre-added to the visited set.
- **Direction filtering**: `forward` follows outgoing relations only, `backward` follows incoming (isReverse) relations only, `both` follows all. This enables both "what does this card depend on" and "what depends on this card" queries.
- **getCardContext graceful degradation**: If gildash is not configured, code links are returned as an empty array (no error thrown).

## Scope Boundaries

- This card covers read-only query operations. Write operations are in `card-crud`.
- The `generateContext` function (multi-card context pack) is in `analysis` because it composes queries with acceptance/changelog/constraint data.
- FTS5 query syntax is whatever SQLite's FTS5 module supports. No query preprocessing or sanitization is done by emberdeck.
