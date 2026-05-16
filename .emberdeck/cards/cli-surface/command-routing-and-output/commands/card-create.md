---
key: cli-surface/command-routing-and-output/commands/card-create
summary: >-
  Per-command CLI-shape spec for 'ed card create'; declares created card stub
  shape (POST-001) and 0/4 exit policy (POST-002).
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

        // stdout shape for `ed card create <key> --type T [...]`

        {
          key, filePath, status, type, parent: string | null,
          failedRelationTargets: string[]    // relation targets that did not persist under concurrent contention (FK violation); empty on clean create.
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the card was created, the file was written, the
        indexed-cache row was inserted, and every relation target persisted
        (failedRelationTargets is empty).

        - 2 (EXIT.VALIDATION_FAILURE): failedRelationTargets.length > 0 (the
        card exists but at least one relation target failed under concurrent
        contention; data is still emitted, exit signals the partial state).

        - thrown mapping: CardAlreadyExistsError → 4 (EXIT.CONFLICT);
        CardValidationError / ParentValidationError / ActivationGuardError → 2
        (EXIT.VALIDATION_FAILURE).
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
    - violation: A card with the same key already exists.
      behavior: >-
        stderr emits `{level:'error', code:'card-already-exists', message,
        details?}` and the process exits 4.
    - violation: >-
        Card input schema validation failed (invalid type / namespace body /
        cross-reference).
      behavior: >-
        CardValidationError → stderr `{code:'validation-error', message}` and
        the process exits 2.
    - violation: >-
        Parent validation failed (parent does not exist or the four-tier
        hierarchy rule is violated).
      behavior: >-
        ParentValidationError → stderr `{code:'parent-validation-error',
        message}` and the process exits 2.
    - violation: >-
        status='active' on creation but the activation guard preconditions are
        not met.
      behavior: >-
        ActivationGuardError → stderr `{code:'activation-guard-failed', message,
        details:{unmetConditions}}` and the process exits 2.
---
