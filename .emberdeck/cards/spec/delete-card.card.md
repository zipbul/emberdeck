---
{key: spec/delete-card,summary: "Behavioral contract for deleteCard: force mode, children orphaning, relation cleanup, and compensation",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/delete.ts],tags: [delete,crud,cascade],relations: [safe-operations,structural-integrity],codeLinks: [{kind: function,file: src/ops/delete.ts,symbol: deleteCard},{kind: interface,file: src/ops/delete.ts,symbol: DeleteCardOptions}],glossary: [card,dual-storage,compensation,relation]}
---
## Contracts

### C-01: Existence check on DB, not file
- **Given** a deleteCard call
- **When** checking existence
- **Then** the check MUST use ctx.cardRepo.existsByKey, NOT file existence
- **And** this allows cleanup of DB records even when the file was externally deleted

### C-02: Children guard (force=false)
- **Given** a card with children and force=false (default)
- **When** deleteCard is called
- **Then** CardValidationError MUST be thrown listing the child count
- **And** no DB or file changes occur

### C-03: Force delete with children orphaning
- **Given** a card with children and force=true
- **When** deleteCard is called
- **Then** the card is deleted from DB (FK cascade removes relations, tags, codeLinks, changelog)
- **And** children's parent field is set to null in DB (FK ON DELETE SET NULL)
- **And** children's .card.md files are updated best-effort (parent field removed)
- **And** referencing cards' .card.md files are updated best-effort (relation removed)

### C-04: DB-first-then-file deletion
- **Given** deleteCard proceeds past validations
- **When** the safe write operation executes
- **Then** dbAction deletes the card row and prunes orphan tags
- **And** fileAction deletes the card file FIRST, then updates children and referencing card files best-effort
- **And** best-effort file updates do NOT block or fail the operation

### C-05: Compensation scope
- **Given** file deletion fails after DB commit
- **When** compensation runs
- **Then** if the original file still exists on disk, syncCardFromFile restores DB state
- **And** if the file was already gone, no compensation is needed (DB deletion was the desired outcome)
- **And** affected children and referencing cards are re-synced from their files to restore correct DB state

## Failure Modes

| Violation | System Behavior |
|---|---|
| Card not found in DB | CardNotFoundError thrown |
| Has children, force=false | CardValidationError with child count |
| File delete fails after DB commit | Compensation via syncCardFromFile if file exists |
| Child file update fails | Silently ignored (best-effort) |
| Referencing card file update fails | Silently ignored (best-effort) |