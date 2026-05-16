---
key: cli-surface/command-routing-and-output/commands/card-rename
summary: >-
  Per-command CLI-shape spec for 'ed card rename'; declares old/new path +
  failedReferenceUpdates shape (POST-001) and 0/2/3/4 exit policy (POST-002).
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

        // stdout shape for `ed card rename <old> <new>`

        {
          oldKey, newKey, oldPath, newPath,
          failedReferenceUpdates: { cardKey: string, reason: string }[]
        }

        // failedReferenceUpdates[].reason carries the underlying error message
        (Error.message or the stringified value); the op layer populates it from
        the catch block inside the rename cascade loop.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): rename succeeded and every referencing-card file update
        succeeded (failedReferenceUpdates.length === 0).

        - 2 (EXIT.VALIDATION_FAILURE): failedReferenceUpdates.length > 0 (data
        is still emitted; the partial-failure signal is the exit code).

        - thrown mapping: CardNotFoundError → 3 (EXIT.NOT_FOUND);
        CardAlreadyExistsError → 4 (EXIT.CONFLICT) for newKey collisions;
        CardRenameSamePathError → 4 (EXIT.CONFLICT) when old equals new.
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
    - violation: Reference-update file write fails for one or more referencing cards.
      behavior: >-
        stdout emits the data shape with failedReferenceUpdates populated,
        process exits 2; stderr is empty (the data channel carries the
        diagnostic).
    - violation: No card exists for the old key.
      behavior: >-
        CardNotFoundError → stderr `{code:'card-not-found', message}` and exit
        3.
    - violation: newKey already names another card.
      behavior: >-
        CardAlreadyExistsError → stderr `{code:'card-already-exists', message}`
        and exit 4.
    - violation: old and new keys resolve to the same path.
      behavior: >-
        CardRenameSamePathError → stderr `{code:'rename-same-path', message}`
        and exit 4.
---
