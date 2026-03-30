---
{key: spec/update-card,summary: "Behavioral contract for updateCard: partial updates, bodyPatches, changelog recording, type change validation, and activation guard re-check",status: draft,type: spec,parent: card-lifecycle,boundary: [src/ops/update.ts],tags: [update,crud,changelog],relations: [safe-operations,structural-integrity,glossary-system],codeLinks: [{kind: function,file: src/ops/update.ts,symbol: updateCard},{kind: function,file: src/ops/update.ts,symbol: updateCardStatus},{kind: interface,file: src/ops/update.ts,symbol: UpdateCardFields},{kind: interface,file: src/ops/update.ts,symbol: BodyPatch},{kind: interface,file: src/ops/update.ts,symbol: UpdateCardResult}],glossary: [card,dual-storage,compensation,activation-guard,codeLink,glossary,boundary]}
---
## Contracts

### C-01: Partial update semantics
- **Given** an UpdateCardFields object
- **When** updateCard is called
- **Then** fields set to undefined MUST be left unchanged
- **And** fields set to null or empty array MUST delete the corresponding frontmatter field
- **And** fields with values MUST replace the existing value

### C-02: Body and bodyPatches mutual exclusivity
- **Given** UpdateCardFields with both body and bodyPatches defined
- **When** updateCard is called
- **Then** CardValidationError MUST be thrown immediately
- **And** no DB or file mutation occurs

### C-03: BodyPatch application rules
- **Given** UpdateCardFields with bodyPatches array
- **When** patches are applied sequentially
- **Then** each patch's old text MUST appear exactly once in the body at apply time
- **And** if old text is not found, CardValidationError MUST be thrown with patch index
- **And** if old text appears multiple times, CardValidationError MUST be thrown with occurrence count

### C-04: Changelog recording
- **Given** any field change in updateCard
- **When** the DB transaction commits
- **Then** a changelog entry MUST be inserted for each changed field
- **And** each entry records: cardKey, field name, oldValue, newValue, changedAt (ISO), changedBy='agent'
- **And** body changes record null for old/new values (too large to store)

### C-05: Type change with children validation
- **Given** a card with children whose type is being changed
- **When** updateCard is called with a new type
- **Then** validateChildrenHierarchy MUST ensure no child violates type rules
- **And** if the card was active and new type's activation conditions are unmet, status is forced to draft
- **And** a warning is added to the result

### C-06: Activation guard re-check on active cards
- **Given** an active card where activation-critical fields (codeLinks, boundary, type) are changed
- **When** updateCard is called
- **Then** validateActivationGuard MUST re-run
- **And** guard re-runs when: becoming active, explicitly set to active, or already active with critical field changes

### C-07: Compensation via syncCardFromFile
- **Given** DB transaction succeeds but file write fails
- **When** compensation runs
- **Then** syncCardFromFile MUST be called to restore DB state from the existing file
- **And** the original file write error is re-thrown

## Failure Modes

| Violation | System Behavior |
|---|---|
| Card not found (file missing) | CardNotFoundError thrown |
| body + bodyPatches both set | CardValidationError thrown |
| bodyPatch old text not found | CardValidationError with patch index |
| bodyPatch old text appears N>1 times | CardValidationError with count |
| Parent cycle detected | ParentValidationError thrown |
| Type change breaks child hierarchy | ParentValidationError thrown |
| Activation guard fails on active card | ActivationGuardError thrown |
| File write fails | DB compensated via syncCardFromFile |
| Glossary word not in glossary.yaml | GlossaryValidationError thrown |