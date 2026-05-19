---
key: cli-surface/command-routing-and-output/commands/bulk-sync
summary: >-
  Per-command CLI-shape spec for 'ed bulk sync'; declares synced + mode +
  failed[] shape (POST-001) and 0/2 exit policy (POST-002).
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

        // stdout shape for `ed bulk sync [PATH]`

        {
          synced: number,
          mode: 'file' | 'directory',
          path: string,
          failed: { filePath: string, error: string }[]
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0.

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0.

        - thrown mapping: CliUsageError → cli-usage-error → 2 (PATH missing or
        does not exist); per-file failures accumulate in failed[].
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
        A per-file parse, validation, or DB upsert step fails during
        DIRECTORY-mode bulk sync.
      behavior: >-
        The offending entry accumulates in failed[] with {filePath, error};
        stdout still emits the data shape; the process exits 2 whenever
        failed.length > 0.
    - violation: >-
        A single-FILE-mode bulk sync where the supplied file fails to parse or
        upsert.
      behavior: >-
        The error throws through the runner and is mapped via toCliError
        (typically internal-error → exit 1 or validation-error → exit 2); it is
        NOT accumulated into failed[] (file mode does not catch per-file
        errors).
    - violation: >-
        PATH positional argument resolves to a non-existent path (only when
        supplied — PATH is optional and defaults to ctx.cardsDir).
      behavior: >-
        CliUsageError → stderr `{code:cli-usage-error, message}` and the process
        exits 2.
---
