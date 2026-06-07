---
key: cli-surface/command-routing-and-output/commands/reset
summary: >-
  Per-command CLI-shape spec for 'ed reset --yes'; declares cardsDeleted +
  glossaryCleared shape (POST-001) and 0/2 exit policy (POST-002).
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
        arguments to this command's action. --yes is OPTIONAL at commander
        layer; if absent, the action calls confirmDestructive which prompts
        interactively (TTY) or throws CliUsageError (non-TTY) before invoking
        resetEmberdeck.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed reset --yes`

        { cardsDeleted: number, glossaryCleared: boolean, failedFileDeletes:
        string[] }

        // failedFileDeletes holds the file paths of cards whose best-effort
        unlink failed. Empty means complete success.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): every card row was removed from the indexed cache and the
        glossary was cleared, and every per-card file unlink succeeded
        (failedFileDeletes is empty).

        - 2 (EXIT.VALIDATION_FAILURE): the indexed cache is consistent (cards
        and glossary both cleared) but one or more `.md` file unlinks failed
        (failedFileDeletes is populated; the operator must clean up). Also:
        CliUsageError from confirmDestructive (no --yes + non-TTY OR user
        declined prompt) → exit 2.

        - thrown mapping: CliUsageError → cli-usage-error → 2. Other unmapped IO
        errors fall through to the parent runner's toCliError default branch as
        `internal-error` → exit 1.
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
    - violation: '--yes flag is omitted AND the process is non-TTY (cannot prompt).'
      behavior: >-
        confirmDestructive throws CliUsageError → stderr `{code:cli-usage-error,
        message}` and exit 2. resetEmberdeck is NOT invoked.
      id: FAIL-001
      case_of: cli-surface/command-routing-and-output#S-F-02
    - violation: >-
        --yes flag is omitted but TTY available; user types anything other than
        'yes' at the prompt.
      behavior: confirmDestructive throws CliUsageError. resetEmberdeck is NOT invoked.
      id: FAIL-002
      case_of: cli-surface/command-routing-and-output#S-F-02
---
