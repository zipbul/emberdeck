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
        Caller passes a card key and optional depth (default 3 per project
        decisions).
      derives: card-storage/queries#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        getCardTree returns parent-child hierarchy capped at the requested
        depth.
      keyword: MUST
      derives: card-storage/queries#G-001
    - id: POST-002
      guarantee: >-
        getCardContext returns parent BFS plus relation neighborhood capped at
        depth.
      keyword: SHALL
      derives: card-storage/queries#G-001
  invariants:
    - id: INV-001
      statement: Tree and context traversals never exceed the depth ceiling.
      always_holds: per-call
  failures:
    - violation: Root key does not exist.
      behavior: Functions throw CardNotFoundError.
---
