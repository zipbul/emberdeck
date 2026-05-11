---
key: code-binding/link-and-coverage/resolve-and-validate
summary: >-
  ensureReindexed, resolveCardCodeLinks, and findCardsBySymbol query gildash to
  resolve codeLinks and reverse-lookup by symbol.
status: draft
type: spec
parent: code-binding/link-and-coverage
glossary:
  - codeLink
  - gildash
spec:
  preconditions:
    - id: PRE-001
      condition: Runtime context includes a gildash adapter.
      derives: code-binding/link-and-coverage#G-001
  postconditions:
    - id: POST-001
      guarantee: Every link query refreshes gildash via ensureReindexed before lookup.
      keyword: MUST
      derives: code-binding/link-and-coverage#G-001
    - id: POST-002
      guarantee: >-
        resolveCardCodeLinks returns per-link valid or broken status without
        partial omission.
      keyword: SHALL
      derives: code-binding/link-and-coverage#G-001
  invariants:
    - id: INV-001
      statement: >-
        All link reads see a consistent gildash snapshot for the duration of the
        call.
      always_holds: per-call
  failures:
    - violation: gildash is unavailable (no projectRoot configured).
      behavior: Link resolution returns empty results; callers handle as no-coverage.
---
