# Envelope-Removal Redesign — Execution Plan

**Status**: Phase 1.2 complete. Phase 2+ pending. Cards are ahead of code.
**Last commit**: `f96a50d refactor(cards): rewrite output contract for per-command shapes`
**Resume from**: this document + the two cards rewritten in Phase 1.2.

---

## 0. Motivation

11 rounds of hostile review against the v1 envelope `{schemaVersion, status, data, warnings, errors, error?}` produced a recurring defect class:

- `errors[]` mixed three distinct concerns (per-link broken / structural skip / transient I/O) → every round surfaced a new defect inside that mixing
- `data` was polymorphic per command anyway → the wrapper added ceremony without true uniformity
- Exit code semantics tied to envelope `status` diverged between commands → CI gating was per-command anyway
- Auto-sync warnings (CARD_SYNC_FAILED) on stdout polluted the data channel; required a dedup mechanism (INV-003) to avoid double-reporting under `ed bulk sync`

Three independent hostile review rounds converged on: **the meta-pattern is that introspection of `validate.ts` for model purity manufactures defects.** Two redesigns (per-card data, `operation_kind` field) were also demolished by hostile review.

Final design (per-command natural shapes, stderr for cross-cutting) was attacked by another hostile round that surfaced 18 unspecified invariants. We accepted those (truth tables, derivation rules, etc.) and committed to the redesign.

---

## 1. Final Design (committed in Phase 1.2)

### 1.1 Channel responsibilities

| channel | content | format |
|---|---|---|
| **stdout** (success) | command's natural data shape | JSON |
| **stdout** (failure) | empty | n/a |
| **stderr** (cross-cutting) | auto-sync per-file failures | JSON-lines: `{"code":"CARD_SYNC_FAILED","message":"path: reason"}` |
| **stderr** (failure) | human-readable error line | text |
| **stderr** (verbose) | structural traces | text |
| **exit code** | per-command policy, from EXIT enum | int |

### 1.2 What is removed (from v1 envelope)

- `schemaVersion` field
- `status: "ok" \| "partial" \| "error" \| "unknown"` field
- `data` wrapper around the actual payload
- top-level `warnings: CliMessage[]`
- top-level `errors: CliMessage[]`
- `error?: CliError` field
- `CliResult` type
- `CliMessage` type
- `ok()` / `partial()` / `err()` / `unknown()` builder functions
- `render()` function
- `statusToExitCode()` function
- `mergeCardSyncWarnings()` function (CARD_SYNC_FAILED now stderr; no dedup)

### 1.3 What replaces them

- `emitResult(data: unknown): void` — `JSON.stringify(data)` to stdout, no wrapper
- `emitError(message: string, exitCode: number): never` — single line to stderr, `process.exit(code)`
- `emitWarning(obj: { code: string; message: string; details?: unknown }): void` — JSON-line to stderr
- `mergeCardSyncWarnings` → replaced by direct stderr emission of CARD_SYNC_FAILED lines from `ensureCardsSynced` failures (runner does the loop)

### 1.4 Per-command exit code policy

Each command's spec card declares the closed set of exit codes it can produce. The runner's `toCliError → EXIT` mapping is the single source for thrown-error codes. Commands that complete normally but want a non-zero exit (e.g. `ed validate links` with broken links) call `emitResult(data); process.exit(2)` explicitly.

EXIT enum (`src/cli/exit-codes.ts`, unchanged):
```
OK: 0
GENERIC_ERROR: 1
VALIDATION_FAILURE: 2
NOT_FOUND: 3
CONFLICT: 4
PERMISSION_OR_IO: 5
CONFIG_MISSING: 6
TRANSIENT: 7
SIGINT: 130
```

### 1.5 Per-command natural shapes (representative samples)

```
ed card get <key>           → CardFile object (frontmatter fields at top level)
ed card list                → CardRow[] or { items, total, limit, offset } if paginated
ed card create              → { key, type, status, parent, filePath }
ed card delete              → { key, deleted: boolean, cascaded?: string[] }
ed card rename              → { old_key, new_key, old_path, new_path, failed_reference_updates }
ed card export              → string (the markdown text) when --out STDOUT, else { filePath }
ed card search              → CardRow[]
ed card tree                → tree-shaped { key, children: [...] }
ed card context             → { card, relations, parent_chain }
ed card relations           → { forward: [...], reverse: [...] }
ed card set-status          → { key, status }
ed validate cards           → { issues: [{ code, message, key?, file_path? }], total }
ed validate links [key]     → { items: [{key, declared, resolved, broken_links?, ...}], summary }
ed validate                 → { cards: <validate cards shape>, links: <validate links shape> }
ed check drift [key]        → { cards: [{key, driftType?, driftTypes?, brokenLinks, totalLinks}], health }
ed check coverage <key>     → { key, declared, resolved, broken, coverage_ratio, unreferenced }
ed check coverage --uncovered → { total_symbols, covered, ratio, uncovered: [...] }
ed check coverage --suggest → { suggestions: [...], total }
ed check impact <files...>  → { risk_level, affected_count, affected_cards, ... }
ed check regression <files> → { pass_or_fail, drifted_ratio, threshold, affected }
ed check interactions       → { interactions, undefined_relations }
ed spec sync                → { created, alreadyLinked, unmatched, markerMissing, linkMissing }
ed spec sync-symbols        → { applied: [...], skipped: [...] }
ed bulk create --from FILE  → { created: [...], failed: [{file, error}], total }
ed bulk sync [path]         → { synced, failed: [{file, error}] }
ed analyze                  → { health, coverage, drift, glossary, unlinked_symbols }
ed init                     → { project_root, cards_dir, config_path, glossary_path, created, skipped, gitignore_updated }
ed reset                    → { cards_deleted, glossary_cleared, db_reset }
ed glossary define          → { defined: [{word, definition}], errors? }
ed glossary lookup [word]   → { word, definition } or { entries: [{word, definition}] }
ed glossary remove          → { word, affected_card_keys }
ed glossary rename          → { old_word, new_word, affected_card_keys }
```

(Each command's spec card formalizes its shape.)

---

## 2. Phase Breakdown

### Phase 1 — Cards (SSOT first)

#### 1.1 Rename brief/spec keys ✅ DONE (commit 072d2c7)
- `cli-surface/command-routing-and-envelope` → `cli-surface/command-routing-and-output`
- Spec parent rename via `ed card rename` (FK cascade)
- Sed-replace 5 stale string references in cards + source files

#### 1.2 Rewrite brief + main spec content ✅ DONE (commit f96a50d)
- Brief goals/policy/rationale flipped from envelope to per-command shapes
- Spec POST/INV rewritten for emitResult/emitError/emitWarning
- `card-storage/persistence/sync` POST-005 + failure entries updated: CARD_SYNC_FAILED is stderr JSON-line

#### 1.3 Per-command spec cards: response_shape postconditions ⏳ PENDING
For each spec card below, add (or rewrite) a POST that says "stdout JSON of shape X" with shape declared in the spec body. Use `<self_review>` + `ed card update --patch` per skill workflow.

Cards to update:
- `card-lifecycle/mutation-workflows/create-card.md`
- `card-lifecycle/mutation-workflows/update-card.md`
- `card-lifecycle/mutation-workflows/delete-rename-bulk.md`
- `card-lifecycle/status-and-safe-write/update-card-status.md`
- `card-lifecycle/status-and-safe-write/safe-write.md`
- `card-storage/queries/get-list-search.md`
- `card-storage/queries/tree-context.md`
- `card-storage/persistence/db-connection.md`
- `code-binding/link-and-coverage/resolve-and-validate.md`
- `code-binding/link-and-coverage/coverage.md`
- `code-binding/annotation-roundtrip/annotate-and-sync.md`
- `analysis/drift-detection/check-drift.md` (already updated for read-only; needs shape POST)
- `analysis/impact-and-aggregate/impact-and-regression.md`
- `analysis/impact-and-aggregate/interactions-and-analyze.md`
- `glossary/lifecycle/define-and-lookup.md`
- `glossary/lifecycle/remove-rename-reset.md`
- `glossary/cross-card-validation/validate-and-match.md`
- `cli-surface/project-setup/setup-config-root.md` (covers ed init, ed reset)

For each: GATE = `ed validate cards` warnings 0.

#### 1.4 SKILL.md rewrite ⏳ PENDING
Rewrite sections:
- `<commands>` table: each row's "사용자 확인" column unchanged, but reshape descriptions to reference per-command shapes not envelope
- Remove the global envelope description "출력은 항상 JSON 봉투 ..."
- Replace `<response_shapes>` with per-command shape index pointing to spec cards
- Update `<error_recovery>` envelope codes table (CARD_SYNC_FAILED → stderr; VALIDATION_FAILED still emitted by validate-family inside stdout shape)
- Add `<stderr_format>` section documenting JSON-lines format for CARD_SYNC_FAILED and free-form text for error lines

### Phase 2 — Code (atomic flag day)

Phase 2 MUST be a single coherent commit. Cannot ship intermediate state because every command file depends on `ok()`/`partial()` from output.ts. Estimate: ~30 files.

#### 2.1 `src/cli/output.ts` complete rewrite
Replace entire file:
```typescript
import { EXIT } from './exit-codes';

export function emitResult(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function emitError(message: string, exitCode: number = EXIT.GENERIC_ERROR): never {
  process.stderr.write(message + '\n');
  process.exit(exitCode);
}

export function emitWarning(obj: { code: string; message: string; details?: unknown }): void {
  process.stderr.write(JSON.stringify(obj) + '\n');
}

// Quiet-mode collapse helper (per-command applies). Replaces resolveOutputMode.
export interface OutputContext { quiet: boolean }
export function buildOutputContext(flags: { quiet?: boolean }): OutputContext {
  return { quiet: !!flags.quiet };
}
```

Remove: `CliResult`, `CliMessage`, `CliError`, `SCHEMA_VERSION`, `ok`, `partial`, `err`, `unknown`, `render`, `statusToExitCode`, `resolveOutputMode`, `ERROR_CODE_TO_EXIT` (move to errors.ts if still needed).

#### 2.2 `src/cli/runner.ts` rewrite
- Replace `run(fn, cmd, opts)` signature: `fn` now returns `unknown` (the data) or `void`/`never` (the command handled emission itself)
- On success path: `const data = await fn(rt); emitResult(data);` (if data !== undefined)
- On catch path: `emitError(message, exitCode)` via toCliError mapping
- Auto-sync failures: stream to stderr via `emitWarning` as they're collected (not at end of run)
- Remove `mergeCardSyncWarnings` function and call site

#### 2.3 Each `src/cli/commands/*.ts` rewrite (~25 files)
Per command:
- Change `return ok(data)` → `return data`
- Change `return partial(data, errors)` → call `emitResult(data); process.exit(2)` OR include partial info inside `data` shape
- Change `throw new CliUsageError(...)` → unchanged, runner maps to exit 2

For each command, the resulting shape must match its spec card's POST.

Files:
- bulk.ts
- card.ts
- check.ts
- glossary.ts
- single.ts (init, analyze, reset)
- spec.ts
- validate.ts

#### 2.4 `src/cli/commands/contract.spec.ts` adjust
The static contract test currently checks for `details.file_path` on per-file error codes inside the v1 envelope `errors[]`. With v2, per-file errors live INSIDE the command's data shape, not in a shared errors[]. Rewrite the test to validate per-command shape conformance instead. Or delete if no useful invariant remains.

#### 2.5 `src/cli/runner.spec.ts` adjust
Delete `mergeCardSyncWarnings` tests. Keep `classifyErrorStatus` test if classifyErrorStatus survives the rewrite; otherwise delete.

### Phase 3 — Tests

#### 3.1 Test refactor (~30+ files)
Every test that does:
```typescript
const parsed = JSON.parse(stdout);
expect(parsed.status).toBe('ok');
expect(parsed.data.X).toBe(...);
expect(parsed.errors).toHaveLength(...);
```
must change to:
```typescript
const parsed = JSON.parse(stdout);
expect(parsed.X).toBe(...);  // direct field access, no .data unwrap
expect(stderr).not.toContain('error');  // or specific assertion
expect(exitCode).toBe(0);
```

Test files affected (every CLI test):
- `test/cli/*.test.ts` (all)
- `test/e2e/*.test.ts`
- `test/integration/*.test.ts`
- Some `test/ops/*.test.ts` that wrap via runCli helper

#### 3.2 Delete or rewrite specific tests
- `test/cli/json-envelope-schema.test.ts` → DELETE entirely. Envelope removed.
- `src/cli/output.spec.ts` → DELETE. Old helpers gone.
- `src/cli/runner.spec.ts` → keep classifyErrorStatus if retained; delete dedup tests.
- `test/cli/fs-race.test.ts` → REWRITE. All assertions on `parsed.errors[]` and `parsed.warnings[]` must move to stderr JSON-line parsing.

#### 3.3 Test helpers update
- `test/helpers.ts` (`runCli` return shape `{exitCode, stdout, stderr}`) — already structured this way; no change needed.

### Phase 4 — Documentation cleanup

#### 4.1 PROBLEM.md
- Mark v1 envelope entries as "resolved by envelope-removal redesign (commit X)"
- New entry: "v2 output contract; cards-only SSOT for response shapes"

#### 4.2 README.md (if exists; check `ls /home/revil/projects/zipbul/emberdeck`)
- BREAKING CHANGE section

#### 4.3 dist/
- Rebuild after Phase 2

---

## 3. GATEs (must pass to proceed between phases)

- After Phase 1.3: `ed validate cards` (warnings 0)
- After Phase 2.5: `bun test` (pass all). Many tests will be broken until Phase 3.
- After Phase 3.3: `bun test` (1000+ pass, no failures)
- After Phase 4: `ed validate cards` AND `ed validate links` clean; `ed spec sync` errors []
- Final: end-to-end smoke: `bun cli.ts analyze` produces sensible JSON with no v1 keys at top level

---

## 4. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 2 single-commit too large to review | High | Med | Split by command file in PR review but commit atomically |
| Card-code drift permanent if work stalls mid-Phase 2 | High | High | Either complete Phase 2 in one session or rollback Phase 1.1-1.2 before stopping |
| Hostile re-review finds new defects in v2 | Certain | Low | Each found defect = card update + code adjust per skill workflow; no envelope-class defects can recur by construction |
| External CI/script consumers (if any) break | Unknown | High | Document breaking change in CHANGELOG; no migration shim |
| Per-command shape drift between cards and code | Medium | Med | contract.spec.ts (or successor) asserts shape match; or runtime self-validator |
| `--quiet` collapse rule per command unclear | Med | Low | Per-command spec card declares quiet form; default falls back to full data if not declared |

---

## 5. Rollback Story

If Phase 2 stalls mid-session:
1. `git revert f96a50d 072d2c7` (Phase 1.2 + 1.1) — restores e1dea64 coherent state.
2. Keep this REDESIGN_PLAN.md so the work can resume later.
3. Update PROBLEM.md to record the attempt.

If Phase 2 completes but Phase 3 stalls:
- Cannot rollback cleanly; need to either finish tests or revert Phase 2 entirely.

---

## 6. Open Questions / Decisions Needed

1. **`ed card export --out STDOUT`** — markdown text on stdout is not JSON. Acceptable exception, OR force JSON-wrapping (`{"content": "..."}`).
2. **`ed analyze` quiet form** — what's the core payload? Single metric (health.drifted)? Or nothing?
3. **`ed bulk sync` partial failure** — `{synced, failed}` is the shape. Exit 0 if `failed.length === 0`, exit 2 otherwise? Or always 0?
4. **`ed glossary lookup` with no word** — return all entries (`{entries: [...]}`)? Or require a word?
5. **`ed check drift` empty project** — `{cards: [], health: {...zeros}}`? Or just `{cards: []}`?
6. **Spec card `response_shape` field** — should this be a structured frontmatter field (like `failure_types: [...]`) or just a postcondition statement? Skill schema doesn't currently support arbitrary fields; would need a card-schema extension.
7. **Auto-sync warning JSON-lines schema** — fix `{code, message, details?}` or `{file_path, error}`? Pick one and document.

---

## 7. Estimated Effort (remaining)

| Phase | Turns | Files Touched |
|---|---|---|
| 1.3 per-command cards | 18-20 | 18 cards |
| 1.4 SKILL.md | 2-3 | 1 file (large) |
| 2.1 output.ts | 1 | 1 |
| 2.2 runner.ts | 1-2 | 1 + runner.spec.ts |
| 2.3 commands | 5-7 | 7 command files |
| 2.4 contract.spec | 1 | 1 |
| 3.1 test refactor | 8-12 | ~30 test files |
| 3.2 delete tests | 1 | 2 deletes |
| 4 docs | 2-3 | 2-3 files |

**Total: ~40-50 turns** of focused work. Realistic single session: half of that. Multi-session: yes.

---

## 8. Resume Instructions (for future Claude / human)

1. Read this file + the two cards rewritten in Phase 1.2:
   - `.emberdeck/cards/cli-surface/command-routing-and-output.md` (brief)
   - `.emberdeck/cards/cli-surface/command-routing-and-output/runner-and-output.md` (spec)
   - `.emberdeck/cards/card-storage/persistence/sync.md` (POST-005 + failures)
2. Confirm git state: `git log --oneline -5` should show `f96a50d` as the latest envelope-related commit.
3. Pick next Phase 1.3 card to update (see list in §2). Use skill workflow: `<self_review>` → `ed card update --patch <file.json>`.
4. Run `ed validate cards` after each card.
5. Once Phase 1.3 + 1.4 complete, start Phase 2 in a single sustained pass (Phase 2 cannot be split across sessions cleanly).
6. After Phase 2, run `bun test` — expect many failures. Then Phase 3.
7. Final: commit, push, update PROBLEM.md.

---

## 9. Why This Design Survives (the meta-argument)

Hostile review demolished prior redesigns by finding semantic gaps in shared envelope structures. This design has no shared envelope, so envelope-level invariants cannot drift. Per-command shapes can each have their own defects — but those are per-command and reviewable in isolation. The defect class that produced 11 review rounds (mixed `errors[]` semantics) cannot recur by construction.

The breaking-change cost is accepted in §0. The "completeness" question (will the design survive round 12+?) is answered: round 12 may find a specific command's shape needs more detail, but that's a per-command card edit, not a system-wide redesign. The blast radius is bounded.

---

End of plan.
