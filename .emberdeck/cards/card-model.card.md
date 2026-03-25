---
{key: card-model,summary: Two-type card system design and content rules,status: active,type: intent,parent: emberdeck,tags: [core,design],relations: [emberdeck]}
---
## Why
Two distinct knowledge types exist: upstream decisions (why/what/what-not) and downstream contracts (verifiable behaviors). Mixing them in one card type causes agents to confuse planning knowledge with implementation contracts — both degrade.

## Type separation
- **intent**: Captures decisions not visible in code. No codeLinks needed. Can be a root card (no parent).
- **spec**: Captures verifiable contracts bound to code. Requires codeLinks. Must relate to at least one intent card via relation or parent chain (enforced by validate_cards broken-chain check).

## Content rules — what NOT to put in any card
Information the agent can discover by reading the code:
- Function counts, class counts, file counts
- Directory structure, module layout
- Tech stack descriptions ("uses SQLite", "built with Bun")
- Function signatures, parameter types, return types

ETH Zurich study (ICSE JAWs 2026): auto-generated discoverable context degrades AI performance by 2-3%. Only human-authored non-discoverable content helps (28.64% faster task completion).

## Decisions
- Body is freeform markdown, not structured YAML — allows natural-language design knowledge that doesn't fit rigid schemas
- Tags are optional classification, not enforced taxonomy — keeps barrier to card creation low
- Boundary globs are optional on spec cards — not all specs map to directory subtrees
- Relations are user-declared semantic links, not auto-inferred from code dependencies