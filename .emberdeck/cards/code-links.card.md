---
{key: code-links,summary: "Code link system: gildash integration for symbol resolution, @spec annotation sync, affected card detection, and drift analysis",status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: Code links are only functional when projectRoot is configured and gildash initializes successfully.,verified: true},{id: ac-2,description: GildashNotConfiguredError is thrown (not silently ignored) when code link operations are called without gildash.,verified: true},{id: ac-3,description: "validateCodeLinks distinguishes broken links from planned links based on card status (draft/accepted = planned, implementing+ = broken).",verified: true},{id: ac-4,description: findAffectedCards accepts changed file paths and returns cards with code links to those files.,verified: true},{id: ac-5,description: syncSpecAnnotations scans @spec annotations from gildash and auto-creates code links. Existing manual links are preserved.,verified: true},{id: ac-6,description: "syncSymbolChanges handles renames (update symbol name), moves (update file path), and deletions (report only, no auto-delete).",verified: true},{id: ac-7,description: getLinkCoverage reports declared/resolved/broken counts and finds unreferenced symbols in linked files.,verified: true},{id: ac-8,description: gildash.reindex() is called before every symbol resolution to ensure the index is fresh.,verified: true}],keywords: [gildash,CodeLink,resolveCardCodeLinks,findAffectedCards,validateCodeLinks,syncSpecAnnotations,syncSymbolChanges,getLinkCoverage],tags: [core,gildash,traceability],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-model}],codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: function,file: src/ops/link.ts,symbol: findAffectedCards},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSymbolChanges},{kind: function,file: src/ops/spec-sync.ts,symbol: getLinkCoverage}]}
---
## Rationale

Code links bridge the gap between design specs and source code. Without them, specs are disconnected documents that drift over time. The gildash integration provides:

- **Traceability**: "Which specs are affected if I change this function?"
- **Validation**: "Are all linked symbols still present in the codebase?"
- **Coverage**: "Which symbols in this file have no spec?"

### Why gildash (not AST parsing)?

Gildash is Zipbul's cross-language symbol indexer. Using it instead of building a custom parser means:
- Language-agnostic symbol resolution
- No need to maintain per-language AST parsers
- Reuses the same index used by other Zipbul tools

### Graceful Degradation

Code links are entirely optional. When `projectRoot` is not configured:
- `gildash` is `undefined` in the context
- All code link operations throw `GildashNotConfiguredError`
- Card CRUD still works (code links are stored in DB but not validated)

This means emberdeck works standalone for projects that don't use gildash.

## Key Invariants

- **Planned vs. Broken**: A broken link on a `draft`/`accepted` card is classified as "planned" (code not yet written). On `implementing`+ cards, it's classified as "broken". This prevents false positives during the design phase.
- **No auto-delete on symbol removal**: When `syncSymbolChanges` detects a deleted symbol, it reports it but does NOT auto-remove the code link. This is intentional — the link might indicate a regression that needs investigation.
- **@spec annotation format**: The value of the `@spec` annotation is the card key. Example: `@spec card-crud` in a JSDoc comment links the symbol to the `card-crud` card.
- **Reindex before resolve**: Every validation/resolution call triggers `gildash.reindex()` to ensure the index reflects the latest file state.

## Scope Boundaries

- This card covers symbol-level traceability. Higher-level impact analysis (risk levels, regression guards) is in `analysis`.
- The code link DB table stores links regardless of gildash availability. Validation only happens when gildash is present.
- Link kind (function, class, variable, etc.) comes from gildash's SymbolKind. Emberdeck does not define its own kind taxonomy.
