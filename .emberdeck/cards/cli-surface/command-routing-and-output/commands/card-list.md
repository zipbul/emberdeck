---
key: cli-surface/command-routing-and-output/commands/card-list
summary: >-
  Per-command CLI-shape spec for 'ed card list'; declares paginated CardSummary
  items shape (POST-001) and exit 0 policy (POST-002).
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

        // stdout shape for `ed card list [filters] [--limit N] [--offset N]`

        { items: CardSummary[], total, limit, offset, hasMore }

        // CardSummary = { key, summary, type, status, parent: string|null }

        // limit defaults to 50 when --limit is omitted; offset defaults to 0;
        hasMore is true when offset + items.length < total.

        // To enumerate every card in one call pass --limit large enough to
        cover total, or page using offset + hasMore.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): filter and pagination applied; result returned (an empty
        items array is still a success).

        - thrown mapping: none (read-only). Build or IO errors fall through to
        the parent runner's generic mapping.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        Inherits INV-001..INV-005 from parent spec runner-and-output (canonical
        stderr JSON-line schema, disjoint stdout/stderr channels, no envelope,
        --quiet semantics, empty stdout on failure).
      always_holds: per-call
    - id: INV-002
      statement: >-
        Pagination defaults are explicit in the result envelope: every
        successful call surfaces limit, offset, and hasMore so callers can tell
        whether items is the complete set or a page. Default limit (50) MUST be
        carried in the result, not hidden.
      always_holds: per-call
  failures:
    - violation: Invalid filter value (e.g. status not in the enum).
      behavior: >-
        commander rejects the invocation upstream, taking the
        runner-commander-fallback path: stderr `{level:'error',
        code:'cli-usage-error', ...}` and exit 2.
      id: FAIL-001
      case_of: cli-surface/command-routing-and-output#S-F-02
---
