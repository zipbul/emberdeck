---
key: cli-surface/command-routing-and-output/commands/spec-sync-symbols
summary: >-
  Per-command CLI-shape spec for 'ed spec sync-symbols'; declares applied /
  skipped (4 reasons) / sinceSource / nextSyncMarker shape (POST-001) and exit 0
  policy (POST-002).
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

        // stdout shape for `ed spec sync-symbols [--since TS]`

        {
          applied: { cardKey, oldSymbol, newSymbol, file, changeType: 'renamed' | 'moved' }[],
          skipped: {
            // The op's SymbolSyncResult.skipped produces the first three reasons; the CLI adds
            // `metadata-write-failed` when the watermark upsert at the end of the run fails.
            reason: 'no-links-referencing-old-symbol'
                  | 'symbol-removed-manual-review-required'
                  | 'card-not-found'
                  | 'metadata-write-failed',
            symbol?: string, file?: string,
            details?: Record<string, unknown>    // all keys (including inside details) are camelCase
          }[],
          total: number,            // applied.length + skipped.length
          since: string,            // the ISO 8601 watermark that was used
          sinceSource: 'flag' | 'last-sync' | 'default-24h',
          nextSyncMarker: string | null   // null when the metadata upsert that records the new watermark failed
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): sync always (skipped entries are not failures; a
        metadata-write-failed surfaces only as nextSyncMarker=null in the data).

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
    - violation: '--since does not parse as ISO 8601 timestamp or epoch ms.'
      behavior: >-
        The CLI action itself throws CliUsageError (NOT a commander upstream
        rejection; the parsing happens inside the action after commander
        validation). Runner maps via toCliError → stderr `{level:error,
        code:cli-usage-error, message}` and exit 2.
---
