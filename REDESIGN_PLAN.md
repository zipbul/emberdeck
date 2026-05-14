# Envelope-Removal Redesign — Executable Plan v2

> **Status**: Phase 1.1 ✅ + Phase 1.2 partial ✅ done in commits `072d2c7`, `f96a50d`. Phase 1.3+ pending.
> **Last commit**: `a123d9e` (plan v1).
> **Plan version**: v2. v1 had 8 BLOCKERs found by hostile review; v2 resolves them.
> **Resume directly from §10 (Resume Instructions). All BLOCKER decisions are pre-committed in §2 (Decisions).**

---

## 0. Executive summary

emberdeck CLI currently wraps every command's output in a JSON envelope `{schemaVersion, status, data, warnings, errors, error?}`. 11 rounds of hostile review against the envelope produced a recurring defect class: `errors[]` mixed three concerns (link broken / structural skip / I/O), `data` was polymorphic per command anyway, exit code derivation drifted between commands. **v2 design: remove the envelope; each command emits its natural JSON shape on stdout; stderr carries diagnostics as JSON-lines; exit code per-command policy.**

This plan executes the removal in 4 phases. Phases 1.1–1.2 are done. Phases 1.3–4 are pending. **A fresh agent should be able to execute Phase 1.3 → 4 using this plan alone, with no other context.**

---

## 1. Final design (frozen)

### 1.1 Channel responsibilities (final)

| channel | content | format |
|---|---|---|
| **stdout** (success or policy-failure with data) | command's natural data shape | JSON |
| **stdout** (thrown failure) | empty (no bytes written) | n/a |
| **stderr** (always) | diagnostics | JSON-lines, one object per line |
| **exit code** | per-command policy + runner mapping | int from `EXIT` enum |

**stderr JSON-line schema** (single canonical form, used by every stderr emission):
```
{"level": "error" | "warning" | "verbose", "code": string, "message": string, "details"?: Record<string, unknown>}
```

Examples:
- Auto-sync per-file failure: `{"level":"warning","code":"CARD_SYNC_FAILED","message":"path: reason","details":{"file_path":"/abs/path.md"}}`
- Thrown CardNotFoundError: `{"level":"error","code":"CARD_NOT_FOUND","message":"Card not found: \"foo\""}`
- Verbose trace: `{"level":"verbose","code":"RUNTIME","message":"buildRuntime: config=... dir=..."}`

No free-text stderr. Consumers read stderr line-by-line, `JSON.parse` each line. Format violation is a bug.

### 1.2 What is removed (from v1 envelope)

Source: `src/cli/output.ts` and `src/cli/runner.ts`.

- Types: `CliResult`, `CliMessage`, `CliError`
- Constants: `SCHEMA_VERSION`, `ERROR_CODE_TO_EXIT` (moved into runner)
- Functions: `ok()`, `partial()`, `err()`, `unknown()`, `render()`, `statusToExitCode()`, `resolveOutputMode()`, `mergeCardSyncWarnings()`
- Envelope keys: `schemaVersion`, `status`, `data` wrapper, top-level `warnings`, top-level `errors`, `error?`

### 1.3 What replaces them

```ts
// src/cli/output.ts (v2)

import { EXIT, type ExitCode } from './exit-codes';

export interface OutputContext {
  quiet: boolean;
}

export function buildOutputContext(flags: { quiet?: boolean }): OutputContext {
  return { quiet: !!flags.quiet };
}

/** Emit success data as a single JSON value on stdout. Per-command quiet collapse
 *  is the caller's responsibility (commands compute their quiet form before calling). */
export function emitResult(data: unknown): void {
  try {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } catch (e) {
    // EPIPE (piped to head etc) or circular ref. Ignore EPIPE; rethrow other.
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'EPIPE') return;
    emitError({ code: 'OUTPUT_ENCODE_FAILED', message: e instanceof Error ? e.message : String(e) });
    process.exit(EXIT.GENERIC_ERROR);
  }
}

export function emitWarning(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'warning', ...obj });
}

export function emitError(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'error', ...obj });
}

export function emitVerbose(message: string, details?: Record<string, unknown>): void {
  emitLine({ level: 'verbose', code: 'RUNTIME', message, ...(details ? { details } : {}) });
}

function emitLine(obj: { level: 'error' | 'warning' | 'verbose'; code: string; message: string; details?: Record<string, unknown> }): void {
  try {
    process.stderr.write(JSON.stringify(obj) + '\n');
  } catch {
    // stderr EPIPE — silent. Diagnostics are best-effort.
  }
}
```

### 1.4 Command-runner contract (final)

Each CLI command action is an `async function(rt: CliRuntime): Promise<CommandReturn>` where:

```ts
export type CommandReturn = { data?: unknown; exitCode?: number } | undefined;
```

**Rules**:
- Return `{ data: D }` → runner emits `D` on stdout, exits with `EXIT.OK` (0).
- Return `{ data: D, exitCode: 2 }` → runner emits `D` on stdout, exits with `2` (policy-failure with data).
- Return `undefined` → runner emits nothing on stdout, exits with `EXIT.OK`. Used for commands that handled their own output (rare; default is to return data).
- Throw → runner catches, emits one `level:error` JSON-line on stderr via `toCliError`, exits with the mapped exit code.
- Commands MUST NOT call `process.exit` directly. The runner owns lifecycle (cleanup, SIGINT, exit).

**Per-command exit code policy**:
- Thrown errors → runner's `toCliError` → `ERROR_CODE_TO_EXIT` mapping (in `src/cli/errors.ts` after the move).
- Policy failures (e.g. `ed validate links` finds broken links) → command returns `exitCode: 2` explicitly in `CommandReturn`.
- Each command's CLI-shape spec card lists the policy exit codes it can return (in addition to the global thrown-error mapping, which is inherited).

### 1.5 EXIT enum (unchanged, copied here for grounding)

```ts
export const EXIT = {
  OK: 0,
  GENERIC_ERROR: 1,
  VALIDATION_FAILURE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  PERMISSION_OR_IO: 5,
  CONFIG_MISSING: 6,
  TRANSIENT: 7,
  SIGINT: 130,
};
```

### 1.6 Per-command CLI-shape spec card family (new)

A new card family is introduced under `cli-surface/command-routing-and-output/commands/`:

| spec card key | command | source file |
|---|---|---|
| `cli-surface/command-routing-and-output/commands/card-get` | `ed card get` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-list` | `ed card list` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-create` | `ed card create` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-update` | `ed card update` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-delete` | `ed card delete` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-rename` | `ed card rename` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-search` | `ed card search` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-export` | `ed card export` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-set-status` | `ed card set-status` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-tree` | `ed card tree` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-context` | `ed card context` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/card-relations` | `ed card relations` | `src/cli/commands/card.ts` |
| `cli-surface/command-routing-and-output/commands/validate-cards` | `ed validate cards` | `src/cli/commands/validate.ts` |
| `cli-surface/command-routing-and-output/commands/validate-links` | `ed validate links` | `src/cli/commands/validate.ts` |
| `cli-surface/command-routing-and-output/commands/validate-aggregate` | `ed validate` | `src/cli/commands/validate.ts` |
| `cli-surface/command-routing-and-output/commands/check-drift` | `ed check drift` | `src/cli/commands/check.ts` |
| `cli-surface/command-routing-and-output/commands/check-coverage` | `ed check coverage` (+--uncovered/--suggest) | `src/cli/commands/check.ts` |
| `cli-surface/command-routing-and-output/commands/check-impact` | `ed check impact` | `src/cli/commands/check.ts` |
| `cli-surface/command-routing-and-output/commands/check-regression` | `ed check regression` | `src/cli/commands/check.ts` |
| `cli-surface/command-routing-and-output/commands/check-interactions` | `ed check interactions` | `src/cli/commands/check.ts` |
| `cli-surface/command-routing-and-output/commands/spec-sync` | `ed spec sync` | `src/cli/commands/spec.ts` |
| `cli-surface/command-routing-and-output/commands/spec-sync-symbols` | `ed spec sync-symbols` | `src/cli/commands/spec.ts` |
| `cli-surface/command-routing-and-output/commands/bulk-create` | `ed bulk create --from FILE` | `src/cli/commands/bulk.ts` |
| `cli-surface/command-routing-and-output/commands/bulk-sync` | `ed bulk sync` | `src/cli/commands/bulk.ts` |
| `cli-surface/command-routing-and-output/commands/glossary-define` | `ed glossary define` | `src/cli/commands/glossary.ts` |
| `cli-surface/command-routing-and-output/commands/glossary-lookup` | `ed glossary lookup` | `src/cli/commands/glossary.ts` |
| `cli-surface/command-routing-and-output/commands/glossary-remove` | `ed glossary remove` | `src/cli/commands/glossary.ts` |
| `cli-surface/command-routing-and-output/commands/glossary-rename` | `ed glossary rename` | `src/cli/commands/glossary.ts` |
| `cli-surface/command-routing-and-output/commands/init` | `ed init` | `src/cli/commands/single.ts` |
| `cli-surface/command-routing-and-output/commands/analyze` | `ed analyze` | `src/cli/commands/single.ts` |
| `cli-surface/command-routing-and-output/commands/reset` | `ed reset` | `src/cli/commands/single.ts` |

**Each card is a spec**, parent = `cli-surface/command-routing-and-output` (the brief renamed in Phase 1.1). Cards under `card-lifecycle/`, `card-storage/queries/`, etc. (op specs) remain unchanged.

### 1.7 Per-command shapes (final, all decisions made)

Shapes are written as **JSON Schema-ish sketches** with each field's type. The shape goes in the per-command card's first postcondition (POST-001) as a fenced JSON code block. `(P=N)` annotations indicate which policy exit code applies.

```
ed card get <key>
  data shape: CardFile (key, summary, status, type, parent?, namespacesJson?, body?, glossary[], filePath, updatedAt)
  exit codes: 0 (success); thrown→3 NOT_FOUND if no such card.

ed card list [filters] [--limit N] [--offset N]
  data shape: { items: CardRow[], total: number, limit: number, offset: number, has_more: boolean }
  exit codes: 0.

ed card create <key> --type T [...]
  data shape: { key: string, filePath: string, status: string, type: string, parent: string | null }
  exit codes: 0; thrown→4 CONFLICT if key exists.

ed card update <key> [--field, --patch, --glossary, --tag]
  data shape: { key: string, filePath: string, status: string, warnings: { code, message }[] }
  exit codes: 0; thrown→3 NOT_FOUND, 2 VALIDATION_FAILURE.

ed card delete <key> [--force] [--yes]
  data shape: { key: string, filePath: string, cascaded?: string[] }  // cascaded = child keys deleted
  exit codes: 0; thrown→3 NOT_FOUND, 4 CONFLICT if children and no --force.

ed card rename <old> <new>
  data shape: { old_key, new_key, old_path, new_path, failed_reference_updates: string[] }
  exit codes: 0; thrown→3, 4.

ed card search <query>
  data shape: { items: CardRow[], total: number }
  exit codes: 0; thrown→2 FTS_SYNTAX_ERROR.

ed card export <key> [--out FILE | --in-place]
  data shape: { key, mode: 'in-place'|'file'|'stdout', filePath?: string|null, bytes?: number, content?: string }
  (mode='stdout' includes content; --out includes filePath; --in-place includes filePath; consumer dispatches on mode)
  exit codes: 0; thrown→3.

ed card set-status <key> <status> [--reason TEXT]
  data shape: { key: string, oldStatus: string, newStatus: string }
  exit codes: 0; thrown→3, 2 if activation guard fails.

ed card tree <key> [--depth N]
  data shape: TreeNode { key, type, status, summary, children: TreeNode[] }
  exit codes: 0; thrown→3.

ed card context <key> [--depth N]
  data shape: { card: CardFile, relations: { forward: CardRow[], reverse: CardRow[] }, parent_chain: CardRow[] }
  exit codes: 0; thrown→3.

ed card relations <key>
  data shape: { forward: CardRow[], reverse: CardRow[] }
  exit codes: 0; thrown→3.

ed validate cards
  data shape: {
    summary: { total: number, by_code: Record<string, number> },
    items: {
      key: string,
      filePath?: string,
      issues: { code: string, message: string, details?: Record<string, unknown> }[]
    }[],
    file_level_issues: { code: string, message: string, file_path: string }[]  // ORPHAN_FILE, STALE_DB_ROW (no card key)
  }
  exit codes: 0 if summary.total===0; else 2 (policy).

ed validate links [key]
  data shape: {
    summary: { total: number, ok: number, broken: number, skipped: number, io_failed: number },
    items: {
      key: string,
      declared: number,
      resolved: number,
      broken_links?: { file: string, symbol: string, reason: string }[],
      skipped?: { reason: 'key_mismatch' },
      io_error?: { message: string }
    }[]
  }
  exit codes: 0 if summary.{broken,io_failed}===0; else 2.

ed validate
  data shape: { cards: <validate cards shape>, links: <validate links shape> }
  exit codes: 0 if both sub-shapes 0; else 2.

ed check drift [key] [--max-depth N]
  data shape: {
    health: { total, active, drifted, draft },
    cards: { key, summary, status, driftType?, driftTypes?, brokenLinks, totalLinks }[],
    total_drifted: number  // = cards.filter(c=>c.driftType).length
  }
  exit codes: 0 (read-only).

ed check coverage <key>
  data shape: { key, total_symbols, covered_symbols, coverage_ratio: number|null, uncovered: { file, symbol, kind }[] }
  exit codes: 0.
ed check coverage --uncovered
  data shape: { total_symbols, covered_symbols, coverage_ratio, uncovered: { file, symbol, kind }[], uncovered_total }
  exit codes: 0.
ed check coverage --suggest
  data shape: { suggestions: { key, type, parent?, files, symbols, reason, suggested_glossary }[], total }
  exit codes: 0.

ed check impact <files...> [--symbol N...]
  data shape: { risk_level, affected_count, affected_cards: AffectedCard[], new_uncovered_files: string[], suggested_actions: string[], max_fan_in?: number }
  exit codes: 0.

ed check regression <files...>
  data shape: { pass_or_fail: 'pass'|'fail', drifted_ratio: number, threshold: number, affected: AffectedCard[] }
  exit codes: 0 if pass_or_fail==='pass'; else 2.

ed check interactions <keys...>
  data shape: { interactions: Interaction[], undefined_relations: UndefinedRelation[] }
  exit codes: 0.

ed spec sync
  data shape: { created: number, alreadyLinked: number, unmatched: Unmatched[], markerMissing: MarkerMissing[], linkMissing: LinkMissing[] }
  exit codes: 0 (sync is fact-recording; unmatched/marker-missing are diagnostics not failures).

ed spec sync-symbols [--since TS]
  data shape: { applied: AppliedSymbol[], skipped: SkippedSymbol[] }
  exit codes: 0.

ed bulk create --from FILE
  data shape: { created: { key, filePath }[], failed: { input_index, key?, error }[], total: number }
  exit codes: 0 if failed.length===0; else 2.

ed bulk sync [PATH]
  data shape: { synced: number, mode: 'file'|'directory', path: string, failed: { filePath, error }[] }
  exit codes: 0 if failed.length===0; else 2.

ed glossary define [pairs...] [--from f.yaml]
  data shape: { defined: { word, definition }[], errors: { input_index, reason }[] }
  exit codes: 0 if errors.length===0; else 2.

ed glossary lookup [word]
  data shape: { entries: { word, definition }[], total: number }
  // Single-word form returns 1-element entries[]; missing word returns 0-element.
  exit codes: 0.

ed glossary remove <word>
  data shape: { removed: boolean, word: string, affected_card_keys: string[] }
  exit codes: 0; thrown→3 if word not defined.

ed glossary rename <old> <new> [--def TEXT]
  data shape: { old_word, new_word, affected_card_keys: string[] }
  exit codes: 0; thrown→3, 4.

ed init [--project-root] [--cards-dir] [--no-gitignore] [--force]
  data shape: { project_root, cards_dir, config_path, glossary_path, created: string[], skipped: string[], gitignore_updated: boolean }
  exit codes: 0.

ed analyze [--drifted-limit N] [--drifted-offset N]
  data shape: { health, coverage, drifted: { cards, total }, glossary, unlinked_symbols }
  exit codes: 0.

ed reset --yes
  data shape: { cards_deleted: number, glossary_cleared: boolean, db_reset: boolean }
  exit codes: 0.
```

### 1.8 Quiet mode collapse (per-command)

Default: emit full JSON. With `--quiet`, each command may collapse to a smaller form. Per-command quiet form (declared in the same per-command card as a POST):

| command | --quiet output |
|---|---|
| `ed card create` | the key string only |
| `ed card delete` | the key string only |
| `ed card update` | the key string only |
| `ed card rename` | the new_key string only |
| `ed card set-status` | the new status string only |
| `ed card list` | newline-separated keys (text, not JSON) |
| `ed card search` | newline-separated keys |
| `ed bulk create` | newline-separated created keys |
| `ed bulk sync` | the synced count as a bare number |
| `ed glossary define` | newline-separated words defined |
| `ed glossary lookup` | the definition string when 1 entry; newline-separated `word: definition` when many |
| `ed glossary remove` | the word string |
| `ed init` | the project_root path |
| `ed validate cards` / `ed validate links` / `ed validate` | nothing on stdout; exit code carries success/failure |
| `ed check drift` / `ed check regression` | nothing on stdout |
| `ed check coverage` | coverage_ratio as a bare number |
| `ed analyze` | the health.total bare number |
| (other queries: get, tree, context, relations) | full JSON unchanged — already minimal |

`--quiet` mode emits **no stderr** (suppress JSON-lines warnings). Failures still write the single error line + exit code.

---

## 2. Decisions log (replaces v1 "open questions")

Each BLOCKER/HIGH from the v1 hostile review is resolved here. No "open" entries remain.

**D1**: Per-command shapes live in a **new card family** `cli-surface/command-routing-and-output/commands/<command-key>` (§1.6). Op cards remain unchanged.

**D2**: Commands return `{ data?, exitCode? }`. Runner emits + cleanup + exit. `process.exit` is forbidden in command actions (§1.4).

**D3**: `emitWarning` and `emitError` use canonical stderr JSON-line shape `{level, code, message, details?}` (§1.1, §1.3).

**D4**: `ed card export --out STDOUT` emits JSON `{key, mode:'stdout', bytes, content}`. Consumer reads `JSON.parse(stdout).content`. No JSON-invariant violation.

**D5**: stderr is JSON-lines only. No free-text errors. `emitError` emits a structured object (§1.1, §1.3).

**D6**: Per-command shape is declared in the per-command CLI-shape spec card as a postcondition with a **fenced JSON code block** in the postcondition body. No frontmatter `response_shape` field. No card schema extension.

**D7**: `--quiet` per-command form is declared in each per-command card as a POST-002 (§1.8 table is authoritative).

**D8**: GATEs split (§7).

**D9**: PROBLEM.md entries to mark resolved at end of Phase 4: `H-005`, `H-006`, `L-006`, `M-018`, `N-021`, `N-034`. Plus any others matching the envelope topic — grep `PROBLEM.md` for `envelope|status: 'partial'|errors\[\]` before final commit.

**D10**: `README.md` does not exist; skip Phase 4.2.

**D11**: No `--json` flag exists today; v2 does not add one. JSON is always emitted on success.

**D12**: `src/cli/commands/contract.spec.ts` → DELETE. INV-003 (per-file dedup) is gone with the envelope. Per-command shape conformance moves to per-command tests in Phase 3.

**D13**: Phase 2 is **one git commit** spanning sub-steps 2.1–2.6. Agent must NOT commit between sub-steps; use `git stash` if interrupted.

**D14**: `runCli` consolidation is **Phase 3.0**, before any test rewrites. The function moves to `test/cli/runner-helper.ts` (new file) with signature `runCli(args: string[], cwd: string): Promise<{ exitCode: number, stdout: string, stderr: string }>`. Per-file private `runCli` copies are deleted in the same commit.

**D15**: `validate.ts` per-error-code mapping (table in §3.5).

**D16**: SIGINT race — runner's SIGINT handler must flush stdout before exit. Achieved by writing JSON via `process.stdout.write(...)` (synchronous on POSIX TTY/pipe) and only registering SIGINT after the write completes. Spec card invariant: "stdout JSON is written atomically (single `process.stdout.write` call); SIGINT during write is acceptable as the OS-level write is the unit."

**D17**: `emitResult(undefined)` is **forbidden**. Commands must return `{ data: ... }` or `undefined` (no top-level result). Runner emits nothing on `undefined`. This is also documented in §1.4.

---

## 3. Phase breakdown (detailed, executable)

### Phase 1.1 ✅ done (`072d2c7`)
- `ed card rename cli-surface/command-routing-and-envelope → command-routing-and-output`
- Stale string references replaced via sed in cards/source

### Phase 1.2 ✅ done (`f96a50d`)
- Brief `cli-surface/command-routing-and-output.md` rewritten (envelope removed, per-command goals)
- Spec `runner-and-output.md` rewritten (emitResult/emitWarning/emitError contract)
- `card-storage/persistence/sync.md` POST-005 + failures updated (CARD_SYNC_FAILED → stderr JSON-line)

### Phase 1.3 — Create 31 per-command CLI-shape spec cards ⏳

For each command in §1.6 table, create a NEW spec card.

**Template** (copy, fill `<placeholders>`, save to the path in §1.6):

```yaml
---
key: cli-surface/command-routing-and-output/commands/<command-key>
summary: |
  <one-line: what the command does + that this card declares its stdout shape and exit codes>
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary: []
spec:
  preconditions:
    - id: PRE-001
      condition: |
        The runner invokes this command's action with a built CliRuntime (auto-sync
        completed) and the user-supplied arguments validated by commander.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
      guarantee: |
        On success the command returns `{ data, exitCode? }` where `data` matches
        the JSON shape below. The runner writes `data` to stdout via emitResult,
        adds no envelope wrapping, and exits with `exitCode ?? 0`.

        ```jsonc
        // stdout shape for `<command full invocation>`
        <paste the shape from §1.7>
        ```
    - id: POST-002
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-005
      guarantee: |
        Under --quiet, the command produces <the quiet form from §1.8>.
    - id: POST-003
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |
        Exit codes this command can produce:
        - 0 (EXIT.OK): <when>
        - <other policy codes if any with conditions>
        - thrown errors map via the runner's global error→exit table:
          <list relevant thrown error classes for this command>
  invariants:
    - id: INV-001
      always_holds: per-call
      statement: |
        stdout receives at most one JSON value (the data). stderr may receive
        zero or more JSON-lines (warnings/verbose). Failure path writes no
        stdout.
  failures:
    - violation: <one realistic failure mode for this command>
      behavior: <what the runner emits>
---
```

**Workflow per card** (skill-compliant):
1. Run `<self_review>` mentally against §1.7 / §1.8 (paste below) to confirm shape accuracy.
2. Write the card file directly with the template filled (skill allows direct edit + `ed bulk sync` for non-`ed card create` flows; cards under the new path don't exist yet, so direct write is the only option until `ed bulk sync` indexes them).
3. After all 31 cards written, run `ed bulk sync` (expect synced=76, errors=0).
4. Run `ed validate cards` — must show `total_issues: 0`.

**Sub-task list**:
- 1.3.a: Create `commands/` subdirectory under `.emberdeck/cards/cli-surface/command-routing-and-output/`
- 1.3.b: Write each of the 31 cards (use §1.7 + §1.8 as the source of truth)
- 1.3.c: `ed bulk sync` + `ed validate cards` GATE

### Phase 1.4 — SKILL.md rewrite

Target file: `.claude/skills/emberdeck/SKILL.md`.

**Replacement text for the `<envelope>` section** (delete the "출력은 항상 JSON 봉투 ..." paragraph):

```markdown
모든 명령은 stdout 에 그 명령의 자연스러운 JSON 결과를 emit. 공통 envelope 없음. stderr 는 JSON-lines 단일 형식:

```
{"level": "error"|"warning"|"verbose", "code": string, "message": string, "details"?: object}
```

각 명령의 정확한 shape 은 그 명령의 spec card `cli-surface/command-routing-and-output/commands/<command-key>` 에 정의.

exit code: 0 = OK, 2 = policy failure (envelope에 data 있어도 exit 2 가능 — 예: validate links broken found), 3 = not_found, 4 = conflict, 5 = IO, 6 = config_missing, 7 = transient, 1 = generic, 130 = SIGINT.

--quiet: 명령별 축약형 (per-card POST-002 참조). stderr 도 suppress.
```

**Replacement for `<response_shapes>` section** (delete entirely):

```markdown
명령별 응답 shape 은 그 명령의 spec card 의 POST-001 fenced JSON 블록에 정의. 예시 일부 (전체는 카드 참조):

(여기서는 `ed validate links` 와 `ed check drift` 2개만 SKILL 에 인라인. 나머지는 cards 가 SoT.)
```

**Replacement for `<error_recovery>` warnings/errors tables**: keep `ed validate cards warnings` table; replace the envelope codes mini-table with:

```markdown
stderr `level: warning` 코드:

| code | 의미 | 해결 |
|------|------|------|
| `CARD_SYNC_FAILED` | 명령 진입 직전 auto-sync 가 특정 파일을 처리 못 함 | details.file_path 의 파일 수정/제거 → 다음 명령에서 자동 재시도 |

stderr `level: error` 코드 (exit non-zero 와 함께):

| code | 의미 | 해결 |
|------|------|------|
| `CARD_NOT_FOUND` (exit 3) | 명령이 요청한 카드 없음 | key 확인 |
| `VALIDATION_FAILURE` (exit 2) | 정합성 검증 실패 | details 확인 후 fix |
| `CARD_ALREADY_EXISTS` (exit 4) | create 시 키 충돌 | 다른 키 or update 사용 |
| `PERMISSION_OR_IO` (exit 5) | 파일/DB IO | 권한/디스크 확인 |
| `CONFIG_MISSING` (exit 6) | `.emberdeck.jsonc` 없음 | `ed init` |
| `GILDASH_TRANSIENT` (exit 7) | gildash 일시 실패 | 재시도 |
```

Phase 1.4 GATE: SKILL.md updated; run a manual eyeball check.

### Phase 2 — Code (single git commit)

**Pre-flight**: `git diff` clean from Phase 1.

#### 2.1 — Rewrite `src/cli/output.ts`

REPLACE ENTIRE FILE with the code in §1.3 above.

#### 2.2 — Rewrite `src/cli/runner.ts`

REPLACE ENTIRE FILE (template):

```ts
/**
 * Common command runner. Builds runtime, runs command, emits stdout JSON,
 * routes diagnostics to stderr JSON-lines, exits with policy-declared code.
 *
 * @spec cli-surface/command-routing-and-output/runner-and-output
 */
import type { Command } from 'commander';
import { buildRuntime, type GlobalFlags, type CliRuntime } from './context';
import { emitResult, emitError, emitVerbose, emitWarning, buildOutputContext } from './output';
import { toCliError, ERROR_CODE_TO_EXIT } from './errors';
import { EXIT, type ExitCode } from './exit-codes';
import { ensureCardsSynced } from '../ops/sync';

export type CommandReturn = { data?: unknown; exitCode?: ExitCode } | undefined;
export type CommandFn = (rt: CliRuntime) => Promise<CommandReturn>;

export async function run(fn: CommandFn, cmd: Command): Promise<void> {
  const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
  const outCtx = buildOutputContext(globalFlags);
  let rt: CliRuntime | undefined;
  let signalInFlight = false;
  const signalHandler = async (sig: string): Promise<void> => {
    if (signalInFlight) process.exit(EXIT.SIGINT);
    signalInFlight = true;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    try { await rt?.cleanup(); } catch { /* best-effort */ }
    if (!outCtx.quiet) emitError({ code: 'SIGINT', message: `${sig} received, exiting` });
    process.exit(EXIT.SIGINT);
  };
  const onSigint = (): void => { void signalHandler('SIGINT'); };
  const onSigterm = (): void => { void signalHandler('SIGTERM'); };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const verboseLog = globalFlags.verbose
    ? (msg: string, details?: Record<string, unknown>) => emitVerbose(msg, details)
    : (_msg: string) => {};

  let exitCode: ExitCode = EXIT.OK;
  try {
    verboseLog(`buildRuntime`, { config: globalFlags.config, dir: globalFlags.dir });
    rt = await buildRuntime(globalFlags);
    verboseLog(`runtime ready`, { cardsDir: rt.ctx.cardsDir });

    const syncFailures = await ensureCardsSynced(rt.ctx);
    if (!outCtx.quiet) {
      for (const f of syncFailures) {
        emitWarning({ code: 'CARD_SYNC_FAILED', message: `${f.filePath}: ${f.error}`, details: { file_path: f.filePath } });
      }
    }

    const ret = await fn(rt);
    verboseLog(`command done`, { hasData: ret?.data !== undefined });

    if (ret && ret.data !== undefined) emitResult(ret.data);
    exitCode = ret?.exitCode ?? EXIT.OK;
  } catch (e) {
    verboseLog(`command threw`, { class: e instanceof Error ? e.constructor.name : 'unknown' });
    const cliErr = toCliError(e);
    if (!outCtx.quiet) {
      emitError({ code: cliErr.code, message: cliErr.message, ...(cliErr.details ? { details: cliErr.details } : {}) });
    }
    exitCode = (ERROR_CODE_TO_EXIT[cliErr.code] ?? EXIT.GENERIC_ERROR) as ExitCode;
  }

  try { await rt?.cleanup(); } catch (ce) {
    verboseLog(`cleanup failed`, { class: ce instanceof Error ? ce.constructor.name : 'unknown' });
  }
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  process.exit(exitCode);
}

export function classifyErrorStatus(code: string): 'unknown' | 'error' {
  if (code === 'GILDASH_TRANSIENT' || code === 'NETWORK_TRANSIENT') return 'unknown';
  return 'error';
}

function extractGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
  return {
    config: opts.config as string | undefined,
    dir: opts.dir as string | undefined,
    dbPath: opts.dbPath as string | undefined,
    projectRoot: opts.projectRoot as string | undefined,
    quiet: opts.quiet as boolean | undefined,
    verbose: opts.verbose as boolean | undefined,
  };
}
```

#### 2.3 — Rewrite each command file

For each file in `src/cli/commands/*.ts`:

1. Remove `import { ok, partial, ... } from '../output'`.
2. Change every `return ok(D)` → `return { data: D }`.
3. Change every `return partial(D, errors)` → `return { data: { ...D, errors }, exitCode: 2 }` OR collapse to a clean shape per §1.7.
4. Map errors per §3.5 (validate.ts specifically).
5. Map `--quiet` collapse per §1.8.

**Exhaustive list of command files**:
- `src/cli/commands/bulk.ts`
- `src/cli/commands/card.ts`
- `src/cli/commands/check.ts`
- `src/cli/commands/glossary.ts`
- `src/cli/commands/single.ts`
- `src/cli/commands/spec.ts`
- `src/cli/commands/validate.ts`

#### 2.4 — `src/cli/errors.ts` adjustments

- Move `ERROR_CODE_TO_EXIT` from `output.ts` to `errors.ts` (export it).
- `toCliError` returns `{ code: string, message: string, details?: Record<string, unknown> }` (already similar).

#### 2.5 — Delete obsolete files

- `src/cli/commands/contract.spec.ts` (D12).
- `test/cli/json-envelope-schema.test.ts`.
- `src/cli/output.spec.ts` (if exists).

#### 2.6 — Adjust `src/cli/runner.spec.ts`

- Delete the `mergeCardSyncWarnings` describe block (7 tests).
- Keep `classifyErrorStatus` tests.

**Phase 2 GATE 1** (mid-phase): `bunx tsc --noEmit` must be CLEAN. If TS errors remain, Phase 2 incomplete; fix before next sub-step.

**Phase 2 GATE 2** (end of phase): `bunx tsc --noEmit` clean. `bun test` will have failures (expected). **Record the failing count**; expect 100–400 failures all in `test/cli/`, `test/e2e/`, `test/integration/` files. Non-CLI unit tests under `src/**/*.spec.ts` (excluding `output.spec.ts` and the dedup tests deleted) must still pass.

### Phase 3 — Tests

#### 3.0 — Consolidate runCli helper

CREATE `test/cli/runner-helper.ts`:

```ts
import { spawn } from 'bun';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '../../cli.ts');

export interface RunResult { exitCode: number; stdout: string; stderr: string; }

export async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = spawn(['bun', CLI, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

export function parseJsonLines(stderr: string): Array<{ level: string; code: string; message: string; details?: Record<string, unknown> }> {
  return stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
```

DELETE per-file private `runCli` definitions in:
- `test/cli/fs-race.test.ts`
- `test/cli/flag-overrides.test.ts`
- `test/cli/symlink.test.ts`
- `test/cli/db-corruption.test.ts`
- `test/cli/fs-error.test.ts`
- `test/cli/json-envelope-schema.test.ts` (already deleted in 2.5)
- `test/cli/phase2.test.ts`, `test/cli/phase2-polish.test.ts`, `test/cli/commands.test.ts` (any with private runCli — confirm via `grep -l "async function runCli"`)

Replace all with `import { runCli, parseJsonLines } from './runner-helper';`.

#### 3.1 — Test pattern remap

Run `rg "parsed\.(status|data|warnings|errors|error|schemaVersion)" test/ src/` to enumerate every assertion pattern. Apply per the table below:

| v1 assertion | v2 replacement |
|---|---|
| `expect(parsed.status).toBe('ok')` | `expect(exitCode).toBe(0)` |
| `expect(parsed.status).toBe('partial')` | `expect(exitCode).toBe(2)` |
| `expect(parsed.status).toBe('error')` | `expect(exitCode).not.toBe(0); expect(parsed).toBeUndefined()` (no stdout) |
| `expect(parsed.data.X).toBe(...)` | `expect(parsed.X).toBe(...)` (parsed is data directly) |
| `expect(parsed.errors.some(e => e.code==='BROKEN_LINK'))` | `expect(parsed.links.items.some(i => i.broken_links?.length))` |
| `expect(parsed.errors.some(e => e.code==='CARD_SYNC_FAILED'))` | `expect(parseJsonLines(stderr).some(l => l.code==='CARD_SYNC_FAILED'))` |
| `expect(parsed.errors.some(e => e.code==='ORPHAN_FILE'))` | `expect(parsed.cards.file_level_issues.some(i => i.code==='ORPHAN_FILE'))` |
| `expect(parsed.errors.some(e => e.code==='VALIDATION_FAILED'))` | `expect(parsed.links.items.some(i => i.io_error))` |
| `expect(parsed.errors.some(e => e.code==='KEY_MISMATCH_SKIPPED'))` | `expect(parsed.links.items.some(i => i.skipped?.reason==='key_mismatch'))` |
| `expect(parsed.schemaVersion).toEqual({major:1,minor:0})` | DELETE assertion |
| `expect(parsed.error?.code).toBe(...)` | `expect(parseJsonLines(stderr).find(l=>l.level==='error')?.code).toBe(...)` |
| `expect(parsed.warnings.some(...))` | `expect(parseJsonLines(stderr).some(...))` |

Apply mechanically to every affected test file.

#### 3.2 — Add new tests

CREATE `test/cli/auto-sync-warnings.test.ts`:
- Asserts a corrupt card file produces exactly one `level:warning code:CARD_SYNC_FAILED` JSON-line on stderr from any read command (e.g. `ed card list`).
- Asserts stdout shape is unaffected.
- Asserts exit code is the operation's natural code (0 for list).

#### 3.3 — Adjust e2e and integration tests

- `test/e2e/flows.test.ts` — apply table above.
- `test/integration/*.test.ts` — apply table above.
- Any `test/ops/*.test.ts` using a private runCli: deferred to 3.0 cleanup.

**Phase 3 GATE**: `bun test` ALL PASS (0 failures).

### Phase 4 — Documentation cleanup

#### 4.1 — PROBLEM.md

Mark these entries resolved (one-line note "closed by envelope-removal commit `<sha>`"):
- `H-005`, `H-006`, `L-006`, `M-018`, `N-021`, `N-034`
- Plus any others found via `grep -E "envelope|status: 'partial'|errors\[\]" PROBLEM.md`.

ADD a new entry summarizing the redesign:
```
### v2 envelope-removed — resolved
Status: shipped (commit <sha>). v1 envelope dropped in favor of per-command shapes + stderr JSON-lines. Card family `cli-surface/command-routing-and-output/commands/` documents each command. See `REDESIGN_PLAN.md`.
```

#### 4.2 — README.md

SKIP. (`README.md` does not exist; verified via `ls /home/revil/projects/zipbul/emberdeck` during plan authoring.)

#### 4.3 — Rebuild dist (optional)

If `dist/` was committed previously, run the build pipeline (whatever produces it) and commit the regenerated artifacts. Confirm dist matches src.

---

## 4. `validate.ts` per-error-code mapping (the specific gap from hostile)

| v1 code | v2 location |
|---|---|
| `BROKEN_LINK` | stdout `data.links.items[].broken_links[]` |
| `VALIDATION_FAILED` | stdout `data.links.items[].io_error?` |
| `KEY_MISMATCH_SKIPPED` | stdout `data.links.items[].skipped?: { reason: 'key_mismatch' }` |
| `STALE_DB_ROW` | stdout `data.cards.file_level_issues[].code='STALE_DB_ROW'` |
| `ORPHAN_FILE` | stdout `data.cards.file_level_issues[].code='ORPHAN_FILE'` |
| `KEY_MISMATCH` | stdout `data.cards.file_level_issues[].code='KEY_MISMATCH'` |
| `ORPHAN_CARD`, `BROKEN_PARENT`, `BROKEN_RELATION`, etc. (validateCards warnings) | stdout `data.cards.items[<card>].issues[]` |
| `CARD_SYNC_FAILED` (runner-level) | stderr JSON-line (always, regardless of command) |

`ed validate cards` exit code policy: 0 if `summary.total === 0`; else 2.
`ed validate links` exit code policy: 0 if `summary.broken === 0 && summary.io_failed === 0`; else 2.
`ed validate` exit code: max of sub-policies.

---

## 5. GATEs (precise, non-contradicting)

| GATE | when | criteria | action on fail |
|---|---|---|---|
| G1 (Phase 1.3) | after creating 31 cards | `ed validate cards` → `total_issues: 0` | fix card content; re-run |
| G2 (Phase 1.4) | after SKILL.md edits | manual eyeball | edit |
| G3 (Phase 2 mid) | after 2.1+2.2+2.4 | `bunx tsc --noEmit` clean | fix types |
| G4 (Phase 2 end) | after 2.1–2.6 | `bunx tsc --noEmit` clean; record `bun test` failure count (expected 100–400 in CLI tests) | proceed to Phase 3 |
| G5 (Phase 3.0) | after runCli consolidation | `grep "async function runCli\|function runCli" test/` returns only the new helper file | delete remaining duplicates |
| G6 (Phase 3.1+3.2+3.3) | after all test rewrites | `bun test` 0 failures | iterate |
| G7 (Phase 4) | after docs | `ed validate cards` + `ed validate links` clean; `ed spec sync` errors `[]` | fix |
| G8 (final) | end | end-to-end: `bun cli.ts analyze` returns sensible JSON with NO v1 keys (`schemaVersion`/`status`/`data`/`errors`/`warnings`) at top level | trace + fix |

---

## 6. Risk register

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| Phase 2 atomic-commit reviewability | High | Med | Reviewers read this plan first; single commit is unavoidable for coherence (D13) |
| Card-code drift permanent if Phase 2 stalls | High | High | If Phase 2 cannot complete in session, ROLLBACK Phase 1.3 + 1.2 + 1.1 (commits `f96a50d`, `072d2c7`, and any Phase 1.3 commits) before stopping |
| Hostile re-review finds new defects | Certain | Low | Per-command defects fix per-card; no shared-envelope defect class can recur by construction (§9) |
| stderr JSON-line format violation by accident | Med | Low | Phase 3.2 auto-sync test asserts the format; any free-text emission breaks the test |
| `--quiet` collapse rule drift | Med | Low | Each per-command card POST-002 declares; §1.8 is the index |
| SIGINT mid-stdout-write | Low | Low | `process.stdout.write` is a single OS-level syscall on POSIX; SIGINT either happens before (no output) or after (full output). Documented in D16 |
| `process.exit` accidentally called in a command | Med | High | Phase 3.2 contract test: `grep "process.exit" src/cli/commands/` returns 0 lines |

---

## 7. Rollback story

**During Phase 1.3** (cards being created):
- `git checkout -- .emberdeck/cards/cli-surface/command-routing-and-output/commands/`
- (Optional) `git revert <Phase 1.3 commits>`.
- State returns to `f96a50d`.

**Between Phase 2 sub-steps** (uncommitted):
- `git stash` then `git stash drop` to discard.
- (Never `git commit` between 2.1–2.6.)

**After Phase 2 commit, before Phase 3**:
- `git revert <Phase 2 commit>` restores `f96a50d` state. Phase 1.3 cards remain (they describe a system that no longer exists in code; this is acceptable as documented future-work).

**After Phase 3 completion**:
- Rollback is undesirable; the project is in v2 state coherently. If a fundamental issue is found, hostile re-review and iterate forward; do not revert.

---

## 8. Effort estimate (remaining)

| phase | turns | files | LOC |
|---|---|---|---|
| 1.3 | 6–10 | 31 new cards | ~30 × 60 = ~1800 |
| 1.4 | 1–2 | 1 (SKILL.md) | ~100 changed |
| 2.1 | 1 | 1 (output.ts) | ~80 |
| 2.2 | 1 | 1 (runner.ts) | ~100 |
| 2.3 | 4–6 | 7 (command files) | ~400 changed |
| 2.4 | 1 | 1 (errors.ts) | ~20 |
| 2.5 | 1 | 3 deletes | n/a |
| 2.6 | 1 | 1 (runner.spec.ts) | ~50 deleted |
| 3.0 | 2 | 1 new + ~10 edits | ~80 |
| 3.1 | 6–10 | ~20 test files | ~600 changed |
| 3.2 | 1 | 1 new test | ~60 |
| 3.3 | 2–3 | ~5 e2e/integration | ~200 changed |
| 4.1 | 1 | 1 (PROBLEM.md) | ~30 |

**Total estimate: 30–40 turns**, 50–80 files touched, ~3500 LOC delta.

---

## 9. Resume instructions (for fresh agent)

1. **Read** this `REDESIGN_PLAN.md` v2 in full.
2. **Verify git state**:
   ```bash
   git log --oneline -10
   ```
   Expected: `a123d9e docs(redesign): add detailed multi-phase plan ...` (or this v2's commit), `f96a50d refactor(cards): rewrite output contract ...`, `072d2c7 refactor(cli-surface): rename ...`. If the latest is `a123d9e` (v1 plan), this v2 plan replaces it via the next commit.
3. **Confirm cards changed in Phase 1.2**:
   ```bash
   cat .emberdeck/cards/cli-surface/command-routing-and-output.md  | head -30
   cat .emberdeck/cards/cli-surface/command-routing-and-output/runner-and-output.md  | head -30
   ```
   Both should be v2 (no `envelope` in summary; mention emitResult/emitError).
4. **Start Phase 1.3**:
   - Create directory: `mkdir -p .emberdeck/cards/cli-surface/command-routing-and-output/commands`
   - For each of the 31 commands in §1.6, write the file (use §3.1 Phase 1.3 template; fill placeholders from §1.7 + §1.8).
   - Run `ed bulk sync` → expect synced=76, errors=0.
   - Run `ed validate cards` → expect `total_issues: 0`. This is GATE G1.
5. **Phase 1.4**: edit `.claude/skills/emberdeck/SKILL.md` per §3.2 patches. GATE G2.
6. **Commit Phase 1.3 + 1.4** as one or two commits (atomic per Phase is fine; Phase 1 sub-phases need not be one commit).
7. **Phase 2**: read §3.2 sub-steps. Stage all changes. Do NOT commit between sub-steps. Run GATE G3 (`bunx tsc --noEmit`) after 2.1+2.2+2.4 to catch type errors early. After 2.1–2.6 all done, commit as one. GATE G4.
8. **Phase 3**: 3.0 first (helper consolidation), then 3.1/3.2/3.3 in any order. GATE G5 after 3.0, GATE G6 after 3.3.
9. **Phase 4**: PROBLEM.md edit. GATE G7.
10. **Final GATE G8**: end-to-end smoke. Commit + push.

If you (the agent) encounter ambiguity NOT resolved in this plan, STOP and document the gap in §2 Decisions. Do not invent.

---

## 10. Why this design survives (the meta-argument)

The v1 envelope produced 11 review rounds because every defect touched the shared `errors[]` / `status` / `data` wrapper — the surface was small (one envelope) but the coupling was total (every command instance of the envelope had to satisfy every invariant). One defect = N commands needed updating.

v2's surface is larger (31 per-command shapes) but coupling is zero (a defect in `ed validate links`'s shape cannot induce a defect in `ed card create`'s shape). Cost of round-N review on v1 = O(commands × envelope-invariants); on v2 = O(1) per command found defective. Reviewers may find more total defects across more commands, but each is locally fixable and cannot cascade. The defect class that produced 11 rounds — `errors[]` mixing 3 concerns — is structurally impossible in v2 (no `errors[]`).

This is the trade we accept.

---

## 11. Cards/files inventory at end of redesign (for verification)

After all phases complete:

**New cards** (31):
- `.emberdeck/cards/cli-surface/command-routing-and-output/commands/*.md` (31 files)

**Rewritten cards** (3, done in 1.2):
- `cli-surface/command-routing-and-output.md`
- `cli-surface/command-routing-and-output/runner-and-output.md`
- `card-storage/persistence/sync.md` (POST-005 + failures)

**Total cards in `ed validate cards`**: previous count (45 or current) + 31 = ~76. Verify with `ed validate cards` output count.

**Deleted files**:
- `src/cli/commands/contract.spec.ts`
- `test/cli/json-envelope-schema.test.ts`
- `src/cli/output.spec.ts` (if it exists)

**Rewritten source files** (~10):
- `src/cli/output.ts` (rewrite)
- `src/cli/runner.ts` (rewrite)
- `src/cli/runner.spec.ts` (dedup tests deleted)
- `src/cli/errors.ts` (ERROR_CODE_TO_EXIT moved in)
- `src/cli/commands/*.ts` × 7 (envelope removal)

**Rewritten test files** (~20):
- See §3.0 D14 list + e2e/integration

**SKILL.md**: heavily edited
**PROBLEM.md**: 6+ entries marked resolved + new entry

---

End of plan v2.
