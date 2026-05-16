---
key: cli-surface/command-routing-and-output/commands/check-regression
summary: >-
  Per-command CLI-shape spec for 'ed check regression'; declares pass/fail +
  driftedRatio shape (POST-001) and 0/2 exit policy (POST-002).
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

        // stdout shape for `ed check regression <files...>`

        {
          passOrFail: 'pass' | 'fail',
          driftedRatio: number,
          threshold: number,
          affected: { key, status, driftType? }[]
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): passOrFail === 'pass' (driftedRatio is at or under
        threshold).

        - 2 (EXIT.VALIDATION_FAILURE): passOrFail === 'fail' (driftedRatio
        strictly exceeds threshold; data is still emitted, only the exit code
        differs).

        - thrown mapping: none.
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
    - violation: driftedRatio strictly exceeds threshold.
      behavior: >-
        stdout emits the data shape with passOrFail='fail' and the process exits
        2.
---
