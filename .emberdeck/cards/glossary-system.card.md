---
{key: glossary-system,summary: Domain vocabulary is consistent across all cards and glossary operations are atomic,status: draft,type: brief,glossary: [card,drift]}
---

## Problem & Goals
The project glossary defines domain vocabulary. Cards declare which glossary terms they discuss. Without enforcement, terms can be removed while cards still reference them, or cards can declare non-existent terms. All glossary mutations must be atomic and handle cross-references correctly.

Goal: glossary and card glossary fields are always consistent; every glossary mutation either fully succeeds or fully rolls back.

## User Scenarios

### P1: Agent defines new glossary terms
Given the agent proposes new domain concepts,
When defineGlossary is called with entries,
Then all entries are validated and written atomically (all-or-nothing).

### P1: Agent renames a glossary term
Given cards reference a glossary word,
When renameGlossary is called,
Then the glossary file is updated first, then all card glossary fields in DB, then card files.
If DB update fails, the glossary file is reverted.

### P2: Agent removes a glossary term
Given cards reference a glossary word,
When removeGlossary is called,
Then the word is removed and affected card keys are returned for manual cleanup.

## Requirements
- R-001: defineGlossary MUST validate all entries before writing (all-or-nothing).
- R-002: renameGlossary MUST update glossary file first, then DB, and compensate glossary file if DB fails.
- R-003: Card creation MUST require non-empty glossary field when the project glossary has entries.
- R-004: Card glossary field MUST only contain words that exist in the project glossary.
- R-005: All glossary write operations MUST be serialized via a global mutex.

## Success Criteria
- SC-001: 0 cards with glossary words not found in glossary.yaml.
- SC-002: 0 interleaved glossary writes (all mutations serialized).

## Scope & Constraints
- Covers: defineGlossary, lookupGlossary, removeGlossary, renameGlossary, findCardsByGlossaryWord, glossary validation, glossary lock, resetEmberdeck.
- Excludes: card CRUD logic (except glossary validation within it), drift detection, code binding.
- Assumes: glossary.yaml is the single file-based store; concurrent access is serialized via withGlossaryLock.
