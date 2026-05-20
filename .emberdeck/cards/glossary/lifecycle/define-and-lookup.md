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
        This is the OP-layer contract; the CLI `ed glossary define`
        pre-validates each entry and splits failures into failed[] before
        invoking the op, so the user-facing surface is partial-accept (see
        commands/glossary-define).
      keyword: MUST
      derives: glossary/lifecycle#G-001
    - id: POST-002
      guarantee: >-
        lookupGlossary(word?) has two modes. With a word: returns `{ found:
        boolean, entry?: GlossaryEntry }` — `{ found: false }` when absent, `{
        found: true, entry }` when present; it never throws for missing words.
        With NO word: returns `{ found: true, entries: GlossaryEntry[] }`
        listing every stored entry. (The CLI `ed glossary lookup [WORD]`
        projects both modes to a uniform `{ entries, total }` stdout shape.)
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
      statement: >-
        defineGlossary batches are bounded by the documented per-call cap of 50
        entries, and the project total is bounded by 500 entries.
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
    - violation: >-
        The batch would push the project total beyond the per-project entry cap
        (500).
      behavior: >-
        defineGlossary throws GlossaryValidationError; no entries are persisted
        (all-or-nothing).
---
