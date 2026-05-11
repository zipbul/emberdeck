---
key: analysis/impact-and-aggregate/interactions-and-analyze
summary: >-
  checkInteractions detects shared symbol or shared file conflicts; analyze
  aggregates health, coverage, drift, and glossary.
status: draft
type: spec
parent: analysis/impact-and-aggregate
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes ≥2 card keys to checkInteractions or no arguments to
        analyze.
      derives: analysis/impact-and-aggregate#G-003
  postconditions:
    - id: POST-001
      guarantee: >-
        checkInteractions reports shared symbols, shared files, and undefined
        relations between input cards.
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-003
    - id: POST-002
      guarantee: >-
        analyze returns an envelope with health, coverage, drifted, glossary,
        and unlinked_symbols populated in one call.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-004
  invariants:
    - id: INV-001
      statement: >-
        analyze read paths share the same gildash snapshot for the duration of
        the call.
      always_holds: per-call
  failures:
    - violation: A target card key in checkInteractions does not exist.
      behavior: checkInteractions throws CardNotFoundError.
---
