---
key: card-storage/queries/tree-context
summary: >-
  getCardTree, getCardContext, and getRelationGraph implement bounded traversals
  over the parent and relation graph.
status: active
type: spec
parent: card-storage/queries
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a card key and optional depth. getCardTree defaults to
        depth 10 capped at 20; getCardContext defaults to depth 1 at both the
        ops and CLI layers; getRelationGraph defaults to depth 3.
      derives: card-storage/queries#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        getCardTree returns the parent-child hierarchy rooted at the requested
        key, capped at min(requestedDepth, 20) and defaulting to 10 when depth
        is omitted; nodes at the depth ceiling that have further unvisited
        children expose a truncated marker on the result.
      keyword: MUST
      derives: card-storage/queries#G-001
    - id: POST-002
      guarantee: >-
        getCardContext returns the requested card plus parent BFS to the root
        and the relation neighborhood up to the requested depth (default 1 hop
        at both ops and CLI layers). Truncation is signalled when nodes at the
        ceiling still have unvisited relation neighbors.
      keyword: SHALL
      derives: card-storage/queries#G-001
  invariants:
    - id: INV-001
      statement: >-
        Tree and context traversals never exceed the depth ceiling resolved as
        min(requestedDepth, 20) for tree and the caller-provided depth for
        context; truncation never silently drops nodes without surfacing the
        truncated marker.
      always_holds: per-call
  failures:
    - violation: Root key does not exist.
      behavior: Functions throw CardNotFoundError.
---
