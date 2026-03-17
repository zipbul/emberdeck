---
{key: card-model,summary: "Card data model: types, key format, markdown serialization, and validation rules",status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: "Card key is a slug: alphanumeric, hyphens, underscores, dots, slashes. No Windows drive paths, no relative traversal (..), no empty segments.",verified: true},{id: ac-2,description: Backslashes in slugs are normalized to forward slashes; leading/trailing slashes are stripped.,verified: true},{id: ac-3,description: "Card file format is YAML frontmatter (--- delimited) followed by markdown body.",verified: true},{id: ac-4,description: "Frontmatter requires key, summary, status. Optional: type, priority, acceptance, tags, keywords, constraints, relations, codeLinks.",verified: true},{id: ac-5,description: "CardStatus lifecycle: draft -> accepted -> implementing -> implemented -> deprecated.",verified: true},{id: ac-6,description: "Validation limits exist for summary length, body length, keyword count, tag count, relation count, codeLink count (defined in LIMITS).",verified: true},{id: ac-7,description: "parseCardMarkdown performs strict coercion: unknown YAML fields are ignored, invalid enums throw CardValidationError.",verified: true}],keywords: [CardFrontmatter,CardFile,CardStatus,CardType,normalizeSlug,parseFullKey,buildCardPath,parseCardMarkdown,serializeCardMarkdown],tags: [core,data-model],codeLinks: [{kind: type,file: src/card/types.ts,symbol: CardFrontmatter},{kind: type,file: src/card/types.ts,symbol: CardFile},{kind: type,file: src/card/types.ts,symbol: CardStatus},{kind: function,file: src/card/card-key.ts,symbol: normalizeSlug},{kind: function,file: src/card/card-key.ts,symbol: parseFullKey},{kind: function,file: src/card/card-key.ts,symbol: buildCardPath},{kind: function,file: src/card/markdown.ts,symbol: parseCardMarkdown},{kind: function,file: src/card/markdown.ts,symbol: serializeCardMarkdown},{kind: function,file: src/card/validation.ts,symbol: validateCardInput}]}
---
## Rationale

The card is the atomic unit of design knowledge. Its format must be both human-readable (markdown files in git) and machine-queryable (SQLite). The YAML frontmatter + markdown body format was chosen because:

- Git-friendly: diffs are meaningful, merge conflicts are resolvable
- Human-editable: developers can read/write cards without tooling
- Structured: frontmatter enables typed queries and validation

## Key Invariants

- **Key = file path**: `buildCardPath(cardsDir, key)` always produces `{cardsDir}/{key}.card.md`. There is no separate "name" field.
- **Slug regex**: `CARD_SLUG_RE` prevents path traversal attacks and Windows drive paths. This is a security boundary.
- **Newline normalization**: All `\r\n` converted to `\n` before parsing. Cards are always stored with Unix line endings.
- **YAML parser**: Uses `Bun.YAML.parse` (not a third-party lib). Multi-document YAML is explicitly rejected.
- **Coercion, not validation-only**: `coerceFrontmatter` normalizes loose input (e.g., single string keyword -> array) rather than rejecting it. This improves UX for manual edits.

## Scope Boundaries

- This card covers the data model and serialization only. CRUD operations are in `card-crud`.
- The `constraints` field is intentionally `unknown` — no schema enforcement. It exists for project-specific metadata.
- `acceptance[].verified` defaults to `false` on parse. There is no "partial" state.

## Edge Cases

- Empty body is valid (stored as empty string, not null).
- Tags and keywords are case-sensitive. No automatic lowercasing.
- The `key` field in frontmatter must match the file path slug. Mismatches are detected during sync operations, not at parse time.
