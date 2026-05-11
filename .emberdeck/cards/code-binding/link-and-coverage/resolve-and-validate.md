---
key: code-binding/link-and-coverage/resolve-and-validate
summary: >-
  ensureReindexed, resolveCardCodeLinks, and findCardsBySymbol query gildash to
  resolve codeLinks and reverse-lookup by symbol.
status: draft
type: spec
parent: code-binding/link-and-coverage
codeLinks:
  - kind: function
    file: src/ops/link.ts
    symbol: ensureReindexed
  - kind: function
    file: src/ops/link.ts
    symbol: resolveCardCodeLinks
  - kind: function
    file: src/ops/link.ts
    symbol: findCardsBySymbol
  - kind: function
    file: src/ops/link.ts
    symbol: expandAffectedFiles
  - kind: function
    file: src/ops/link.ts
    symbol: makeSymbolFileCache
  - kind: class
    file: src/ops/link.ts
    symbol: SymbolFileCache
  - kind: function
    file: src/ops/link.ts
    symbol: validateCodeLinks
  - kind: function
    file: src/ops/link.ts
    symbol: gildashProjectNames
  - kind: function
    file: src/ops/link.ts
    symbol: listAllIndexedFilesWithProject
  - kind: function
    file: src/ops/link.ts
    symbol: findAffectedCards
glossary:
  - codeLink
  - gildash
spec:
  preconditions:
    - id: PRE-001
      condition: Runtime context includes a gildash adapter.
      binds:
        - file: src/ops/link.ts
          symbol: ensureReindexed
      derives: code-binding/link-and-coverage#G-001
  postconditions:
    - id: POST-001
      guarantee: Every link query refreshes gildash via ensureReindexed before lookup.
      keyword: MUST
      binds:
        - file: src/ops/link.ts
          symbol: ensureReindexed
        - file: src/ops/link.ts
          symbol: resolveCardCodeLinks
      derives: code-binding/link-and-coverage#G-001
    - id: POST-002
      guarantee: >-
        resolveCardCodeLinks returns per-link valid or broken status without
        partial omission.
      keyword: SHALL
      binds:
        - file: src/ops/link.ts
          symbol: resolveCardCodeLinks
      derives: code-binding/link-and-coverage#G-001
  invariants:
    - id: INV-001
      statement: >-
        All link reads see a consistent gildash snapshot for the duration of the
        call.
      binds:
        - file: src/ops/link.ts
          symbol: ensureReindexed
      always_holds: per-call
  failures:
    - violation: gildash is unavailable (no projectRoot configured).
      behavior: Link resolution returns empty results; callers handle as no-coverage.
      exception:
        class: none
        file: src/cli/errors.ts
---
