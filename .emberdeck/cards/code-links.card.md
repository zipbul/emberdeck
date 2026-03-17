---
{key: code-links,summary: "Code-spec traceability — symbol resolution, @spec annotations, planned vs broken links, reindex policy",status: draft,type: feature,priority: high,acceptance: [{id: AC1,description: "validateCodeLinks returns { declared, valid, broken, planned } with status-based routing",verified: false},{id: AC2,description: resolveCardCodeLinks calls reindex() then resolves symbols via gildash,verified: false},{id: AC3,description: "syncSpecAnnotations discovers @spec comments, creates links, reports alreadyLinked count",verified: false},{id: AC4,description: "syncSymbolChanges updates links on rename/move, reports removed symbols without auto-deleting",verified: false},{id: AC5,description: getLinkCoverage reports resolved/broken/unreferenced symbols per card,verified: false}],keywords: [codelinks,gildash,symbol,resolution,spec,annotation,reindex,coverage],tags: [ops,traceability],relations: [{type: depends-on,target: persistence},{type: depends-on,target: card-io}],codeLinks: [{kind: function,file: src/ops/link.ts,symbol: resolveCardCodeLinks},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks},{kind: function,file: src/ops/link.ts,symbol: findCardsBySymbol},{kind: function,file: src/ops/link.ts,symbol: findAffectedCards},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSymbolChanges},{kind: function,file: src/ops/spec-sync.ts,symbol: getLinkCoverage}]}
---
## Why

Code link validation is two-stage by design. Stage 1 (markdown layer) checks structure — kind/file/symbol fields exist. Stage 2 (ops layer + gildash) checks reality — does this symbol actually exist in the codebase? This decouples card I/O from external symbol indexing. A card can be created/updated without gildash; resolution is optional.

`validateCodeLinks` distinguishes `planned` vs `broken` links based on card status. Draft/accepted cards route unresolved links to `planned` (code not yet written — expected), while implementing+ cards route them to `broken` (code should exist — regression). This prevents false alarms during planning.

All gildash-dependent functions (`resolveCardCodeLinks`, `validateCodeLinks`, `getLinkCoverage`) call `reindex()` before querying to ensure the symbol index reflects current disk state. Without this, code changes made seconds ago would be invisible. `syncSpecAnnotations` already called reindex; the others were added later to fix a consistency gap.

`syncSpecAnnotations` returns `alreadyLinked` count (not just `created`) so agents can distinguish "annotations matched existing links" from "no annotations found at all". The previous `{ created: 0 }` was ambiguous.

`syncSymbolChanges` tracks renames and moves but does NOT auto-delete removed symbols. Deletion is a destructive decision that requires human/agent review.

## Invariants

- `validateCodeLinks` always calls `reindex()` before querying gildash.
- `planned` links only appear for `draft` or `accepted` status cards.
- `broken` links only appear for `implementing`, `implemented`, or `deprecated` cards.
- Return type `{ declared, valid, broken, planned }` — `declared = valid + broken.length + planned.length`.
- `syncSpecAnnotations` preserves existing manual links — only adds new ones from @spec annotations.
- `getLinkCoverage` reports `coverage = resolved / declared` (1.0 if no links declared).

## Scope Boundaries

- Does NOT auto-delete code links when symbols are removed — reports for review only.
- Does NOT resolve links without gildash — throws `GildashNotConfiguredError`.
- Does NOT validate code link kind values — any string accepted (e.g., "function", "class", "defines").
- Does NOT track import/dependency relationships between files — only symbol existence.
- `findAffectedCards` uses DB code link records, not live gildash queries.

## Edge Cases

- Card with no codeLinks: `validateCodeLinks` returns `{ declared: 0, valid: 0, broken: [], planned: [] }`.
- gildash returns error Result (non-array): treated as `file-not-indexed` (planned or broken depending on status).
- Symbol found in gildash but at different file path: treated as not found (exact file+symbol match required).
- `syncSpecAnnotations` with `@spec` pointing to nonexistent card key: reported in `unmatched` array.
- `syncSpecAnnotations` with `@spec` annotation but null symbolName: skipped silently.