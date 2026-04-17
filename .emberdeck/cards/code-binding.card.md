---
{key: code-binding,summary: "Code-to-card binding via symbol resolution, @spec annotation sync, and coverage analysis",status: draft,type: intent,glossary: [code-link,boundary,drift]}
---

## Motivation
Cards must be traceable to the code they describe. Without explicit binding, agents cannot determine which cards govern which code, and code changes cannot be checked against their governing specs. The code binding system connects cards to source symbols via code links and @spec annotations, and measures how much of the codebase is covered by specs.

## Scope
- Covers: code link resolution via symbol index, @spec annotation reconciliation (scan, build, remove, add), symbol rename/move tracking, coverage analysis (per-card and project-wide), card discovery by symbol or file.
- Excludes: drift auto-transition (see drift-detection), activation guard mechanics (see card-lifecycle), glossary management.
- Assumes: a symbol indexer is available when projectRoot is configured; annotations follow @spec tag format.

## Scenario

### P1: Code link resolution
Given a spec card has code links,
When resolveCardCodeLinks is called,
Then each link is looked up in the symbol index and returns the matched symbol or null.

### P1: @spec annotation reconciliation
Given cards have code links in DB,
When writeSpecAnnotations is called,
Then orphan @spec annotations are removed from source and missing annotations are inserted.

### P1: Find cards by symbol
Given an agent is modifying a function,
When findCardsBySymbol is called with the symbol name,
Then all cards referencing that symbol via code links or boundary patterns are returned.

### P2: Symbol rename tracking
Given a symbol was renamed in source,
When syncSymbolChanges is called with a since timestamp,
Then code links referencing the old name are updated to the new name.

### P2: Project-wide coverage
Given the project has indexed symbols,
When getUncoveredSymbols is called,
Then symbols not referenced by any card's code links or boundary are listed.

### P3: Per-card coverage with unreferenced symbols
Given a card has code links to specific files,
When getLinkCoverage is called,
Then symbols in the same files not linked to this card are listed as unreferenced.

## Rule
- R-001: Code link resolution MUST refresh the symbol index before lookup to ensure current state.
- R-002: @spec reconciliation MUST follow four steps in order: scan existing annotations, build desired set from DB, remove orphans, add missing. This is idempotent.
- R-003: Symbol rename sync MUST update both the code link DB records and the card file frontmatter.
- R-004: Coverage analysis MUST exclude files matching ignore patterns.
- R-005: Boundary-covered files MUST be considered covered in coverage calculations (not just code-link files).
- R-006: findCardsBySymbol MUST check code links first, then boundary patterns, with deduplication.

## Constraint
- Symbol index availability depends on projectRoot configuration. Code binding features are disabled when projectRoot is not set.
- @spec annotations are JSDoc tags — they only work in languages that support JSDoc-style comments.
- Symbol rename detection depends on the index's change tracking capability, which may not be available in all indexers.

## Risk
- If the symbol index is stale, code link resolution may return false negatives (symbol exists but not indexed yet).
- @spec annotation removal modifies source files — incorrect removal could delete developer-authored comments.
- Coverage metrics may be misleading if boundary patterns are overly broad (covering files the card does not actually describe).

## Criteria
- SC-001: After writeSpecAnnotations, every code link in DB has a corresponding @spec annotation in source, and no orphan @spec annotations remain.
- SC-002: Symbol rename sync updates 100% of affected code links (no stale references after sync).
- SC-003: Coverage ratio accurately reflects the proportion of indexed symbols covered by cards.
- SC-004: findCardsBySymbol returns all governing cards for a given symbol with 0 false negatives.

## Decision
- Four-step reconciliation (scan, build, remove, add) was chosen over simple overwrite because it preserves developer-authored JSDoc content while only managing @spec tags.
- Boundary coverage is counted in coverage metrics because boundary patterns represent intentional file ownership, even without per-symbol links.
- ensureReindexed is called before every symbol-dependent operation rather than once per session, because source files may change between calls.
