---
key: cli-surface/command-routing-and-output/commands/spec-sync
summary: >-
  ed spec sync emits {created, alreadyLinked, unmatched:[], markerMissing:[], linkMissing:[]}
  per C4; array-valued diagnostics so callers can fix individual mismatches (file:symbol)
  instead of greppging counter totals.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Source files under projectRoot have been scanned by gildash; `@spec <key>`
        JSDoc annotations are the source of truth for code-link binding.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C4 batch-mutation, diagnostic arrays):

        ```
        {
          created:        number,                                      // new code_link rows
          alreadyLinked:  number,                                      // rows that already existed
          unmatched:      { cardKey: string, file: string, symbol: string }[],
                          //   @spec annotation present in source but cardKey has no card
          markerMissing:  { cardKey: string, file: string, symbol: string }[],
                          //   card exists but the source no longer has the @spec marker
          linkMissing:    { cardKey: string, file: string, symbol: string }[]
                          //   card declares the link but the symbol isn't found in source
        }
        ```

        Diagnostics are not failures: sync still records the facts it could; the
        arrays let the operator manually reconcile.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: always 0 (sync is fact-recording). unmatched/markerMissing/
        linkMissing are informational; they do not change the exit code.
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-002
    - id: POST-003
      guarantee: >-
        --quiet does not change the shape (D19).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-005
  invariants:
    - id: INV-001
      statement: >-
        created + alreadyLinked === number of (cardKey, file, symbol) tuples
        in source @spec annotations that resolved to existing cards.
      always_holds: per-call
  failures:
    - violation: Source scan fails (gildash transient error).
      behavior: >-
        Thrown error → stderr `GILDASH_*` JSON-line; exit per error class. No partial
        data emitted.
---
