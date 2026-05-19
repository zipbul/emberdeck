---
key: cli-surface/command-routing-and-output/commands/check-drift
summary: >-
  Per-command CLI-shape spec for 'ed check drift'; declares health + per-card
  driftType breakdown shape (POST-001) and read-only exit 0 policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
  - drift
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

        // stdout shape for `ed check drift [key]`

        {
          health: { total, active, drifted, draft },
          cards: { key, summary, status, driftType?, driftTypes?, brokenLinks, totalLinks }[]
          // total drifted card count is derived as `cards.filter(c => c.driftType).length`
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): drift report always (read-only; presence of drift is not
        failure).

        - 3 (EXIT.NOT_FOUND): the optional [key] argument was provided but no
        card with that key exists; CardNotFoundError is thrown by the action.
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
        The optional [key] argument was provided but no card with that key
        exists.
      behavior: >-
        stderr emits `{level:'error', code:'card-not-found', message}` and the
        process exits 3.
---
