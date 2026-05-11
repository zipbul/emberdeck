---
key: cli-surface/command-routing-and-envelope/runner-and-output
summary: >-
  run wraps every subcommand action; ok, partial, err, unknown, and render build
  and emit the JSON envelope.
status: draft
type: spec
parent: cli-surface/command-routing-and-envelope
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: A commander.js subcommand action wraps its body in run with a CommandFn.
      derives: cli-surface/command-routing-and-envelope#G-001
  postconditions:
    - id: POST-001
      guarantee: Every subcommand emits the documented envelope on stdout via render.
      keyword: MUST
      derives: cli-surface/command-routing-and-envelope#G-001
    - id: POST-002
      guarantee: >-
        statusToExitCode maps status to documented exit codes (0 / 1 / 2 / 3 / 4
        / 5 / 6 / 7).
      keyword: SHALL
      derives: cli-surface/command-routing-and-envelope#G-002
    - id: POST-003
      guarantee: >-
        resolveOutputMode returns quiet when --quiet is set so render emits only
        the data key.
      keyword: MUST
      derives: cli-surface/command-routing-and-envelope#G-003
  invariants:
    - id: INV-001
      statement: >-
        Every catchable error class is mapped through toCliError to a CliMessage
        with a stable code.
      always_holds: per-call
  failures:
    - violation: An unmapped error class is thrown inside the action.
      behavior: >-
        classifyErrorStatus returns unknown; render emits status=unknown and
        exit code 1.
---
