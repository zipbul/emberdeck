---
{key: spec/card-data-model,summary: "Behavioral contract for card types, frontmatter schema, DB schema tables, markdown serialization, and card key normalization",status: draft,type: spec,parent: card-lifecycle,boundary: [src/card/types.ts,src/card/card-key.ts,src/card/markdown.ts,src/card/errors.ts,src/db/schema.ts,src/db/repository.ts],tags: [schema,types,model,serialization],relations: [structural-integrity],codeLinks: [{kind: type,file: src/card/types.ts,symbol: CardStatus},{kind: type,file: src/card/types.ts,symbol: CardType},{kind: interface,file: src/card/types.ts,symbol: CodeLink},{kind: interface,file: src/card/types.ts,symbol: CardFrontmatter},{kind: interface,file: src/card/types.ts,symbol: CardFile},{kind: interface,file: src/db/repository.ts,symbol: CardRepository},{kind: interface,file: src/db/repository.ts,symbol: RelationRepository},{kind: interface,file: src/db/repository.ts,symbol: CodeLinkRepository},{kind: interface,file: src/db/repository.ts,symbol: CardRow}],glossary: [card,intent,spec,codeLink,boundary,relation,card-status,dual-storage]}
---
## Contracts

### C-01: Card status type constraint
- **Given** the CardStatus type
- **When** any card status value is assigned
- **Then** it MUST be one of: 'draft', 'active', 'drifted'
- **And** draft = authoring in progress, codeLinks treated as planned
- **And** active = code and spec structurally aligned
- **And** drifted = code has diverged, system auto-detected

### C-02: Card type constraint
- **Given** the CardType type
- **When** any card type is assigned
- **Then** it MUST be one of: 'intent', 'spec'
- **And** intent = upstream decisions (why, scope, constraints), not bound to code
- **And** spec = downstream contracts (verifiable behaviors), bound to code via codeLinks

### C-03: CodeLink structure
- **Given** a CodeLink object
- **When** it is defined
- **Then** it MUST have kind (gildash SymbolKind string), file (relative path), and symbol (exact name)

### C-04: CardFrontmatter required fields
- **Given** a CardFrontmatter object
- **When** it is serialized to YAML
- **Then** key, summary, status, and type MUST always be present
- **And** parent, boundary, relations, codeLinks, tags, glossary are optional

### C-05: CardFile composition
- **Given** a CardFile object
- **When** it represents a complete card
- **Then** it MUST have frontmatter (CardFrontmatter) and body (string)
- **And** filePath is optional (set when read from/written to disk)

### C-06: DB schema foreign keys and cascades
- **Given** the SQLite schema
- **When** a card is deleted
- **Then** card_tag entries CASCADE delete
- **And** card_relation entries CASCADE delete (both src and dst)
- **And** code_link entries CASCADE delete
- **And** card_changelog entries CASCADE delete
- **And** card.parent is SET NULL on parent deletion

### C-07: Relation bidirectional storage
- **Given** the card_relation table
- **When** a forward relation is inserted from A to B
- **Then** a reverse relation (isReverse=true) MUST also be inserted from B to A (auto-generated)
- **And** the unique index prevents duplicate (srcCardKey, dstCardKey, isReverse) triples

### C-08: Repository interface contracts
- **Given** the CardRepository interface
- **When** findByKey returns null, the card does not exist
- **And** upsert MUST create or update the row
- **And** list MUST support filters: status, type, parent, tag, roots, updatedSince, sortBy
- **And** search MUST use FTS5 for full-text search
- **And** findChildren MUST return all cards with parent=key

### C-09: CodeLinkRepository lookup methods
- **Given** the CodeLinkRepository interface
- **When** findBySymbol is called with symbolName and optional filePath
- **Then** it returns all codeLink rows matching the symbol (filtered by file if provided)
- **And** findByFile returns all codeLinks referencing a specific file path

## Failure Modes

| Violation | System Behavior |
|---|---|
| Invalid card status value | TypeScript compile error (union type constraint) |
| Invalid card type value | TypeScript compile error (union type constraint) |
| Missing required frontmatter field | parseCardMarkdown throws CardValidationError |
| FK violation on relation insert | Insert silently fails (replaceForCard returns failed keys) |
| Duplicate unique index violation | SQLite error (caught by caller) |