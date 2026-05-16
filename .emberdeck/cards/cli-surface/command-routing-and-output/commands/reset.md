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
        arguments to this command's action; --yes is required, commander rejects
        the invocation otherwise.
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
        (failedFileDeletes is populated; the operator must clean up).

        - thrown mapping: none (general IO failures fall through to the parent
        runner's mapping → exit 5).

        - Missing --yes: commander rejects upstream → runner-commander-fallback
        path with stderr `{level:'error', code:'cli-usage-error', ...}` and exit
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
    - violation: '--yes flag is missing.'
      behavior: >-
        commander rejects the invocation upstream, taking the
        runner-commander-fallback path: stderr `{level:'error',
        code:'cli-usage-error', ...}` and exit 2.
---
