# REMAIN — Production-Readiness Audit

Initial audit: 23 issues found. All 23 fixed.

## Status

| # | Severity | Summary | Status |
|---|----------|---------|--------|
| 01 | CRITICAL | `renameCard` destroys incoming relations | **FIXED** — FK CASCADE UPDATE |
| 02 | CRITICAL | Mutual same-type relations crash | **FIXED** — migration 0005 |
| 03 | CRITICAL | `tsc` build fails (15 type errors) | **FIXED** |
| 04 | HIGH | `updateCardStatus` no transaction | **FIXED** |
| 05 | HIGH | `deleteCard` no transaction | **FIXED** |
| 06 | HIGH | Duplicate codeLinks crash | **FIXED** — dedup in replaceForCard |
| 07 | HIGH | FTS malformed query crash | **FIXED** — try/catch with empty result |
| 08 | HIGH | `validateCards` nested key false positive | **FIXED** — `relative()` instead of `basename()` |
| 09 | HIGH | Empty keyword API/file inconsistency | **FIXED** — empty string check in validateCardInput |
| 10 | HIGH | `checkDrift` wrong property (`mtime` → `mtimeMs`) | **FIXED** |
| 11 | HIGH | `checkInteractions` missing import | **FIXED** |
| 12 | HIGH | Config `limits`/`statuses`/`cardExtension` not wired | **FIXED** — dead fields removed |
| 13 | MEDIUM | `removeCardByFile` orphan leak | **FIXED** — pruneOrphans added |
| 14 | MEDIUM | `updateCard` changelog missing fields | **FIXED** — relations/keywords/tags/codeLinks logged |
| 15 | MEDIUM | `renameCard` changelog ID regeneration | **FIXED** — resolved by TODO-01 CASCADE UPDATE |
| 16 | MEDIUM | `generateContext` N×3 DB queries | **FIXED** — rowCache Map |
| 17 | MEDIUM | `getRelationGraph` default `maxDepth: Infinity` | **FIXED** — default 3 |
| 18 | MEDIUM | `bulkSyncCards` no concurrency limit | **FIXED** — batch size 20 |
| 19 | MEDIUM | MCP server no graceful shutdown | **FIXED** — SIGINT/SIGTERM handlers |
| 20 | MEDIUM | `cli.ts` Korean characters | **FIXED** — translated to English |
| 21 | LOW | `console.warn` in repos | **FIXED** — removed |
| 22 | LOW | `package.json` exports `.ts` source | **FIXED** — `bun` + `import` + `types` conditions |
| 23 | LOW | `McpServerLike` `Function` type | **FIXED** — eslint-disable, kept for SDK compat |

