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
        failure. Re-defining an existing word is an allowed update (not a
        collision error): such an entry is overwritten and reported with action
        'updated', while a brand-new word is reported with action 'created'.
      keyword: MUST
      derives: glossary/lifecycle#G-001
    - id: POST-002
      guarantee: >-
        lookupGlossary(word?) has two modes. With a word: returns `{ found:
        boolean, entry?: GlossaryEntry }` — `{ found: false }` when absent (NOT
        an empty list), `{ found: true, entry }` when present; it never throws
        for missing words. With NO word: returns the full listing `{ entries:
        GlossaryEntry[], total: number }` enumerating every stored entry (total
        === entries.length). The CLI `ed glossary lookup [WORD]` maps the
        optional WORD to these two modes directly.
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
        The glossary store write itself fails (filesystem I/O error, permission
        denied, disk full).
      behavior: >-
        defineGlossary propagates the underlying I/O error; the on-disk store is
        left in its prior state with no partial entries (all-or-nothing
        guarantee).
---
