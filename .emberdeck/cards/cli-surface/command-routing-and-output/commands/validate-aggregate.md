---
key: cli-surface/command-routing-and-output/commands/validate-aggregate
summary: >-
  Per-command CLI-shape spec for 'ed validate' (aggregate); declares { cards,
  links } shape (POST-001) and 0/2 exit policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
relations:
  - cli-surface/command-routing-and-output/commands/validate-cards
  - cli-surface/command-routing-and-output/commands/validate-links
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

        // stdout shape for `ed validate` (aggregate)

        { cards: <validate cards shape>, links: <validate links shape> }

        // The two sub-objects are the POST-001 shapes of `ed validate cards`
        and `ed validate links` respectively, nested under one envelope.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): cards.summary.total === 0 and links.summary.broken === 0
        and links.summary.ioFailed === 0.

        - 2 (EXIT.VALIDATION_FAILURE): either sub-result reports a non-zero
        violation.

        - thrown mapping: propagated from the composed validate links pass —
        GildashInitError → gildash-init-failed → 6; other reindex / IO errors →
        internal-error → 1; CardNotFoundError → card-not-found → 3 when an
        explicit key argument points to no card.
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
    - violation: Either the cards or the links sub-result reports at least one violation.
      behavior: stdout emits the aggregate data shape and the process exits 2.
---
