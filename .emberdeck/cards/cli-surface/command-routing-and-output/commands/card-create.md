---
key: cli-surface/command-routing-and-output/commands/card-create
summary: >-
  Per-command CLI-shape spec for 'ed card create'; declares created card stub
  shape with failedRelationTargets (POST-001) and 0/2/4 exit policy (POST-002).
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

        // stdout shape for `ed card create KEY --type T --summary S [...]`

        {
          key: string,
          filePath: string,
          status: 'draft'|'active'|'drifted',
          type: 'principle'|'domain'|'brief'|'spec',
          parent: string|null,
          failedRelationTargets: string[]   // declared relation targets that did not resolve at create time; the card is still persisted
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): card persisted AND failedRelationTargets is empty.

        - 2 (EXIT.VALIDATION_FAILURE): failedRelationTargets.length > 0 — the
        card persisted but at least one declared relation target did not
        resolve; data is still emitted, only the exit code differs.

        - thrown mapping: CardAlreadyExistsError → card-already-exists → 4;
        CardValidationError → validation-error → 2; ParentValidationError →
        parent-validation-error → 2; ActivationGuardError →
        activation-guard-failed → 2; CliUsageError → cli-usage-error → 2.
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
    - violation: >-
        CLI pre-op input violation: `--from` body is empty, the parsed root is
        non-object, or summary is missing (no --summary AND no `summary` field
        in --from JSON).
      behavior: >-
        CliUsageError → stderr `{code:'cli-usage-error', message}` and the
        process exits 2.
---
