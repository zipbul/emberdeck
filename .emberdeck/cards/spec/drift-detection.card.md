---
{key: spec/drift-detection,summary: "Behavioral contract for checkDrift: 4 drift types, priority evaluation, auto-transition with compensation, and health reporting",status: draft,type: spec,parent: code-binding,boundary: [src/ops/context.ts],tags: [drift,detection,auto-transition],relations: [card-lifecycle,safe-operations],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkDrift},{kind: type,file: src/ops/context.ts,symbol: DriftType},{kind: interface,file: src/ops/context.ts,symbol: DriftCard},{kind: interface,file: src/ops/context.ts,symbol: DriftResult},{kind: interface,file: src/ops/context.ts,symbol: DriftHealth}],glossary: [drift,codeLink,boundary,gildash,card-status,compensation,glossary]}
---
## Contracts

### C-01: Draft cards excluded from analysis
- **Given** any card with status=draft
- **When** checkDrift runs
- **Then** the card is counted in health.draft but NOT analyzed for drift
- **And** no DriftCard entry is produced for draft cards

### C-02: Drift type priority order
- **Given** an active or drifted card
- **When** multiple drift conditions are true simultaneously
- **Then** the drift type MUST be assigned in priority order: broken_link > boundary_inactive > symbol_changed > glossary_broken
- **And** only the first matching type is reported (first match wins)

### C-03: broken_link detection via gildash
- **Given** a card with codeLinks
- **When** gildash resolves each link
- **Then** links where the symbol cannot be found are counted as broken
- **And** gildash resolution is batched by file: getSymbolsByFile first, searchSymbols fallback
- **And** if gildash throws (transient failure), the card is skipped for drift (no false positive)

### C-04: boundary_inactive detection
- **Given** an active card with boundary patterns
- **When** no files on disk match any boundary glob via scanSync
- **Then** driftType MUST be set to boundary_inactive
- **And** this check only runs on active cards (not already-drifted)
- **And** only runs when ctx.projectRoot is available

### C-05: symbol_changed detection
- **Given** an active card with boundary matching files where symbols changed
- **When** gildash.getSymbolChanges returns changes after the card's updatedAt
- **Then** driftType MUST be set to symbol_changed with symbolChanges detail array
- **And** the since parameter uses the oldest active card's updatedAt

### C-06: glossary_broken detection
- **Given** a card declaring glossary words not present in glossary.yaml
- **When** checkDrift runs
- **Then** driftType MUST be set to glossary_broken
- **And** this is the lowest priority drift type

### C-07: Auto-transition with compensation
- **Given** drift is detected on an active card with autoTransition=true
- **When** transition is attempted
- **Then** a targeted UPDATE (status='drifted') runs with a WHERE status='active' guard
- **And** the card file is rewritten with the new status
- **And** if file write fails, the DB update is reverted to the original status and updatedAt
- **And** gildashUnavailable=true prevents auto-transition (no false transitions)

### C-08: Scoped vs full-project drift check
- **Given** a fullKey parameter
- **When** checkDrift is called with a specific key
- **Then** the target scope is the card + its relation graph (BFS, maxDepth from options)
- **And** when fullKey is omitted, all cards in the DB are checked

## Failure Modes

| Violation | System Behavior |
|---|---|
| gildash transient failure | Card skipped for drift, gildashUnavailable flag set |
| gildash not configured | Code link checks skipped entirely |
| File write fails during auto-transition | DB reverted; drift type still reported |
| getSymbolChanges not available | symbol_changed detection skipped |
| Card not found in DB | Silently skipped (no DriftCard entry) |