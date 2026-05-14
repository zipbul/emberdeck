---
key: cli-surface/command-routing-and-output/commands/spec-sync-symbols
summary: >-
  ed spec sync-symbols emits {applied:[], skipped:[], total, since, since_source,
  next_sync_marker} per C4; applied/skipped are per-link rows preserving cardKey;
  grouping by symbol is left to consumers.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        --since (optional) is ISO 8601 or epoch ms. Absent --since uses
        the stored last_symbol_sync_at metadata, or now-24h on first run.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C4 batch-mutation):

        ```
        {
          applied: {
            cardKey:    string,
            oldSymbol:  string,
            newSymbol:  string,
            file:       string,
            changeType: 'renamed' | 'moved'
          }[],
          skipped: {
            reason:  'no_links_referencing_old_symbol'
                   | 'symbol_removed_manual_review_required'
                   | 'card_not_found'
                   | 'metadata_write_failed',
            symbol?: string,
            file?:   string,
            details?: { card_key?: string, [k: string]: unknown }
          }[],
          total:             number,             // events recorded = applied.length + skipped.length
          since:             string,              // ISO8601 watermark used
          since_source:      'flag' | 'last_sync' | 'default_24h',
          next_sync_marker:  string | null        // null if metadata upsert failed
        }
        ```

        Per-link emission (not grouped by symbol) preserves which card was affected; gildash
        returns per-symbol-change events so per-link is the natural granularity. Surface field
        names use camelCase; the free-form `details` bag uses snake_case keys to match other
        CLI outputs (since_source, next_sync_marker).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: always 0 (sync is fact-recording; skipped is informational).
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
        skipped reason 'metadata_write_failed' is CLI-synthesized AFTER the op returns
        (the op never emits it). The other three reasons come from syncSymbolChanges
        directly. The union of 4 reasons is the response surface; the op surface uses 3.
      always_holds: per-call
    - id: INV-002
      statement: >-
        applied[i].changeType ∈ {'renamed', 'moved'}. The 'removed' changeType from gildash
        becomes skipped[{reason:'symbol_removed_manual_review_required'}] — never auto-applied
        (deletion of a symbol requires human review of the affected card).
      always_holds: per-call
  failures:
    - violation: --since is not parseable as ISO 8601 or epoch ms.
      behavior: >-
        CliUsageError → stderr `CLI_USAGE_ERROR` JSON-line; exit 2. stdout empty.
    - violation: Metadata upsert (recording the new watermark) fails after a successful sync.
      behavior: >-
        next_sync_marker is null; a `skipped` entry with reason='metadata_write_failed'
        carries the upsert error in details.message. The sync itself stays committed;
        next invocation may re-process the same changes (idempotent re-application is safe).
---
