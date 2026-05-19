---
key: analysis/impact-and-aggregate/interactions-and-analyze
summary: >-
  checkInteractions detects shared-symbol, shared-file, import-dependency, and
  potential-conflict relationships; analyze aggregates health, coverage,
  drifted, glossary, and unlinkedSymbols in one call.
status: active
type: spec
parent: analysis/impact-and-aggregate
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes one or more card keys to checkInteractions (unknown keys
        produce empty entries rather than throwing) or no arguments to analyze.
      derives: analysis/impact-and-aggregate#G-003
  postconditions:
    - id: POST-001
      guarantee: >-
        checkInteractions returns `{ interactions: CardInteraction[],
        undefinedRelations: ... }`. Each CardInteraction entry contains the
        per-pair detail: `{ pair, sharedSymbols, sharedFiles,
        importDependencies, hasRelation, potentialConflicts }`. The top-level
        shape is the two-key envelope; per-pair details are nested inside
        interactions[].
      keyword: MUST
      derives: analysis/impact-and-aggregate#G-003
    - id: POST-002
      guarantee: >-
        analyze returns a JSON object populating health, coverage, glossary,
        unlinkedSymbols, and pagination on drifted cards. The drifted
        information is exposed as FLAT top-level keys (driftedCards,
        driftedCardsTotal) on the ops-layer return value; the CLI surface (`ed
        analyze`) restructures these into a nested `drifted: { cards, total,
        limit, offset, hasMore }` envelope for stdout. As a hygiene side effect,
        code-index changelog entries older than the configured retention window
        are pruned during the call.
      keyword: SHALL
      derives: analysis/impact-and-aggregate#G-004
  invariants:
    - id: INV-001
      statement: >-
        analyze read paths share the same code-index snapshot for the duration
        of the call (ensureReindexed is invoked at most once per context
        lifetime).
      always_holds: per-call
  failures:
    - violation: A target card key in checkInteractions does not exist.
      behavior: >-
        The unknown key is treated as empty (no symbols, no files, no imports)
        and the call continues; no exception is raised.
    - violation: code-index unavailable during analyze.
      behavior: >-
        The call still returns the card-only views (health, drifted, glossary);
        coverage and unlinkedSymbols are populated with code-index-unavailable
        markers; no exception is raised.
---
