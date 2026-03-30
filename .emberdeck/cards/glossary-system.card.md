---
{key: glossary-system,summary: "Design document for glossary CRUD, card-glossary cross-validation, progressive enforcement, and glossary locking",status: draft,type: intent,boundary: [src/glossary/**,src/ops/glossary.ts],tags: [glossary,vocabulary,validation],glossary: [glossary,card,drift,dual-storage,compensation]}
---
## Problem & Goals

**Problem**: Domain vocabulary in a project is ambiguous. Different agents (and humans) use different terms for the same concept, or the same term for different concepts. Without a canonical vocabulary, specs become inconsistent and miscommunication causes implementation errors.

**Who has it**: Any project where multiple agents or developers contribute to the codebase. Terminology drift is as dangerous as code drift: it causes misunderstanding at the design level.

**What breaks without this**: Cards use inconsistent terminology. An agent writes "code link" in one card and "symbol binding" in another, referring to the same concept. There is no way to detect when a card's body uses glossary terms it has not declared, or declares terms it never uses.

**Success looks like**: A project-level glossary.yaml file defines canonical domain terms with definitions. Every card declares which glossary words it uses. The system cross-validates card bodies against declared glossary terms, detecting undeclared usage and phantom declarations. Glossary enforcement is progressive: it activates only after the first glossary entry is defined.

## User Scenarios

### P1: Define glossary entries
- **Given** new domain concepts have been introduced
- **When** defineGlossary is called with entries (word + definition pairs)
- **Then** new words are created, existing words are updated (upsert semantics)
- **And** all entries are validated before any write (all-or-nothing)
- **And** word length <= 100 chars, definition length <= 1000 chars
- **And** max 50 entries per call, max 500 total entries

### P1: Progressive enforcement on card creation
- **Given** the glossary has at least one entry
- **When** a card is created or updated
- **Then** the card MUST declare a glossary field with at least one word
- **And** every declared word must exist in glossary.yaml
- **And** when glossary.yaml is empty, the glossary field is optional (progressive enforcement)

### P1: Cross-validation (M6/M7)
- **Given** a card has a glossary field and a body
- **When** cross-validation runs (during create/update or validateCards)
- **Then** M6: words found in body+summary but not declared produce undeclared-usage warnings
- **And** M7: words declared but absent from body+summary produce phantom-declaration warnings
- **And** matching uses word boundaries and is case-insensitive
- **And** warnings are non-blocking (card is still created/updated)

### P2: Lookup glossary
- **Given** an agent needs to understand a domain term
- **When** lookupGlossary is called with a word (or without for full listing)
- **Then** exact match returns the entry, or all entries are returned
- **And** read-only operation, no lock required

### P2: Remove glossary entry
- **Given** a glossary word is obsolete
- **When** removeGlossary is called
- **Then** the word is removed from glossary.yaml
- **And** cards referencing this word are identified (for future drift detection)
- **And** on next checkDrift, those cards will be detected as glossary_broken drift

### P2: Rename glossary entry
- **Given** a glossary word needs to be renamed
- **When** renameGlossary is called with oldWord and newWord
- **Then** glossary.yaml is updated first (file before DB for this operation)
- **And** all cards' glossary_json fields are updated in a single DB transaction
- **And** card .md files are updated best-effort
- **And** if DB transaction fails, glossary.yaml is reverted
- **And** card bodies are NOT automatically updated (manual task)

### P3: Find cards by glossary word
- **Given** a glossary word
- **When** findCardsByGlossaryWord is called
- **Then** all cards declaring that word in their glossary field are returned

## Requirements

- **FR-001**: defineGlossary MUST validate all entries before writing (fail fast, all-or-nothing).
- **FR-002**: defineGlossary MUST enforce max 50 entries per call and max 500 total entries.
- **FR-003**: writeGlossary MUST sort entries alphabetically by word for deterministic git diffs.
- **FR-004**: Progressive enforcement: glossary field is required on cards ONLY when glossary.yaml has entries.
- **FR-005**: validateCardGlossaryField MUST reject: empty glossary arrays, duplicate words, words not in glossary.yaml, words exceeding length limits.
- **FR-006**: crossValidateGlossary MUST use a compiled regex with word boundaries for efficient matching.
- **FR-007**: crossValidateGlossary MUST sort terms longest-first in the regex to match multi-word terms before substrings.
- **FR-008**: Cross-validation warnings (undeclared-usage, phantom-declaration) MUST be non-blocking.
- **FR-009**: removeGlossary MUST identify affected cards so drift detection can flag them later.
- **FR-010**: renameGlossary MUST follow file-first-then-DB pattern with DB-failure compensation (revert file).
- **FR-011**: renameGlossary MUST NOT update card bodies (only frontmatter glossary fields).
- **FR-012**: All glossary write operations MUST be serialized via withGlossaryLock (single global mutex per context).
- **FR-013**: Glossary file path MUST be in the .emberdeck/ directory (parent of cardsDir).

## Success Criteria

- Glossary enforcement is transparent: zero enforcement when glossary.yaml is empty, full enforcement when populated.
- Cross-validation catches 100% of undeclared word usage and phantom declarations using word-boundary regex.
- Rename operation is atomic: either both glossary.yaml and DB are updated, or neither is.
- Glossary operations are concurrency-safe via global mutex.

## Scope & Constraints

**Covers**: Glossary CRUD (define, lookup, remove, rename), card-glossary validation, cross-validation (M6/M7), progressive enforcement, glossary locking, findCardsByGlossaryWord.

**Excludes**: Card CRUD mechanics (see card-lifecycle intent), glossary_broken drift detection (see code-binding intent).

**Assumes**: glossary.yaml is a YAML array of {word, definition} objects. Bun.YAML.parse/stringify is available. One glossary file per project. Lock is per-EmberdeckContext via WeakMap.