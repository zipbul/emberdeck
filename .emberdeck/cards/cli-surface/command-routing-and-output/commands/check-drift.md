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
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): drift report always (read-only). When the optional [key]
        argument is supplied but no such card exists, the op returns an empty
        cards[] (NOT a thrown error) and exits 0.

        - thrown mapping: none under the read-only happy path.
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
        The op skips the absent key and returns an empty cards[] in data; exit
        0. (No CardNotFoundError thrown — read-only path returns absence as
        empty data, not as failure.)
---
