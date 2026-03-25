---
{key: drift-detection-rules,summary: "Three drift types, detection priority, and auto-transition contract",status: active,type: spec,parent: drift-lifecycle,codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkDrift}],tags: [contract,drift],relations: [drift-lifecycle,code-link-contract]}
---
## Contracts
- WHEN checking drift THEN three types are evaluated in priority order (first match wins):
  1. **broken_link**: code link no longer resolves in gildash symbol index
  2. **boundary_inactive**: boundary glob patterns match no files on disk
  3. **symbol_changed**: symbols in boundary files changed after card.updatedAt
- WHEN autoTransition=true (default) AND active card found drifted THEN status changed to drifted in DB + file
- WHEN autoTransition=false THEN drift detected and reported but no status change (read-only mode)
- WHEN draft card encountered THEN skip entirely — draft cards are excluded from drift analysis
- WHEN fullKey provided THEN check that card + BFS relation graph (maxDepth default 3)
- WHEN no fullKey provided THEN check all cards in DB
- WHEN gildash unavailable THEN all three drift checks are skipped (no symbol index to verify against)

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Card stays active despite broken code | Gildash unavailable, so drift check skipped | Configure projectRoot to enable gildash |
| Card marked drifted but code is fine | Symbol was renamed, old name no longer resolves | Run sync_symbol_changes to update code links |

## Cross-module contracts
- regressionGuard calls checkDrift with autoTransition=false to get read-only drift status
- analyze calls checkDrift with autoTransition=true as part of full health report
- Symbol change detection uses gildash getSymbolChanges API with changedAt timestamps compared to card.updatedAt