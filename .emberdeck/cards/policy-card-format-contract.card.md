---
{key: policy-card-format-contract,summary: "Card files use YAML frontmatter + markdown body; the parser rejects multi-document YAML, missing frontmatter fences, and invalid field types",status: draft,type: decision,priority: medium,acceptance: [{id: ac-1,description: parseCardMarkdown throws CardValidationError when frontmatter fences are missing or unterminated,verified: false},{id: ac-2,description: Multi-document YAML (array at top level) is explicitly rejected with a descriptive error,verified: false},{id: ac-3,description: CRLF line endings are normalized to LF before parsing,verified: false}],keywords: [parseCardMarkdown,serializeCardMarkdown,frontmatter,YAML,card-format],tags: [policy,format,parsing],codeLinks: [{kind: function,file: src/card/markdown.ts,symbol: parseCardMarkdown},{kind: function,file: src/card/markdown.ts,symbol: serializeCardMarkdown}]}
---
## Policy

A valid `.card.md` file has exactly this structure:
```
---
<YAML frontmatter>
---
<markdown body>
```

The parser (`parseCardMarkdown`) enforces:
- First line must be `---`.
- A closing `---` must exist.
- YAML must parse to a single object (not an array, not multi-document).
- Required fields: `key` (non-empty string), `summary` (non-empty string), `status` (one of the CardStatus enum values).
- Optional typed fields: `type`, `priority`, `acceptance`, `tags`, `keywords`, `constraints`, `relations`, `codeLinks`.
- Each optional field has strict type coercion (e.g., `keywords` can be a string and gets wrapped in an array; `tags` must be an array).

## Serialization

`serializeCardMarkdown` produces the canonical format. Frontmatter is YAML-stringified, trimmed, and wrapped in `---` fences. The body follows the closing fence.

## Newline normalization

All `\r\n` sequences are normalized to `\n` before parsing. The system is CRLF-tolerant but stores LF-only.

## What breaks if violated

- A file without frontmatter fences cannot be parsed and will crash `syncCardFromFile` and `readCardFile`.
- Invalid field types cause `CardValidationError` at parse time, preventing the card from loading.
- Multi-document YAML would silently drop all documents after the first if not explicitly rejected.

## Exclusions

- The body is free-form markdown with no validation. It can be empty.
- `constraints` is free-form (stored as `unknown`). No type checking beyond JSON serializability.