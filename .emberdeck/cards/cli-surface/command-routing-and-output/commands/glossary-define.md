---
key: cli-surface/command-routing-and-output/commands/glossary-define
summary: >-
  Per-command CLI-shape spec for 'ed glossary define'; declares defined[] +
  total shape (all-or-nothing, POST-001) and 0/2 exit policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Runner has built a CliRuntime and forwarded commander-validated
        arguments to this command's action.
      derives: cli-surface/command-routing-and-output#G-001
    - id: PRE-002
      condition: >-
        Per-invocation batch size MUST be ≤ MAX_ENTRIES_PER_CALL (50). The 51st
        entry triggers GlossaryValidationError before the op is dispatched.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed glossary define WORD=DEF ... | --from FILE`

        { defined: { word, definition, action: 'created' | 'updated' }[],
          total: number }
        // defineGlossary is ALL-OR-NOTHING: on any per-entry validation failure
        or batch size > 50 it throws and persists nothing. A successful call
        returns the full defined[] (each entry created or updated) with total
        === defined.length.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): every entry persisted (all-or-nothing success).

        - 2 (EXIT.VALIDATION_FAILURE): thrown GlossaryValidationError — any
        per-entry validation failure (malformed word, empty/over-long
        definition, duplicate within batch) OR batch size > 50; nothing is
        persisted.

        - thrown mapping: GlossaryValidationError → glossary-validation-error →
        2.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        Inherits INV-001..INV-005 from parent spec runner-and-output (canonical
        stderr JSON-line schema, disjoint stdout/stderr channels, no envelope,
        --quiet semantics, empty stdout on failure).
      always_holds: per-call
  failures:
    - violation: >-
        Any entry fails validation (malformed word, empty or over-long
        definition, duplicate within the batch).
      behavior: >-
        defineGlossary throws GlossaryValidationError naming the offending
        entry; stderr emits `{level:'error', code:'glossary-validation-error',
        message}` and the process exits 2. No entries are persisted
        (all-or-nothing).
    - violation: Batch size exceeds MAX_ENTRIES_PER_CALL (50).
      behavior: >-
        GlossaryValidationError → stderr `{code:'glossary-validation-error',
        message}` and the process exits 2; nothing persisted.
---
