---
key: cli-surface/command-routing-and-output/commands/glossary-rename
summary: >-
  Per-command CLI-shape spec for 'ed glossary rename'; declares oldWord/newWord
  + affectedCardKeys + fileWriteFailures shape (POST-001) and 0/2/3 exit policy
  (POST-002).
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

        // stdout shape for `ed glossary rename <old> <new> [--def TEXT]`

        { oldWord, newWord, affectedCardKeys: string[],
          fileWriteFailures?: string[] }
        // The YAML store is written FIRST; then the indexed glossary fields of
        every referencing card update in a DB transaction, with the YAML write
        reverted if the DB step fails (two-step sequence, NOT a single
        transaction). Per-card markdown rewrites are best-effort and any
        file-write failure is recorded in fileWriteFailures.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): rename succeeded and every referencing-card markdown
        rewrite succeeded (fileWriteFailures is absent or empty).

        - 2 (EXIT.VALIDATION_FAILURE): fileWriteFailures.length > 0 (data is
        still emitted; only the exit code differs).

        - thrown mapping: GlossaryNotFoundError → 3 (EXIT.NOT_FOUND) when
        oldWord is missing; GlossaryValidationError → 2
        (EXIT.VALIDATION_FAILURE) for other validation failures (e.g. newWord
        already exists).
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
    - violation: newWord already exists in the glossary store.
      behavior: >-
        stderr emits `{level:'error', code:'glossary-validation-error',
        message}` and the process exits 2.
    - violation: One or more referencing-card markdown rewrites failed.
      behavior: >-
        The offending file paths are recorded in fileWriteFailures; stdout still
        emits the data shape; the process exits 2.
    - violation: oldWord does not exist in the glossary store.
      behavior: >-
        GlossaryNotFoundError → stderr `{code:'glossary-not-found', message}`
        and the process exits 3.
---
