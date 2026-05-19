---
key: cli-surface/command-routing-and-output/commands/glossary-define
summary: >-
  Per-command CLI-shape spec for 'ed glossary define'; declares defined[] +
  failed[] + total shape (POST-001) and 0/2 exit policy (POST-002).
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

        { defined: { word, definition, action: 'created' | 'updated' }[],
          failed:  { inputIndex, reason }[],
          total: number }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0.

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (per-entry failures) OR
        thrown GlossaryValidationError (batch size > 50).

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
        Per-entry validation failed (malformed word, empty definition,
        length-limit violation).
      behavior: >-
        The offending entry is appended to failed[] with its inputIndex and
        reason; stdout still emits the data shape, and the process exits 2.
    - violation: >-
        Batch size exceeds MAX_ENTRIES_PER_CALL (50). The 51st+ entries trigger
        pre-op rejection.
      behavior: >-
        GlossaryValidationError → stderr `{code:'glossary-validation-error',
        message}`; stdout empty; process exits 2.
---
