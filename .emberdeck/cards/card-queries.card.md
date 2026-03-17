---
{key: card-queries,summary: "Read-only card queries — get, list, search, relation graph BFS traversal",status: draft,type: feature,priority: high,acceptance: [{id: AC1,description: getCard returns full CardFile from disk with DB metadata,verified: false},{id: AC2,description: listCards supports filtering by status/type and sorting by priority/updated_at,verified: false},{id: AC3,description: "searchCards uses FTS5 and returns [] on malformed queries",verified: false},{id: AC4,description: getRelationGraph performs BFS with maxDepth cap and cycle prevention,verified: false}],keywords: [query,search,fts5,bfs,graph,list,filter],tags: [ops,read],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-io}],codeLinks: [{kind: function,file: src/ops/query.ts,symbol: getCard},{kind: function,file: src/ops/query.ts,symbol: listCards},{kind: function,file: src/ops/query.ts,symbol: searchCards},{kind: function,file: src/ops/query.ts,symbol: getRelationGraph},{kind: function,file: src/ops/query.ts,symbol: getCardContext},{kind: function,file: src/ops/query.ts,symbol: listCardRelations}]}
---
## Why

Read operations are separated from write operations because they have fundamentally different consistency requirements: reads need no locks, no transactions, no compensation. Mixing them with write ops would force unnecessary concurrency overhead.

`getCard` reads from the file (not DB) to ensure the returned content matches what's on disk. DB metadata (status, priority, etc.) is authoritative for queries, but frontmatter + body come from the file.

`getRelationGraph` uses BFS (not DFS) because the primary use case is "show me everything within N hops" — breadth-first naturally discovers the closest dependencies first. maxDepth defaults to 3 because in practice, transitive dependencies beyond 3 levels are noise. The visited set prevents infinite loops in circular relation graphs.

`searchCards` delegates to FTS5 and catches malformed query syntax, returning `[]` instead of throwing. This was a deliberate choice: search should be tolerant. Users (and agents) shouldn't need to learn FTS5 syntax to search.

## Invariants

- `getRelationGraph` never includes the root card in results — only neighbors.
- BFS depth counting: root is depth 0 (not returned), neighbors are depth 1+.
- `visited` set prevents cycles — each card appears at most once in results.
- Direction semantics: `isReverse=false` means forward (outgoing), `isReverse=true` means backward (incoming).
- `listCards` returns all cards when no filter provided. Sorting by `priority` uses the order: critical > high > medium > low.

## Scope Boundaries

- Does NOT modify any data — all operations are pure reads.
- Does NOT implement pagination — full results always returned.
- Does NOT rank search results by relevance — FTS5 returns insertion order.
- Does NOT validate that queried card exists before BFS — returns empty graph for nonexistent root.
- `getCardContext` is a convenience wrapper, not a new algorithm — combines getCard + listCardRelations + codeLinks.

## Edge Cases

- `getRelationGraph` with maxDepth=0: returns empty array (no traversal).
- Circular relations (A→B→A): visited set prevents revisit; both cards appear once.
- `searchCards` with empty string: returns all cards (FTS5 matches everything).
- `listCards` with impossible filter combination (e.g., status=draft AND type=bug with none matching): returns `[]`.