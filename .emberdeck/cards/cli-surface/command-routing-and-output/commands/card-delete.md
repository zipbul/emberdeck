---
key: cli-surface/command-routing-and-output/commands/card-delete
summary: >-
  Per-command CLI-shape spec for 'ed card delete'; declares detached-children +
  removed-refs shape (POST-001) and 0/2/3 exit policy (POST-002).
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

        // stdout shape for `ed card delete <key> [--force] [--yes]`

        {
          key, filePath,
          detachedChildren: string[],          // --force: child keys whose parent was set to null. With force=false this stays empty (and the call only succeeds when the card has no children).
          removedCrossDomainRefs: string[],    // --force: domain card keys from which this key was removed from cross_domain_dependencies. With force=false: empty.
          failedChildUpdates:       { cardKey: string, reason: string }[],  // children markdown rewrite failed (best-effort surface)
          failedRelationUpdates:    { cardKey: string, reason: string }[],  // referencing card relations rewrite failed
          failedCrossDomainUpdates: { cardKey: string, reason: string }[]   // cross_domain_dependencies rewrite failed
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): delete succeeded and every best-effort cascade file
        rewrite succeeded (failedChildUpdates, failedRelationUpdates, and
        failedCrossDomainUpdates are all empty).

        - 2 (EXIT.VALIDATION_FAILURE): the card was deleted but one or more
        best-effort cascade file rewrites failed (indexed cache is consistent,
        only the markdown files remain stale; the operator must clean up). Also:
        thrown mapping — CardValidationError → 2 (EXIT.VALIDATION_FAILURE) when
        children exist and --force is absent, or when cross_domain_dependencies
        references exist and --force is absent.

        - 3 (EXIT.NOT_FOUND): no card exists for the requested key
        (CardNotFoundError).
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
        force=false but the target card has children or is referenced via
        cross_domain_dependencies.
      behavior: >-
        CardValidationError → stderr `{level:'error', code:'validation-error',
        message}` and exit 2.
    - violation: No card exists for the requested key.
      behavior: >-
        CardNotFoundError → stderr `{level:'error', code:'card-not-found',
        message}` and exit 3.
    - violation: >-
        One or more best-effort cascade file rewrites fail after the card is
        deleted (failedChildUpdates / failedRelationUpdates /
        failedCrossDomainUpdates populated).
      behavior: >-
        The delete still commits in the indexed cache; the failed cascade
        targets are surfaced in the data channel and the command exits 2 with
        stderr empty (a data-channel partial signal, not a thrown error).
---
