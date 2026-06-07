---
key: cli-surface/command-routing-and-output/commands/glossary-remove
summary: >-
  Per-command CLI-shape spec for 'ed glossary remove'; declares word +
  affectedCardKeys shape (POST-001) and 0/2/3 exit policy (POST-002).
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
        arguments (the target word and the destructive-confirmation flag --yes)
        to this command's action.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` matches the shape:

        ```jsonc

        // stdout shape for `ed glossary remove <word>`

        { word: string, affectedCardKeys: string[] }

        // affectedCardKeys lists every card whose glossary field referenced the
        removed word; the cards themselves are NOT mutated and their status is
        unchanged. They will surface as glossary_broken on the next check-drift.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the word was removed from the glossary store.

        - thrown mapping: GlossaryNotFoundError → 3 (EXIT.NOT_FOUND) when the
        word does not exist; GlossaryValidationError → 2
        (EXIT.VALIDATION_FAILURE) for other validation failures.
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
    - violation: The requested word does not exist in the glossary store.
      behavior: >-
        stderr emits `{level:'error', code:'glossary-not-found', message}` and
        the process exits 3.
      id: FAIL-001
    - violation: >-
        The word argument fails op-level validation (empty string, exceeding
        length, etc).
      behavior: >-
        GlossaryValidationError → stderr `{code:'glossary-validation-error',
        message}` and the process exits 2.
      id: FAIL-002
    - violation: >-
        Destructive confirmation is absent (no --yes and non-TTY, or the
        interactive prompt is declined).
      behavior: >-
        confirmDestructive throws CliUsageError → stderr
        `{code:'cli-usage-error', message}` and the process exits 2; no word is
        removed.
      id: FAIL-003
      case_of: cli-surface/command-routing-and-output#S-F-02
---
