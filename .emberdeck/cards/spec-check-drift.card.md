---
{key: spec-check-drift,summary: checkDrift detects 4 drift mechanisms and auto-transitions active cards to drifted with compensation,status: draft,type: spec,parent: drift-detection,boundary: [src/ops/context.ts],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkDrift}],glossary: [drift,codeLink,boundary,gildash,compensation],relations: [drift-detection]}
---

## Contracts
- WHEN checkDrift is called for non-draft cards, THEN each card MUST be checked for 4 drift mechanisms in priority order: broken_link > boundary_inactive > symbol_changed > glossary_broken. First match wins.
- WHEN autoTransition=true (default) and drift is detected on an active card, THEN a targeted DB UPDATE (status=drifted) MUST execute, followed by file write. IF file write fails, DB MUST be reverted.
- WHEN gildash is transiently unavailable during link check, THEN auto-transition MUST be skipped (false positive prevention).
- WHEN a fullKey is provided, THEN BFS relation graph MUST determine the scope of cards to check (up to maxDepth).
- WHEN no fullKey is provided, THEN all cards in the project MUST be checked.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Gildash transient failure during link check | gildashUnavailable flag set, auto-transition skipped |
| File write fails after DB status update | DB reverted to previous status+updatedAt |
| DB status update fails | Transition skipped, driftType still reported |
| Draft card encountered | Excluded from analysis, counted in healthDraft |
