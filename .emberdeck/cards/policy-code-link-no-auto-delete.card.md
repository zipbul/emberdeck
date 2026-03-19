---
{key: policy-code-link-no-auto-delete,summary: Deleted code symbols are reported as broken links but never auto-removed from cards; manual review is required before removing a code link,status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: "syncSymbolChanges with changeType 'removed' increments broken counter but does not delete the code link from DB",verified: false},{id: ac-2,description: "syncSymbolChanges with changeType 'renamed' updates the symbol name in the code link",verified: false},{id: ac-3,description: "validateCodeLinks classifies unresolvable links on draft/accepted cards as 'planned', not 'broken'",verified: false}],keywords: [syncSymbolChanges,broken-links,validateCodeLinks,no-auto-delete],tags: [policy,code-links,safety],relations: [{type: depends-on,target: policy-gildash-graceful-degradation}],codeLinks: [{kind: function,file: src/ops/spec-sync.ts,symbol: syncSymbolChanges},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: getLinkCoverage},{kind: function,file: src/ops/link.ts,symbol: validateCodeLinks}]}
---
## Policy

When `syncSymbolChanges` encounters a symbol with `changeType: 'removed'`, it increments the `broken` counter and records the detail but does NOT delete the code link from the card. The link remains in the DB and file as a stale reference until a human or agent explicitly updates it.

Renames and moves ARE auto-applied: the symbol name and/or file path are updated in the code link.

## Rationale

A deleted symbol might be temporarily removed during a refactor, or the deletion might be a mistake. Auto-deleting the code link would silently sever the spec-to-code traceability chain. Broken links are a signal that demands attention, not an error to be auto-corrected.

## Detection surfaces

- `validateCodeLinks`: returns `broken` array with reason (`symbol-not-found` or `file-not-indexed`). For draft/accepted cards, unresolvable links are classified as `planned` instead of `broken`.
- `checkDrift`: counts broken links in the drift score formula (weight 0.3).
- `getLinkCoverage`: reports `broken` count and `coverage` ratio.

## What breaks if violated

- Auto-deleting code links on symbol removal would silently lose traceability. A refactored function with a new name would have no link to its spec.
- Ignoring broken links entirely would let drift accumulate undetected.

## Exclusions

- `syncSpecAnnotations` DOES auto-create new links from @spec annotations. The asymmetry is intentional: creation is safe (additive), deletion is destructive.