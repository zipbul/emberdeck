---
{key: code-binding/link-resolution,summary: "Symbol resolution with reindex, code link validation with auto-drift, and card discovery by symbol/file",status: draft,type: spec,parent: code-binding,boundary: [src/ops/link.ts],relations: [code-binding],codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: function,file: src/ops/link.ts,symbol: ensureReindexed}],glossary: [code-link,boundary]}
---

## Contract
- GIVEN a spec card has code links and the symbol index is configured
  WHEN resolveCardCodeLinks is called
  THEN the index MUST be refreshed first, then each link MUST be looked up by exact symbol name and file path.
- GIVEN validateCodeLinks is called for an active card
  WHEN broken links are detected and the index was available (no transient failures)
  THEN the card MUST be automatically transitioned to drifted status in both DB and file.
- GIVEN validateCodeLinks transitions an active card to drifted in DB
  WHEN the file write to update status fails
  THEN the DB MUST be reverted to the previous status.
- GIVEN a symbol name (and optional file path)
  WHEN findCardsBySymbol is called
  THEN cards MUST be matched first by code links, then by boundary glob patterns, with deduplication.
- GIVEN the symbol index is not configured (no projectRoot)
  WHEN any code link operation is called
  THEN GildashNotConfiguredError MUST be thrown.

## Invariant
- ensureReindexed MUST be called before every symbol-dependent operation to ensure current state.
- validateCodeLinks on draft cards MUST report unresolved links as planned (not broken) and MUST NOT trigger auto-drift.
- findCardsBySymbol MUST never return duplicate cards — a card matched by both code link and boundary appears once (as codeLink).
- Auto-drift transition MUST use a targeted DB update (not full card upsert) to minimize side effects.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Symbol index not configured | GildashNotConfiguredError thrown |
| Symbol not found in index | ResolvedCodeLink with symbol=null |
| Index transiently unavailable during resolve | ResolvedCodeLink with symbol=null |
| Index transiently unavailable during validate | Link counted as broken but no auto-drift |
| Auto-drift DB update succeeds, file write fails | DB reverted to previous status |
| Card not found for given key | CardNotFoundError thrown |
| Invalid card key format | CardKeyError thrown before any operation |
