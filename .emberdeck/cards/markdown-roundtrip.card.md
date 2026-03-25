---
{key: markdown-roundtrip,summary: Parser-serializer round-trip equivalence contract,status: active,type: spec,parent: data-integrity,boundary: [src/card/markdown.ts],tags: [contract],relations: [data-integrity,sync-file-authority],codeLinks: [{kind: function,file: src/card/markdown.ts,symbol: parseCardMarkdown},{kind: function,file: src/card/markdown.ts,symbol: serializeCardMarkdown}]}
---
## Contracts
- WHEN serialize then parse THEN all frontmatter fields are preserved identically (key, summary, type, status, parent, relations, codeLinks, boundary, tags)
- WHEN parse then serialize THEN body whitespace may be normalized but content is preserved
- WHEN frontmatter contains optional fields set to null/empty THEN they are omitted from serialized output (no `parent: null` in YAML)
- WHEN codeLinks serialized THEN field order is kind, file, symbol (consistent for version control diffs)
- WHEN body is empty string THEN serialized card has frontmatter only, no trailing body section

## Failure modes
| Symptom | Cause | Resolution |
|---------|-------|------------|
| Fields silently lost after save-reload cycle | Serializer omits a field that parser expects | Add round-trip test case for the field |
| Spurious file diffs on every sync | Serializer produces different whitespace/ordering than original | Normalize serialization order to match parser expectations |
| DB-file inconsistency after bulk sync | Parser reads corrupted frontmatter, syncs wrong data to DB | Validate parsed output before writing to DB |

## Cross-module contracts
- syncCardFromFile depends on parseCardMarkdown — if parser breaks, sync propagates corrupt data to DB
- Every CRUD write op depends on serializeCardMarkdown — if serializer breaks, file content diverges from DB
- exportCardToFile uses serializeCardMarkdown to regenerate file from DB state — must produce parseable output