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

        The CLI pre-validates each entry: failures go into failed[] (with
        inputIndex+reason) and surviving entries are passed to the
        all-or-nothing op write. If the op itself throws (e.g. batch size > 50
        or total cap), every accepted entry is moved into failed[].
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0.

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (per-entry
        pre-validation failures) OR a thrown GlossaryValidationError (batch size
        > 50 or total cap) folded into failed[].

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
        An individual entry fails per-entry pre-validation (malformed word,
        empty or over-long definition, duplicate within the batch).
      behavior: >-
        The CLI records that entry in failed[] with its inputIndex and reason;
        the surviving (accepted) entries are still passed to the all-or-nothing
        op write and persisted (partial-accept). Because failed[] is non-empty
        the command exits 2, with data still emitted.
      id: FAIL-001
    - violation: >-
        The op-level all-or-nothing write fails — batch size exceeds 50 per
        call, or the project total would exceed 500.
      behavior: >-
        defineGlossary throws GlossaryValidationError; the CLI folds every
        accepted entry into failed[] and persists nothing. stderr emits
        `{level:'error', code:'glossary-validation-error', message}` and the
        command exits 2.
      id: FAIL-002
---
