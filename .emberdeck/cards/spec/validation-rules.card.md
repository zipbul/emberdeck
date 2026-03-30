---
{key: spec/validation-rules,summary: "Behavioral contract for input validation, parent hierarchy rules, relation targets, activation guard, and size limits",status: draft,type: spec,parent: structural-integrity,boundary: [src/card/validation.ts],tags: [validation,hierarchy,guard],relations: [card-lifecycle,code-binding],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateCardInput},{kind: function,file: src/card/validation.ts,symbol: validateParentExists},{kind: function,file: src/card/validation.ts,symbol: validateParentType},{kind: function,file: src/card/validation.ts,symbol: validateParentCycle},{kind: function,file: src/card/validation.ts,symbol: validateRelationTargets},{kind: function,file: src/card/validation.ts,symbol: validateChildrenHierarchy},{kind: function,file: src/card/validation.ts,symbol: validateActivationGuard},{kind: function,file: src/card/validation.ts,symbol: validateTypeChangeActivation},{kind: variable,file: src/card/validation.ts,symbol: LIMITS}],glossary: [card,activation-guard,spec,intent,codeLink,boundary]}
---
## Contracts

### C-01: Size limit validation (LIMITS)
- **Given** any card input
- **When** validateCardInput is called
- **Then** key MUST NOT exceed 200 characters
- **And** summary MUST NOT be empty and MUST NOT exceed 300 characters
- **And** body MUST NOT exceed 100,000 characters
- **And** tags, relations, codeLinks arrays MUST NOT exceed 100 items
- **And** each tag MUST NOT be empty or exceed 100 characters
- **And** each relation target MUST NOT be empty or exceed 200 characters
- **And** each codeLink symbol MUST NOT exceed 200 characters, file MUST NOT exceed 500 characters
- **And** boundary MUST NOT exceed 50 patterns, each <= 500 characters
- **And** boundary patterns MUST be valid glob syntax (Bun.Glob constructor test)

### C-02: Parent existence validation
- **Given** a parent key
- **When** validateParentExists is called
- **Then** ParentValidationError MUST be thrown if the key does not exist in ctx.cardRepo

### C-03: Parent type hierarchy
- **Given** a card type and parent key
- **When** validateParentType is called
- **Then** intent cards MUST have intent parents (ParentValidationError if parent is not intent)
- **And** spec cards MUST have intent or spec parents (ParentValidationError if parent is neither)

### C-04: Circular parent detection
- **Given** a card key and proposed parent
- **When** validateParentCycle walks the ancestor chain
- **Then** if the card key is found in the ancestor chain within 20 levels, ParentValidationError MUST be thrown
- **And** the walk stops after MAX_PARENT_DEPTH=20 iterations

### C-05: Relation target validation
- **Given** a card key and relation targets array
- **When** validateRelationTargets is called
- **Then** self-references (target === cardKey) MUST throw CardValidationError
- **And** non-existent targets MUST throw CardValidationError

### C-06: Children hierarchy on type change
- **Given** a card with children being changed to a new type
- **When** validateChildrenHierarchy is called
- **Then** changing to spec MUST throw ParentValidationError if any child is intent

### C-07: Activation guard for spec cards
- **Given** a card with type=spec transitioning to active
- **When** validateActivationGuard is called
- **Then** at least 1 codeLink MUST be declared (otherwise unmet condition)
- **And** all codeLinks MUST resolve in gildash (otherwise unmet condition per link)
- **And** if boundary is present, at least 1 file MUST match via gildash.listIndexedFiles
- **And** ActivationGuardError is thrown with the full list of unmet conditions

### C-08: Activation guard for intent cards
- **Given** a card with type=intent
- **When** validateActivationGuard is called
- **Then** the function MUST return immediately (no conditions to check)

### C-09: Type change activation re-check
- **Given** an active card whose type is being changed
- **When** validateTypeChangeActivation is called
- **Then** if the new type's activation conditions are unmet, status is forced to draft
- **And** if already non-active, the current status is returned unchanged

## Failure Modes

| Violation | System Behavior |
|---|---|
| Any size limit exceeded | CardValidationError with specific field and limit info |
| Empty summary | CardValidationError |
| Invalid glob syntax in boundary | CardValidationError |
| Parent not found | ParentValidationError |
| Parent type mismatch | ParentValidationError with types |
| Circular parent chain | ParentValidationError with cycle info |
| Self-referencing relation | CardValidationError |
| Non-existent relation target | CardValidationError |
| Spec card with 0 codeLinks going active | ActivationGuardError |
| Unresolved codeLink on active spec | ActivationGuardError with link details |
| Boundary matches no files on active spec | ActivationGuardError |