---
{key: policy-card-key-safety,summary: "Card slugs are validated against a strict regex to prevent path traversal, Windows drive paths, and filesystem collisions",status: draft,type: decision,priority: critical,acceptance: [{id: ac-1,description: "normalizeSlug rejects empty strings, relative paths (..), Windows drive letters, double colons, and colons",verified: false},{id: ac-2,description: Every ops-layer function that accepts a fullKey calls parseFullKey before constructing a file path,verified: false},{id: ac-3,description: buildCardPath only receives already-validated slugs (never raw user input),verified: false}],keywords: [slug,normalizeSlug,parseFullKey,CARD_SLUG_RE,path-traversal],tags: [policy,security,critical-invariant],codeLinks: [{kind: function,file: src/card/card-key.ts,symbol: normalizeSlug},{kind: function,file: src/card/card-key.ts,symbol: parseFullKey},{kind: function,file: src/card/card-key.ts,symbol: buildCardPath},{kind: class,file: src/card/card-key.ts,symbol: CardKeyError}]}
---
## Policy

Every card key entering the system must pass through `normalizeSlug` or `parseFullKey`, which enforces `CARD_SLUG_RE`. No operation may construct a card file path from an unnormalized slug.

## Allowed characters

`[A-Za-z0-9._-]` segments separated by `/`. No leading/trailing slashes, no `..`, no `::`, no `:`, no `//`, no Windows drive letters (`C:`).

## Normalization

Backslashes are converted to forward slashes. Leading and trailing slashes are stripped. The result is then validated.

## What breaks if violated

- Path traversal: a slug like `../../etc/passwd` could read or write arbitrary files.
- Windows drive path collision: `C:secret` would be misinterpreted.
- Empty slugs produce broken file paths.
- Double slashes or dots create ambiguous directory structures.

## Exclusions

- The regex does NOT enforce max length; that is handled separately by `LIMITS` in validation.ts.
- Subdirectory slugs like `api/rate-limit` are allowed and produce nested card files.