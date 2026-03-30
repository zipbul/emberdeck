---
{key: spec/card-interactions,summary: "Behavioral contract for checkInteractions: shared symbols, shared files, import dependencies, and undefined relation detection",status: draft,type: spec,parent: impact-analysis,boundary: [src/ops/context.ts],tags: [interactions,shared-symbols,dependencies],relations: [code-binding,structural-integrity],codeLinks: [{kind: function,file: src/ops/context.ts,symbol: checkInteractions},{kind: interface,file: src/ops/context.ts,symbol: CardInteraction},{kind: interface,file: src/ops/context.ts,symbol: InteractionResult}],glossary: [card,codeLink,relation,boundary,gildash]}
---
## Contracts

### C-01: Pairwise analysis
- **Given** a list of card keys
- **When** checkInteractions is called
- **Then** every unique pair of cards is analyzed (N choose 2 comparisons)
- **And** pairs with no interaction (no shared symbols, files, imports, or relations) are excluded from results

### C-02: Shared symbol detection
- **Given** two cards with codeLinks
- **When** their links are compared
- **Then** shared symbols are identified: same file AND same symbol name in both cards' codeLinks
- **And** results include the file path and symbol name for each shared symbol

### C-03: Shared file detection
- **Given** two cards with codeLinks
- **When** their file sets overlap
- **Then** files that appear in both cards' codeLink file sets are listed as sharedFiles
- **And** different symbols in the same file still count as a shared file

### C-04: Import dependency detection
- **Given** gildash with getDependencies support
- **When** file dependencies are analyzed
- **Then** A->B dependency: file in card A imports file in card B
- **And** B->A dependency: file in card B imports file in card A
- **And** file sets include both codeLink files and boundary-expanded files
- **And** when gildash lacks getDependencies, import analysis is skipped

### C-05: Existing relation check
- **Given** two cards
- **When** their relation status is checked
- **Then** hasRelation is true if any forward or reverse relation exists between them
- **And** this uses ctx.relationRepo.findByCardKey

### C-06: Potential conflict detection
- **Given** shared files between two cards with no defined relation
- **When** conflicts are assessed
- **Then** a warning is generated: "Cards share N file(s) but have no defined relation"

### C-07: Undefined relation suggestions
- **Given** cards with shared symbols but no relation
- **When** interaction analysis completes
- **Then** an undefinedRelation entry is added with suggestion='related'

## Failure Modes

| Violation | System Behavior |
|---|---|
| Card key not found in DB | Skipped (no links to compare) |
| gildash getDependencies unavailable | Import dependencies empty (graceful degradation) |
| gildash getDependencies throws | Error caught per-file (graceful degradation) |
| Boundary JSON parse error | Card's boundary files skipped |
| No interactions between any pair | Empty interactions array, empty undefinedRelations |