---
key: code-binding
summary: >-
  Source @spec annotation scanning, DB code_link reconciliation, symbol
  rename/move tracking, and coverage measurement.
status: draft
type: domain
glossary:
  - codeLink
  - gildash
  - spec-annotation
domain:
  overview: >
    Owns the bridge between cards and source code. Source is the binding
    source of truth: every `/** @spec card-key */` JSDoc annotation in code
    populates one row in the DB `code_link` cache via `ed spec sync`. Cards
    themselves carry no binding fields. This domain reconciles that cache,
    tracks rename/move changes to keep `code_link` rows pointing at the
    live symbol, and produces coverage views (which symbols are covered by
    which card, which are uncovered) plus scope suggestions for new cards.
  scope: >
    IN: scanning source `@spec` annotations into DB code_link rows, broken
    link detection against the gildash index, rename/move symbol tracking,
    getLinkCoverage, getUncoveredSymbols, suggestCardScope, gildash adapter
    usage policy.

    OUT: drift classification (delegated to analysis), card mutations
    (delegated to card-lifecycle), CLI output formatting, writing
    annotations back into source files (the source is authored manually).
  cross_domain_dependencies:
    - domain: card-storage
      relationship: writes DB code_link rows that mirror the source annotation set.
---
