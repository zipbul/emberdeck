---
{key: dual-storage/card-crud,summary: "Create, update, and delete card operations composing safeWriteOperation with operation-specific validation",status: draft,type: spec,parent: dual-storage,boundary: [src/ops/create.ts,src/ops/update.ts,src/ops/delete.ts],relations: [dual-storage,dual-storage/mutation-safety],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus},{kind: function,file: src/ops/delete.ts,symbol: deleteCard}],glossary: [dual-storage,compensation,activation-guard]}
---

## Contract
- GIVEN valid card input with a unique key
  WHEN createCard is called
  THEN the card MUST be inserted into DB and written to file via safeWriteOperation, with compensation deleting the DB row on file failure.
- GIVEN a card file already exists for the key
  WHEN createCard is called
  THEN CardAlreadyExistsError MUST be thrown before any DB mutation.
- GIVEN the project glossary has entries
  WHEN createCard is called without a glossary field
  THEN GlossaryValidationError MUST be thrown (progressive enforcement).
- GIVEN an updateCard call provides both body and bodyPatches
  WHEN validation runs
  THEN CardValidationError MUST be thrown (mutually exclusive).
- GIVEN bodyPatches are provided
  WHEN a patch's old text appears 0 times or more than once in the body
  THEN CardValidationError MUST be thrown.
- GIVEN an active card's codeLinks or boundary are updated
  WHEN the card status remains active
  THEN the activation guard MUST be re-run against the new values.
- GIVEN a card type is changed on an active card
  WHEN the new type's activation conditions are unmet
  THEN the status MUST be forced to draft with a warning.
- GIVEN deleteCard is called with force=false and the card has children
  WHEN the operation runs
  THEN CardValidationError MUST be thrown.
- GIVEN deleteCard is called with force=true and the card has children
  WHEN the card is deleted
  THEN children's parent field MUST be set to null (best-effort file update), and referencing cards' relation fields MUST be cleaned up (best-effort).
- GIVEN deleteCard's file deletion fails after DB commit
  WHEN compensation runs
  THEN DB state MUST be restored from the original file via syncCardFromFile.

## Invariant
- createCard existence check MUST verify the file on disk, not only the DB, to handle externally created files.
- updateCard compensation MUST use syncCardFromFile (not deleteByKey) because the previous file still exists.
- deleteCard MUST check DB existence (not file existence) as the primary guard, because the file may have been externally deleted.
- All three operations MUST be wrapped in withCardLock and withRetry.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Duplicate key on create | CardAlreadyExistsError before any DB mutation |
| Missing glossary when glossary exists | GlossaryValidationError |
| body + bodyPatches both provided | CardValidationError |
| bodyPatch old text not found or ambiguous | CardValidationError |
| Delete with children, force=false | CardValidationError listing child count |
| File write fails on create | DB row deleted via compensation |
| File write fails on update | DB restored via syncCardFromFile |
| File delete fails on delete | DB restored via syncCardFromFile |
| Children file update fails on force delete | Best-effort; no error thrown |
| Invalid card key format | CardKeyError thrown before any DB/file operation |
