---
key: glossary/lifecycle/define-and-lookup
summary: >-
  defineGlossary enforces the all-or-nothing batch contract with a 50-entry cap;
  lookupGlossary provides read access.
status: draft
type: spec
parent: glossary/lifecycle
glossary:
  - drift
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller passes a list of word/definition pairs (≤50) for define, or a
        word for lookup.
      derives: glossary/lifecycle#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        defineGlossary persists all entries or zero entries on any single
        failure.
      keyword: MUST
      derives: glossary/lifecycle#G-001
    - id: POST-002
      guarantee: >-
        lookupGlossary returns the entry or empty list without throwing for
        missing words.
      keyword: SHALL
      derives: glossary/lifecycle#G-001
  invariants:
    - id: INV-001
      statement: defineGlossary batches are bounded by the documented cap of 50 entries.
      always_holds: per-call
  failures:
    - violation: Batch exceeds the size cap.
      behavior: defineGlossary throws GlossaryValidationError; no entries persisted.
---
