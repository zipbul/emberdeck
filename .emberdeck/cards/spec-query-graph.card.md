---
{key: spec-query-graph,summary: BFS relation graph traversal and card context assembly for cross-module consumers,status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/query.ts],relations: [card-lifecycle],codeLinks: [{kind: function,file: src/ops/query.ts,symbol: getRelationGraph},{kind: function,file: src/ops/query.ts,symbol: getCardContext}],glossary: [card]}
---

## Contracts
- WHEN getRelationGraph is called, THEN BFS traversal MUST respect maxDepth (default 3) and direction (forward/backward/both). Visited nodes MUST NOT be revisited (cycle-safe). Non-existent neighbors MUST be skipped.
- WHEN getRelationGraph root card does not exist, THEN an empty array MUST be returned (no error).
- WHEN getCardContext is called, THEN upstream cards MUST be those with isReverse=true relations, and downstream cards MUST be those with isReverse=false relations. Code links MUST be resolved via gildash when available.
- WHEN getCardContext depth > 1, THEN BFS relation graph MUST be used for multi-hop discovery. Nodes at maxDepth with unvisited neighbors MUST set truncated=true.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Root card not found in getRelationGraph | Empty array returned |
| Card file not found in getCardContext | CardNotFoundError |
| Gildash unavailable in getCardContext | codeLinks returned as empty array |
| Traversal hits depth limit with more neighbors | truncated=true in result |
