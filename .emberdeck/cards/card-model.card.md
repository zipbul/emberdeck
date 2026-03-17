---
{key: card-model,summary: "Card domain model — types, key normalization, markdown serialization, validation, error hierarchy",status: draft,type: feature,priority: critical,acceptance: [{id: AC1,description: parseCardMarkdown round-trips with serializeCardMarkdown for all valid card structures,verified: false},{id: AC2,description: "normalizeSlug rejects invalid slugs (empty, .., consecutive separators, drive letters) and normalizes backslashes",verified: false},{id: AC3,description: validateCardInput enforces LIMITS and reports first violation in field order,verified: false},{id: AC4,description: All error classes extend Error with .name matching class name,verified: false},{id: AC5,description: Optional frontmatter fields omitted from YAML when empty/undefined (clean serialization),verified: false}],keywords: [card,domain,types,slug,markdown,frontmatter,validation,errors],tags: [core,domain],codeLinks: [{kind: interface,file: src/card/types.ts,symbol: CardFrontmatter},{kind: function,file: src/card/card-key.ts,symbol: normalizeSlug},{kind: function,file: src/card/card-key.ts,symbol: parseFullKey},{kind: function,file: src/card/markdown.ts,symbol: parseCardMarkdown},{kind: function,file: src/card/markdown.ts,symbol: serializeCardMarkdown},{kind: function,file: src/card/validation.ts,symbol: validateCardInput},{kind: class,file: src/card/errors.ts,symbol: CardNotFoundError}]}
---
## Why

The domain model is deliberately DB-agnostic and I/O-free. All types are pure data structures. This allows the card layer to be tested without a database, used in browser contexts, and composed independently of persistence decisions.

Acceptance criteria are mandatory at card creation time (enforced in ops layer, not here) because a card without completion conditions cannot drive planning — it becomes unmeasurable noise.

Constraints are schema-free (any JSON-serializable value) because constraint shapes are domain-specific (performance SLAs, compliance rules, security mandates). Emberdeck cannot anticipate all schemas.

## Invariants

- Card keys must match `CARD_SLUG_RE`: lowercase alphanumeric, hyphens, underscores, dots, forward slashes. No consecutive separators, no `..` paths, no Windows drive letters (`C:`), no leading/trailing slashes.
- `normalizeSlug` and `parseFullKey` are idempotent: calling twice produces identical output.
- `parseCardMarkdown(serializeCardMarkdown(card))` round-trips without data loss for all valid structures.
- Every error class has `.name` matching the class name (enables `error.name === 'CardNotFoundError'` checks).
- YAML frontmatter requires exactly `key`, `summary`, `status`. All other fields optional.
- Validation enforces LIMITS: summary ≤500, body ≤100K, arrays ≤100 items, keyword/tag items ≤100 chars, relation targets ≤200 chars, codeLink symbols ≤200 chars, codeLink files ≤500 chars. Acceptance has NO limit (planning depth is unbounded).
- Validation checks fields in order (summary→body→keywords→tags→relations→codeLinks) and reports the first violation only.

## Scope Boundaries

- Does NOT validate relation types — that's ops layer concern (`allowedRelationTypes`).
- Does NOT resolve code links against the codebase — gildash integration is ops layer.
- Does NOT enforce card key uniqueness — that's DB's PRIMARY KEY.
- Does NOT enforce status transitions — all 5 statuses are equally reachable from any other.
- Does NOT limit acceptance criteria count.
- Does NOT validate acceptance criterion ID format (any string is valid).

## Edge Cases

- Slugs with backslashes normalize: `foo\bar/baz` → `foo/bar/baz`.
- Single-character slugs (`a`, `1`) are valid. Arbitrary nesting depth (`a/b/c/d`) allowed.
- CRLF line endings normalized to LF before YAML parsing.
- Empty body after frontmatter is valid (body = empty string, not null).
- `acceptance: []` is valid and distinct from `acceptance: undefined`.
- Frontmatter with unknown fields is preserved (pass-through, no stripping).
- Keywords accept single string input (coerced to 1-element array).
- `acceptance[].verified` defaults to `false` if omitted (checked `=== true`).
- Constraints can be primitives (`42`, `"hello"`) — no type enforcement.