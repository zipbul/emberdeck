---
{key: glossary-management/glossary-ops,summary: "All-or-nothing define, rename with compensation, remove with affected card tracking, write serialization",status: draft,type: spec,parent: glossary-management,boundary: [src/ops/glossary.ts,src/glossary/*.ts],codeLinks: [{kind: function,file: src/ops/glossary.ts,symbol: defineGlossary},{kind: function,file: src/ops/glossary.ts,symbol: removeGlossary},{kind: function,file: src/ops/glossary.ts,symbol: renameGlossary},{kind: function,file: src/ops/glossary.ts,symbol: lookupGlossary},{kind: function,file: src/glossary/lock.ts,symbol: withGlossaryLock},{kind: function,file: src/glossary/validation.ts,symbol: validateCardGlossaryField}],glossary: [card-lock],relations: [glossary-management]}
---

## Contract
- GIVEN a batch of glossary entries
  WHEN defineGlossary is called and all entries pass validation
  THEN all entries MUST be created or updated in the glossary file.
- GIVEN a batch of glossary entries
  WHEN any single entry fails validation
  THEN the entire batch MUST be rejected and no entries written.
- GIVEN a glossary word exists
  WHEN renameGlossary is called with oldWord and newWord
  THEN the glossary file MUST be updated first, then all cards referencing oldWord MUST have their DB glossary_json updated, then card files MUST be rewritten.
- GIVEN renameGlossary updated the glossary file
  WHEN the DB transaction to update cards fails
  THEN the glossary file MUST be reverted to its original state.
- GIVEN a glossary word exists
  WHEN removeGlossary is called
  THEN the word MUST be removed from the glossary file and all affected card keys MUST be returned.
- GIVEN a card declares glossary words during creation or update
  WHEN the project glossary has entries
  THEN every declared word MUST exist in the project glossary.

## Invariant
- All glossary write operations (define, remove, rename) MUST be serialized through a single global lock.
- Glossary read operations (lookup) MUST NOT acquire the lock.
- Glossary entries MUST be sorted alphabetically in the file for deterministic output.
- Maximum 500 entries per project; maximum 50 entries per define call.
- A card's glossary field MUST have at least 1 entry when the project glossary exists.

## Failure
| Violation | System behavior |
|-----------|----------------|
| Any entry in define batch fails validation | GlossaryValidationError; entire batch rejected |
| Total entries would exceed 500 | GlossaryValidationError thrown |
| removeGlossary for nonexistent word | GlossaryValidationError thrown |
| renameGlossary target word already exists | GlossaryValidationError thrown |
| renameGlossary DB transaction fails | Glossary file reverted to original entries |
| Card file rewrite fails during rename | Reported in fileWriteFailures array; DB is consistent |
| Card created without glossary when glossary exists | GlossaryValidationError thrown |
| Card declares word not in project glossary | GlossaryValidationError thrown |
