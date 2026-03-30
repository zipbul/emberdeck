---
{key: spec/code-link-resolution,summary: "Behavioral contract for resolveCardCodeLinks, validateCodeLinks, findCardsBySymbol, and findAffectedCards",status: draft,type: spec,parent: code-binding,boundary: [src/ops/link.ts],tags: [codelink,resolution,symbol-search],relations: [card-lifecycle,structural-integrity],codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: function,file: src/ops/link.ts,symbol: findAffectedCards},{kind: function,file: src/ops/link.ts,symbol: ensureReindexed},{kind: interface,file: src/ops/link.ts,symbol: ValidateCodeLinksResult},{kind: interface,file: src/ops/link.ts,symbol: ResolvedCodeLink},{kind: interface,file: src/ops/link.ts,symbol: BrokenLink}],glossary: [codeLink,gildash,drift,boundary,spec,card]}
---
## Contracts

### C-01: resolveCardCodeLinks gildash requirement
- **Given** ctx.gildash is undefined
- **When** resolveCardCodeLinks is called
- **Then** GildashNotConfiguredError MUST be thrown
- **And** no other operation is performed

### C-02: resolveCardCodeLinks reindex-before-resolve
- **Given** ctx.gildash is configured
- **When** resolveCardCodeLinks is called
- **Then** ensureReindexed MUST be called before any symbol lookup
- **And** each codeLink is searched with exact=true and filePath filter
- **And** results contain the full SymbolSearchResult for found links, or null for broken links

### C-03: validateCodeLinks broken vs planned classification
- **Given** a card with codeLinks
- **When** validateCodeLinks is called
- **Then** on draft cards, unresolved links are classified as planned (not broken)
- **And** on active/drifted cards, unresolved links are classified as broken
- **And** the result includes declared count, valid count, broken array, and planned array

### C-04: validateCodeLinks auto-transition
- **Given** an active card with broken links detected
- **When** gildash was NOT transiently unavailable
- **Then** the card MUST be auto-transitioned to drifted via targeted UPDATE + file rewrite
- **And** if file rewrite fails, the DB update MUST be reverted
- **And** when gildash WAS transiently unavailable, NO auto-transition occurs

### C-05: findCardsBySymbol dual-match strategy
- **Given** a symbol name and optional file path
- **When** findCardsBySymbol is called
- **Then** codeLink-based matches are found FIRST (via codeLinkRepo.findBySymbol)
- **And** boundary-based matches are found SECOND (only when filePath is provided)
- **And** a card is never returned twice (deduplication via seen set)

### C-06: findAffectedCards file-based discovery
- **Given** a list of changed file paths
- **When** findAffectedCards is called
- **Then** all cards with codeLinks referencing any of the given files are returned
- **And** gildash is reindexed before the lookup

### C-07: ensureReindexed safety
- **Given** ctx.gildash is undefined or does not have a reindex method
- **When** ensureReindexed is called
- **Then** it MUST be a no-op (no error thrown)

## Failure Modes

| Violation | System Behavior |
|---|---|
| gildash not configured | GildashNotConfiguredError for resolve/validate; graceful skip for others |
| gildash transient failure during resolve | Link result is null (symbol not found) |
| gildash transient failure during validate | Classified as gildash-unavailable reason; no auto-transition |
| Card not found | CardNotFoundError thrown |
| Card has no codeLinks | Empty result returned (not an error) |
| Auto-transition file write fails | DB reverted; broken links still reported |