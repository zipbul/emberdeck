# Changelog

## Unreleased — source-as-SoT refactor

### Breaking changes

- **Card schema:** removed `codeLinks`, `boundary`, `spec.{preconditions,postconditions,invariants,state_transitions}.binds`, `spec.failures.exception`, `spec.code_patterns`. Source `@spec card-key` JSDoc annotations are now the single source of truth for the card↔source binding; the DB `code_link` table is a cache populated by `ed spec sync`.
- **CLI:** `ed spec annotate` (and the corresponding `writeSpecAnnotations` op) removed. Source is authored by humans; only the cache direction (`ed spec sync` / `ed spec sync-symbols`) remains.
- **Drift detection:** the `DriftType` union shrank from six to two — `broken_link` and `glossary_broken`. `boundary_inactive`, `symbol_changed`, `heritage_uncovered`, `pattern_violation` and their related `DriftCard` fields (`symbolChanges`, `uncoveredSubclasses`, `patternViolations`, `patternErrors`) are gone.
- **`preChangeCheck`:** `AffectedCard.linkType` no longer carries `'boundary'`; the union is now `'direct' | 'transitive'`.
- **`AnalyzeHealth`:** `staleBoundary` field removed.
- **DB schema:** the drizzle migration history was collapsed into a single `0000_init.sql` reflecting the current schema (no `boundary_json`, no historical incremental files). No production users exist yet, so preserving the upgrade path was not worth the carrying cost.
- **Errors:** `BoundaryValidationError` class removed and dropped from the CLI error-code map.
- **Validation:** `validateCardInput`'s `boundary` / `codeLinks` parameters and the `LIMITS.BOUNDARY_*` / `LIMITS.CODE_LINK_*` constants are gone.

### Migration

1. Pull the new schema; existing card files containing `codeLinks` / `boundary` / `binds` / `exception` / `code_patterns` still parse (those keys are ignored by the new normalizer) but `ed card export` will rewrite them without those fields on the next round-trip. To clean up explicitly run `ed bulk sync` followed by `ed card export <key> --in-place` for each card.
2. Anywhere your source previously expected `ed spec annotate` to inject `@spec` tags, author the `/** @spec card-key */` JSDoc by hand. Then `ed spec sync` populates the cache.
3. CI / scripts that called `ed spec annotate` should drop that step.

### Internal

- Strict lint: `noUnusedLocals` and `noUnusedParameters` are now enabled in `tsconfig.json`.
- Dead detectors (`boundary_inactive`, `symbol_changed`, `heritage_uncovered`, `pattern_violation`) and their helpers were purged from `src/ops/context.ts`, `src/ops/analyze.ts`, `src/ops/impact.ts`, `src/ops/sync.ts`, and `src/ops/spec-sync.ts`.
- The 45 self-cards under `.emberdeck/cards/` and `.emberdeck/glossary.yaml` were rewritten to describe the source-as-SoT model.
