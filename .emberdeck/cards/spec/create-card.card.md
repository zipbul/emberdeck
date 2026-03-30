---
{key: spec/create-card,summary: "Behavioral contract for createCard: input validation, dual-storage atomic write, compensation, and glossary enforcement",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/create.ts],tags: [create,crud,dual-storage],relations: [safe-operations,glossary-system,structural-integrity],codeLinks: [{kind: function,file: src/ops/create.ts,symbol: createCard},{kind: interface,file: src/ops/create.ts,symbol: CreateCardInput},{kind: interface,file: src/ops/create.ts,symbol: CreateCardResult}],glossary: [card,dual-storage,compensation,glossary,activation-guard,codeLink,relation]}
---
## Contracts

### C-01: Key normalization and path computation
- **Given** a CreateCardInput with a key containing mixed case or special characters
- **When** createCard is called
- **Then** the key MUST be normalized via normalizeSlug
- **And** the file path MUST be computed via buildCardPath(ctx.cardsDir, slug)
- **And** the normalized key is used as fullKey in all subsequent operations

### C-02: Input validation precedes all side effects
- **Given** any CreateCardInput
- **When** createCard is called
- **Then** validateCardInput MUST run before any DB or file operation
- **And** summary MUST NOT be empty and MUST NOT exceed 300 characters
- **And** body MUST NOT exceed 100,000 characters
- **And** tags, relations, codeLinks arrays MUST NOT exceed 100 items each
- **And** boundary patterns MUST NOT exceed 50 items, each <= 500 characters

### C-03: Duplicate key rejection
- **Given** a key that already has a .card.md file on disk
- **When** createCard is called with that key
- **Then** CardAlreadyExistsError MUST be thrown
- **And** no DB row or file MUST be created

### C-04: Parent validation chain
- **Given** a CreateCardInput with a parent field
- **When** createCard is called
- **Then** validateParentExists, validateParentType, and validateParentCycle MUST all pass
- **And** intent cards MUST have intent parents; spec cards MUST have intent or spec parents

### C-05: Glossary progressive enforcement
- **Given** glossary.yaml has at least one entry
- **When** createCard is called without a glossary field (or with empty glossary)
- **Then** GlossaryValidationError MUST be thrown
- **And** when glossary.yaml is empty, omitting the glossary field is permitted

### C-06: Activation guard on status=active
- **Given** CreateCardInput with status='active'
- **When** createCard is called
- **Then** validateActivationGuard MUST run
- **And** for spec type: at least 1 codeLink must resolve, boundary must match files
- **And** for intent type: guard is a no-op

### C-07: Atomic dual-storage write via safeWriteOperation
- **Given** all validations pass
- **When** the DB transaction and file write execute
- **Then** DB transaction MUST write card row, relations, tags, and codeLinks atomically
- **And** file write MUST create the directory (mkdir recursive) and write the .card.md file
- **And** if file write fails, compensate MUST delete the DB row via cardRepo.deleteByKey

### C-08: Concurrency and retry
- **Given** concurrent createCard calls for the same key
- **When** both calls execute
- **Then** withCardLock MUST serialize them in FIFO order
- **And** withRetry MUST handle SQLITE_BUSY with exponential backoff

### C-09: Glossary cross-validation warnings
- **Given** a card with glossary field and body text
- **When** createCard succeeds
- **Then** crossValidateGlossary MUST run (non-blocking)
- **And** undeclared-usage and phantom-declaration warnings MUST be included in glossaryWarnings

## Failure Modes

| Violation | System Behavior |
|---|---|
| Invalid key characters | CardKeyError thrown before any side effect |
| Summary empty or > 300 chars | CardValidationError thrown |
| Body > 100,000 chars | CardValidationError thrown |
| Duplicate key (file exists) | CardAlreadyExistsError thrown |
| Parent not found | ParentValidationError thrown |
| Parent type mismatch | ParentValidationError thrown |
| Circular parent reference | ParentValidationError thrown |
| Glossary field missing (glossary.yaml non-empty) | GlossaryValidationError thrown |
| Glossary word not in glossary.yaml | GlossaryValidationError thrown |
| Activation guard unmet (spec, status=active) | ActivationGuardError thrown with unmet conditions |
| File write fails after DB commit | DB compensated via deleteByKey; original error re-thrown |
| Both file write and compensation fail | CompensationError thrown with both errors |
| SQLITE_BUSY | Retried up to 3 times with exponential backoff |