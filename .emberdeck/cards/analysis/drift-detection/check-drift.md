---
key: analysis/drift-detection/check-drift
summary: >-
  checkDrift runs the broken_link and glossary_broken detectors per card and
  reports drift as a derived field; it never mutates card status.
status: draft
type: spec
parent: analysis/drift-detection
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes an optional card key (scopes the report) and an optional
        max-depth for graph traversal.
      derives: analysis/drift-detection#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        Each card in the response receives a primary driftType plus a driftTypes
        array enumerating all detected types.
      keyword: MUST
      derives: analysis/drift-detection#G-001
    - id: POST-002
      guarantee: >-
        checkDrift performs zero writes — neither the card table nor card files
        are modified by detection.
      keyword: MUST
      derives: analysis/drift-detection#G-002
    - id: POST-003
      guarantee: >-
        Source bindings come from the DB code_link cache populated by `ed spec
        sync`; checkDrift never reparses source annotations.
      keyword: MUST
      derives: analysis/drift-detection#G-001
  invariants:
    - id: INV-001
      statement: >-
        Repeated invocations on identical project state return equal responses.
        checkDrift is idempotent.
      always_holds: cross-call
    - id: INV-002
      statement: >-
        broken_link can only be reported when the gildash index has at least one
        file; an empty index is treated as "no information".
      always_holds: per-call
    - id: INV-003
      statement: >-
        Individual gildash lookup failures inside the per-link loop are
        best-effort and never inflate brokenLinks; they are silently skipped so
        a transient gildash hiccup cannot manufacture false drift.
      always_holds: per-call
  failures:
    - violation: ensureReindexed throws (gildash cannot reindex at all).
      behavior: >-
        The exception propagates up through checkDrift; no per-card output is
        produced and no writes occur (consistent with POST-002).
    - violation: >-
        An individual symbol lookup throws inside the per-link loop (transient
        gildash error on one query).
      behavior: >-
        That link is skipped — not counted as broken. brokenLinks reflects only
        confirmed missing symbols. driftType is set only when at least one link
        is provably absent.
    - violation: An expected card key is not in the DB.
      behavior: >-
        The card is silently skipped from the per-card output; the aggregate
        health counts reflect what is present.
---
