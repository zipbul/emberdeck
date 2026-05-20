---
key: code-binding/annotation-roundtrip/annotate-and-sync
summary: >-
  syncSpecAnnotations rebuilds the DB code_link cache from source `@spec` tags;
  syncSymbolChanges propagates gildash-reported renames and moves.
status: active
type: spec
parent: code-binding/annotation-roundtrip
glossary:
  - codeLink
  - spec-annotation
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller has a runtime context with a gildash adapter and a populated
        index.
      derives: code-binding/annotation-roundtrip#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        syncSpecAnnotations reconciles DB code_link rows from `@spec`
        annotations in source. It adds missing rows, leaves existing rows
        unchanged, and reports annotations whose card key is unknown.
      keyword: SHALL
      derives: code-binding/annotation-roundtrip#G-001
    - id: POST-002
      guarantee: >-
        syncSymbolChanges only applies renames or moves reported by gildash; no
        heuristic guesses are made.
      keyword: MUST
      derives: code-binding/annotation-roundtrip#G-002
  invariants:
    - id: INV-001
      statement: >-
        syncSpecAnnotations is idempotent — re-running with no source change
        leaves the cache byte-identical.
      always_holds: per-call
    - id: INV-002
      statement: >-
        The DB code_link cache is never the source of binding declarations for
        source generation; it is strictly a derived view.
      always_holds: cross-call
  failures:
    - violation: gildash index unavailable.
      behavior: >-
        The gildash adapter's ensureReindexed step throws (binary missing or
        database-open failure) before any per-annotation work begins, and the op
        does not swallow it — the error propagates to the caller unchanged. The
        card-level partial-result envelope (unmatched/markerMissing) covers only
        post-reindex per-annotation failures, not the up-front gildash bootstrap
        failure.
    - violation: An annotation references a card key with no matching card row.
      behavior: >-
        The annotation is reported under `unmatched` in the spec sync result; no
        cache row is written for it. The op itself returns successfully (the
        unmatched array is a normal field, not an exception path).
---
