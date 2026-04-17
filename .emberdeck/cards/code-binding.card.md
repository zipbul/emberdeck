---
{key: code-binding,summary: Code symbols are correctly bound to cards and spec annotations stay synchronized,status: draft,type: brief,glossary: [codeLink,gildash,card,boundary]}
---

## Problem & Goals
Spec cards must be traceable to source code via codeLinks and @spec annotations. Without correct binding, coverage reporting is wrong and agents cannot discover which design governs a code area. The system must resolve links, detect broken ones, sync annotations bidirectionally, and track symbol renames/moves.

Goal: every codeLink on a spec card resolves to an actual symbol, and every linked symbol has a @spec annotation in source.

## User Scenarios

### P1: Agent resolves code links for a card
Given a spec card has codeLinks,
When resolveCardCodeLinks is called,
Then each link is looked up in gildash and the resolution status (found/not found) is returned.

### P1: Agent writes spec annotations after creating cards
Given spec cards have codeLinks,
When writeSpecAnnotations is called,
Then @spec JSDoc tags are inserted above each linked symbol in source,
And orphan @spec annotations (from deleted cards) are removed.

### P2: Symbol is renamed in source
Given a codeLink references a symbol that was renamed,
When syncSymbolChanges is called with a since timestamp,
Then the codeLink is updated to the new symbol name.

### P2: Agent finds cards by symbol
Given an agent is about to modify a function,
When findCardsBySymbol is called,
Then cards with codeLinks or boundary patterns matching that symbol/file are returned.

## Requirements
- R-001: resolveCardCodeLinks MUST return resolution status for every declared link.
- R-002: validateCodeLinks on an active card MUST auto-transition to drifted if broken links are found.
- R-003: writeSpecAnnotations MUST be idempotent (safe to run repeatedly).
- R-004: writeSpecAnnotations MUST remove orphan @spec annotations from source files.
- R-005: syncSymbolChanges MUST update codeLinks for renamed/moved symbols without deleting links for removed symbols.
- R-006: findCardsBySymbol MUST check both codeLinks and boundary glob patterns.

## Success Criteria
- SC-001: 0 active spec cards with broken codeLinks at any point.
- SC-002: Every codeLink has a corresponding @spec annotation in source after writeSpecAnnotations.
- SC-003: 0 orphan @spec annotations in source after writeSpecAnnotations.

## Scope & Constraints
- Covers: resolveCardCodeLinks, validateCodeLinks, findCardsBySymbol, findAffectedCards, ensureReindexed, syncSpecAnnotations, writeSpecAnnotations, syncSymbolChanges, getLinkCoverage, getUncoveredSymbols, suggestCardScope.
- Excludes: card CRUD, drift detection (except link-triggered), glossary management.
- Assumes: gildash is available and configured with projectRoot.
