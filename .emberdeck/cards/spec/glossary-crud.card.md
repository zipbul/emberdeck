---
{key: spec/glossary-crud,summary: "Behavioral contract for defineGlossary, lookupGlossary, removeGlossary, renameGlossary, and findCardsByGlossaryWord",status: draft,type: spec,parent: glossary-system,boundary: [src/ops/glossary.ts,src/glossary/io.ts,src/glossary/lock.ts],tags: [glossary,crud,lock],relations: [card-lifecycle,safe-operations],codeLinks: [{kind: function,file: src/ops/glossary.ts,symbol: defineGlossary},{kind: function,file: src/ops/glossary.ts,symbol: lookupGlossary},{kind: function,file: src/ops/glossary.ts,symbol: removeGlossary},{kind: function,file: src/ops/glossary.ts,symbol: renameGlossary},{kind: function,file: src/ops/glossary.ts,symbol: findCardsByGlossaryWord},{kind: function,file: src/ops/glossary.ts,symbol: resetEmberdeck},{kind: function,file: src/glossary/io.ts,symbol: readGlossary},{kind: function,file: src/glossary/io.ts,symbol: writeGlossary},{kind: function,file: src/glossary/lock.ts,symbol: withGlossaryLock}],glossary: [glossary,card,compensation,dual-storage,drift]}
---
## Contracts

### C-01: defineGlossary all-or-nothing validation
- **Given** a list of glossary entries
- **When** defineGlossary is called
- **Then** all entries MUST be validated before any file write (fail-fast)
- **And** each entry's word must be non-empty, <= 100 chars; definition non-empty, <= 1000 chars
- **And** max 50 entries per call
- **And** total entries after upsert MUST NOT exceed 500

### C-02: defineGlossary upsert semantics
- **Given** entries with both new and existing words
- **When** defineGlossary executes under withGlossaryLock
- **Then** existing words have their definitions updated
- **And** new words are added to the list
- **And** the result includes action='created' or action='updated' for each entry

### C-03: writeGlossary deterministic output
- **Given** glossary entries to write
- **When** writeGlossary is called
- **Then** entries are sorted alphabetically by word before writing
- **And** the file is written via writeFileSync (atomic single-call write)
- **And** empty entries result in an empty file (not deletion)

### C-04: readGlossary defensive parsing
- **Given** a glossary.yaml file
- **When** readGlossary is called
- **Then** missing file returns empty array (no error)
- **And** empty file returns empty array
- **And** non-array YAML throws GlossaryParseError
- **And** entries missing word or definition throw GlossaryParseError with index

### C-05: lookupGlossary read-only
- **Given** a word or no word
- **When** lookupGlossary is called
- **Then** with word: exact match returns {found: true, entry}; no match returns {found: false}
- **And** without word: all entries returned as {found: true, entries}
- **And** NO lock is acquired (read-only)

### C-06: removeGlossary with affected card identification
- **Given** a glossary word
- **When** removeGlossary is called under withGlossaryLock
- **Then** the word MUST exist (GlossaryValidationError if not found)
- **And** the word is spliced from the entries and file is rewritten
- **And** all cards declaring this word in their glossary_json are identified and returned as affectedCardKeys

### C-07: renameGlossary file-first-then-DB pattern
- **Given** oldWord and newWord
- **When** renameGlossary is called under withGlossaryLock
- **Then** oldWord MUST exist, newWord MUST NOT exist (GlossaryValidationError otherwise)
- **And** glossary.yaml is written FIRST with the renamed word
- **And** a DB transaction updates all affected cards' glossary_json fields
- **And** if DB transaction fails, glossary.yaml is reverted to original entries
- **And** card .md files are updated best-effort (failures collected in fileWriteFailures)
- **And** card bodies are NOT updated (only frontmatter glossary fields)

### C-08: Glossary locking serialization
- **Given** concurrent glossary write operations
- **When** multiple define/remove/rename calls overlap
- **Then** withGlossaryLock MUST serialize all write operations (single global mutex per context)
- **And** the lock uses Promise-chaining (same pattern as withCardLock)
- **And** read operations (lookup) do NOT acquire the lock

### C-09: resetEmberdeck full cleanup
- **Given** an emberdeck instance with cards and glossary
- **When** resetEmberdeck is called
- **Then** all card DB rows are deleted
- **And** all card files are deleted (best-effort)
- **And** orphan tags are pruned
- **And** glossary.yaml is cleared (writeGlossary with empty array)

## Failure Modes

| Violation | System Behavior |
|---|---|
| Empty entries array | GlossaryValidationError |
| > 50 entries per call | GlossaryValidationError |
| Total would exceed 500 | GlossaryValidationError |
| Word empty or > 100 chars | GlossaryValidationError |
| Definition empty or > 1000 chars | GlossaryValidationError |
| Remove word not found | GlossaryValidationError |
| Rename oldWord not found | GlossaryValidationError |
| Rename newWord already exists | GlossaryValidationError |
| Rename DB transaction fails | glossary.yaml reverted; DB error re-thrown |
| Rename card file write fails | Collected in fileWriteFailures (non-blocking) |
| Malformed glossary.yaml | GlossaryParseError |