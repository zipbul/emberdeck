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
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed glossary define [pairs...] [--from f.json]`

        { defined: { word, definition, action: 'created' | 'updated' }[],
          failed:  { inputIndex, reason }[],
          total: number }
        // The CLI reuses the validateGlossaryEntry helper for per-entry
        validation; entries that pass

        // are submitted in one defineGlossary batch (all-or-nothing inside the
        op) and entries that

        // fail the per-entry check accumulate in failed[] without aborting the
        rest of the batch.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0 (every entry persisted).

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (data is still emitted;
        the partial-failure signal is the exit code).

        - thrown mapping: none (per-entry failures accumulate in failed[]).
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
        Per-entry validation failed (e.g. malformed word, empty definition,
        length-limit violation).
      behavior: >-
        The offending entry is appended to failed[] with its inputIndex and
        reason; stdout still emits the data shape, and the process exits 2.
---
