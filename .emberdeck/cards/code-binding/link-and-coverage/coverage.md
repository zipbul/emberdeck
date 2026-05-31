---
key: code-binding/link-and-coverage/coverage
summary: >-
  getLinkCoverage, getUncoveredSymbols, and suggestCardScope produce coverage
  metrics from the code_link cache.
status: active
type: spec
parent: code-binding/link-and-coverage
glossary:
  - codeLink
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Caller invokes coverage in one of three mutually exclusive modes: (a)
        per-card via `getLinkCoverage(ctx, fullKey)` for a specific card; (b)
        --uncovered (returns all unbound symbols across the project); (c)
        --suggest (returns proposed card scopes). Exactly one mode applies per
        invocation; the CLI requires either a card key or a single mode flag
        (see commands/check-coverage).
      derives: code-binding/link-and-coverage#G-002
  postconditions:
    - id: POST-001
      guarantee: >-
        getUncoveredSymbols returns gildash-indexed symbols that are not bound
        by any card's code_link cache, narrowed by caller-supplied
        kinds/files/excludePatterns and project ignorePatterns.
      keyword: MUST
      derives: code-binding/link-and-coverage#G-002
    - id: POST-002
      guarantee: >-
        suggestCardScope produces card suggestions with type, files, symbols,
        and reason.
      keyword: SHALL
      derives: code-binding/link-and-coverage#G-002
    - id: POST-003
      guarantee: >-
        Each uncovered entry contains only {file, symbol, kind} fields; no
        visibility metadata is exposed.
      keyword: MUST
      derives: code-binding/link-and-coverage#G-002
    - id: POST-004
      guarantee: >-
        coverageRatio is null when no symbols are indexed; otherwise it equals
        coveredSymbols divided by totalSymbols.
      keyword: MUST
      derives: code-binding/link-and-coverage#G-002
    - id: POST-005
      guarantee: >-
        getLinkCoverage(ctx, key) returns per-card coverage for a single card
        (declared/resolved/broken counts plus unreferenced symbols within the
        card's bound files). It is the mode underlying `ed check coverage
        <key>`. Missing card key produces zero-link coverage (no throw).
      keyword: SHALL
      derives: code-binding/link-and-coverage#G-002
  invariants:
    - id: INV-001
      statement: >-
        Symbol visibility (exported vs internal) is not a filter axis for
        coverage classification.
      always_holds: per-call
    - id: INV-002
      statement: >-
        suggestCardScope derives its uncovered set by calling
        getUncoveredSymbols; the two functions cannot disagree about which
        symbols are covered.
      always_holds: cross-call
    - id: INV-003
      statement: >-
        The code_link cache is the sole inclusion test for coverage
        classification. Caller-supplied filters (kinds, files, excludePatterns)
        and project ignorePatterns may further reduce the result, but symbol
        visibility is never consulted.
      always_holds: per-call
  failures:
    - violation: >-
        All three modes (per-card key, --uncovered, --suggest) are omitted at
        the CLI layer.
      behavior: CLI throws CliUsageError; exit 2.
      id: FAIL-001
    - violation: gildash returns an empty index (project not yet built).
      behavior: >-
        getUncoveredSymbols reports totalSymbols=0 and coverageRatio=null;
        suggestCardScope produces no suggestions.
      id: FAIL-002
---
