---
{key: spec-update-card,summary: updateCard and updateCardStatus partially update cards with type-change re-validation and changelog,status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/update.ts],codeLinks: [{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus}],glossary: [card,dual storage,activation guard,compensation],relations: [card-lifecycle,spec-safe-write]}
---

## Contracts
- WHEN updateCard is called with partial fields, THEN only specified fields MUST change; undefined fields MUST be preserved.
- WHEN type changes on an active card, THEN children hierarchy MUST be re-validated, and if new type's activation conditions are unmet, status MUST be forced to draft.
- WHEN body and bodyPatches are both specified, THEN CardValidationError MUST be thrown (mutually exclusive).
- WHEN bodyPatches are applied, THEN each patch's old string MUST appear exactly once in the body at apply time. Zero occurrences or multiple occurrences MUST throw.
- WHEN status is set to active (explicitly or already active with critical field changes), THEN activation guard MUST re-run.
- WHEN file write fails after DB commit, THEN syncCardFromFile MUST be called to restore DB from the unchanged file.
- WHEN updateCardStatus is called, THEN only status changes; all other fields are preserved.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| body + bodyPatches both set | CardValidationError |
| bodyPatch old string not found | CardValidationError with patch index |
| bodyPatch old string appears multiple times | CardValidationError with occurrence count |
| Type change breaks children hierarchy | ParentValidationError |
| Activation conditions unmet on active | ActivationGuardError |
| File write fails after DB | syncCardFromFile restores DB from file |
