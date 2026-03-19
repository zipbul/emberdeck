---
{key: policy-size-limits,summary: All card fields are bounded by fixed size limits enforced at the ops layer; violations are rejected before any write,status: draft,type: decision,priority: high,acceptance: [{id: ac-1,description: createCard and updateCard call validateCardInput before any DB or file write,verified: false},{id: ac-2,description: Empty summary is rejected even when other fields are valid,verified: false},{id: ac-3,description: Array fields exceeding 100 items are rejected,verified: false}],keywords: [LIMITS,validateCardInput,CardValidationError,size-limit],tags: [policy,validation,limits],codeLinks: [{kind: function,file: src/card/validation.ts,symbol: validateCardInput},{kind: variable,file: src/card/validation.ts,symbol: LIMITS},{kind: class,file: src/card/errors.ts,symbol: CardValidationError}]}
---
## Policy

`validateCardInput` enforces per-field size limits on every create and update operation. Validation runs BEFORE any DB transaction or file write. Only the first violation is reported (fail-fast, ordered check).

## Limits

| Field | Limit |
|-------|-------|
| summary | 500 chars, must not be empty |
| body | 100,000 chars |
| keywords | 100 items, each <= 100 chars, no empty items |
| tags | 100 items, each <= 100 chars, no empty items |
| relations | 100 items, target <= 200 chars |
| codeLinks | 100 items, symbol <= 200 chars, file <= 500 chars |

## Validation order

summary -> body -> keywords -> tags -> relations -> codeLinks. The first violation throws `CardValidationError`; subsequent fields are not checked.

## What breaks if violated

- Unbounded summary or body could exhaust SQLite storage or FTS indexing memory.
- Unbounded arrays could degrade relation graph traversal and classification query performance.
- Empty summary means the card has no human-readable identity in list/search results.

## Exclusions

- `undefined` fields are skipped (partial update semantics in `updateCard`).
- Slug length is NOT validated here — the slug regex in card-key.ts handles slug validity.
- `constraints` is free-form and has no size limit; it is stored as JSON.