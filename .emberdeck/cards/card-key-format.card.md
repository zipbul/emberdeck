---
{key: card-key-format,summary: "Slug regex, normalization rules, and path computation contract",status: active,type: spec,parent: card-model,boundary: [src/card/card-key.ts],codeLinks: [{kind: function,file: src/card/card-key.ts,symbol: normalizeSlug},{kind: function,file: src/card/card-key.ts,symbol: buildCardPath},{kind: function,file: src/card/card-key.ts,symbol: parseFullKey},{kind: class,file: src/card/card-key.ts,symbol: CardKeyError}],tags: [contract],relations: [card-model]}
---
## Contracts
- WHEN slug contains characters outside [a-zA-Z0-9._/-] THEN reject with CardKeyError
- WHEN slug contains Windows drive paths (C:), relative paths (..), or double colons (::) THEN reject
- WHEN slug has backslashes THEN normalize to forward slashes
- WHEN slug has leading/trailing slashes THEN strip them
- WHEN buildCardPath called THEN result is `{cardsDir}/{normalizedSlug}.card.md`
- WHEN parseFullKey called THEN returns the key portion after any prefix processing

## Cross-module contracts
- Card key MUST match file path slug — enforced by rename operation via FK CASCADE UPDATE
- normalizeSlug is called during create and rename, before any DB or file operation
- The slug regex (CARD_SLUG_RE) is the single source of truth for key validity across the entire system