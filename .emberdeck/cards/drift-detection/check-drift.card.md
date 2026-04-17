---
{key: drift-detection/check-drift,summary: Four drift type detection in priority order with auto-transition and file write compensation,status: draft,type: spec,parent: drift-detection,boundary: [src/ops/context.ts,src/ops/analyze.ts],relations: [drift-detection],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkDrift},{kind: type,file: src/ops/context.ts,symbol: DriftType}],glossary: [drift,code-link,boundary]}
---

## Contract
- GIVEN a non-draft card with code links
  WHEN checkDrift runs and a linked symbol does not resolve
  THEN the card MUST be reported with driftType broken_link.
- GIVEN an active card with boundary patterns
  WHEN no files on disk match any boundary pattern
  THEN the card MUST be reported with driftType boundary_inactive.
- GIVEN an active card with boundary patterns
  WHEN symbols in boundary-matching files changed after the card's updatedAt
  THEN the card MUST be reported with driftType symbol_changed.
- GIVEN a card declares glossary words
  WHEN a declared word does not exist in the project glossary
  THEN the card MUST be reported with driftType glossary_broken.
- GIVEN autoTransition is true and drift is detected on an active card
  WHEN the symbol index was available (not transiently failed)
  THEN the card status MUST be updated to drifted in both DB and file.

## Invariant
- Drift types MUST be checked in priority order: broken_link > boundary_inactive > symbol_changed > glossary_broken. First match wins.
- Draft cards MUST be excluded from all drift detection.
- Auto-transition MUST NOT occur when the symbol index had transient failures (to prevent false positives).
- After auto-transition, DB and file status MUST be consistent (both drifted, or both reverted on file failure).

## Failure
| Violation | System behavior |
|-----------|----------------|
| Symbol index transiently unavailable | Drift detection skipped for affected links; no auto-transition |
| Auto-transition DB update succeeds but file write fails | DB reverted to previous status |
| Card key not found in DB | Card skipped in drift analysis |
| Boundary pattern has invalid glob syntax | Pattern skipped, others still checked |
| Glossary file missing or empty | glossary_broken check passes (no words to validate against) |
