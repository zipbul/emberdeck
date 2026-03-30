---
{key: spec/relation-graph,summary: "Behavioral contract for getRelationGraph BFS traversal, getCardContext, getCardTree, listCardRelations, and card querying",status: draft,type: spec,parent: structural-integrity,boundary: [src/ops/query.ts],tags: [graph,bfs,query,context],relations: [code-binding,impact-analysis],codeLinks: [{kind: function,file: src/ops/query.ts,symbol: getRelationGraph},{kind: function,file: src/ops/query.ts,symbol: getCardContext},{kind: function,file: src/ops/query.ts,symbol: getCard},{kind: function,file: src/ops/query.ts,symbol: getCards},{kind: function,file: src/ops/query.ts,symbol: listCards},{kind: function,file: src/ops/query.ts,symbol: searchCards},{kind: function,file: src/ops/query.ts,symbol: getCardTree},{kind: function,file: src/ops/query.ts,symbol: listCardRelations},{kind: interface,file: src/ops/query.ts,symbol: RelationGraphNode}],glossary: [relation,card,codeLink,boundary]}
---
## Contracts

### C-01: BFS traversal with cycle protection
- **Given** a root card key and maxDepth (default 3)
- **When** getRelationGraph is called
- **Then** BFS traversal discovers connected cards through relations
- **And** a visited set prevents revisiting the same node (cycle-safe)
- **And** traversal stops at maxDepth (nodes at maxDepth are not expanded further)
- **And** if root card does not exist, an empty array is returned (no error)

### C-02: Direction filtering
- **Given** direction option (forward, backward, or both)
- **When** getRelationGraph processes relations
- **Then** forward direction follows non-reverse relations (isReverse=false)
- **And** backward direction follows reverse relations (isReverse=true)
- **And** both direction follows all relations
- **And** each result node includes its depth and direction

### C-03: Card context with multi-hop BFS
- **Given** a card key and depth option
- **When** getCardContext is called with depth > 1
- **Then** upstream cards (reverse relations) and downstream cards (forward relations) at depth 1 are returned
- **And** depth-2+ nodes are returned in the related array with full card data
- **And** truncation is flagged when any node at maxDepth has unvisited neighbors

### C-04: getCard and getCards read operations
- **Given** card key(s)
- **When** getCard/getCards is called
- **Then** the card file is read from disk and returned
- **And** if includeHistory=true, changelog entries are included
- **And** getCards collects not-found keys in notFound array instead of throwing

### C-05: listCards lightweight DB query
- **Given** optional filters (status, type, parent, tag, roots, updatedSince, sortBy)
- **When** listCards is called
- **Then** results come from DB only (no file reads)
- **And** body field is stripped from results (CardSummaryRow)

### C-06: searchCards FTS5 full-text search
- **Given** a search query string
- **When** searchCards is called
- **Then** FTS5 search runs on the card_fts virtual table
- **And** results can be filtered by type and/or status
- **And** empty query returns empty array

### C-07: getCardTree recursive hierarchy
- **Given** a root card key and maxDepth (default 10, capped at 20)
- **When** getCardTree is called
- **Then** children are recursively built from ctx.cardRepo.findChildren
- **And** nodes at maxDepth have empty children array with truncated=true if they have actual children
- **And** CardNotFoundError is thrown if root does not exist

### C-08: listCardRelations
- **Given** a card key
- **When** listCardRelations is called
- **Then** both forward (isReverse=false) and reverse (isReverse=true) relations are returned

## Failure Modes

| Violation | System Behavior |
|---|---|
| Root card not found for getRelationGraph | Empty array returned |
| Card not found for getCard | CardNotFoundError thrown |
| Card not found for getCards | Collected in notFound array |
| Root not found for getCardTree | CardNotFoundError thrown |
| maxDepth > 20 for getCardTree | Capped to 20 silently |
| Empty search query | Empty array returned |