---
{key: spec/glossary-cross-validation,summary: "Behavioral contract for glossary cross-validation (M6/M7), progressive enforcement, and card glossary field validation",status: draft,type: spec,parent: glossary-system,boundary: [src/glossary/cross-validate.ts,src/glossary/validation.ts],tags: [glossary,cross-validation,enforcement],relations: [spec/create-card,spec/update-card,spec/sync-cards],codeLinks: [{kind: function,file: src/glossary/cross-validate.ts,symbol: crossValidateGlossary},{kind: function,file: src/glossary/cross-validate.ts,symbol: buildGlossaryMatcher},{kind: interface,file: src/glossary/cross-validate.ts,symbol: GlossaryCrossWarning},{kind: function,file: src/glossary/validation.ts,symbol: validateGlossaryEntry},{kind: function,file: src/glossary/validation.ts,symbol: validateCardGlossaryField}],glossary: [glossary,card,drift]}
---
## Contracts

### C-01: Progressive enforcement gate
- **Given** a card being created or updated
- **When** glossary.yaml has at least one entry
- **Then** the card MUST have a glossary field with at least one word
- **And** when glossary.yaml is empty (no entries), the glossary field is optional
- **And** this enforcement is implemented in createCard and updateCard ops

### C-02: Card glossary field validation
- **Given** a card's glossary field
- **When** validateCardGlossaryField is called
- **Then** empty array MUST throw GlossaryValidationError
- **And** > 100 entries MUST throw GlossaryValidationError
- **And** duplicate words MUST throw GlossaryValidationError
- **And** empty word or word > 100 chars MUST throw GlossaryValidationError
- **And** word not found in project glossary MUST throw GlossaryValidationError

### C-03: Cross-validation undeclared-usage (M6)
- **Given** a card with body and summary text
- **When** crossValidateGlossary runs
- **Then** glossary words found in text (body + summary) but NOT in the card's declared glossary produce undeclared-usage warnings
- **And** matching uses word boundaries (\b) and is case-insensitive

### C-04: Cross-validation phantom-declaration (M7)
- **Given** a card's declared glossary words
- **When** crossValidateGlossary runs
- **Then** words declared in the card's glossary field but NOT appearing in text (body + summary) produce phantom-declaration warnings

### C-05: Efficient regex matching
- **Given** the project glossary entries
- **When** buildGlossaryMatcher builds the regex
- **Then** all glossary words are combined into a single regex with word boundaries
- **And** terms are sorted longest-first to match multi-word terms before substrings
- **And** matching is case-insensitive but results use canonical (original-case) words
- **And** the matcher is O(text_length + glossary_size) per call

### C-06: Non-blocking warnings
- **Given** cross-validation detects undeclared-usage or phantom-declaration
- **When** the warnings are produced
- **Then** the card creation/update MUST still succeed
- **And** warnings are attached to the result (glossaryWarnings field)
- **And** during validateCards, warnings are added to the warnings array

## Failure Modes

| Violation | System Behavior |
|---|---|
| No glossary entries exist, card omits glossary | No error (progressive enforcement) |
| Glossary exists, card omits glossary | GlossaryValidationError in createCard |
| Card declares word not in glossary | GlossaryValidationError |
| Duplicate word in card glossary | GlossaryValidationError |
| Undeclared usage in body | Non-blocking warning (undeclared-usage) |
| Phantom declaration | Non-blocking warning (phantom-declaration) |
| Empty glossary entries for matcher | Matcher returns empty set (no matches, no errors) |