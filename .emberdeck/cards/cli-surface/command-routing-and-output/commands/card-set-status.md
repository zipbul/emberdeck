---
key: cli-surface/command-routing-and-output/commands/card-set-status
summary: >-
  Per-command CLI-shape spec for 'ed card set-status'; declares
  oldStatus/newStatus shape (POST-001) and 0/2/3 exit policy (POST-002).
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

        // stdout shape for `ed card set-status <key> <status> [--reason TEXT]`

        { key, oldStatus, newStatus }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the status transition succeeded.

        - thrown mapping: CardNotFoundError → 3 (EXIT.NOT_FOUND);
        ActivationGuardError → 2 (EXIT.VALIDATION_FAILURE).
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
        Transition to active leaves the activation guard preconditions unmet
        (e.g. missing child cards on a domain, broken `@spec` binding on a
        spec).
      behavior: >-
        ActivationGuardError → stderr `{level:'error',
        code:'activation-guard-failed', message, details:{unmetConditions}}` and
        the process exits 2.
    - violation: No card exists for the requested key.
      behavior: >-
        CardNotFoundError → stderr `{level:'error', code:'card-not-found',
        message}` and the process exits 3.
---
