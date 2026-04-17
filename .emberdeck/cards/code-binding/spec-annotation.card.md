---
{key: code-binding/spec-annotation,summary: "Four-step @spec reconciliation, symbol rename tracking, and coverage analysis",status: draft,type: spec,parent: code-binding,boundary: [src/ops/spec-sync.ts],relations: [code-binding,code-binding/link-resolution],codeLinks: [{kind: function,file: src/ops/spec-sync.ts,symbol: writeSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSpecAnnotations},{kind: function,file: src/ops/spec-sync.ts,symbol: syncSymbolChanges},{kind: function,file: src/ops/spec-sync.ts,symbol: getUncoveredSymbols},{kind: function,file: src/ops/spec-sync.ts,symbol: getLinkCoverage}],glossary: [code-link]}
---

## Contract
- GIVEN cards have code links in DB
  WHEN writeSpecAnnotations is called
  THEN orphan @spec annotations (present in source but not in DB) MUST be removed, and missing @spec annotations (in DB but not in source) MUST be inserted.
- GIVEN writeSpecAnnotations is scoped to a single card key
  WHEN reconciliation runs
  THEN only that card's code links and orphan annotations MUST be affected; other cards' annotations MUST be untouched.
- GIVEN a symbol was renamed in source code
  WHEN syncSymbolChanges is called with a since timestamp
  THEN code links referencing the old symbol name MUST be updated to the new name in DB.
- GIVEN a symbol was moved to a different file
  WHEN syncSymbolChanges is called
  THEN code links MUST be updated with the new file path.
- GIVEN getUncoveredSymbols is called
  WHEN symbols exist in the index
  THEN symbols not referenced by any card's code links or boundary patterns MUST be returned.

## Invariant
- writeSpecAnnotations MUST follow four steps in exact order: scan, build, remove, add. This is idempotent — running twice produces the same result.
- @spec annotation removal MUST only remove lines matching the @spec tag pattern. Other JSDoc content MUST be preserved.
- Coverage analysis MUST exclude files matching ignore patterns.
- Boundary-covered files MUST be considered covered in coverage calculations.
- Symbol index MUST be refreshed before every operation.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Symbol index not configured | GildashNotConfiguredError thrown |
| @spec annotation references nonexistent card | Reported in unmatched array |
| Symbol not found during annotation insertion | Counted as symbolNotFound; annotation not inserted |
| Source file unreadable during removal | File skipped; other files still processed |
| Symbol was deleted (not renamed/moved) | Reported as broken in syncSymbolChanges; no auto-update |
| Coverage for card with 0 code links | Returns coverage=1, 0 declared, 0 broken |
| Invalid card key format | CardKeyError thrown before any operation |
