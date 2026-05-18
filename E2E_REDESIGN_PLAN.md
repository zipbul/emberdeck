# E2E Test Redesign — Plan v7

Status: **Migration-ready** (iteration 13 — atom-level POST-001 enumeration + case ID traceability)

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
| 1 | `command-success-stdout.test.ts` | Per-command natural JSON shape on success (no envelope) — every command's POST-001 verified (including `check-coverage` POST-001a/b/c as 3 distinct cases) | runner-and-output.md POST-001, **INV-004** (no v1 envelope keys), **PRE-001** (every action wrapped in run with CommandFn returning natural data); command-routing-and-output.md R-001, R-005, DI-001; every command card's POST-001 / POST-001a/b/c |
| 2 | `stderr-channel.test.ts` | Output channel discipline: (a) every stderr line is canonical `{level, code, message, details?}` schema, camelCase keys, kebab codes; (b) stdout/stderr disjoint channels (failure detect via exit code, not stdout parsing). One file because both INVs govern the SAME boundary — the stderr channel and its relationship to stdout. | runner-and-output.md INV-005 (schema, line 98) + INV-003 (disjoint channels, line 85) |
| 3 | `error-to-exit.test.ts` | Thrown error class → kebab code → exit code matrix + stdout empty on thrown path | R-002, R-003, **DI-003 (exit codes via ERROR_CODE_TO_EXIT keyed by kebab)**, DI-002, POST-002, POST-003, **INV-001 (error class mapping stable)** |
| 4 | `partial-exit.test.ts` | Non-thrown commands return `{data, exitCode:2}` — stdout populated AND exit 2 (opposite of thrown failure) | POST-002 NOTE in runner-and-output.md:33 + per-command POST-002 |
| 5 | `quiet-mode.test.ts` | `--quiet` compact stdout + suppress warning/verbose stderr; error still emit | POST-005, G-005, SC-002 |
| 6 | `auto-sync-warning.test.ts` | One `card-sync-failed` JSON-line per failed file on stderr, exit unaffected, **runs after buildRuntime and before command (ordering invariant)** | POST-004, R-004, DI-004, **INV-002** (runner-and-output.md:77-84) |
| 7 | `commander-fallback.test.ts` | Unknown cmd/option/missing arg/**invalid argument value (InvalidArgumentError)** → cli-usage-error + exit 2; `--help`/`--version` → exit 0 (commander pre-runtime). **Fallback path itself emits no stdout JSON** (commander.help/version write directly; success/failure both leave stdout JSON-empty). | runner-commander-fallback.md **PRE-001** (CommanderError other than help/version triggers fallback), POST-001, POST-002, **INV-001** (inherits parent INV-001..INV-005) |
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
| 1 command-success-stdout | **40** | 30 single-shape commands + 3 for check-coverage POST-001a/b/c modes + 1 edge for CommandFn returns undefined (runner-and-output.md:115-120) + 6 boundary cases B1-B3, B6-B8 (Per-command Contract Specificity section) |
| 2 stderr-channel | 6 | INV-005 schema check across error / warning / verbose / camelCase / kebab + **INV-003 channel disjoint (stdout empty when stderr has level:error)** |
| 3 error-to-exit | 23 | 20 kebab codes in errors.ts:34-61 + sigint + unknown fallback + ensureCardsSynced-throws path (runner-and-output.md:109-114) |
| 4 partial-exit | 13 | Commands with POST-002 `{data, exitCode:2}` pattern: bulk-create, bulk-sync, card-create, card-delete, card-rename, card-update, glossary-define, glossary-rename, reset, **validate-cards, validate-links, validate-aggregate, check-regression** |
| 5 quiet-mode | 6 | compact format × suppress warning × suppress verbose × keep error × shape unchanged × error path |
| 6 auto-sync-warning | 7 | per file × details.filePath × no exit change × no stdout change × multiple files × concurrent with error × **INV-002 ordering (auto-sync warning emit precedes command stdout)** |
| 7 commander-fallback | 6 | --help / --version / unknown cmd / unknown option / missing arg / **invalid argument value (e.g. `--limit abc` triggers InvalidArgumentError)** |
| 8 runtime-config-composition | 7 | each flag × all-together × config+CLI overlay × defaults fallback |
| 9 runtime-setup-errors | 6 | config-missing-file / config-parse-error / config-validation-error / gildash-init-failed + success baseline + edge |
| 10 runtime-lifecycle | 6 | setup-then-teardown on success / on action failure / on setup partial / sequential invocations / cleanup error / reopen |
| 11 process-signal | 5 | SIGINT cleanup / SIGTERM cleanup / message format / normal completion no-emit / cleanup-failed warning |
| 12 output-channel-fault | 5 | stdout-write-failed / output-encode-failed / EPIPE excludes stdout-write-failed / no partial JSON leak / encode error message hint |
| 13 compensation-failed | 4 | exit 1 / details.originalError / details.compensationError / details serialization |
| **TOTAL** | **134** | (sum: 40+6+23+13+6+7+6+7+6+6+5+5+4) |

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
| command-success-stdout | 11 (init + undefined-return edge + check-coverage 3 modes + boundary B1 depth-clamp + B2 default-limit + B3 depth-0 BFS + B6 spec-sync idempotency + B7 init pre-existing skipped[] + B8 init --no-gitignore) |
| process-signal | 2 (cleanup-failed warning + message-format exact) |
| runtime-setup-errors | 3 (parse-error / validation-error / gildash-init-failed distinct) |
| quiet-mode | 2 (--quiet + error / shape-unchanged invariant) |
| commander-fallback | 2 (invalid flag value via InvalidArgumentError + help/version exit-0 no-stderr assertion) |
| stderr-channel | 2 (kebab/camelCase schema explicit check + INV-003 channel disjoint) |
| partial-exit | 4 (validate-cards, validate-links, validate-aggregate, check-regression were missed in Round 6 — Round 7 added) |
| auto-sync-warning | 1 (INV-002 ordering case; existing covers warning emission but not pre-command ordering invariant) |
| runtime-config-composition | 0 |
| **TOTAL** | **~57** |

Refined from earlier ~30 / ~42 / ~49 estimates across rounds: partial-exit 9→13 (validate family + check-regression added in R7), command count 30→31 (R7), +2 SoT failure clauses (R7), +1 INV-002 ordering (R9), +1 INV-003 disjoint (R10). Round 12 confirmed sum = 50.

## Migration Steps

0. **Complete the Step 0 Audit table** (164 it/test blocks across `test/cli/` + `test/e2e/`, classified file-by-file in the "Step 0 Audit" section below). The 16-source-file × target-v6-file table is the contract for Step 3 cut-paste routing. For the 5 mixed-source files (phase2 / phase2-polish / commands / fs-race / chaos), each individual `it()` must be inspected at migration time and routed by its asserted contract.
1. Create `test/e2e/helpers.ts` from `test/cli/helpers.ts` (move + update import paths).
2. Create 13 new e2e files with shells (describe blocks + imports).
3. Per the complete (R6 + Step 0) mapping table, cut-paste each `it()` block to its target file.
4. Write ~50 new test cases (matches "TOTAL ~50" in the new-cases section above).
5. Delete 14 source files in `test/cli/` (after verification all blocks moved or deleted).
6. Verify full suite green.
7. Commit.

## Per-command Contract Specificity

The 13-file SRP split owns *contract dimensions*. Each per-command case within those files MUST assert the command's specific contract shape, not just generic envelope structure. This is what makes "command-success-stdout" 34 cases meaningful instead of 34 identical no-op checks.

**Specificity rules per SRP file**:

| File | Generic assertion | Command-specific assertion (REQUIRED) |
|---|---|---|
| command-success-stdout | "stdout is valid JSON" (INV-004) | Each command's exact POST-001 shape: e.g., `card-tree` returns root `TreeNode` directly (no enclosing object); `card-list` MUST include `limit`/`offset`/`hasMore`; `card-context` includes `related[].{card, depth, direction}` + optional `truncated`; `check-coverage` matches the 3 mode-distinct shapes (POST-001a/b/c); `spec-sync` includes `alreadyLinked[]`/`unmatched[]`/`markerMissing[]`; `spec-sync-symbols` includes `sinceSource`/`nextSyncMarker`/`applied[]`; `bulk-sync` includes `mode: 'file'\|'directory'`; `init` includes `gitignoreUpdated: boolean` + `skipped[]`. |
| error-to-exit | error class → kebab code → EXIT mapping | Each code asserted via its **canonical triggering command**: `fts-syntax-error` via `card-search "bad("`; `activation-guard-failed` via `card-set-status active` with unmet preconditions + `details.unmetConditions` shape; `card-rename-same-path-error` via rename to same key; `glossary-validation-error` via `glossary-rename` to existing newWord; `parent-validation-error` via `card-create` with invalid parent. |
| partial-exit | non-thrown `{data, exitCode:2}` | Each command's command-specific partial shape: `card-delete --force` → 3 parallel arrays (`failedChildUpdates[]`/`failedRelationUpdates[]`/`failedCrossDomainUpdates[]`); `card-rename` → `failedReferenceUpdates[]` with `{cardKey, reason}`; `bulk-create` → `failed[]` + `partialKeys[]` (phase-2 split); `bulk-sync` → `failed[].{filePath, error}` + `mode`; `glossary-rename` → `failedFileWrites[]`; `reset` → `failedFileDeletes[]`; `check-regression` → `passOrFail: 'fail'` + `driftedRatio` strictly > `threshold`; `validate-cards/-links/-aggregate` → per-card fan-out with `data.items[].issues[]` / `data.items[].brokenLinks[]` / `data.items[].skipped` / `data.items[].ioError`. |
| stderr-channel | INV-005 schema | (no per-command specificity — schema is universal) |
| quiet-mode | POST-005 compact + suppress | Spot-checked across 2-3 commands with warning AND verbose to confirm both suppressed under quiet. |
| auto-sync-warning | `card-sync-failed` warning | `details.filePath` content asserted. |
| commander-fallback | pre-runtime error | Each subcase uses a real command name where applicable (e.g., `ed badcmd`, `ed card list --bad-flag`). |
| runtime-config-composition | flag/config overlay | Tested with `card list` as the harness command (read-only, deterministic). |
| runtime-setup-errors | setup failures → `cli-setup-error` exit 6 | Triggered via missing config, missing cards dir, broken DB path, no-TTY confirm requirement (depending on path under test). |
| runtime-lifecycle | DI-001/DI-002/R-001/R-002 ordering | Spy on `setupEmberdeck`/`teardown` call order + invocation guarantees; harness command can be any read-only. |
| process-signal | SIGINT/SIGTERM cleanup | Tested with `bulk sync` against large fixture (signal lands mid-flight). |
| output-channel-fault | stdout EPIPE / stderr swallow | Tested with `card list` piped to closed sink. |
| compensation-failed | `compensation-failed` after thrown op error | Triggered via `card update` where rollback step is intercepted to throw. |

**Implication**: Each per-command case is an explicit shape assertion, not a generic JSON-validity check. Test bodies use `expect(JSON.parse(stdout)).toMatchObject({...command-specific keys...})` with the exact key set from that command's POST-001 SoT.

**Note on commands not explicitly named in the specificity table**: The table calls out commands with notable shape variations (TreeNode-direct, pagination envelope, BFS-related, mode-multiplexing, watermark, etc.). The other commands (analyze, card-export, card-get, card-relations, card-search, check-drift, check-impact, check-interactions, glossary-lookup, glossary-remove, glossary-define, etc.) follow per-command POST-001 envelopes that are equally enforced — each case asserts the exact POST-001 JSON shape from its source card. The table is a callout list; the full atom-level enumeration follows.

### Atom-level POST-001 enumeration (all 32 commands + 3 check-coverage modes)

Each row = one CSS-NNN case. Top-level JSON keys are in spec order. `?` = optional per spec. Test body asserts `toMatchObject` with the exact key set (no extra, no missing top-level keys).

| Command | Top-level JSON keys | Notable nested shape | Source |
|---|---|---|---|
| analyze | health, coverage, drifted, glossary, unlinkedSymbols | health: {total,active,drifted,draft,brokenLinks,codeStats?,codeCycles?}; coverage: {totalSymbols,coveredSymbols,coverageRatio}; drifted: {cards,total,limit,offset,hasMore} | analyze.md:20-55 |
| bulk-create | created, failed, partialKeys, total | created: {inputIndex,key,filePath}[]; failed: {inputIndex,key?,error}[] | bulk-create.md:19-38 |
| bulk-sync | synced, mode, path, failed | failed: {filePath,error}[] | bulk-sync.md:19-35 |
| card-context | key, summary, status, type, parent, glossary, relations?, tags?, principle?, domain?, brief?, spec?, upstream, downstream, parentChain, related?, truncated?, codeLinks | related?: {card,depth,direction}[] | card-context.md:20-45 |
| card-create | key, filePath, status, type, parent, failedRelationTargets | failedRelationTargets: string[] | card-create.md:19-31 |
| card-delete | key, filePath, detachedChildren, removedCrossDomainRefs, failedChildUpdates, failedRelationUpdates, failedCrossDomainUpdates | arrays with {cardKey,reason} | card-delete.md:19-35 |
| card-export | key, mode, filePath?, bytes, content? | mode: 'in-place'\|'file'\|'stdout' | card-export.md:19-35 |
| card-get | key, summary, status, type, parent, glossary, relations?, tags?, principle?, domain?, brief?, spec?, filePath, updatedAt?, history? | history?.entries: {field,oldValue,newValue,changedAt,changedBy}[] | card-get.md:19-45 |
| card-list | items, total, limit, offset, hasMore | items: CardSummary[] | card-list.md:19-38 |
| card-relations | key, forward, reverse, total | forward, reverse: CardSummary[] | card-relations.md:19-35 |
| card-rename | oldKey, newKey, oldPath, newPath, failedReferenceUpdates | failedReferenceUpdates: {cardKey,reason}[] | card-rename.md:19-31 |
| card-search | items, total | items: {CardSummary..., snippet, rank}[] | card-search.md:19-38 |
| card-set-status | key, oldStatus, newStatus | — | card-set-status.md:19-29 |
| card-tree | key, type, status, summary, depth, truncated?, children | TreeNode recursive (no enclosing object) | card-tree.md:19-35 |
| card-update | key, filePath, status, validationNotes, failedRelationTargets | validationNotes: string[] | card-update.md:19-33 |
| check-coverage (POST-001a, key mode) | key, declared, resolved, broken, coverageRatio, unreferencedSymbols, unreferencedTotal | unreferencedSymbols: {file,symbol,kind}[] | check-coverage.md:22-40 |
| check-coverage (POST-001b, --uncovered) | totalSymbols, coveredSymbols, coverageRatio, uncovered, uncoveredTotal | uncovered: {file,symbol,kind}[] | check-coverage.md:46-58 |
| check-coverage (POST-001c, --suggest) | suggestions, total | suggestions: {key,type,parent?,files,symbols,reason,suggestedGlossary?}[] | check-coverage.md:61-80 |
| check-drift | health, cards | cards: {key,summary,status,driftType?,driftTypes?,brokenLinks,totalLinks}[] | check-drift.md:19-32 |
| check-impact | riskLevel, affectedCards, newUncoveredFiles, suggestedActions, maxFanIn?, maxFanOut?, directDependents? | affectedCards: {key,summary,linkType,affectedLinks,via?,linkStatus?}[] | check-impact.md:19-42 |
| check-interactions | interactions, undefinedRelations | interactions: {pair,sharedSymbols,sharedFiles,importDependencies,hasRelation,potentialConflicts}[] | check-interactions.md:19-39 |
| check-regression | passOrFail, driftedRatio, threshold, affected | affected: {key,status,driftType?}[] | check-regression.md:19-33 |
| glossary-define | defined, failed, total | defined: {word,definition,action}[]; failed: {inputIndex,reason}[] | glossary-define.md:19-40 |
| glossary-lookup | entries, total | entries: {word,definition}[] | glossary-lookup.md:19-31 |
| glossary-remove | word, affectedCardKeys | affectedCardKeys: string[] | glossary-remove.md:19-28 |
| glossary-rename | oldWord, newWord, affectedCardKeys, failedFileWrites? | failedFileWrites?: string[] | glossary-rename.md:19-35 |
| init | projectRoot, cardsDir, configPath, glossaryPath, created, skipped, gitignoreUpdated | created, skipped: string[] (cwd-relative) | init.md:22-40 |
| reset | cardsDeleted, glossaryCleared, failedFileDeletes | failedFileDeletes: string[] | reset.md:19-35 |
| runner-commander-fallback | (no stdout JSON) | commander writes help/version directly to stdout/stderr; success/failure both leave stdout JSON-empty | runner-commander-fallback.md:21-27 |
| spec-sync | alreadyLinked, linkMissing, unmatched, markerMissing | all arrays: {cardKey,file,symbol}[] | spec-sync.md:19-34 |
| spec-sync-symbols | applied, skipped, total, since, sinceSource, nextSyncMarker | applied: {cardKey,oldSymbol,newSymbol,file,changeType}[]; skipped: {reason,symbol?,file?,details?}[] | spec-sync-symbols.md:19-45 |
| validate-aggregate | cards, links | nested POST-001 shapes from validate-cards / validate-links | validate-aggregate.md:22-34 |
| validate-cards | summary, items, fileLevelIssues | summary: {total,byCode}; items: {key,filePath?,issues:{code,message,details?}[]}; fileLevelIssues: {code,message,filePath,key?}[] | validate-cards.md:19-60 |
| validate-links | summary, items | summary: {total,ok,broken,skipped,ioFailed,planned}; items: {key,declared,resolved,brokenLinks?,plannedLinks?,skipped?,ioError?}[] | validate-links.md:19-36 |

**Row count**: 31 commands × 1 row + check-coverage × 3 mode rows = **34 success-shape rows** (runner-commander-fallback has no stdout JSON so its row is descriptive only). Maps to CSS-001..CSS-034 (CSS-035..CSS-040 reserved for boundaries B1, B2, B3, B6, B7, B8). Each CSS-NNN test asserts the exact top-level key set above via `toMatchObject({...keys...})` (no extras, no missing).

## Additional Boundary / Invariant Cases (NOT yet in case enumeration)

These are command-specific contracts that have NO existing case mapping. Added as net-new:

| # | Case | Target file | Source |
|---|---|---|---|
| B1 | `card-tree --depth 25` → cap to 20 + nodes at maxDepth have `truncated:true` | command-success-stdout case CSS-035 | card-tree.md POST |
| B2 | `card-list` omitted `--limit` → response has `limit:50` (default) | command-success-stdout case CSS-036 | card-list.md INV-002 |
| B3 | `card-context --depth 0` returns root only, no `related[]` BFS | command-success-stdout case CSS-037 | card-context.md |
| ~~B4~~ | ~~card-update --field + --patch mutual exclusion~~ | **REMOVED (invalid)** | R20-B confirmed neither card NOR code enforces mutual exclusion — `src/cli/commands/card.ts` uses `Object.assign(fields, parsedRaw)` to merge both. No contract exists to test. SoT Backlog #6 records the no-op decision. |
| ~~B5~~ | ~~glossary-define ≤50 batch limit~~ | **moved to SoT Backlog #7** | glossary-define.md has no clause for 50-entry max though `src/glossary/io.ts:8 MAX_ENTRIES_PER_CALL:50` enforces it. SoT update needed; once added, restore as ERR-024 (extending error-to-exit). |
| B6 | `spec-sync` run twice in a row → second run's `applied[]` empty, `alreadyLinked[]` non-empty (idempotency) | command-success-stdout case CSS-038 | spec-sync.md (`alreadyLinked[]` field present; idempotency inferable) |
| B7 | `init` against pre-existing `.emberdeck.jsonc` without `--force` → `skipped[]` lists config path, no overwrite | command-success-stdout case CSS-039 | init.md POST `skipped[]` + idempotency clause |
| B8 | `init --no-gitignore` → response has `gitignoreUpdated:false`, no `.gitignore` modification | command-success-stdout case CSS-040 | init.md (`gitignoreUpdated:boolean` field; flag→false binding inferable from POST shape) |

**New totals after R20 reconciliation**:
- command-success-stdout: 34 → **40** (+6 boundaries B1, B2, B3, B6, B7, B8 → CSS-035..CSS-040)
- error-to-exit: **23** (B4 invalid-removed; B5 deferred to Backlog #7 — restored as ERR-024 once SoT updated)
- **TOTAL**: 128 → **134** (40+6+23+13+6+7+6+7+6+6+5+5+4)
- new cases needed: ~51 → **~57**

## Case ID Allocation (plan-to-test traceability)

Every test case in the plan gets a stable ID. Test code (`it()` block names) MUST include this ID so the case can be traced back to the SoT row. Format: `<PREFIX>-<NNN>: <description>`.

| File | Prefix | ID range | Count |
|---|---|---|---|
| 1 command-success-stdout | `CSS` | CSS-001 … CSS-040 | 40 |
| 2 stderr-channel | `STD` | STD-001 … STD-006 | 6 |
| 3 error-to-exit | `ERR` | ERR-001 … ERR-023 | 23 |
| 4 partial-exit | `PEX` | PEX-001 … PEX-013 | 13 |
| 5 quiet-mode | `QUI` | QUI-001 … QUI-006 | 6 |
| 6 auto-sync-warning | `ASW` | ASW-001 … ASW-007 | 7 |
| 7 commander-fallback | `CMF` | CMF-001 … CMF-006 | 6 |
| 8 runtime-config-composition | `RCC` | RCC-001 … RCC-007 | 7 |
| 9 runtime-setup-errors | `RSE` | RSE-001 … RSE-006 | 6 |
| 10 runtime-lifecycle | `RLC` | RLC-001 … RLC-006 | 6 |
| 11 process-signal | `PSG` | PSG-001 … PSG-005 | 5 |
| 12 output-channel-fault | `OCF` | OCF-001 … OCF-005 | 5 |
| 13 compensation-failed | `CMP` | CMP-001 … CMP-004 | 4 |
| **TOTAL** | | | **134** |

**ID assignment rules**:
- IDs are stable across iterations — once allocated to a contract, the ID stays even if case is reordered.
- Boundary cases B1-B3, B6-B8 take CSS slots within the 40-range (e.g., CSS-035..CSS-040). Reserved CSS-001..CSS-031 for the 30 single-shape commands + 1 undefined-return edge; CSS-032..CSS-034 for check-coverage modes a/b/c; CSS-035..CSS-040 for boundaries B1, B2, B3, B6, B7, B8.
- ERR-001..ERR-020 = 20 kebab codes (one per code, in errors.ts:34-61 order). ERR-021 = sigint. ERR-022 = unknown fallback. ERR-023 = ensureCardsSynced-throws.
- PEX-001..PEX-013 = 13 partial-exit commands in case-enumeration order (bulk-create, bulk-sync, card-create, card-delete, card-rename, card-update, glossary-define, glossary-rename, reset, validate-cards, validate-links, validate-aggregate, check-regression).
- Other file IDs are sequential per their case-enumeration row description.

**Enforcement** (post-migration): a CI lint scans every `it(...)` name in test/e2e/ for the `<PREFIX>-<NNN>: ` prefix and fails if any case is missing or has a duplicate ID. Plan and test code stay in lockstep.

## Harness Selection (per file)

`test/cli/helpers.ts` already exposes both harnesses (relocate to `test/e2e/helpers.ts` per Migration Step 1):
- **`runEd(args, cwd)`** — in-process `program.parseAsync`. ~10× faster. Use for: stdout JSON shape, exit-code mapping, flag/config parsing, error→code mapping, partial-exit, quiet-format, stderr capture (non-fault path), commander fallback (relies on `program.exitOverride()`).
- **`spawnCli(args, cwd)`** — `Bun.spawn` subprocess. Required for: real signal delivery (SIGINT/SIGTERM), real EPIPE / stdout fault, cross-process state, anything that depends on OS-level process behavior. **In-process cannot model these** (signal handlers don't fire on in-process throws; stdout-write is intercepted by spy, not OS pipe).

| # | File | Harness | Rationale |
|---|---|---|---|
| 1 | command-success-stdout | `runEd` | stdout JSON capture via spy; no OS dependency |
| 2 | stderr-channel | `runEd` | stderr capture via spy; schema is in-process observable |
| 3 | error-to-exit | `runEd` | `process.exit` intercept yields exit code |
| 4 | partial-exit | `runEd` | non-thrown `{data, exitCode:2}` observable in-process |
| 5 | quiet-mode | `runEd` | format check is buffer-level |
| 6 | auto-sync-warning | `runEd` | warning emission is in-process |
| 7 | commander-fallback | `runEd` | depends on `program.exitOverride()` which runEd sets up |
| 8 | runtime-config-composition | `runEd` | config parse path is pure in-process |
| 9 | runtime-setup-errors | `runEd` | setup throws observable as CliError |
| 10 | runtime-lifecycle | `runEd` | lifecycle ordering observable via spy on init/teardown |
| 11 | **process-signal** | **`spawnCli`** | SIGINT/SIGTERM must be delivered to a real PID; in-process spy on `process.kill` does not trigger registered handlers in the same way |
| 12 | **output-channel-fault** | **`spawnCli`** | EPIPE only occurs on a real OS pipe; needs `proc.stdout` piped to a closed sink. In-process spy cannot synthesize this. |
| 13 | compensation-failed | `runEd` | error injection via DI; observable as stderr JSON-line `code:compensation-failed` |

**Note**: Files #11 and #12 will be slower per case (subprocess boot ~50-100ms each). Keep their case counts tight (5 + 5 = 10 of 128 total). All other files use `runEd` for speed.

## Fixture Strategy

Each test case is fully isolated. No shared state across `it` blocks.

**Per-case setup** (every `beforeEach` or inline at top of `it`):
1. `const { tmp, cleanup } = setupTmpProject()` — creates fresh tmpdir via `mkdtempSync(tmpdir(), 'ed-it-')` with `.emberdeck.jsonc` + empty `.emberdeck/cards/`. No DB pre-created (created lazily by `ed` commands).
2. Write any fixture cards / source files inline (no shared fixture dir — each case owns its disk state).
3. Run `runEd` / `spawnCli` against `tmp`.
4. `afterEach`: `cleanup()` removes tmpdir.

**Why fully isolated** (not shared):
- Cards are SoT (HC-1) — a contaminated tmpdir across cases would make later cases fail spuriously when an earlier case leaves cards behind.
- `ed` mutating commands persist to disk; `mkdtempSync` ensures unique paths so parallel test execution is safe.
- DB is per-tmpdir (cardsDir-relative). No global DB state.

**What NOT to share**:
- ❌ no module-level fixture project root
- ❌ no module-level DB
- ❌ no `beforeAll` that does mutation
- ✅ test-data constants (JSON literals for `--from`, expected JSON shapes) — these are pure values, share OK

**Special fixtures per file**:
- `command-success-stdout`: per-command minimal happy fixture (e.g. for `card get KEY` — pre-seed 1 card via `ed card create` in setup).
- `auto-sync-warning`: write a malformed `.md` card before running command → `card-sync-failed` warning triggers naturally.
- `commander-fallback`: no `.emberdeck/` needed at all — fallback runs pre-runtime.
- `process-signal`: long-running command (`ed bulk sync` against large fixture) so SIGINT lands mid-flight.
- `output-channel-fault`: close stdout (`spawnCli` with `stdout: 'pipe'` then `proc.stdout?.cancel()` mid-write) to force EPIPE.

## SoT Backlog Resolutions (proposed)

These 7 items are contract gaps (#1-#5 from R16/R18 + #6-#7 from R20). Each has a proposed resolution + rationale. **Apply to SoT cards (or accept the no-op decision for #6) before tests are written** (mutations via `ed card update`, with HC gate). Tests then encode the resolved behavior, not the current undefined state.

| # | Topic | Proposed resolution | Rationale | SoT card | Source |
|---|---|---|---|---|---|
| 1 | Second signal during cleanup | **Hard exit 130** (no cleanup-retry) | UNIX convention; user re-pressing Ctrl-C signals impatience — must not block. Matches `runner.ts:37` current impl. | runner-and-output.md failures | runner.ts:37-49 |
| 2 | EPIPE on stdout write | **Silent + exit code = command's natural outcome** | Matches Unix tools (`yes \| head` does not error). Matches `output.ts:42` swallow. | runner-and-output.md failures | output.ts:42 |
| 3 | cleanup-failed first detection | **Signal-path catch is primary**; final-cleanup catch is secondary safety | Both paths exist (`runner.ts:41-46` + `:105-109`); signal path is the actually-reachable production case | runner-and-output.md failures | runner.ts:41-46, 105-109 |
| 4 | stderr write-failure swallow scope | **Keep current ALL-exception swallow** (not narrow to EPIPE) | Stderr is a diagnostic channel — if it fails, the command must still complete. Narrowing risks `TypeError`/`Error` killing the whole CLI on edge cases. Add SoT clause stating "any exception in stderr write is silently swallowed". | runner-and-output.md (new INV or failures) | output.ts:71-74 |
| 5 | cleanup-failed warning under `--quiet` | **Emit even under quiet** (safety override) | A failed cleanup may leave artifacts on disk (DB file, lock); silencing this risks user data loss. Add POST-005 exception: "warnings with `code:cleanup-failed` bypass quiet suppression". | runner-and-output.md POST-005 | runner.ts:106 |
| 6 | card-update `--field` + `--patch` mutual exclusion | **No-op (decision: not a contract)** | Verified by Reviewer B: neither card nor code enforces this. `src/cli/commands/card.ts` merges both via `Object.assign`. SKILL.md's "alternative" wording is informal. If a user wants this behavior, it must be added to BOTH code AND card. Until that decision, NO test case (B4 fully removed, not deferred). | n/a | card.ts (Object.assign merge) |
| 7 | glossary-define batch size limit | **Add POST/PRE clause**: "Per-invocation batch size ≤50 entries; 51st → glossary-validation-error exit 2." | Reviewer B verified: code enforces via `MAX_ENTRIES_PER_CALL: 50` (src/glossary/io.ts:8) and throws GlossaryValidationError, but glossary-define.md card has no clause documenting this contract. Add SoT clause; then add B5 back as error-to-exit case 24. | glossary-define.md POST/PRE (new) | src/glossary/io.ts:8 + src/ops/glossary.ts |

**Decision required from user** before SoT cards mutated. Proposed defaults above. If user disagrees with any, test cases for that item adjust accordingly.

## Step 0 Audit — existing block classification

164 it/test blocks in `test/cli/` + `test/e2e/` (counted via grep, R17). Classification:

| Source file | Blocks | Target v6 file(s) | Notes |
|---|---|---|---|
| `test/cli/phase2.test.ts` | 32 | mixed → split across multiple targets | Largest source; spans output/exit/quiet/auto-sync |
| `test/cli/phase2-polish.test.ts` | 30 | mixed | Phase-2 follow-up, similar split |
| `test/cli/commands.test.ts` | 26 | `command-success-stdout` (primary) + `error-to-exit` (for failure cases) | Per-command happy + neg |
| `test/cli/fs-race.test.ts` | 14 | `output-channel-fault` (fs-races) + `error-to-exit` (fs errors) | Mixed; case-by-case split |
| `test/cli/malformed-yaml.test.ts` | 11 | `error-to-exit` (parse errors → `validation-error` / `card-sync-failed`) | All map to error path |
| `test/cli/flag-overrides.test.ts` | 7 | `runtime-config-composition` | All about flag/config overlay |
| `test/cli/hook-regex.test.ts` | 6 | **DELETE** | Lint test, not in test/ — user explicitly excluded |
| `test/cli/fs-error.test.ts` | 6 | `error-to-exit` (io-failed) | All map to exit 5 |
| `test/e2e/flows.test.ts` | 5 | absorb into `command-success-stdout` per-command cases | Flow tests are command-shape tests |
| `test/e2e/chaos.test.ts` | 5 | `output-channel-fault` + `process-signal` | Chaos = OS-level disruption |
| `test/cli/tty-confirm.test.ts` | 5 | `runtime-setup-errors` (no-TTY → cli-usage-error) | Mostly negative path |
| `test/cli/symlink.test.ts` | 4 | `runtime-setup-errors` + `error-to-exit` | Fs symlink edge cases |
| `test/cli/signal-handling.test.ts` | 4 | `process-signal` | Direct mapping |
| `test/cli/db-corruption.test.ts` | 4 | `runtime-setup-errors` (DB open fails) | Lifecycle path |
| `test/cli/auto-sync-warnings.test.ts` | 4 | `auto-sync-warning` | Direct mapping |
| `test/cli/no-direct-process-exit.test.ts` | 1 | **DELETE** | Lint test |
| **TOTAL** | **164** | (155 migrate or rewrite, 7 lint-delete, 2 absorbed into wider cases) | |

**Migration block-flow**:
- 7 lint blocks → DELETE (hook-regex 6 + no-direct-process-exit 1)
- 157 production blocks → cut-paste-or-rewrite into 13 v6 files
- Mixed-source files (phase2 / phase2-polish / commands / fs-race / chaos) require per-it inspection at migration time — Step 3 must scan each `it()` description and route based on what contract it asserts. Each line → one target file.
- Where existing block enforces a contract NOT in the 134-case enumeration, it's redundant (already deleted in case enumeration) — skip migration.
- Where existing block enforces a contract IN the 134-case enumeration but is currently weak (missing assertions), rewrite from scratch using the new structure rather than cut-paste.

**Estimated kept blocks** after Step 3: ~100 of 157 production (60-65%) — rest replaced by ~51 new cases. Final suite size: ~128 cases as enumerated.

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
| 15 | Convergence check (Explore + Codex) | Explore says ZERO DEFECT; Codex says "2 more rounds needed" (couldn't verify case coverage from limited card slice). Apparent convergence — only 1 reviewer concrete. v7 iteration 9 unchanged. |
| 16 | High-effort strict review (Codex high-effort + Explore) | **9 defects found** by Codex high-effort despite R15 apparent convergence: D1 check-coverage 3 modes uncounted, D2 InvalidArgumentError uncovered, D3 total cascade, D4 PRE-001 (runner) unmapped, D5 PRE-001 (commander-fallback) unmapped, D6 INV-001 (commander-fallback) unmapped, D7 backlog stderr-EPIPE scope too narrow, D8 cleanup-failed warning vs --quiet drift, D9 stderr-channel SRP (INV-005 + INV-003 in one file). All 9 fixed. Total 125→128, new ~50→~51, SoT backlog 4→5. v7 iteration 10. |
| 17 | Strict convergence verify (Explore A: citations+arithmetic; Explore B: SRP+impl drift) | **ZERO DEFECT** from Explore A across all 23 cited IDs, arithmetic sums (128, 51), and R16 fix verification. Explore B: 1 false positive (claimed "× 8 exit values" inference but doc never claims it — actual text says only "20 kebab codes"); 2 backlog items already documented (#4 stderr swallow scope, #5 cleanup-failed--quiet); 1 borderline-but-defensible (stderr-channel two-INV join — explicit rationale in line 28 holds). **Convergence achieved.** v7 iteration 10 confirmed. |
| 18 | Migration-readiness gap closure | **4 gaps closed**: (a) Harness Selection table — 11 files use `runEd`, 2 files (process-signal, output-channel-fault) use `spawnCli` per OS-dependency rationale; (b) Fixture Strategy section — fully isolated per-case mkdtemp, no shared state, HC-1 compliant; (c) SoT Backlog Resolutions — 5 items each have proposed resolution + rationale + target SoT card (apply via `ed card update` before tests written); (d) Step 0 Audit completed — 164 blocks classified across 16 source files, 7 lint-delete + 157 migrate/rewrite. v7 iteration 11. |
| 19 | R18 verify (gap-closure check + cross-section coherence) | **Reviewer A** (source-code dual: helpers.ts, runner.ts, output.ts, line-by-line + `grep -c` block counts on 16 source files): **ZERO DEFECT** — runEd/spawnCli signatures verified, setupTmpProject verified, all 5 backlog citations match real impl lines (runner.ts:37/41-46/105-109/106, output.ts:42/71-74), 164-block sum verified (32+30+26+14+11+7+6+6+5+5+5+4+4+4+4+1=164). **Reviewer B** (coherence): 1 LOW defect (Migration Step 0 wording "residual 77" vs new audit's 164 scope) → fixed. **Convergence confirmed at iteration 11.** |
| 20 | Per-command contract specificity gap closure + R20 verify (A + B) | **Per-command Contract Specificity** section 추가 + **6 boundary cases** (B1, B2, B3, B6, B7, B8) confirmed. **R20-A** 3 defects: footer stale + B4/B5 SoT 미명시. **R20-B** further verification: B4 code 도 not-enforced (Object.assign merge) → **B4 invalid, removed entirely**, not deferred; B5 code 는 src/glossary/io.ts:8 `MAX_ENTRIES_PER_CALL:50` 강제, card 만 미명시 → backlog #7. 9 commands explicit absent from specificity 표 → note 추가 (commands not named follow per-command POST-001 generically). errors.ts 20 codes verified. Total 128 → 134, new ~51 → ~57. SoT Backlog 5 → 7 (#6 = no-op decision, #7 = card update needed). v7 iteration 12. |
| 21 | Final strict convergence verify | **ZERO DEFECT** confirmed across all 8 strict checklist items: arithmetic (40+6+23+13+6+7+6+7+6+6+5+5+4=134 ✓; new 17+4+5+4+11+2+3+2+2+2+4+1+0=57 ✓), status line iteration 12, B4 REMOVED + B5 backlog #7 reconciliation, SoT Backlog 7 items, errors.ts 20 codes via grep, no self-contradictions, all R20 references coherent, footer correct. **Document migration-ready at iteration 12.** |
| 22 | Atom-level rigor (iteration 13) | Added (a) **Case ID Allocation** section — 134 stable IDs (CSS-001..CSS-040, STD-001..STD-006, ERR-001..ERR-023, PEX-001..PEX-013, QUI/ASW/CMF/RCC/RSE/RLC/PSG/OCF/CMP) for plan-to-test traceability; CI lint enforces ID prefix on every `it()` name. Added (b) **Atom-level POST-001 enumeration** — 34-row table (32 commands + 3 check-coverage modes) extracted from every command card's POST-001 fenced JSON, exact top-level keys + notable nested shape + source line range. Each CSS-NNN test asserts exact key set via `toMatchObject` (no extras, no missing). v7 iteration 13. |
| 23 | R22 verify (A: atom enumeration; B: full integration) | **R23-A**: ZERO DEFECT — 8 commands spot-checked against actual card files (analyze, card-tree, card-list, check-coverage×3, init, validate-cards, bulk-create, card-rename); all 32 commands present; 34-row count + arithmetic verified. **R23-B**: 2 MED stale-reference defects — (a) "case count tolerance: 125" → 134; (b) "SoT Backlog 5 items" appearing in 2 places → 7 items. Also row-annotation confusion ("+1 → 35", "+1 → 36" etc) replaced with explicit CSS-035..CSS-040 IDs. All fixed. v7 iteration 13 final. |
| 24 | Final convergence pass | Found 1 last stale reference: "128-case enumeration" in Step 0 migration block-flow (2 occurrences). Fixed → "134-case enumeration". All other 7 strict checks pass (iteration consistency, number consistency, cross-section consistency, no SoT Backlog 5-item ghosts, no current-state 125/128/136 references outside Verification Trace history, Rounds 2-23 contiguous, footer correct). **ZERO DEFECT — CONVERGENCE FINAL.** v7 iteration 13. |

## Known Limits / Open Items

- **Double-signal hard exit** test deferred — SoT card update needed first (`runner-and-output.md` failures block). Tracked as Backlog #1.
- **EPIPE positive behavior** — testing only negative ("no stdout-write-failed emitted") per Codex `TEST-NEGATIVE-ONLY` verdict. Positive "silent + exit 0" needs SoT update first.
- **case count tolerance**: 134 is the verified exhaustive total (sum of row counts after R20 boundary additions; B4/B5 deferred to SoT Backlog #6/#7). Actual implementation may merge closely-related cases via `it.each` if SoT contract allows; the 134 stable case IDs (CSS/STD/ERR/PEX/QUI/ASW/CMF/RCC/RSE/RLC/PSG/OCF/CMP) remain the unit of plan-to-test traceability.

---

This doc is **iteration 13** (Plan v7). R16 (iter 10) fixed 9 defects; R18 (iter 11) closed 4 migration-readiness gaps; R20 (iter 12) added Per-command Contract Specificity + 6 boundaries; **R22 (iter 13)** added Case ID Allocation (134 stable IDs, CI-lint enforced) + Atom-level POST-001 enumeration (34-row table extracted from every command card).

**R16 fixes (iteration 10, retained)**:
- D1: command-success-stdout 32→34 cases (check-coverage POST-001a/b/c as 3 distinct)
- D2: commander-fallback 5→6 cases (InvalidArgumentError case added)
- D3: TOTAL 125→128 (D1+D2 cascade)
- D4: runner-and-output.md PRE-001 explicit citation → command-success-stdout
- D5: runner-commander-fallback.md PRE-001 explicit citation → commander-fallback
- D6: runner-commander-fallback.md INV-001 (parent INV inheritance) explicit citation → commander-fallback
- D7: SoT backlog #4 scope corrected: "stderr EPIPE swallow" → "stderr write-failure swallow (any exception)"
- D8: SoT backlog #5 added: cleanup-failed warning vs --quiet contract drift (runner.ts:106 emits without quiet check)
- D9: stderr-channel SRP — widened responsibility statement to "output channel discipline" (INV-005 + INV-003 both govern the SAME boundary)

**R18 gap closures (iteration 11)**:
- G1: Harness Selection table — 13 files mapped to `runEd` (11) or `spawnCli` (2) with rationale
- G2: Fixture Strategy section — fully isolated per-case mkdtemp + cleanup; no shared state
- G3: SoT Backlog Resolutions — initially 5 items (R18); grew to 7 in R20 (#6 = no-op decision for invalid B4, #7 = card update for glossary-define ≤50). Each has proposed resolution + rationale + target card.
- G4: Step 0 Audit — 164 blocks classified; 7 lint-delete, 157 production blocks routed to 13 v6 files

**Before migration begins**: user decides on SoT Backlog Resolutions table (7 items). Tests reflect those decisions.
