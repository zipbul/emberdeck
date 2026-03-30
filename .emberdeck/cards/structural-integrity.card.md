---
{key: structural-integrity,summary: "Design document for card hierarchy, relation graph, validation rules, activation guard, and boundary management",status: draft,type: intent,boundary: [src/card/validation.ts,src/ops/query.ts,src/ops/sync.ts,src/db/relation-repo.ts],tags: [integrity,hierarchy,validation,relations],glossary: [card,relation,boundary,activation-guard,intent,spec]}
---
## Problem & Goals

**Problem**: Cards do not exist in isolation. They form a hierarchy (parent-child) and a dependency graph (relations). Without structural validation, the card graph degrades: circular parents, orphaned specs, type hierarchy violations, and overlapping boundaries create an unreliable knowledge base.

**Who has it**: Any project with more than a handful of cards. As the card count grows, manual consistency checking becomes impossible.

**What breaks without this**: Circular parent chains cause infinite loops. Spec cards without intent parents lose their design rationale. Overlapping boundaries create ambiguous ownership. Active cards that depend on draft cards give false confidence.

**Success looks like**: The system enforces structural invariants at every mutation point. Parent hierarchy respects type rules, relations form a valid directed graph, boundaries do not overlap (except parent-child), and activation guard prevents premature activation.

## User Scenarios

### P1: Parent-child hierarchy validation
- **Given** a card is being created or updated with a parent field
- **When** the parent is specified
- **Then** the parent MUST exist in the DB
- **And** intent cards can only have intent parents
- **And** spec cards can have intent or spec parents
- **And** circular parent references are detected up to 20 levels deep

### P1: Relation graph traversal
- **Given** cards are connected via forward relations
- **When** getRelationGraph is called with a root key
- **Then** BFS traversal discovers connected cards up to maxDepth (default 3)
- **And** both forward and backward directions are supported
- **And** visited nodes are never revisited (cycle-safe)

### P1: Activation guard for spec cards
- **Given** a spec card is being set to active status
- **When** the activation-guard runs
- **Then** at least 1 codeLink must be declared
- **And** all codeLinks must resolve in gildash
- **And** if boundary patterns exist, at least 1 file must match
- **And** intent cards pass activation with no conditions

### P2: Card tree construction
- **Given** a root card with nested children
- **When** getCardTree is called
- **Then** a recursive tree structure is built up to maxDepth (default 10, capped at 20)
- **And** nodes beyond maxDepth are marked as truncated

### P2: Structural validation sweep
- **Given** the full card database
- **When** validateCards is called
- **Then** stale DB rows (no matching file) are detected
- **And** orphan files (no matching DB row) are detected
- **And** type hierarchy violations, broken parents, broken relations are reported
- **And** boundary overlaps between non-parent-child cards are detected
- **And** broken chains (spec cards with no intent relation or parent) are reported
- **And** rework dependencies (active card depending on draft card) are reported

### P2: Type change with children
- **Given** a card has children
- **When** the card's type is changed
- **Then** validateChildrenHierarchy ensures no child would violate type rules
- **And** if the card was active and new type's activation conditions are unmet, status is forced to draft

### P3: Card context retrieval
- **Given** an agent needs full context about a card
- **When** getCardContext is called with depth > 1
- **Then** the card's file content, resolved codeLinks, upstream/downstream relations, and multi-hop related cards are returned
- **And** truncation is indicated when BFS hits the depth limit

## Requirements

- **FR-001**: validateParentExists MUST throw ParentValidationError when parent key does not exist in DB.
- **FR-002**: validateParentType MUST enforce: intent parent for intent cards; intent or spec parent for spec cards.
- **FR-003**: validateParentCycle MUST detect circular references by walking the ancestor chain up to MAX_PARENT_DEPTH (20).
- **FR-004**: validateRelationTargets MUST reject self-references and non-existent targets.
- **FR-005**: getRelationGraph MUST use BFS with a visited set to prevent infinite loops in cyclic graphs.
- **FR-006**: getRelationGraph MUST support direction filtering: forward, backward, or both.
- **FR-007**: validateActivationGuard for spec cards MUST require >= 1 resolved codeLink and matching boundary files.
- **FR-008**: validateActivationGuard for intent cards MUST be a no-op (always passes).
- **FR-009**: validateCards MUST detect boundary overlaps using sample-path-based heuristic (generateSamplePaths + cross-test).
- **FR-010**: validateCards MUST detect broken chains: spec cards with no relation or parent link to any intent card.
- **FR-011**: validateCards MUST detect content mismatches between DB and file (status, summary, glossary).
- **FR-012**: getCardTree MUST cap depth at 20 regardless of input to prevent stack overflow.
- **FR-013**: Relation insertion MUST auto-generate reverse (isReverse=true) entries for bidirectional traversal.

## Success Criteria

- Zero circular parent chains in the card database at any point in time.
- Every spec card is reachable from at least one intent card via relation or parent chain.
- Boundary overlaps between non-parent-child cards are always detected and reported.
- Activation guard prevents any spec card from reaching active status without resolved code bindings.

## Scope & Constraints

**Covers**: Parent-child hierarchy, relation graph (BFS), activation guard, card tree, structural validation, type change validation, card context retrieval, boundary overlap detection.

**Excludes**: Card CRUD mechanics (see card-lifecycle intent), drift detection (see code-binding intent), impact analysis (see impact-analysis intent).

**Assumes**: Relations are stored with both forward and auto-generated reverse entries. BFS maxDepth defaults to 3 for relation graph, 10 for card tree. Boundary overlap uses heuristic sample paths, not exhaustive matching.