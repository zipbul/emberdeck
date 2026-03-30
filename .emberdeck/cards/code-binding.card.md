---
{key: code-binding,summary: "Design document for code-to-spec binding via codeLinks, drift detection (4 types), and automatic status transitions",status: draft,type: intent,boundary: [src/ops/link.ts,src/ops/context.ts,src/ops/spec-sync.ts,src/db/code-link-repo.ts],tags: [code-binding,drift,gildash],glossary: [codeLink,drift,gildash,boundary,spec,card-status,activation-guard]}
---
## Problem & Goals

**Problem**: Design specs become stale the moment code changes. Without automated detection, specs silently diverge from implementation, creating a false sense of safety. Agents trust outdated specs and introduce regressions.

**Who has it**: Any project using Emberdeck where code evolves faster than spec maintenance. The gap between spec and code is the primary source of design debt.

**What breaks without this**: Specs become decorative documentation. Agents read a spec, assume the code matches, and build on incorrect assumptions. Drift accumulates silently until a critical failure surfaces.

**Success looks like**: Every spec card is bound to specific code symbols via codeLinks. When code changes, the system automatically detects which specs are affected and transitions them to drifted status. Four distinct drift types are identified, each with a clear remediation path.

## User Scenarios

### P1: Resolve codeLinks for a spec card
- **Given** a spec card has codeLinks declared in frontmatter
- **When** resolveCardCodeLinks is called
- **Then** each codeLink is looked up in the gildash symbol index
- **And** results distinguish found symbols (with full metadata) from broken links (null)
- **And** gildash is reindexed before resolution to ensure freshness

### P1: Detect broken_link drift
- **Given** an active spec card has codeLinks to symbols that no longer exist
- **When** checkDrift runs for that card
- **Then** the card is classified as drifted with driftType=broken_link
- **And** if autoTransition=true, the card's status is changed to drifted in both DB and file

### P1: Validate code links with auto-transition
- **Given** an active spec card
- **When** validateCodeLinks is called
- **Then** broken links on active cards trigger automatic transition to drifted
- **And** broken links on draft cards are classified as planned (not broken)
- **And** gildash transient failures do NOT trigger false drift transitions

### P2: Detect boundary_inactive drift
- **Given** an active card has boundary glob patterns
- **When** checkDrift runs and no files on disk match any boundary pattern
- **Then** the card is classified as drifted with driftType=boundary_inactive

### P2: Detect symbol_changed drift
- **Given** an active card has boundary patterns matching files where symbols changed after the card's updatedAt
- **When** checkDrift runs with gildash.getSymbolChanges available
- **Then** the card is classified as drifted with driftType=symbol_changed
- **And** the specific symbol changes are included in the drift report

### P2: Detect glossary_broken drift
- **Given** an active card declares glossary words that no longer exist in glossary.yaml
- **When** checkDrift runs
- **Then** the card is classified as drifted with driftType=glossary_broken

### P2: Find cards by symbol
- **Given** an agent is about to modify a function
- **When** findCardsBySymbol is called with the symbol name and optional file path
- **Then** cards with matching codeLinks are returned first
- **And** cards with boundary patterns matching the file are returned second

### P3: Auto-transition compensation
- **Given** checkDrift detects drift and attempts auto-transition
- **When** the file write for status change fails
- **Then** the DB change is reverted to the previous status
- **And** the drift type is still reported in the result (detection succeeds even if transition fails)

## Requirements

- **FR-001**: resolveCardCodeLinks MUST call gildash.reindex() before resolving any links.
- **FR-002**: resolveCardCodeLinks MUST throw GildashNotConfiguredError when ctx.gildash is undefined.
- **FR-003**: validateCodeLinks MUST distinguish broken links (active/drifted cards) from planned links (draft cards).
- **FR-004**: validateCodeLinks MUST auto-transition active cards to drifted when broken links are detected, UNLESS gildash was transiently unavailable.
- **FR-005**: checkDrift MUST evaluate drift types in priority order: broken_link > boundary_inactive > symbol_changed > glossary_broken (first match wins).
- **FR-006**: checkDrift MUST skip draft cards entirely from drift analysis.
- **FR-007**: checkDrift with autoTransition=true MUST update both DB (targeted UPDATE) and file; if file write fails, DB MUST be reverted.
- **FR-008**: findCardsBySymbol MUST match via codeLinks first, then via boundary glob patterns.
- **FR-009**: findAffectedCards MUST return cards whose codeLinks reference any of the given changed files.
- **FR-010**: Drift detection for symbol_changed MUST use gildash.getSymbolChanges with the oldest active card's updatedAt as the since parameter.
- **FR-011**: ensureReindexed MUST be a no-op when gildash is not configured or does not support reindex.

## Success Criteria

- All 4 drift types are detected within a single checkDrift call.
- Zero false positives: gildash transient failures never cause incorrect drift transitions.
- Auto-transition maintains dual-storage consistency (DB and file always agree on status).
- Symbol coverage ratio is computable: totalSymbols, coveredSymbols, and uncovered list are available.

## Scope & Constraints

**Covers**: codeLink resolution, 4-type drift detection, auto-transition, symbol search, affected card discovery, code link validation, symbol coverage analysis.

**Excludes**: Card CRUD operations (see card-lifecycle intent), impact analysis and regression guard (see impact-analysis intent).

**Assumes**: gildash is optionally available via ctx.gildash. When not configured, code binding features are disabled gracefully. Drift detection priority order is fixed and not configurable.