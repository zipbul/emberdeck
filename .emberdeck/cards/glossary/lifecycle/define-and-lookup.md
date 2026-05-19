---
key: glossary/lifecycle/define-and-lookup
summary: >-
  defineGlossary enforces the all-or-nothing batch contract with a 50-entry cap;
  lookupGlossary provides read access.
status: active
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
        lookupGlossary returns a `{ found: boolean, entry?: GlossaryEntry }`
        object for the requested word. When the word does not exist, `{ found:
        false }` is returned (NOT an empty list); when it exists, `{ found:
        true, entry }` carries the persisted entry. lookupGlossary never throws
        for missing words.
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
