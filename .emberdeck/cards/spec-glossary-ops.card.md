---
{key: spec-glossary-ops,summary: "Glossary CRUD operations with all-or-nothing define, file-first rename with DB compensation, and reset",status: draft,type: spec,parent: glossary-system,boundary: [src/ops/glossary.ts],codeLinks: [{kind: function,file: src/ops/glossary.ts,symbol: defineGlossary},{kind: function,file: src/ops/glossary.ts,symbol: lookupGlossary},{kind: function,file: src/ops/glossary.ts,symbol: removeGlossary},{kind: function,file: src/ops/glossary.ts,symbol: renameGlossary},{kind: function,file: src/ops/glossary.ts,symbol: findCardsByGlossaryWord},{kind: function,file: src/ops/glossary.ts,symbol: resetEmberdeck}],glossary: [card,compensation],relations: [glossary-system]}
---

## Contracts
- WHEN defineGlossary is called, THEN all entries MUST be validated before any write (all-or-nothing). IF total entries would exceed the max limit, the entire call MUST be rejected.
- WHEN renameGlossary is called, THEN glossary.yaml MUST be written first, then all affected card glossary_json fields updated in a DB transaction, then card files updated best-effort. IF DB transaction fails, glossary.yaml MUST be reverted to original state.
- WHEN removeGlossary is called, THEN the word MUST be removed from glossary.yaml and affected card keys MUST be returned. Cards are NOT auto-updated (they become drifted on next check).
- WHEN findCardsByGlossaryWord is called, THEN all cards whose glossary field contains the word MUST be returned.
- WHEN resetEmberdeck is called, THEN all cards (DB + files) MUST be deleted, orphan tags pruned, and glossary.yaml cleared.
- WHEN lookupGlossary is called without a word, THEN all entries MUST be returned. With a word, exact match only.

## Failure modes
| Violation | System behavior |
|-----------|----------------|
| Entry validation fails in defineGlossary | GlossaryValidationError, no entries written |
| Max entries exceeded | GlossaryValidationError |
| Word not found in removeGlossary | GlossaryValidationError |
| DB fails after glossary.yaml write in rename | glossary.yaml reverted |
| Card file write fails during rename | Key added to fileWriteFailures |
