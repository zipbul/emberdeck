---
key: cli-surface/command-routing-and-output/commands/runner-commander-fallback
summary: >-
  Per-command CLI-shape spec for the commander error fallback (not a
  subcommand); failure-only path with stderr JSON-line and 0/2 exit policy
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
        commander.parseAsync threw a CommanderError other than commander.help or
        commander.version, so no subcommand action was dispatched and no
        CliRuntime was built.
      derives: cli-surface/command-routing-and-output#G-004
  postconditions:
    - id: POST-001
      guarantee: >-
        This fallback path produces no stdout data shape; success and failure
        both leave stdout empty. The fallback exists only to translate
        CommanderError exit into the canonical stderr JSON-line plus exit-code
        contract before the process terminates.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        Exit codes: 0 (EXIT.OK) for commander.help and commander.version paths
        (commander itself writes the help or version text to stdout; this
        fallback emits no stderr line). 2 (EXIT.VALIDATION_FAILURE) for any
        other CommanderError (InvalidArgumentError, missing positional, unknown
        option, etc.). stdout MUST be empty on the failure path.
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
        A CommanderError other than commander.help or commander.version
        (InvalidArgumentError, missing positional, unknown option).
      behavior: >-
        stderr emits a single `{level:'error', code:'cli-usage-error',
        message:<commander message>}` JSON-line and the process exits 2
        (VALIDATION_FAILURE); stdout is empty.
---
