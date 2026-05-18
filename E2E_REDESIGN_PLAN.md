# E2E Test Redesign — Plan v7

Status: **Draft for deep review** (iteration 9 — Round 14 citation-meaning fix)

## Scope

Redesign `test/e2e/` from scratch following Single Responsibility Principle (SRP). Source of truth: `.emberdeck/cards/cli-surface/**`. Existing 14 files in `test/cli/` will be consolidated into 13 contract-scoped files in `test/e2e/`. Two existing files (`hook-regex.test.ts`, `no-direct-process-exit.test.ts`) are not e2e and will be deleted.

Integration tier and unit tier are **out of scope** for this plan.

## Tier Definition (lock)

- **unit** — `src/**/*.spec.ts` colocated. Pure functions or mock-only. No fs/DB/Gildash.
- **test/integration** — Component composition. Real or in-memory DB, real fs (tmp), mock-or-real Gildash. Ops API direct.
- **test/e2e** — CLI boundary via `runEd` (in-process `program.parseAsync`) or `Bun.spawn` (subprocess). Asserts stdout/stderr/exit triple + disk side-effects.

## Why this plan exists

Existing `test/cli/` has 14 files mixed by **historical phase** (`phase2.test.ts`, `phase2-polish.test.ts`), **failure type** (`fs-race`, `db-corruption`, `malformed-yaml`), and **mechanism** (`signal-handling`, `tty-confirm`, `symlink`). The same contract dimension is verified across multiple files. A regression in one contract dimension can hide behind another file's tests. SRP per file makes contract violations surface at exactly one location.

## 13-File Structure

Each file owns **exactly one contract dimension** (Single Responsibility). SoT citations from `.emberdeck/cards/cli-surface/**`.

| # | File | Single responsibility | SoT citation |
|---|---|---|---|
| 1 | `command-success-stdout.test.ts` | Per-command natural JSON shape on success (no envelope) — every command's POST-001 verified (including `check-coverage` POST-001a/b/c mode variants) | R-001, **R-005**, DI-001, POST-001, **INV-004 (no v1 envelope keys)** in runner-and-output.md + every command card's POST-001 / POST-001a/b/c |
| 2 | `stderr-channel.test.ts` | Every stderr line is canonical `{level, code, message, details?}` schema, camelCase keys, kebab codes; **stdout/stderr disjoint channels (failure detect via exit code, not stdout parsing)** | INV-005 (runner-and-output.md:98) + **INV-003 (disjoint channels, runner-and-output.md:85)** |
| 3 | `error-to-exit.test.ts` | Thrown error class → kebab code → exit code matrix + stdout empty on thrown path | R-002, R-003, **DI-003 (exit codes via ERROR_CODE_TO_EXIT keyed by kebab)**, DI-002, POST-002, POST-003, **INV-001 (error class mapping stable)** |
| 4 | `partial-exit.test.ts` | Non-thrown commands return `{data, exitCode:2}` — stdout populated AND exit 2 (opposite of thrown failure) | POST-002 NOTE in runner-and-output.md:33 + per-command POST-002 |
| 5 | `quiet-mode.test.ts` | `--quiet` compact stdout + suppress warning/verbose stderr; error still emit | POST-005, G-005, SC-002 |
| 6 | `auto-sync-warning.test.ts` | One `card-sync-failed` JSON-line per failed file on stderr, exit unaffected, **runs after buildRuntime and before command (ordering invariant)** | POST-004, R-004, DI-004, **INV-002** (runner-and-output.md:77-84) |
| 7 | `commander-fallback.test.ts` | Unknown cmd/option/missing arg → cli-usage-error + exit 2; `--help`/`--version` → exit 0 (commander pre-runtime). **Fallback path itself emits no stdout JSON** (commander.help/version write directly; success/failure both leave stdout JSON-empty). | runner-commander-fallback.md **POST-001** + POST-002 |
| 8 | `runtime-config-composition.test.ts` | Global flag overlay success path (`--config` / `--dir` / `--db-path` / `--project-root` + composition) | project-setup.md G-002; setup-config-root.md POST-001 |
| 9 | `runtime-setup-errors.test.ts` | config-missing/parse/validation + gildash-init-failed. **Unknown top-level keys are strict-rejected (no silent ignore).** | setup-config-root.md **PRE-001**, POST-003/004, **INV-002 (strict unknown-key reject)**; project-setup.md **R-003 (loadConfig throws ConfigError on malformed input — no silent defaulting)** |
| 10 | `runtime-lifecycle.test.ts` | setupEmberdeck/teardownEmberdeck pairing — teardown runs on success AND failure; setup discovers root + loads config **before** opening DB; setup returns fully-initialized context or throws | setup-config-root.md POST-001/002, INV-001; project-setup.md **DI-001 (initialized-or-throws)**, **DI-002 (teardown always closes DB)**, **R-001 (setup ordering: discover/load before DB)**, **R-002 (teardown invoked regardless of outcome)** |
| 11 | `process-signal.test.ts` | SIGINT/SIGTERM cleanup + sigint JSON-line + exit 130 | runner-and-output.md failures #4 |
| 12 | `output-channel-fault.test.ts` | stdout-write-failed (exit 5) + output-encode-failed (exit 1) + EPIPE-negative (no stdout-write-failed emitted) | runner-and-output.md failures #5/6 |
| 13 | `compensation-failed.test.ts` | CompensationError → `compensation-failed` exit 1 with `details.{originalError, compensationError}` | runner-and-output.md failures #10 |

Plus `test/e2e/helpers.ts` — `runEd`, `spawnCli`, `setupTmpProject`, `parseJsonLines` (relocated from `test/cli/helpers.ts`).

## Case Enumeration (Round 5+6 verified)

| File | Cases | Source enumeration |
|---|---|---|
| 1 command-success-stdout | **32** | 31 testable commands per `.emberdeck/cards/cli-surface/command-routing-and-output/commands/*.md` (32 files − runner-commander-fallback = 31) + 1 edge: CommandFn returns undefined → exit 0, no stdout (runner-and-output.md:115-120) |
| 2 stderr-channel | 6 | INV-005 schema check across error / warning / verbose / camelCase / kebab + **INV-003 channel disjoint (stdout empty when stderr has level:error)** |
| 3 error-to-exit | 23 | 20 kebab codes in errors.ts:34-61 + sigint + unknown fallback + ensureCardsSynced-throws path (runner-and-output.md:109-114) |
| 4 partial-exit | 13 | Commands with POST-002 `{data, exitCode:2}` pattern: bulk-create, bulk-sync, card-create, card-delete, card-rename, card-update, glossary-define, glossary-rename, reset, **validate-cards, validate-links, validate-aggregate, check-regression** |
| 5 quiet-mode | 6 | compact format × suppress warning × suppress verbose × keep error × shape unchanged × error path |
| 6 auto-sync-warning | 7 | per file × details.filePath × no exit change × no stdout change × multiple files × concurrent with error × **INV-002 ordering (auto-sync warning emit precedes command stdout)** |
| 7 commander-fallback | 5 | --help / --version / unknown cmd / unknown option / missing arg |
| 8 runtime-config-composition | 7 | each flag × all-together × config+CLI overlay × defaults fallback |
| 9 runtime-setup-errors | 6 | config-missing-file / config-parse-error / config-validation-error / gildash-init-failed + success baseline + edge |
| 10 runtime-lifecycle | 6 | setup-then-teardown on success / on action failure / on setup partial / sequential invocations / cleanup error / reopen |
| 11 process-signal | 5 | SIGINT cleanup / SIGTERM cleanup / message format / normal completion no-emit / cleanup-failed warning |
| 12 output-channel-fault | 5 | stdout-write-failed / output-encode-failed / EPIPE excludes stdout-write-failed / no partial JSON leak / encode error message hint |
| 13 compensation-failed | 4 | exit 1 / details.originalError / details.compensationError / details serialization |
| **TOTAL** | **125** | (sum: 32+6+23+13+6+7+5+7+6+6+5+5+4) |

## Mapping: 154 existing it()/test() blocks → v6 structure

Existing `test/cli/*.test.ts` has 154 `it()`/`test()` blocks total across 14 files (verified by `grep -c` Round 7). Of these:

- **7 DELETE** (lint files): `hook-regex.test.ts` (6 it) + `no-direct-process-exit.test.ts` (1 it) — both static-analysis or shell-hook tests, not e2e
- **147 IN-SCOPE** for mapping to one of the 13 v6 files

Agent B Round 6 produced a line-by-line mapping for a **70-block subset** (the audited core). Of those 70: **61 KEEP / 1 REFACTOR / 8 DELETE = 70** ✓. The 8 deletions break down as 7 lint-file blocks (hook-regex 6 + no-direct-process-exit 1 — verified via strict grep in R7) plus 1 non-lint mismatch (a block in a test file that doesn't map to any v6 file). The lint-file deletions delete the whole file; the 1 mismatch deletes just that block.

The remaining **77 in-scope blocks** (147 − 70 audited subset) need a final pass during migration — each block's primary contract dimension determines target file.

Action item before execution: complete line-by-line audit for the residual 77 blocks (Step 0 of migration).

## New tests needed

~50 cases must be written from scratch (verified totals below):

| File | New cases needed |
|---|---|
| error-to-exit | 17 (16 untargeted kebab + ensureCardsSynced-throws) |
| runtime-lifecycle | 4 (no existing test exercises teardown-on-failure pairing) |
| output-channel-fault | 5 (stdout-write, encode, EPIPE-negative all uncovered) |
| compensation-failed | 4 (no existing test for CompensationError details bag) |
| command-success-stdout | 5 (check-coverage 3 modes + init + undefined-return edge currently uncovered) |
| process-signal | 2 (cleanup-failed warning + message-format exact) |
| runtime-setup-errors | 3 (parse-error / validation-error / gildash-init-failed distinct) |
| quiet-mode | 2 (--quiet + error / shape-unchanged invariant) |
| commander-fallback | 1 (invalid flag value) |
| stderr-channel | 2 (kebab/camelCase schema explicit check + INV-003 channel disjoint) |
| partial-exit | 4 (validate-cards, validate-links, validate-aggregate, check-regression were missed in Round 6 — Round 7 added) |
| auto-sync-warning | 1 (INV-002 ordering case; existing covers warning emission but not pre-command ordering invariant) |
| runtime-config-composition | 0 |
| **TOTAL** | **~50** |

Refined from earlier ~30 / ~42 / ~49 estimates across rounds: partial-exit 9→13 (validate family + check-regression added in R7), command count 30→31 (R7), +2 SoT failure clauses (R7), +1 INV-002 ordering (R9), +1 INV-003 disjoint (R10). Round 12 confirmed sum = 50.

## Migration Steps

0. **Audit the residual 77 in-scope `it()` blocks** (the 147 in-scope minus the 70 already mapped by Agent B Round 6). Each block's primary contract dimension → target v6 file. Produce a complete `source:line → v6 file` table before any code movement.
1. Create `test/e2e/helpers.ts` from `test/cli/helpers.ts` (move + update import paths).
2. Create 13 new e2e files with shells (describe blocks + imports).
3. Per the complete (R6 + Step 0) mapping table, cut-paste each `it()` block to its target file.
4. Write ~50 new test cases (matches "TOTAL ~50" in the new-cases section above).
5. Delete 14 source files in `test/cli/` (after verification all blocks moved or deleted).
6. Verify full suite green.
7. Commit.

## SoT Backlog (post-migration)

After tests written, propose SoT card updates for behaviors currently undocumented but implemented:

1. **runner-and-output.md failures section**: add "Second SIGINT or SIGTERM during cleanup → hard exit 130 (cleanup interrupted)" — covers `runner.ts:37`. Then add test as case #6 in process-signal.test.ts.
2. **runner-and-output.md failures section**: add positive EPIPE behavior — "broken pipe on stdout write → silent (no error emitted), exit code matches command's natural outcome" — covers `output.ts:42`. Optionally upgrade EPIPE case from negative-only to positive assertion.
3. **runner-and-output.md failures section**: add `cleanup-failed` warning behavior — covers `runner.ts:41-46` (signal-path cleanup catch) and `runner.ts:105-109` (final cleanup catch). Then add test in auto-sync-warning.test.ts OR process-signal.test.ts for the warning emission.
4. **runner-and-output.md OR output module spec**: add stderr EPIPE silent swallow behavior — covers `output.ts:71-74` (stderr write in `emitLine` swallows EPIPE silently). Decide whether stderr EPIPE is contract or implementation safety.

## Verification Trace

| Round | Goal | Result |
|---|---|---|
| 2 | 4-way independent SRP design (me + Explore×2 + Codex) | 7 SRP violations in initial v4 surfaced |
| 3 | Resolve 5 disagreements (D1-D6) via SoT citations | All resolved; v5 = 11 files |
| 4 | SRP audit per file (Agent B + Codex) | #8 and #11 split agreed → v6 = 13 files |
| 5 | Case enumeration + existing mapping + gap ID | 116 cases enumerated (later corrected to 125), 70 existing mapped (later: 154 total) |
| 6 | Case count verification (Agent A: 30+9 exhaustive — later corrected) + line mapping (Agent B: 61/1/7 subset of 70) + SoT gap resolution (Codex 35s, all 3 align) | v7 draft |
| 7 | Deep review by 3 reviewers (Explore×2 + Codex, all medium-effort) | **6 corrections applied**: commands 30→31, partial-exit 9→13 (validate family + check-regression missed in R6), it() 70→154 total / 147 in-scope, +1 ensureCardsSynced-throws case (error-to-exit), +1 undefined-return edge (command-success-stdout), 2 SoT failure clauses absorbed. v7 iteration 2. |
| 8 | Re-review after R7 corrections (Explore + Codex) | **2 arithmetic errors fixed**: total cases doc-stale 125→123 (then later re-grew to 125 in R10 via INV-003), unaccounted blocks 84→77 (147−70). All R7 corrections re-verified VERIFIED. v7 iteration 3. |
| 9 | Re-review after R8 fixes (Explore + Codex) | **1 SoT clause unmapped found**: INV-002 (auto-sync ordering: runs after buildRuntime before command). Absorbed into auto-sync-warning.test.ts (+1 case). Explore agent's "8 DELETE" claim refuted (still 7; `no-direct-process-exit.test.ts` has 1 block confirmed). Total 123→124, new 48→49. v7 iteration 4. |
| 10 | Re-review after R9 fix (Explore + Codex) | **3 more SoT clauses unmapped** found by Codex: INV-001 → error-to-exit citation, INV-003 → stderr-channel citation + 1 new case (channel disjoint), INV-004 + R-005 → command-success-stdout citation. **2 implementation drift items** added to SoT Backlog: cleanup-failed warning (runner.ts:41-46, 105-109), stderr EPIPE silent swallow (output.ts:71-74). Agent A's "163 it()" claim refuted (strict grep = 154 confirmed). Total 124→125, new 49→50, SoT backlog 2→4. v7 iteration 5. |
| 11 | Re-review after R10 (Explore + Codex) | **4 more SoT clauses unmapped** found by Codex: DI-003 → error-to-exit citation, setup-config-root PRE-001 → runtime-setup-errors citation, setup-config-root INV-002 → runtime-setup-errors citation, runner-commander-fallback POST-001 → commander-fallback citation. **Migration Steps fixed**: added Step 0 (residual 77-block audit), Step 4 count "~42"→"~50". Internal contradiction at history line cleaned ("125→123" clarified). v7 iteration 6. |
| 12 | Final consistency pass (Explore + Codex) | **Stale-text cleanup**: "8 DELETE" → 7 (line 69 — corrected back in R13), "~30 cases" → ~50 (line 77), "116 exhaustive" → 125 (line 137), refinement note updated to include R9/R10 deltas. Added explicit POST-001a/b/c mention for check-coverage. **Minor unmapped** (project-setup.md DI/R clauses + runner-and-output.md PRE-001 + runner-commander-fallback INV-001) noted as transitively covered via SPEC-level citation — strict explicit citation deferred (low value). v7 iteration 7. |
| 13 | Footer + arithmetic + Codex push on explicit citations | **2 defects fixed**: line 142 footer "iteration 1" stale (now iteration 8); line 69 subset breakdown corrected to 61/1/**8** = 70 (R12 reduced to 7 was wrong — 7 lint blocks + 1 non-lint mismatch = 8 total subset deletions). **5 SoT citations added** per Codex: project-setup R-001/R-002/R-003 + DI-001/DI-002 explicitly cited in runtime-config-composition + runtime-setup-errors. v7 iteration 8. |
| 14 | Citation meaning verification (Explore claim ZERO-DEFECT vs Codex flag MEANING-WRONG) | **Codex correct**: R13's 5 citations mis-attributed meanings. Real meanings from project-setup.md:121-148: DI-001=initialized-or-throws (lifecycle), DI-002=teardown-always-closes-DB (lifecycle), R-001=setup-ordering-discover-before-DB (lifecycle), R-002=teardown-invoked-regardless (lifecycle), R-003=loadConfig-throws-ConfigError (setup-errors — kept). Rehomed 4 clauses from file #8/#9 to file #10 lifecycle. Footer updated. v7 iteration 9. |

## Known Limits / Open Items

- **Double-signal hard exit** test deferred — SoT card update needed first (`runner-and-output.md` failures block). Tracked as Backlog #1.
- **EPIPE positive behavior** — testing only negative ("no stdout-write-failed emitted") per Codex `TEST-NEGATIVE-ONLY` verdict. Positive "silent + exit 0" needs SoT update first.
- **case count tolerance**: 125 is the verified exhaustive total (sum of row counts after R11). Actual implementation may merge some closely-related cases via `it.each` if SoT contract allows.

---

This doc is **iteration 9** (Plan v7). Round 14 review applied: 5 SoT citation meaning errors fixed — R-001, R-002, DI-001, DI-002 actually describe lifecycle (not flag composition or error mapping); rehomed to `runtime-lifecycle.test.ts`. R-003 stays in `runtime-setup-errors.test.ts` (its meaning was correct).
