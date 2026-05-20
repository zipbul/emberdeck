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
    - id: POST-003
      guarantee: >-
        lookupGlossary never throws for an unknown, empty, or malformed word: it
        returns `{ found: false }` for any word that does not match an entry.
        Throwing is reserved for store-level failures (I/O / parse), not for
        missing-word lookups.
      keyword: MUST
      derives: glossary/lifecycle#G-001
  invariants:
    - id: INV-001
      statement: defineGlossary batches are bounded by the documented cap of 50 entries.
      always_holds: per-call
  failures:
    - violation: Batch exceeds the size cap.
      behavior: defineGlossary throws GlossaryValidationError; no entries persisted.
    - violation: >-
        A word fails format validation (invalid slug shape, reserved characters,
        or normalization-rules violation) OR its definition exceeds the
        configured length cap.
      behavior: >-
        defineGlossary throws GlossaryValidationError with details identifying
        the offending word(s); no entries are persisted (all-or-nothing).
    - violation: >-
        The input batch contains duplicate words (the same word key appears more
        than once in one call).
      behavior: defineGlossary throws GlossaryValidationError; no entries are persisted.
    - violation: >-
        A word in the batch collides with an existing entry in the glossary
        store (defineGlossary does not silently overwrite).
      behavior: >-
        defineGlossary throws GlossaryValidationError; no entries from the batch
        are persisted (all-or-nothing).
    - violation: >-
        The glossary store write itself fails (filesystem I/O error, permission
        denied, disk full).
      behavior: >-
        defineGlossary propagates the underlying I/O error; the on-disk store is
        left in its prior state with no partial entries (all-or-nothing
        guarantee).
---
