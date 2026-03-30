---
{key: card-lifecycle,summary: "Design document for card lifecycle management: dual-storage architecture, CRUD operations, and status transitions",status: draft,type: intent,boundary: [src/card/**,src/ops/create.ts,src/ops/update.ts,src/ops/delete.ts,src/ops/rename.ts,src/ops/sync.ts,src/fs/**,src/db/card-repo.ts,src/db/schema.ts],tags: [lifecycle,dual-storage,crud],glossary: [card,intent,spec,dual-storage,card-status,compensation]}
---
## Problem & Goals

**Problem**: AI agents performing vibe coding have no persistent memory of design decisions. When an agent modifies code, it has no way to know what contracts exist, what the original design rationale was, or whether its changes break cross-module agreements. Without a structured design memory, agents repeatedly violate implicit contracts, causing cascading regressions.

**Who has it**: AI coding agents operating across multi-file codebases, and the developers who rely on them for code generation and maintenance.

**What breaks without this**: Design knowledge evaporates between agent sessions. Each new context window starts from zero, leading to contradictory changes, orphaned code paths, and silent contract violations.

**Success looks like**: Every design decision is captured as a card with frontmatter metadata and markdown body. Cards persist across sessions in both a queryable database and git-diffable markdown files. Card status automatically reflects whether code and spec are aligned.

## User Scenarios

### P1: Create a new design card
- **Given** an agent has a design decision to record
- **When** the agent calls createCard with key, summary, type, and body
- **Then** the system creates a DB row and a .card.md file atomically
- **And** the card key is normalized to a URL-safe slug
- **And** duplicate keys are rejected with CardAlreadyExistsError

### P1: Update an existing card
- **Given** a card exists in dual-storage
- **When** the agent calls updateCard with partial fields
- **Then** only specified fields are modified; unspecified fields are preserved
- **And** both DB and file are updated atomically
- **And** a changelog entry is recorded for each changed field

### P1: Delete a card
- **Given** a card exists with potential children and relations
- **When** the agent calls deleteCard
- **Then** with force=false, deletion is rejected if children exist
- **And** with force=true, children's parent is set to null and referencing relations are cleaned up
- **And** both DB and file are removed

### P2: Status transitions (draft -> active -> drifted)
- **Given** a card in draft status
- **When** the agent sets status to active
- **Then** the activation-guard validates type-specific conditions
- **And** for spec cards: at least 1 codeLink must resolve, boundary must match files
- **And** for intent cards: no activation conditions apply

### P2: Sync card from external file edit
- **Given** a .card.md file is modified outside the system (e.g., git pull)
- **When** syncCardFromFile is called
- **Then** the DB is updated to match the file's frontmatter and body
- **And** relations, tags, and codeLinks are fully replaced in the DB

### P3: Bulk sync all cards
- **Given** multiple .card.md files exist on disk
- **When** bulkSyncCards scans the cards directory
- **Then** all files are read in parallel batches of 20
- **And** duplicate keys across files are detected and reported as errors
- **And** each file's DB write is individually atomic

## Requirements

- **FR-001**: createCard MUST normalize the key via normalizeSlug and compute filePath via buildCardPath.
- **FR-002**: createCard MUST validate all input fields (summary length <= 300, body <= 100,000, arrays <= 100 items) before any DB/file operation.
- **FR-003**: createCard MUST atomically write to both DB and file; if file write fails after DB commit, the DB MUST be compensated (rolled back).
- **FR-004**: updateCard MUST support partial updates where undefined fields are preserved and null/empty-array fields are deleted.
- **FR-005**: updateCard MUST support bodyPatches (search-and-replace) as an alternative to full body replacement; body and bodyPatches MUST be mutually exclusive.
- **FR-006**: updateCard MUST record changelog entries for every changed field with old/new values and timestamp.
- **FR-007**: deleteCard MUST check for children and reject deletion (force=false) or orphan children (force=true).
- **FR-008**: deleteCard MUST perform best-effort cleanup of referencing cards' relation fields in their files.
- **FR-009**: Card status MUST be one of: draft, active, drifted. No other values are permitted.
- **FR-010**: Status transition to active MUST pass the activation-guard (type-specific validation).
- **FR-011**: syncCardFromFile MUST fully replace DB state (card row, relations, tags, codeLinks) from file content.
- **FR-012**: bulkSyncCards MUST detect and reject duplicate keys across files to prevent data loss.
- **FR-013**: Card frontmatter MUST include key, summary, status, type as required fields.

## Success Criteria

- 100% of card CRUD operations maintain dual-storage consistency (DB row exists iff .card.md file exists).
- Zero silent data loss: every failed file write triggers DB compensation.
- All status transitions are validated; no card reaches active status without passing activation-guard.
- Changelog captures every field mutation with before/after values.

## Scope & Constraints

**Covers**: Card CRUD (create, read, update, delete), card rename, status transitions, file-to-DB sync, bulk sync, card key normalization, frontmatter serialization/parsing, changelog recording.

**Excludes**: Code binding and drift detection (see code-binding intent), relation graph traversal (see structural-integrity intent), glossary validation (see glossary-system intent).

**Assumes**: SQLite is the backing database. Bun runtime is available. Card files use .card.md extension with YAML frontmatter.