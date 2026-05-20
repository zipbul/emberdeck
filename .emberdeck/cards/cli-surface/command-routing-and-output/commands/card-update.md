---
key: cli-surface/command-routing-and-output/commands/card-update
summary: >-
  Per-command CLI-shape spec for 'ed card update'; declares updated card shape
  with failedRelationTargets (POST-001) and 0/1/2/3 exit policy (POST-002).
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

        // stdout shape for `ed card update <key> [--field ... | --summary ... |
        --patch FILE | --glossary W | --tag T]`

        {
          key, filePath, status,
          failedRelationTargets: string[]   // relation targets that did not persist; empty on a clean update; the card is still updated
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): patch applied, indexed cache + file write succeeded, and
        every relation target persisted (failedRelationTargets empty).

        - 2 (EXIT.VALIDATION_FAILURE): failedRelationTargets.length > 0 — the
        update persisted but at least one relation target did not resolve;
        partial state is signalled in data.

        - thrown mapping: CardNotFoundError → card-not-found → 3;
        CardValidationError / ParentValidationError / ActivationGuardError → 2;
        CompensationError → compensation-failed → 1; CliUsageError →
        cli-usage-error → 2.
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
    - violation: No card exists for the requested key.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
    - violation: >-
        Patch body conflicts with the card schema (invalid type, malformed
        namespace body, unresolved cross-references).
      behavior: >-
        CardValidationError → stderr `{level:'error', code:'validation-error',
        message, details?}` and the process exits 2.
    - violation: >-
        Transitioning status to 'active' leaves the activation guard
        preconditions unmet.
      behavior: >-
        ActivationGuardError → stderr `{code:'activation-guard-failed', message,
        details:{unmetConditions}}` and the process exits 2.
    - violation: >-
        Parent change violates the four-tier hierarchy or the new parent does
        not exist; or a type change on a card with children would orphan or
        mis-tier any direct child.
      behavior: >-
        ParentValidationError → stderr `{code:'parent-validation-error',
        message}` and the process exits 2.
    - violation: >-
        CLI pre-op input violation: `--patch` body is empty, the parsed root is
        non-object, an unknown top-level key was supplied, or no effective
        change was specified.
      behavior: >-
        CliUsageError → stderr `{code:'cli-usage-error', message}` and the
        process exits 2.
---
