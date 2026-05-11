---
key: code-binding/annotation-roundtrip/annotate-and-sync
summary: >-
  syncSpecAnnotations rebuilds the DB code_link cache from source `@spec`
  tags; syncSymbolChanges propagates gildash-reported renames and moves.
status: draft
type: spec
parent: code-binding/annotation-roundtrip
glossary:
  - codeLink
  - spec-annotation
spec:
  preconditions:
    - id: PRE-001
      condition: Caller has a runtime context with a gildash adapter and a populated index.
      derives: code-binding/annotation-roundtrip#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        syncSpecAnnotations reconciles DB code_link rows from `@spec` tags in
        source — adding missing rows, leaving existing rows unchanged, and
        reporting annotations whose card key is unknown.
      keyword: SHALL
      derives: code-binding/annotation-roundtrip#G-001
    - id: POST-002
      guarantee: >-
        syncSymbolChanges only applies renames or moves reported by gildash;
        no heuristic guesses are made.
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
        The DB code_link cache is never the source of binding declarations
        for source generation; it is strictly a derived view.
      always_holds: cross-call
  failures:
    - violation: gildash index unavailable.
      behavior: >-
        Each operation returns a transient-failure status; partial results
        from successful project queries are still returned.
    - violation: An annotation references a card key with no matching card row.
      behavior: >-
        The annotation is reported under `unmatched` and produces a partial
        envelope with `UNMATCHED_ANNOTATION`; no cache row is written for it.
---
