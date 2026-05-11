---
key: analysis/drift-detection/check-drift
summary: >-
  checkDrift runs the broken_link and glossary_broken detectors per card
  and optionally auto-transitions active cards to drifted.
status: draft
type: spec
parent: analysis/drift-detection
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes optional card key, max-depth, and the auto-transition
        flag.
      derives: analysis/drift-detection#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        Each card receives a primary driftType plus a driftTypes array
        enumerating all detected types.
      keyword: MUST
      derives: analysis/drift-detection#G-001
    - id: POST-002
      guarantee: >-
        Without --no-auto-transition active cards with any drift transition
        to drifted.
      keyword: SHALL
      derives: analysis/drift-detection#G-002
    - id: POST-003
      guarantee: >-
        Source bindings come from the DB code_link cache populated by
        `ed spec sync`; checkDrift never reparses source annotations.
      keyword: MUST
      derives: analysis/drift-detection#G-001
  invariants:
    - id: INV-001
      statement: >-
        --no-auto-transition disables every status mutation while still
        producing the same drift report.
      always_holds: per-call
    - id: INV-002
      statement: >-
        broken_link can only be reported when the gildash index has at
        least one file; an empty index is treated as "no information".
      always_holds: per-call
  failures:
    - violation: gildash cannot reindex.
      behavior: >-
        checkDrift surfaces the failure as a transient error; status is
        not changed.
    - violation: An expected card key is not in the DB.
      behavior: >-
        The card is silently skipped from the per-card output; the
        aggregate health counts reflect what is present.
---
