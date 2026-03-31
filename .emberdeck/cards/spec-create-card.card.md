---
{key: spec-create-card,summary: createCard validates inputs and atomically stores card in DB and file with compensation on failure,status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/create.ts],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard}],glossary: [card,dual storage,activation guard,compensation],relations: [card-lifecycle,spec-safe-write]}
---

## Contracts
- WHEN createCard is called with a valid key, THEN the card MUST be written to DB first, then to file. IF file write fails, DB MUST be compensated by deleting the card row.
- WHEN a card with the same key already exists (file or DB), THEN CardAlreadyExistsError MUST be thrown before any mutation.
- WHEN parent is specified, THEN parent existence, type hierarchy (intent->intent, spec->intent|spec), and circular reference checks MUST all pass before commit.
- WHEN status=active is requested for a spec card, THEN the activation guard MUST verify all codeLinks resolve and boundary matches files.
- WHEN the project glossary has entries, THEN the glossary field MUST be non-empty and all declared words MUST exist in the glossary.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Duplicate key | CardAlreadyExistsError before any mutation |
| Parent not found | ParentValidationError |
| Type hierarchy violation | ParentValidationError |
| Circular parent chain | ParentValidationError |
| Activation conditions unmet | ActivationGuardError with list of unmet conditions |
| File write fails after DB | DB row deleted via compensation |
| Glossary word not in project glossary | GlossaryValidationError |
