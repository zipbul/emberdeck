# Envelope-Removal Redesign — Executable Plan v2.13

> **Status**: Phase 1.1 ✅ + Phase 1.2 partial ✅ done in commits `072d2c7`, `f96a50d`. Phase 1.2.5 + 1.3+ pending.
> **Last commit (plan)**: `1c48ad0` (v2.12).
> **Plan version**: v2.12. 14th hostile attacked v2.11's new additions and found a BLOCKER: v2.11 pinned OP-2 pseudocode to flat `{cardKey, oldSymbol, newSymbol, file, changeType}` but §1.7's `spec sync-symbols.applied[]` declared grouped `{oldSymbol, newSymbol, file, affected_cards:[]}` — the "CLI maps directly, no transformation" claim was false. Plus Phase 2.3a's "delete the line" escape valve violated D36's "Phase 2 doesn't touch op-tests" commit-boundary. v2.12 (a) flattens §1.7 applied shape to match OP-2 (chosen: gildash returns per-link, no grouping needed; consumer groupBy if wanted), (b) collapses Phase 3.0a back into Phase 2.3a — single Phase 2 commit rewrites op + op-tests atomically (D36 retired), (c) fixes input_index duplicate-key Map collapse, (d) standardizes snake_case in skipped.details, (e) adds Phase 3.0a's missing `result.changes`-length rewrite rule.
> **Design principle (final)**: §1.7 is canonical — code adapts to §1.7, not the other way. Each command's shape is derived from its functional category (single read / list / mutation / batch / validation / etc.); divergence from the category template is a defect, not an accepted variation.
> **Resume directly from §10 (Resume Instructions). All BLOCKER + HIGH decisions are pre-committed in §2 (Decisions).**

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

/** OutputEncodeError — thrown by emitResult when JSON.stringify fails (e.g. BigInt,
 *  circular ref). Runner catches and maps to exit 1 + stderr line. Per D26 we do
 *  NOT process.exit here so the runner's cleanup (DB close, file handles) runs. */
export class OutputEncodeError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'OutputEncodeError';
  }
}

/** StdoutWriteError — thrown by emitResult when stdout.write's callback reports a
 *  non-EPIPE error (e.g. disk-backed redirect that ran out of space). Runner
 *  catches and maps to exit 5 (PERMISSION_OR_IO). EPIPE is silently swallowed
 *  per UNIX SIGPIPE convention. */
export class StdoutWriteError extends Error {
  constructor(public readonly cause: NodeJS.ErrnoException) {
    super(cause.message);
    this.name = 'StdoutWriteError';
  }
}

/** Emit success data as a single JSON value on stdout. Pretty in default mode,
 *  compact under --quiet (per D19). Per D25 we ALWAYS wait for the write
 *  callback before resolving — never resolve early on the sync fast path — so
 *  `process.exit` (called by the runner afterward) cannot truncate a pipe-bound
 *  payload. The previous v2.8 fast path (`if (ok) resolve()`) defeated D25;
 *  fixed in v2.9 per H1. */
export async function emitResult(data: unknown, ctx: OutputContext): Promise<void> {
  let payload: string;
  try {
    const indent = ctx.quiet ? undefined : 2;
    payload = JSON.stringify(data, null, indent) + '\n';
  } catch (e) {
    // JSON.stringify failed (BigInt, circular). Bubble to runner; do NOT process.exit (D26).
    throw new OutputEncodeError(e);
  }
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (err) => {
      if (!err) return resolve();
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'EPIPE') return resolve();  // SIGPIPE convention; exit code unchanged.
      // Real I/O failure (ENOSPC, EIO). Surface to runner; runner maps to exit 5.
      reject(new StdoutWriteError(err as NodeJS.ErrnoException));
    });
  });
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
- Return `undefined` (or `{data: undefined}`) → runner emits nothing on stdout, exits with `EXIT.OK`. Reserved for void-side-effect commands (currently none in v2 scope; commands SHOULD always return `{data}` with a concrete payload, even if it's `{}`). Commands MUST NOT write stdout directly; only the runner calls `emitResult`. (See D17 for the runner-side guard rule.)
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
| `cli-surface/command-routing-and-output/commands/runner-commander-fallback` | (no `.command()`; commander error fallback) | `cli.ts` + `src/cli/index.ts` (Phase 2.7) |

(32 cards total — 31 ed subcommands + 1 commander-fallback meta-card.)

**Each card is a spec**, parent = `cli-surface/command-routing-and-output` (the brief renamed in Phase 1.1). Cards under `card-lifecycle/`, `card-storage/queries/`, etc. (op specs) remain unchanged.

### 1.7 Per-command shapes (final, all decisions made)

Shapes are written as **JSON Schema-ish sketches** with each field's type. The shape goes in the per-command card's first postcondition (POST-001) as a fenced JSON code block. `(P=N)` annotations indicate which policy exit code applies.

**Shape-classification rubric (v2.9, canonical)** — every command's shape MUST fit one of these categories. Divergence = defect.

| # | category | shape skeleton | rationale |
|---|---|---|---|
| C1 | single read | flat object of entity fields | no wrapper; entity IS the response |
| C2 | list (paginated) | `{items:[], total, limit?, offset?, has_more?}` | unify list shape; no word-vs-no-word divergence |
| C3 | mutation (single) | `{...mutated_entity_identifiers, ...changed_fields}` | side-effect = "what changed"; concrete IDs, not counters |
| C4 | batch mutation | `{<verb>:[{...}], failed:[{input_index|filePath, error, ...}], total}` | array-valued success+failure (NOT counters) so caller can retry |
| C5 | validation (per-entity grouped) | `{summary:{by_code, total, ok, broken, ...}, items:[{key, issues|broken_links, ...}], file_level_issues?:[]}` | envelope-derived defect fix: group by entity; file-level (no key) separate bucket |
| C6 | structured detail item | inside C5: each issue `{file, symbol, reason, ...}` — NEVER a flattened message string | consumer must filter/group without string parsing |
| C7 | multi-dimension report | `{<dim1>:{...}, <dim2>:{...}, ...}` each dim is its own natural shape | each dimension stands alone; cards-array within a dim carries its own `total` |
| C8 | mode-discriminated | one card, N POST-001 blocks (one per mode), consumer dispatches on field presence | unifying loses information; explicit mode flag in shape when needed |
| C9 | policy gate | `{pass_or_fail, ...reasoning fields, affected:[]}` | exit code is the real signal; data is the reasoning |
| C10 | environment / scaffold | `{...paths_or_resources, created:[], skipped:[], ...flags}` | idempotent setup reports what changed vs what was already there |

Command → category mapping is annotated `(Cn)` on each command below. Phase 2.3 verifies that the implemented shape matches its category template.

```
ed card get <key>  (C1)
  data shape: CardFile + optional history. FLAT (no `frontmatter` nesting):
  {
    key, summary, status, type, parent: string|null,
    glossary: string[], relations?: string[], tags?: string[],
    principle?, domain?, brief?, spec?,                   // namespace bodies, present per type
    filePath: string, updatedAt: string,
    history?: { entries: { ts, action, fields?: string[] }[] }  // present iff --history was passed
  }
  exit codes: 0 (success); thrown→3 NOT_FOUND if no such card.
  v1→v2 delta (Phase 2.3 hint): current `card.ts:104-112` returns
    `{key, type, status, summary, frontmatter: {...all namespace fields...}, history?}`.
    v2 inlines the frontmatter fields at the root (drop the `frontmatter` wrapper). The
    `history` field stays at the same position. See D23.

ed card list [filters] [--limit N] [--offset N]  (C2)
  data shape: { items: CardRow[], total: number, limit: number, offset: number, has_more: boolean }
  exit codes: 0.
  v1→v2 delta (Phase 2.3 hint): current `card.ts:193-197` returns
    `{items, total, page: {limit, offset, has_more}}`. v2 flattens `page.*` to the root.
    See D23.

ed card create <key> --type T [...]  (C3)
  data shape: { key: string, filePath: string, status: string, type: string, parent: string | null }
  exit codes: 0; thrown→4 CONFLICT if key exists.

ed card update <key> [--field, --patch, --glossary, --tag]  (C3)
  data shape: { key: string, filePath: string, status: string, validation_notes: { code: string, message: string }[] }
  (validation_notes carries non-fatal field warnings — e.g. "status changed to draft because type changed"; renamed from "warnings" per D20 to avoid v1 envelope collision)
  exit codes: 0; thrown→3 NOT_FOUND, 2 VALIDATION_FAILURE.

ed card delete <key> [--force] [--yes]  (C3)
  data shape: { key: string, filePath: string, cascaded?: string[] }  // cascaded = child keys deleted
  exit codes: 0; thrown→3 NOT_FOUND, 4 CONFLICT if children and no --force.

ed card rename <old> <new>  (C3)
  data shape: { old_key, new_key, old_path, new_path, failed_reference_updates: string[] }
  exit codes: 0; thrown→3, 4.

ed card search <query>  (C2)
  data shape: { items: CardRow[], total: number }
  exit codes: 0; thrown→2 FTS_SYNTAX_ERROR.

ed card export <key> [--out FILE | --in-place]  (C8)
  data shape: { key, mode: 'in-place'|'file'|'stdout', filePath?: string|null, bytes?: number, content?: string }
  (mode='stdout' includes content; --out includes filePath; --in-place includes filePath; consumer dispatches on mode)
  exit codes: 0; thrown→3.

ed card set-status <key> <status> [--reason TEXT]  (C3)
  data shape: { key: string, oldStatus: string, newStatus: string }
  exit codes: 0; thrown→3, 2 if activation guard fails.

ed card tree <key> [--depth N]  (C1)
  data shape: TreeNode { key, type, status, summary, children: TreeNode[] }
  exit codes: 0; thrown→3.

ed card context <key> [--depth N]  (C7)
  data shape: { card: CardFile, relations: { forward: CardRow[], reverse: CardRow[] }, parent_chain: CardRow[] }
  exit codes: 0; thrown→3.

ed card relations <key>  (C7)
  data shape: { forward: CardRow[], reverse: CardRow[] }
  exit codes: 0; thrown→3.

ed validate cards  (C5)
  data shape: {
    // summary.by_code MUST aggregate codes from BOTH items[].issues[] AND file_level_issues[]
    // — single source of truth for CI greps like `jq .summary.by_code.KEY_MISMATCH`. (D33)
    // summary.total === sum(items[i].issues.length) + file_level_issues.length.
    summary: { total: number, by_code: Record<string, number> },
    items: {
      key: string,
      filePath?: string,
      issues: { code: string, message: string, details?: Record<string, unknown> }[]
    }[],
    file_level_issues: { code: string, message: string, file_path: string, key?: string }[]
    //   ORPHAN_FILE  — file with no DB row (no key)
    //   STALE_DB_ROW — DB row whose file vanished (carries key for context)
    //   KEY_MISMATCH — frontmatter key != path-derived key (carries BOTH; bucketed
    //                  here per D33 because the "issue is about the file path, not
    //                  the entity"; the card's own items[] entry would imply the
    //                  issue belongs to the card-as-identified-by-its-key, but here
    //                  the key itself is what's wrong. Single canonical bucket prevents
    //                  double-reporting.)
  }
  exit codes: 0 if summary.total===0; else 2 (policy).
  v1→v2 delta (Phase 2.3 — NOT mechanical, see D24): current `validate.ts:208-215` returns
    flat counters `{warnings, stale_db_rows, orphan_files, key_mismatches, total_issues}`
    with separate `errors[]` envelope. v2 requires:
    (1) bucket per-card issues by `cardKey` into `items[].issues[]`,
    (2) split `STALE_DB_ROW`/`ORPHAN_FILE` (no key) → `file_level_issues[]`,
    (3) compute `summary.by_code` from issue counts,
    (4) return `exitCode: 2` when `summary.total > 0` (no more `partial()`).

ed validate links [key]  (C5+C6)
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
  v1→v2 delta (Phase 2.3 — NOT mechanical, see D24): current `validate.ts:158-165` returns
    flat counters `{declared, resolved, broken, unresolved}` with separate `errors[]`
    carrying BROKEN_LINK/KEY_MISMATCH_SKIPPED/VALIDATION_FAILED. v2 requires:
    (1) accumulate one `items[]` entry per target card (explicit-key path = 1 entry; fan-out = N),
    (2) move BROKEN_LINK from flat `errors[]` into the matching `items[i].broken_links[]`,
    (3) convert KEY_MISMATCH_SKIPPED → `items[i].skipped = {reason:'key_mismatch'}`,
    (4) convert VALIDATION_FAILED → `items[i].io_error = {message}`,
    (5) `summary.total` = items.length; `summary.ok` = items with no broken/skipped/io_error,
    (6) return `exitCode: 2` when `summary.broken > 0 || summary.io_failed > 0`.

ed validate  (C7 of C5+C5)
  data shape: { cards: <validate cards shape>, links: <validate links shape> }
  exit codes: 0 if both sub-shapes 0; else 2.
  v1→v2 delta: apply both deltas above; combine into top-level `{cards, links}`.

ed check drift [key] [--max-depth N]  (C7)
  data shape: {
    health: { total, active, drifted, draft },
    cards: { key, summary, status, driftType?, driftTypes?, brokenLinks, totalLinks }[],
    total_drifted: number  // = cards.filter(c=>c.driftType).length
  }
  exit codes: 0 (read-only).
  v1→v2 delta (per D28, Phase 2.3): current `check.ts:28-31` returns `{health, cards}` — `total_drifted` field is MISSING (code comment at line 26-27 argues against it; the comment is wrong per C7 — every cards-array dimension carries its own total). v2 adds `total_drifted = result.cards.filter(c=>c.driftType).length`.

ed check coverage <key>                  // mode='card'   (positional key present)
ed check coverage --uncovered            // mode='uncovered'
ed check coverage --suggest              // mode='suggest'
  (C8 — mode-discriminated)
  Single card with 3 mode-discriminated shape variants. Write the per-command card
  with 3 separate POST-001a/b/c blocks (one per mode), each declaring its shape
  + invariants. The runner dispatches on flags; consumer dispatches on the response's
  field set (presence of `key` vs `uncovered_total` vs `suggestions`).

  POST-001a (mode='card'):
  data shape: { key, total_symbols, covered_symbols, coverage_ratio: number|null, uncovered: { file, symbol, kind }[] }
  exit codes: 0.
  v1→v2 delta (per D29, Phase 2.3): current `check.ts:74-82` returns link-coverage `{declared, resolved, broken, coverage_ratio, unreferenced_symbols, unreferenced_total}` — a DIFFERENT concept (declared codeLinks resolution rate, not symbol coverage). §1.7's POST-001a is **symbol-coverage** (how many project symbols are referenced by THIS card). Phase 2.3 MUST: (a) call `getCoverageByCard(rt.ctx, key)` (the symbol-coverage op — confirm name in src/ops/) instead of `getLinkCoverage`, OR (b) if no such op exists yet, ADD it (count symbols in card's declared codeLinks ÷ total symbols in card's bound files), THEN map to `{key, total_symbols, covered_symbols, coverage_ratio, uncovered:[{file,symbol,kind}]}`. The current op `getLinkCoverage` is REPURPOSED for `check drift`'s link-validity dimension; do NOT delete it.

  POST-001b (mode='uncovered'):
  data shape: { total_symbols, covered_symbols, coverage_ratio, uncovered: { file, symbol, kind }[], uncovered_total }
  exit codes: 0.
  v1→v2 delta: current matches §1.7. Mechanical `ok(D) → {data:D}`.

  POST-001c (mode='suggest'):
  data shape: { suggestions: { key, type, parent?, files, symbols, reason, suggested_glossary }[], total }
  exit codes: 0.
  v1→v2 delta: current matches §1.7. Mechanical.

ed check impact <files...> [--symbol N...]  (C7)
  data shape (per D22, inline AffectedCard from src/ops/impact.ts):
  {
    risk_level: 'low'|'medium'|'high'|'critical',
    affected_count: number,
    affected_cards: { key: string, summary: string, linkType: 'direct'|'transitive', affectedLinks: number, linkStatus: { valid: number, broken: number } }[],
    new_uncovered_files: string[],
    suggested_actions: string[],
    max_fan_in?: number
  }
  exit codes: 0.
  v1→v2 delta: matches §1.7. Mechanical.

ed check regression <files...>  (C9)
  data shape:
  {
    pass_or_fail: 'pass'|'fail',
    drifted_ratio: number,
    threshold: number,
    affected: { key: string, status: string, driftType?: string }[]
  }
  exit codes: 0 if pass_or_fail==='pass'; else 2.
  v1→v2 delta: matches §1.7. Remove `partial()` branch; return `{data, exitCode: result.passOrFail==='fail' ? 2 : 0}`.

ed check interactions <keys...>  (C7)
  data shape (per D22, inline CardInteraction + UndefinedRelation from src/ops/context.ts):
  {
    interactions: { keys: string[], sharedSymbols: { file: string, symbol: string }[], sharedFiles: string[], importDependencies: { from: string, to: string, file: string }[] }[],
    undefined_relations: { src_key: string, dst_key: string, suggestion: string, reason: string }[]
  }
  exit codes: 0.
  v1→v2 delta: matches §1.7. Mechanical.

ed spec sync  (C4)
  data shape (per D22, inline types from src/ops/spec-sync.ts SpecSyncResult):
  {
    created: number,
    alreadyLinked: number,
    unmatched: { cardKey: string, file: string, symbol: string }[],
    markerMissing: { cardKey: string, file: string, symbol: string }[],
    linkMissing: { cardKey: string, file: string, symbol: string }[]
  }
  exit codes: 0 (sync is fact-recording; unmatched/marker-missing are diagnostics not failures).
  v1→v2 delta (per D30, Phase 2.3): current `spec.ts:28-34` returns `{created, already_linked, unmatched:NUMBER, marker_missing:NUMBER, link_missing:NUMBER}` — three NUMBER counters where §1.7 demands ARRAYS, plus snake_case `already_linked` vs camelCase `alreadyLinked`. Phase 2.3 MUST: (a) pass `result.unmatched`/`result.markerMissing`/`result.linkMissing` arrays through unmodified, (b) rename `already_linked` → `alreadyLinked`, (c) DELETE the `UNMATCHED_ANNOTATION` CliMessage construction (lines 24-27) — diagnostics live INSIDE the arrays now, not in stderr.

ed spec sync-symbols [--since TS]  (C4)
  data shape: {
    applied: { cardKey: string, oldSymbol: string, newSymbol: string, file: string, changeType: 'renamed'|'moved' }[],
    skipped: { reason: 'no_links_referencing_old_symbol'|'symbol_removed_manual_review_required'|'card_not_found'|'metadata_write_failed', symbol?: string, file?: string, details?: { card_key?: string, [k: string]: unknown } }[],
    total: number,                            // events recorded = applied.length + skipped.length (includes CLI-synthesized metadata_write_failed entries)
    since: string,                            // ISO8601 watermark used
    since_source: 'flag'|'last_sync'|'default_24h',
    next_sync_marker: string | null           // null if metadata upsert failed
  }
  Shape is per-link (one row per (cardKey, symbol, file)). Grouping by symbol is left to
  consumers (groupBy applied[].oldSymbol if desired). Rationale: gildash returns
  per-symbol-change events; per-link emission preserves which card was affected — a
  v2.11 grouped shape lost that linkage and forced a CLI-side grouping step that v2.12
  removes.
  Field-naming convention (v2.12, per 14th hostile F4): top-level interface fields
  use camelCase (`cardKey`, `oldSymbol`, `newSymbol`, `changeType`) because they are
  TypeScript surface; the `details` object's keys use snake_case (`card_key`) because
  it is a free-form bag and snake_case is the CLI output convention (cf. `affected_cards`,
  `since_source`, `next_sync_marker`). Mixing inside one response is intentional.
  (Inline shape; actual SymbolChange type lives in src/ops/spec-sync.ts but fields match the public output.)
  exit codes: 0.
  v1→v2 delta (per D30, Phase 2.3): current `spec.ts:91-98` returns `{updated, broken, changes, since, since_source, next_sync_marker}` — `updated`/`broken`/`changes` are aggregate fields that conflate applied/skipped/total. §1.7 splits into `applied:[]` (successfully renamed links) and `skipped:[]` (changes that couldn't be applied — e.g. ambiguous, missing card). Phase 2.3 MUST: (a) restructure `result.changes` into the two arrays — map `applied` entries (where the rename actually happened) and `skipped` entries (the rest) using the existing op's classification; if the op doesn't already classify, ADD that classification to `syncSymbolChanges()` in src/ops/spec-sync.ts, (b) compute `total`, (c) move the `METADATA_WRITE_FAILED` warning from the `ok(data, [...warnings])` second-arg into `skipped:[{reason:'metadata_write_failed', message:upsertWarning}]` — D19 forbids the old warnings channel.

ed bulk create --from FILE  (C4)
  data shape: { created: { key, filePath }[], failed: { input_index, key?, error }[], total: number }
  exit codes: 0 if failed.length===0; else 2.
  v1→v2 delta (per D31, Phase 2.3): current `bulk.ts:75-82` returns COUNTER shape `{succeeded:string[], partial_keys, total, created:NUMBER, failed:NUMBER, rejected_pre_write:NUMBER}` plus a separate CliMessage `errors[]`. §1.7 is ARRAY shape with structured `failed[]`. Phase 2.3 MUST: (a) build `created:[{key, filePath}]` from `result.keys` joined with `result.<created details>` (op may need a minor change to return filePath per created key — if not present, add it), (b) merge `validated.errors` (pre-write) and `result.errors` (write-time) into one `failed:[{input_index, key?, error}]` ordered by input_index, (c) DROP `succeeded`/`partial_keys`/`rejected_pre_write` (all derivable), (d) keep `total` = input count, (e) return `{data, exitCode: failed.length>0 ? 2 : 0}` — no `partial()`.

ed bulk sync [PATH]  (C4)
  data shape: { synced: number, mode: 'file'|'directory', path: string, failed: { filePath, error }[] }
  exit codes: 0 if failed.length===0; else 2.
  v1→v2 delta (per D31, Phase 2.3): current `bulk.ts:109` (file-mode) returns `{synced:1, path, mode:'file'}` with NO `failed` field; current `bulk.ts:118-123` (directory-mode) returns counter `errors:NUMBER` + separate CliMessage `errors[]`. §1.7 unifies both modes to include `failed:[{filePath, error}]` (empty array on success). Phase 2.3 MUST: (a) file-mode returns `{synced:1, mode:'file', path, failed:[]}`, (b) directory-mode replaces `errors:result.errors.length` with `failed: result.errors.map(e=>({filePath:e.filePath, error:errorMessage(e.error)}))`, (c) return `{data, exitCode: failed.length>0 ? 2 : 0}` — no `partial()`.

ed glossary define [pairs...] [--from f.yaml]  (C4)
  data shape: { defined: { word, definition }[], failed: { input_index, reason }[], total: number }
  exit codes: 0 if failed.length===0; else 2.
  (renamed top-level `errors` → `failed` per D20 v2.3)
  v1→v2 delta (per D32, Phase 2.3): current `glossary.ts:64-69` returns `{results, total, created:NUMBER, updated:NUMBER}` — a counter shape that conflates created/updated. §1.7 unifies into `defined:[{word, definition}]` (every entry that was successfully written, whether created or updated) + `failed:[]` (validation/IO failures with their input index). Phase 2.3 MUST: (a) map `result.results` filter where `action==='created'||action==='updated'` → `defined:[{word, definition}]`, (b) accumulate any input-validation failures (from `loadEntriesFromFile`/`parseDefinitionPair` — currently these THROW; v2 catches them per-entry into `failed[]`), (c) `total` = input count, (d) return `{data, exitCode: failed.length>0 ? 2 : 0}`. NOTE: this changes failure semantics from "throw at first bad pair" to "process all, report all failures" — explicitly per D32.

ed glossary lookup [word]  (C2)
  data shape: { entries: { word, definition }[], total: number }
  // Single-word form returns 1-element entries[] (or 0-element if not found); no-word form returns all entries.
  exit codes: 0.
  v1→v2 delta (per D32, Phase 2.3): current `glossary.ts:83-89` BRANCHES the shape — single-word form returns `{found, entry}`, no-word form returns `{entries, total}`. §1.7 unifies to single shape. Phase 2.3 MUST: in the `if (word)` branch, build `{entries: result.found ? [result.entry] : [], total: result.found ? 1 : 0}`; in the else branch keep as is. Single shape regardless of args (C2 invariant).

ed glossary remove <word>  (C3)
  data shape: { removed: boolean, word: string, affected_card_keys: string[] }
  exit codes: 0; thrown→3 if word not defined.
  v1→v2 delta (per D32, Phase 2.3): current `glossary.ts:109` returns `{removed, affected_card_keys}` — `word` field is MISSING. §1.7 mandates `word` for C3 (mutation must identify what was mutated). Phase 2.3: add `word` from the input arg.

ed glossary rename <old> <new> [--def TEXT]  (C3)
  data shape: { old_word, new_word, affected_card_keys: string[], failed_file_writes?: string[] }
  exit codes: 0 if no failures; 2 if any `failed_file_writes`. thrown→3, 4.
  v1→v2 delta (per D32, Phase 2.3): current `glossary.ts:124-130` uses `{renamed_from, renamed_to, definition, cards_updated, file_write_failures}` — different field names from §1.7. Phase 2.3 MUST: (a) rename `renamed_from→old_word`, `renamed_to→new_word`, (b) `cards_updated` array → `affected_card_keys` (same content, name aligns with C3 sibling `glossary remove`), (c) `file_write_failures` → optional `failed_file_writes?` (only present if non-empty), (d) DROP `definition` from top-level — it's an input, not a result of the rename; consumer already knows it, (e) return `{data, exitCode: failed_file_writes ? 2 : 0}` — no `partial()`.

ed init [--project-root] [--cards-dir] [--no-gitignore] [--force]  (C10)
  data shape: { project_root, cards_dir, config_path, glossary_path, created: string[], skipped: string[], gitignore_updated: boolean }
  exit codes: 0.
  v1→v2 delta: current `single.ts:111-119` matches §1.7. Mechanical.

ed analyze [--drifted-limit N] [--drifted-offset N]  (C7)
  data shape (all inner types inlined per D22):
  {
    health: {
      total: number,
      active: number,
      drifted: number,
      draft: number,
      brokenLinks: number,
      codeStats?: { files: number, symbols: number },
      codeCycles?: { count: number, samples: string[][] }
    },
    coverage: { totalSymbols: number, covered: number, ratio: number | null },
    drifted: { cards: { key: string, summary: string, driftType?: string, brokenLinks: number, totalLinks: number }[], total: number },
    glossary: { totalWords: number, unusedWords: string[], entries: { word: string, definition: string }[] },
    unlinked_symbols: { file: string, symbol: string, kind: string }[]
  }
  exit codes: 0.

ed reset --yes  (C10)
  data shape: { cards_deleted: number, glossary_cleared: boolean, db_reset: boolean }
  exit codes: 0.
  v1→v2 delta: matches §1.7. Mechanical.

runner-commander-fallback  (not an ed subcommand; commander-error path per Phase 2.7)
  data shape: (none — failure path emits no stdout)
  stderr: one JSON-line `{level:'error', code:'CLI_USAGE_ERROR', message:<commander msg>}`
  --quiet behavior: stderr line is NOT suppressed (errors always emit per D19).
  exit codes: 0 for commander.help / commander.version; 2 (VALIDATION_FAILURE) for all other commander errors (InvalidArgumentError, missing positional, unknown option).
```

### 1.8 Quiet mode (final, per D19)

`--quiet` mode does NOT alter the per-command JSON shape. It:
1. Emits the same compact JSON (single-line `JSON.stringify(data)` instead of pretty 2-space indent) on stdout.
2. Suppresses stderr `level: warning` and `level: verbose` JSON-lines (auto-sync, runtime traces).
3. Still emits stderr `level: error` JSON-line on failure + non-zero exit code (failures must remain observable).

There is NO per-command quiet shape variation. Consumers always parse stdout as JSON of the shape declared in the command's spec card. The only difference under `--quiet` is formatting (compact vs pretty) and suppression of non-fatal stderr.

Validation/check commands that return shapes with `summary.broken > 0` or similar policy markers MAY still emit the full data — `--quiet` does not change that. The exit code carries the policy outcome.

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

**D9**: PROBLEM.md entries to mark resolved at end of Phase 4: `L-006`, `N-021`, `N-034`. **NOT** `H-005`/`H-006` (root = commander missing `exitOverride()`, NOT envelope — see Phase 2.7) and **NOT** `M-018` (status: refuted). Before final commit, grep `PROBLEM.md` for `envelope|status: 'partial'|errors\[\]` to catch any other envelope-rooted entry; only mark as resolved if envelope removal actually fixes it.

**Phase 2.7 (new)**: Catch commander argument errors. Concrete code template (per D27, the try/catch lives inside `main()` in `src/cli/index.ts`; `cli.ts` stays the 11-line shim):

```ts
// src/cli/index.ts — edit buildProgram() and rewrite main():

// 1) Inside buildProgram(), before returning `program`:
//    DELETE the existing `.showHelpAfterError(...)` call (line 40) — it prints
//    free-text help to stderr, which violates §1.1 "stderr is JSON-lines only" (D5).
program.exitOverride();  // throws CommanderError instead of process.exit

// 2) Replace main():
import { emitError } from './output';
import { EXIT } from './exit-codes';

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: string }).code;
      // commander.help / commander.version are intentional successful exits.
      if (code === 'commander.help' || code === 'commander.version') {
        process.exit(EXIT.OK);
      }
      // All other commander errors = usage errors (typo, bad flag, missing positional).
      const msg = e instanceof Error ? e.message : String(e);
      emitError({ code: 'CLI_USAGE_ERROR', message: msg });
      process.exit(EXIT.VALIDATION_FAILURE);
    }
    throw e;  // non-commander error: re-throw so it surfaces (should not happen in practice)
  }
}
```

`cli.ts` remains unchanged (it just `await main()`). This fixes H-005 (`--limit abc` plain stderr) and H-006 (missing positional plain stderr): both now emit JSON-line on stderr + exit 2. Spec card under cli-surface/command-routing-and-output/commands/`runner-commander-fallback` (NEW Phase 1.3 card).

**D10**: `README.md` does not exist; skip Phase 4.2.

**D11**: No `--json` flag exists today; v2 does not add one. JSON is always emitted on success.

**D12**: `src/cli/commands/contract.spec.ts` → DELETE. INV-003 (per-file dedup) is gone with the envelope. Per-command shape conformance moves to per-command tests in Phase 3.

**D13**: Phase 2 is **one git commit** spanning sub-steps 2.1–2.7 (plus 2.3a per D35). Agent must NOT commit between sub-steps; use `git stash` if interrupted. **Sub-step ordering within Phase 2 (v2.11)**: 2.4 (move ERROR_CODE_TO_EXIT to errors.ts) and 2.3a (op-layer changes: BulkCreateResult, SymbolSyncResult, getCardSymbolCoverage) — these two have NO inter-dependency, run in either order — both must complete before 2.2 (which imports from errors.ts) and before 2.3 (which uses the new op interfaces). Then: 2.1 (output.ts) → 2.2 (runner.ts) → 2.3 (commands) → 2.5 (delete obsolete) → 2.6 (runner.spec.ts) → 2.7 (commander exitOverride). The 13th hostile flagged a gratuitous "2.4 → 2.3a" coupling claim in v2.10; v2.11 corrects that — the two steps are independent peers in the dependency DAG.

**D14**: `runCli` consolidation is **Phase 3.0**, before any test rewrites. **An exported `runEd(args, cwd)` already exists at `test/cli/helpers.ts`** (used by `phase2.test.ts` and others — verified). Phase 3.0 task: extend the EXISTING `helpers.ts` to also expose stderr (current `runEd` may not return stderr — check + extend). DO NOT create a new file. Add helper `parseJsonLines(stderr)` to the same module. Then replace per-file private `runCli` spawners with imports from `helpers.ts`. **Exhaustive list of files with private `Bun.spawn` / `spawnEd` (v2.8 re-verified by `rg -l 'Bun\.spawn' test/`)**: `test/cli/fs-race.test.ts`, `test/cli/flag-overrides.test.ts`, `test/cli/symlink.test.ts`, `test/cli/db-corruption.test.ts`, `test/cli/fs-error.test.ts`, `test/cli/malformed-yaml.test.ts`, `test/cli/signal-handling.test.ts` (has `spawnEd`), **`test/cli/commands.test.ts`** (3 `Bun.spawn` invocations at lines 297/319/356 + ~42 v1-envelope assertion patterns — was missing from v2.7's list and is the largest envelope-assertion site outside aggregate validators). Phase 3.0 MUST handle commands.test.ts in two passes: (a) replace `Bun.spawn` → `spawnCli` (subprocess for stdin tests) or `runEd` (in-process where no stdin); (b) apply Phase 3.1 pattern table to the envelope assertions. Without this, GATE G6 (`bun test` 0 failures) fails.

**D15**: `validate.ts` per-error-code mapping (table in §4).

**D16**: SIGINT during stdout write — `process.stdout.write` for `> PIPE_BUF` (64KB on Linux) data is NOT atomic; SIGINT mid-write can yield partial JSON on stdout. **Consumer contract**: check `exitCode === 130` (SIGINT) BEFORE attempting to parse stdout. The runner does best-effort cleanup; this is documented as a known limitation, not mitigated by atomicity. Risk register row updated accordingly (impact: Med, not Low — partial JSON parse can mislead consumers).

**D17**: Runner-side rule: if a command's return is `undefined` or its `.data` field is `undefined`, the runner skips `emitResult` entirely (no stdout written). Commands wishing to emit a JSON literal `null` must explicitly `return { data: null }`. Commands MUST NOT write to stdout directly; only the runner calls `emitResult`.

**D18**: stderr code table (regenerated from `src/cli/errors.ts` `SIMPLE_ERROR_CODES` + structured-error branches in `toCliError` — verified against source):

| code | level | mapped by toCliError? | exit code | details schema (today; phase 2.4 may add) |
|---|---|---|---|---|
| `CARD_SYNC_FAILED` | warning | n/a (runner-emit only) | n/a (warning) | `{file_path: string}` |
| `CLI_USAGE_ERROR` | error | ✓ (CliUsageError) | 2 | `{}` |
| `FTS_SYNTAX_ERROR` | error | ✓ (FtsSyntaxError) | 2 | `{}` |
| `CARD_NOT_FOUND` | error | ✓ (CardNotFoundError) | 3 | `{}` (only message carries key today) |
| `CARD_ALREADY_EXISTS` | error | ✓ (CardAlreadyExistsError) | 4 | `{}` |
| `INVALID_CARD_KEY` | error | ✓ (CardKeyError) | 2 | `{}` |
| `VALIDATION_ERROR` | error | ✓ (CardValidationError) | 2 | `{}` |
| `PARENT_VALIDATION_ERROR` | error | ✓ (ParentValidationError) | 2 | `{}` |
| `GILDASH_INIT_FAILED` | error | ✓ (GildashInitError) | 6 | `{}` |
| `RENAME_SAME_PATH` | error | ✓ (CardRenameSamePathError) | 4 | `{}` |
| `GLOSSARY_PARSE_ERROR` | error | ✓ (GlossaryParseError) | 2 | `{}` |
| `GLOSSARY_VALIDATION_ERROR` | error | ✓ (GlossaryValidationError) | 2 | `{}` |
| `ACTIVATION_GUARD_FAILED` | error | ✓ (ActivationGuardError, structured branch) | 2 | `{unmet_conditions: string[]}` (already emitted today) |
| `COMPENSATION_FAILED` | error | ✓ (CompensationError, structured branch) | 1 | `{original_error: string, compensation_error: string}` (already emitted today) |
| `INTERNAL_ERROR` | error | ✓ (fallback) | 1 | `{class?: string}` |
| `OUTPUT_ENCODE_FAILED` | error | n/a (emitResult catch path) | 1 | `{}` |
| `STDOUT_WRITE_FAILED` | error | n/a (emitResult callback path; non-EPIPE) | 5 | `{}` |
| `NOT_FOUND` | error | (legacy alias of CARD_NOT_FOUND, kept until grep confirms no source throws) | 3 | `{}` |
| `CONFLICT` | error | (legacy alias of CARD_ALREADY_EXISTS, kept until grep confirms no source throws) | 4 | `{}` |
| `PERMISSION` | error | (legacy IO bucket — kept while ops still throws it; audit in Phase 2.4) | 5 | `{}` |
| `IO_ERROR` | error | (legacy IO bucket — kept while ops still throws it; audit in Phase 2.4) | 5 | `{}` |
| `BOUNDARY_VALIDATION_ERROR` | error | (boundary check failure; ops throws today) | 2 | `{}` |
| `VALIDATION_FAILURE` | error | (legacy alias of VALIDATION_ERROR; kept until ops audit) | 2 | `{}` |
| `RUNTIME` | verbose | n/a (runner verboseLog) | n/a | `{subsystem?: string, ...freeform}` |
| `SIGINT` | error | n/a (signal handler) | 130 | `{}` |

`details` schemas currently `{}` are emit-time empty; if a command's structured-details enhancement is desired (per F4), it goes in Phase 2.4 errors.ts edit. The `{key}` placeholders previously in D18 v2.1 were aspirational — removed until errors.ts adds them.

Notes:
- D18 v2.1 had invented codes (`GILDASH_TRANSIENT` — no source class) — removed.
- D18 v2.1 had wrong names (`ACTIVATION_GUARD_ERROR`, `COMPENSATION_ERROR`) — corrected to `_FAILED`.
- Missing in v2.1 (`CLI_USAGE_ERROR`, `INVALID_CARD_KEY`, `GILDASH_INIT_FAILED`, `RENAME_SAME_PATH`, `GLOSSARY_PARSE_ERROR`, `GLOSSARY_VALIDATION_ERROR`) — added.

**D19**: `--quiet` mode emits **compact JSON of the same per-command shape** (not text), one JSON value per stdout. Failures still emit one stderr JSON-line + exit code. `--quiet` does NOT change the data shape — it only suppresses warnings and verbose-level stderr lines. (Old plan §1.8 had per-command text-mode quiet forms; those are removed.) **§1.8 rewrite below.**

**D20**: Field-name avoidance — the v1 envelope had **top-level** `warnings`/`errors` arrays. Per-command data shapes MUST NOT use `warnings`/`errors`/`status`/`schemaVersion`/`error` **as top-level wrapper-shaped fields** (i.e. directly at the root of the response JSON). Nested usage is permitted when context is unambiguous: `affected_cards[].status` (domain object's natural status field), `failed[].error` (a tuple's error message inside a structured array), are fine. The rule prevents consumer confusion only at the wrapper level. **§1.7 `ed card update` field `warnings` → `validation_notes`.** **§1.7 `ed glossary define` top-level field `errors` → `failed`** (to avoid the wrapper-level collision).

**D21**: Numeric indexing in per-command shapes is **0-based** unless the field name says otherwise (e.g. `line_number` is 1-based). `failed[].input_index` in `ed bulk create` is 0-based (the index into the input array as parsed; first entry = 0).

**D22**: Inline named type definitions in §1.7 instead of citing TypeScript type names from `src/`. The shape blocks in §1.7 are the SoT for per-command output; agents do not need to read `src/` to determine field lists. **Canonical inlined types** (paste into card POST when shape mentions them):

```
CardRow:
{
  key: string, summary: string, status: 'draft'|'active'|'drifted'|'retired',
  type: 'principle'|'domain'|'brief'|'spec', parent: string | null,
  namespacesJson: string | null, body: string | null,
  glossaryJson: string,  // JSON-encoded string[]
  filePath: string, updatedAt: string  // ISO8601
}

CardFile (frontmatter object — fields are a typed superset of CardRow + parsed JSON fields):
{
  key: string, summary: string, status: ..., type: ..., parent: ... | null,
  glossary: string[],                  // parsed
  relations?: string[],
  tags?: string[],
  principle?: PrincipleBody, domain?: DomainBody, brief?: BriefBody, spec?: SpecBody,  // namespaces
  filePath: string, updatedAt: string
}

TreeNode:
{
  key: string, type: string, status: string, summary: string,
  children: TreeNode[]
}
```

Agents writing per-command cards may inline these recursively where the shape uses them.

**D23 (v2.8 — card shape drift)**: The current `card get` and `card list` implementations return shapes that diverge from §1.7 (verified by reading `src/cli/commands/card.ts:104-112,193-197`):
- `card get` currently nests namespace fields under `frontmatter:{...}` and adds `history?` at the root.
- `card list` currently nests `{limit, offset, has_more}` under `page:{...}`.

**Resolution**: §1.7 is canonical. Phase 2.3 MUST restructure card.ts returns:
- `card get`: spread frontmatter at the root (`...frontmatter`), keep `history?` (already at root in current code). Net delta: drop the literal `frontmatter:` wrapper.
- `card list`: spread `page` at the root (`...page`). Net delta: replace `page: {limit, offset, has_more}` with the three fields directly.

These are 2-line edits per command — small, but they are NOT covered by Phase 2.3's "mechanical `ok(D) → {data:D}`" rule. Phase 2.3 step 2a lists them explicitly.

**D24 (v2.8 — validate restructure)**: The current `validate.ts` implementations emit flat counters + a separate `errors[]` envelope. §1.7 specifies per-card `items[]` with grouped issues. Phase 2.3 step 2a flags both `validate cards` and `validate links` as **non-mechanical restructures** with explicit pseudocode in §1.7's "v1→v2 delta" notes. This is the largest single piece of work in Phase 2.3.

**D25 (v2.8 — stdout flush before exit)**: `process.exit` does NOT flush stdout when piped to a slow consumer. For commands like `analyze` whose JSON payload can exceed PIPE_BUF (64KB on Linux), the runner's `process.exit(exitCode)` immediately after `emitResult` can truncate. Resolution: `emitResult` uses the callback form of `process.stdout.write` and awaits drain (§1.3 v2.8 code); the runner `await`s `emitResult` (§2.2 template updated).

**D26 (v2.8 — emitResult must not process.exit)**: If `JSON.stringify` fails inside `emitResult`, the v2.7 code called `process.exit(1)` directly. This bypasses the runner's `await rt?.cleanup()` → leaked DB handle → next CLI run sees stale lock. Resolution: `emitResult` throws an `OutputEncodeError`; the runner's catch block recognizes it, calls `emitError({code:'OUTPUT_ENCODE_FAILED',...})`, sets `exitCode = 1`, then proceeds to cleanup as normal.

**D27 (v2.8 — commander exitOverride location)**: Phase 2.7 v2.7 template put the try/catch in `cli.ts`, but `cli.ts` is a thin shim that just calls `main()` — `parseAsync` lives inside `main()` in `src/cli/index.ts`. v2.8 puts the try/catch inside `main()` so the relative imports (`./output`, `./exit-codes`) work without re-anchoring. Additionally, the existing `.showHelpAfterError('(run `ed --help` for full usage)')` at `src/cli/index.ts:40` is DELETED — it prints free-text help to stderr, which violates §1.1 / D5 ("stderr is JSON-lines only").

**D28 (v2.9 — check drift total_drifted)**: §1.7's `check drift` shape includes `total_drifted` per C7 (every cards-array dimension carries its own total). The code comment at `check.ts:26-27` argues against it on the grounds that "health.drifted already reflects this." That comment is wrong: `health.drifted` is the DB-status-aggregate count; `total_drifted` is the live-detection count from the cards array. They can diverge when a card's DB status is stale. Phase 2.3 adds the field. (REAL defect per 11th hostile F-C.)

**D29 (v2.9 — check coverage <key> semantic shift + BROKEN_LINK structured)**: Two separate issues bundled because they share a single file edit:
- `check coverage <key>` (mode='card') currently returns LINK-coverage (declared codeLinks resolution rate). §1.7 specifies SYMBOL-coverage (project symbols referenced by this card). These are different concepts. Phase 2.3 switches the op call. If the symbol-coverage op doesn't exist yet (audit src/ops/), Phase 2.3 ADDS it; the existing `getLinkCoverage` stays for `check drift`'s dimension.
- `BROKEN_LINK` collector in `validate.ts:72,152` currently flattens link details into a message string. v2 stores structured `{file, symbol, reason}` directly (per C6 invariant: no message-string parsing required by consumers). The op already exposes structured `{link:{file,symbol}, reason}`; just pass through. (REAL defect per 11th hostile H7.)

**D30 (v2.9 — spec sync / sync-symbols counter-to-array)**: Both `spec sync` and `spec sync-symbols` currently return COUNTER aggregates (`unmatched:N`, `markerMissing:N`, `updated:N`, `broken:N`); §1.7 per C4 requires structured ARRAYS so consumers can retry/fix individual items. Phase 2.3 restructures:
- `spec sync` passes the existing op's `unmatched`/`markerMissing`/`linkMissing` arrays through unchanged and DELETES the runner-side `UNMATCHED_ANNOTATION` CliMessage construction (those items live inside the arrays now).
- `spec sync-symbols` splits the existing `changes[]` into `applied[]` (successful renames) and `skipped[]` (couldn't apply); if the op doesn't already classify, Phase 2.3 adds the classification. The `METADATA_WRITE_FAILED` warning moves into `skipped[]` (D19 forbids the old `warnings` channel). (REAL defect per 11th hostile F-F.)

**D31 (v2.9 — bulk create / bulk sync counter-to-array)**: Same pattern as D30 for `bulk` family. C4 violation: counters where arrays are needed for retry. Phase 2.3:
- `bulk create`: merge `validated.errors` (pre-write) and `result.errors` (write-time) into one ordered `failed:[{input_index, key?, error}]`. Build `created:[{key, filePath}]` from the op result. Drop the legacy `succeeded`/`partial_keys`/`rejected_pre_write`/numeric `created`/`failed` fields.
- `bulk sync`: unify file-mode and directory-mode under one shape that always carries `failed:[{filePath, error}]`. File-mode `failed:[]` on success. (REAL defect per 11th hostile F-D.)

**D32 (v2.9 — glossary family alignment)**: Four glossary commands all drift from §1.7:
- `glossary define`: counter shape → array `{defined:[], failed:[], total}`. **Semantics change SCOPE**: the change is CLI-layer only. The op `defineGlossary` (src/ops/glossary.ts) keeps its existing all-or-nothing throw behavior (verified: test/ops/glossary.test.ts:176-214 asserts GlossaryValidationError throws). The CLI helpers `parseDefinitionPair` and `loadEntriesFromFile` (currently throw at first bad arg) are what change: in v2 they accumulate per-input failures into `failed:[{input_index, reason}]` before calling the op. The op call only happens for the surviving valid entries; if the op itself throws (e.g. duplicate within the same batch), that's still a thrown error → exit 2. No op-test changes required. (REAL defect per 11th hostile F-E; test-impact audit per 12th hostile F4.)
- `glossary lookup`: unify the word/no-word shapes to single `{entries, total}` form (C2).
- `glossary remove`: add `word` field (C3 sibling consistency).
- `glossary rename`: rename `renamed_from→old_word`, `renamed_to→new_word`, `cards_updated→affected_card_keys`, drop `definition` (input echo), `file_write_failures→failed_file_writes?` (optional, only when non-empty), `partial()` → `exitCode:2` branch. (REAL defect per 11th hostile F-E.)

**D33 (v2.9 — KEY_MISMATCH bucketing)**: KEY_MISMATCH issues have BOTH a card-key and a file_path. v2.7/v2.8 left it ambiguous between `items[].issues[]` (card-keyed) and `file_level_issues[]` (file-keyed). v2.9 places it in `file_level_issues[]` because the issue IS the file's frontmatter key being wrong — the "card identified by its key" doesn't coherently exist (the key itself is the defect). Single canonical bucket prevents double-reporting. §1.7 `validate cards` shape's `file_level_issues[].key?` is OPTIONAL precisely so KEY_MISMATCH can carry it for context.

**D34 (v2.9 — stdout I/O error)**: Non-EPIPE failures during `process.stdout.write` (ENOSPC, EIO when stdout is redirected to a full filesystem) used to be silently swallowed. v2.9 surfaces them via a new `StdoutWriteError` thrown out of `emitResult`; the runner catches and maps to `STDOUT_WRITE_FAILED` + exit 5. EPIPE stays silent (UNIX SIGPIPE convention). The v2.8 fast-path `if (ok) resolve()` is DELETED — it defeated D25's anti-truncation purpose. (REAL defect per 11th hostile H1.)

**D35 (v2.10 — op-layer prerequisites)**: Phase 2.3 cannot produce §1.7's shapes without prior op-layer changes for bulk-create, spec-sync, and a NEW symbol-coverage op. v2.9's "v1→v2 delta" notes hedged these as conditional ("if op doesn't classify, ADD it"); v2.10 fact-checked and confirmed every conditional is REAL. The work moves into **Phase 2.3a** with explicit interface diffs (`BulkCreateResult`, `SymbolSyncResult`, `CardSymbolCoverageResult`). Phase 2.3a runs BEFORE Phase 2.3 command-file rewrites within the same Phase 2 commit. v2.11 amendment: `BulkCreateResult.created` and `.errors` BOTH carry `input_index` (topological sort breaks input order); OP-2 pseudocode pins `card_not_found` to a `findByKey` check at the top of the per-link loop in `syncSymbolChanges`.

**D36 (RETIRED in v2.12)**: v2.11 deferred op-test rewrites to Phase 3.0a but the deferral was unworkable — leaving stale assertions in Phase 2 either broke `bunx tsc --noEmit` (GATE 2.1) or required silent "delete the line" vacuity. v2.12 inlines op-test rewrites into Phase 2.3a so op + op-tests change atomically. Phase 3.0a is removed. GATE 2.1 (tsc clean) now applies to op-tests inside the Phase 2 commit; `bun test` is still expected to have CLI-test failures after Phase 2 (those land in 3.1/3.2/3.3).

---

## 3. Phase breakdown (detailed, executable)

### Phase 1.1 ✅ done (`072d2c7`)
- `ed card rename cli-surface/command-routing-and-envelope → command-routing-and-output`
- Stale string references replaced via sed in cards/source

### Phase 1.2 ✅ done (`f96a50d`)
- Brief `cli-surface/command-routing-and-output.md` rewritten (envelope removed, per-command goals)
- Spec `runner-and-output.md` rewritten (emitResult/emitWarning/emitError contract)
- `card-storage/persistence/sync.md` POST-005 + failures updated (CARD_SYNC_FAILED → stderr JSON-line)

### Phase 1.2.5 — Reconcile Phase 1.2 cards with v2.2 decisions ⏳ NEW

Discovered post-v2.2 fact-check: Phase 1.2 cards have wording that contradicts v2.2 decisions D19, D5, D18. **Must reconcile before Phase 1.3** (per-command cards derive from these goals).

**`cli-surface/command-routing-and-output.md` (brief)** — edits needed:
- **G-003**: current text mentions "verbose / user-facing error messages — go to stderr" implying free text. v2.2 D5 says stderr is JSON-lines ONLY. **Rewrite G-003** to: "All stderr emission is canonical JSON-lines per the schema `{level: 'error'|'warning'|'verbose', code: string, message: string, details?: Record<string, unknown>}`. No free-text on stderr. CARD_SYNC_FAILED uses `level:'warning'`; thrown command errors use `level:'error'`; verbose traces use `level:'verbose'`."
- **G-004**: current text says "stderr carries a human-readable message". **Rewrite** to: "On command failure (typo, IO, crash) stdout emits no JSON; stderr carries exactly one `level:'error'` JSON-line + exit code is non-zero."
- **G-005**: current text says "--quiet collapses the natural stdout shape to its core payload (e.g. a card key, a count)". v2.2 D19 says no shape collapse. **Rewrite** to: "--quiet emits the same per-command JSON shape but compact (single-line `JSON.stringify`); suppresses `level:'warning'` and `level:'verbose'` stderr lines; `level:'error'` still emitted on failure."

**`cli-surface/command-routing-and-output/runner-and-output.md` (spec)** — edits needed:
- **POST-005**: current text "collapses the stdout shape to its core payload (per command's spec-declared quiet form)". **Rewrite** to match new G-005: "Under --quiet, `emitResult` writes compact JSON of the same shape (no indent); `emitWarning` and `emitVerbose` are suppressed; `emitError` still fires."

**Workflow**: direct YAML edit (Edit tool on the .md file) for the three goal statements + POST-005 wording; then `ed bulk sync` to reindex; then `ed validate cards`. Direct edit is symmetric with Phase 1.3's "direct write" approach for new cards and avoids reconstructing the full namespace JSON for a partial-statement change. GATE: `ed validate cards` `total_issues: 0` (NOT "warnings 0" — current shape uses issues, not warnings).

### Phase 1.3 — Create 32 per-command CLI-shape spec cards ⏳

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
        Under --quiet, this command emits the same JSON shape declared in
        POST-001 but compact (single-line `JSON.stringify(data)`, no indent).
        stderr `level:'warning'` and `level:'verbose'` lines are suppressed.
        stderr `level:'error'` JSON-lines are still emitted on failure.
        (Per cli-surface/command-routing-and-output G-005 / D19.)
    - id: POST-003
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |
        Exit codes this command can produce:
        - 0 (EXIT.OK): <when>
        - <other policy codes if any with conditions>
        - thrown errors map via the runner's global error→exit table:
          <list relevant thrown error classes for this command>
    - id: POST-004
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-004
      guarantee: |
        On failure (thrown error or non-zero policy exit), this command produces
        no stdout output. The runner emits a single stderr JSON-line
        `{level:'error', code, message, details?}` per D18 and exits non-zero.
  invariants:
    - id: INV-001
      always_holds: per-call
      derives: cli-surface/command-routing-and-output#G-003
      statement: |
        stdout receives at most one JSON value (the data). stderr may receive
        zero or more JSON-lines per the canonical schema `{level, code, message,
        details?}`. No free-text on stderr.
  failures:
    - violation: <one realistic failure mode for this command>
      behavior: <what the runner emits>
---
```

**Multi-mode commands** (like `ed check coverage` with 3 modes per §1.7): split POST-001 into POST-001a / POST-001b / POST-001c — three sibling postconditions with identical `keyword: MUST` + `derives: cli-surface/command-routing-and-output#G-001`, and one separate `guarantee:` body per mode (each containing its own fenced JSON shape block). POST-002/POST-003/POST-004 remain single (they describe meta-rules that apply to all modes uniformly). Only `ed check coverage` requires this in v2; future multi-mode commands inherit the pattern.

**Failure-only commands** (only `runner-commander-fallback` in v2): the card has no stdout payload. Drop POST-001 entirely (no "data matches the JSON shape" guarantee). POST-004 (failure path) carries the full contract; POST-003 lists exit codes; POST-002 is omitted (no stdout = no quiet variation to document). INV-001 still applies (stdout receives at most zero JSON values; stderr receives the error JSON-line). PRE-001 is also REWRITTEN for this card to: *"commander.parseAsync threw a CommanderError other than `commander.help` / `commander.version`, before any subcommand action was dispatched; no CliRuntime exists."* (The default template PRE-001 about "runner invokes this command's action with a built CliRuntime" is factually inverted for the commander-fallback path.) One special-case card; future failure-only commands inherit the same PRE pattern.

**Workflow per card** (skill-compliant):
1. Run `<self_review>` mentally against §1.7 / §1.8 (paste below) to confirm shape accuracy.
2. Write the card file directly with the template filled (skill allows direct edit + `ed bulk sync` for non-`ed card create` flows; cards under the new path don't exist yet, so direct write is the only option until `ed bulk sync` indexes them).
3. After all 32 cards written, run `ed bulk sync` (expect synced=77, errors=0).
4. Run `ed validate cards` — must show `total_issues: 0`.

**Sub-task list**:
- 1.3.a: Create `commands/` subdirectory under `.emberdeck/cards/cli-surface/command-routing-and-output/`
- 1.3.b: Write each of the 32 cards (use §1.7 + §1.8 as the source of truth)
- 1.3.c: `ed bulk sync` + `ed validate cards` GATE

### Phase 1.4 — SKILL.md rewrite

Target file: `.claude/skills/emberdeck/SKILL.md`.

**Verified anchors** (no `<envelope>` tag exists; use these instead):
- Line 116: the literal paragraph beginning with `출력은 항상 JSON 봉투` (inside `<commands>` section)
- Lines 306–380: `<response_shapes>` … `</response_shapes>`
- Lines 261–304: `<error_recovery>` … `</error_recovery>`

**Replacement for line 116 paragraph** (delete the existing one-liner about envelope; replace with):

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
| `CLI_USAGE_ERROR` (exit 2) | commander 인자/플래그 오류 (typo, 누락 positional, 알 수 없는 flag) | 명령 형식 확인. `ed --help` 또는 `ed <명령> --help` |
| `CARD_NOT_FOUND` (exit 3) | 명령이 요청한 카드 없음 | key 확인 |
| `VALIDATION_FAILURE` (exit 2) | 정합성 검증 실패 | details 확인 후 fix |
| `CARD_ALREADY_EXISTS` (exit 4) | create 시 키 충돌 | 다른 키 or update 사용 |
| `PERMISSION_OR_IO` (exit 5) | 파일/DB IO | 권한/디스크 확인 |
| `CONFIG_MISSING` (exit 6) | `.emberdeck.jsonc` 없음 | `ed init` |
```

(D18 v2.8: `GILDASH_TRANSIENT` / `NETWORK_TRANSIENT` rows are NOT included — no error class throws them today; `classifyErrorStatus` in v1 `runner.ts:33` was reserved-future code, deleted by Phase 2.2 rewrite. If a transient class is added later, that PR amends both `SIMPLE_ERROR_CODES` and `ERROR_CODE_TO_EXIT` and re-adds the SKILL row in one atomic change.)

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
import { emitResult, emitError, emitVerbose, emitWarning, buildOutputContext, OutputEncodeError, StdoutWriteError } from './output';
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
    emitError({ code: 'SIGINT', message: `${sig} received, exiting` });  // errors always emit per D19
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

    if (ret && ret.data !== undefined) await emitResult(ret.data, outCtx);  // D25: await drain
    exitCode = ret?.exitCode ?? EXIT.OK;
  } catch (e) {
    verboseLog(`command threw`, { class: e instanceof Error ? e.constructor.name : 'unknown' });
    if (e instanceof OutputEncodeError) {
      // D26: emitResult bubbled an encode failure; cleanup still runs below before exit.
      emitError({ code: 'OUTPUT_ENCODE_FAILED', message: e.message });
      exitCode = EXIT.GENERIC_ERROR;
    } else if (e instanceof StdoutWriteError) {
      // D25 v2.9: real I/O error during stdout write (ENOSPC, EIO). EPIPE was already
      // swallowed inside emitResult per UNIX convention; only non-EPIPE reaches here.
      emitError({ code: 'STDOUT_WRITE_FAILED', message: e.message });
      exitCode = EXIT.PERMISSION_OR_IO;
    } else {
      const cliErr = toCliError(e);
      // Errors always emit regardless of --quiet (D19) — silent failure is anti-pattern.
      emitError({ code: cliErr.code, message: cliErr.message, ...(cliErr.details ? { details: cliErr.details } : {}) });
      exitCode = (ERROR_CODE_TO_EXIT[cliErr.code] ?? EXIT.GENERIC_ERROR) as ExitCode;
    }
  }

  try { await rt?.cleanup(); } catch (ce) {
    verboseLog(`cleanup failed`, { class: ce instanceof Error ? ce.constructor.name : 'unknown' });
  }
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  process.exit(exitCode);
}

// classifyErrorStatus REMOVED in v2 — GILDASH_TRANSIENT / NETWORK_TRANSIENT were
// reserved-future codes never thrown by ops. If transient classification is needed
// later, add the throwing error class + SIMPLE_ERROR_CODES row + ERROR_CODE_TO_EXIT
// entry + SKILL row in one atomic PR. Tests referencing classifyErrorStatus
// (src/cli/runner.spec.ts:17-18, src/cli/output.spec.ts:58-61) are deleted in
// Phase 2.6 along with the v1 envelope assertions.

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
2. Change every `return ok(D)` → `return { data: D }` **ONLY if `D` already matches §1.7's shape for that command**. Otherwise restructure `D` first (see step 2a). Most card / glossary / check / bulk commands are mechanical. The exceptions are listed in step 2a.
2a. **Non-mechanical commands** — the current `D` shape differs from §1.7's target; agent MUST restructure. See each command's "v1→v2 delta" note in §1.7. Per v2.9 systematic audit, the FULL non-mechanical set is:
   - `ed card get` — unwrap `frontmatter` to root, keep `history?` (D23).
   - `ed card list` — flatten `page.{limit,offset,has_more}` to root (D23).
   - `ed validate cards` — bucket warnings into `items[].issues[]`, split file-level into `file_level_issues[]`, compute `summary.by_code` (D24).
   - `ed validate links` — per-target `items[]` with `broken_links[]`/`skipped`/`io_error`, compute `summary` (D24).
   - `ed validate` (aggregate) — combine the two above into `{cards, links}`.
   - `ed check drift` — add `total_drifted` field (D28).
   - `ed check coverage <key>` (mode='card') — switch from link-coverage to symbol-coverage op (D29). LARGEST single semantic change.
   - `ed bulk create` — counter → arrays `{created:[], failed:[{input_index,...}], total}` (D31).
   - `ed bulk sync` — both modes include `failed:[]` (D31).
   - `ed glossary define` — counter → arrays; catch per-entry validation errors instead of throw-first (D32). Semantics change documented in D32.
   - `ed glossary lookup` — unify single-word and no-word shapes to `{entries, total}` (D32).
   - `ed glossary remove` — add `word` field (D32).
   - `ed glossary rename` — rename fields to match C3 sibling; drop `definition`; `partial()` → `exitCode:2` branch (D32).
   - `ed spec sync` — counter → arrays; drop `UNMATCHED_ANNOTATION` stderr messages (D30).
   - `ed spec sync-symbols` — restructure `changes` into `applied[]`/`skipped[]`; metadata warning moves into `skipped[]` (D30).
   - `ed check regression` — replace `partial()` with `{data, exitCode: passOrFail==='fail' ? 2 : 0}` (mechanical-ish; no shape change).
   - `BROKEN_LINK` collector inside validate.ts (per D29 v2.9): the current `validate.ts:72,152` flattens to `message: \`${b.link.file}:${b.link.symbol} (${b.reason})\``. v2 MUST store structured `{file: b.link.file, symbol: b.link.symbol, reason: b.reason}` directly into the per-card `items[i].broken_links[]` array — NO message-string assembly. The src/ops/link.ts BrokenLink already exposes `{link:{file,symbol}, reason}` structured; just pass through.
3. For non-mechanical commands above: do NOT use `partial(D, errors)`. Build the §1.7 shape directly. Return `{ data, exitCode: 2 }` when the policy condition (`summary.total>0` for validate cards; `summary.broken+io_failed>0` for links) is true.
4. For other commands still using `partial(D, errors)`: collapse to a clean shape per §1.7 (most have a top-level `failed: []` field; move errors there).
5. Map error CODE strings per §4 (validate.ts specifically — codes already align with §1.7's expected codes).
6. `--quiet` does NOT change shape (D19) — no per-command collapse logic needed in command files.

**Exhaustive list of command files**:
- `src/cli/commands/bulk.ts`
- `src/cli/commands/card.ts`
- `src/cli/commands/check.ts`
- `src/cli/commands/glossary.ts`
- `src/cli/commands/single.ts`
- `src/cli/commands/spec.ts`
- `src/cli/commands/validate.ts`

**Worked example — `ed validate` (aggregate)**: current code calls `validateCards` then loops `validateCodeLinks`, mixing codes into one `errors[]` array. New v2 restructure:

```ts
.action(async (_opts, cmd) => {
  await run(async (rt: CliRuntime) => {
    // 1) cards portion — reuse the validate-cards action logic
    const cardsData = await buildValidateCardsData(rt);  // extract from existing validate-cards action; returns the new validate-cards shape
    // 2) links portion — reuse the validate-links fan-out logic
    const linksData = await buildValidateLinksData(rt, undefined);  // undefined key = fan-out
    const cardsOk = cardsData.summary.total === 0;
    const linksOk = linksData.summary.broken === 0 && linksData.summary.io_failed === 0;
    return {
      data: { cards: cardsData, links: linksData },
      exitCode: cardsOk && linksOk ? 0 : 2,
    };
  }, cmd);
});
```

Apply similar extract-and-compose to: `ed check coverage` (3 modes), `ed card export` (3 modes via `--out` / `--in-place` / STDOUT).

#### 2.3a — Op-layer changes required for v2 shapes (v2.10, per 12th hostile F1/F2/F3)

These are pre-requisite to Phase 2.3 command-file rewrites. Without them, the command files can't produce the §1.7 shapes. Done in the same Phase 2 commit; verified absent by reading the source.

**OP-1 — `BulkCreateResult` adds `filePath` per created key**

File: `src/ops/bulk-create.ts` (verified: `keys: string[]` only; createCard already returns `filePath` and it is currently DROPPED).

Change `BulkCreateResult`:
```ts
export interface BulkCreateResult {
  created: Array<{ input_index: number; key: string; filePath: string }>;  // was: keys: string[] + numeric `created`
  partialKeys: string[];
  errors: Array<{ input_index: number; key?: string; filePath?: string; message: string }>;
}
```
Drop the numeric `created`/`failed` counters. The `input_index` is mandatory on BOTH arrays because `topologicalSort` (bulk-create.ts:26-65) reorders inputs. **Duplicate-key handling (v2.12 fix per 14th hostile F3)**: a naive `Map<inputKey, index>` collapses duplicates so both error reports inherit the LATER index — wrong. Instead, `bulkCreateCards` augments inputs at function entry: `const indexed = inputs.map((it, i) => ({ ...it, __inputIndex: i }))` (private symbol field, NOT persisted to disk; type-erased by interface). topologicalSort and createCard operate on `indexed`; on success/failure, the original index travels with the record. Duplicate input keys produce two error entries with distinct `input_index` (the op decides which to attempt; typical behavior: first attempt succeeds, second fails with `CARD_ALREADY_EXISTS` carrying its own input_index — this is the desired user-facing report). The CLI layer (`bulk.ts validateBulkInput`) ALREADY tracks `index` for pre-write validation failures — pass it through verbatim. Update the op's `@spec` reference; verify no other call site relies on the old `keys: string[]` (grep `BulkCreateResult\|bulkCreateCards` across src/ and test/).

**OP-2 — `SymbolSyncResult` adds applied/skipped classification**

File: `src/ops/spec-sync.ts` lines 165-263 (verified: currently `{updated, broken, changes[]}` where `changes` only carries successfully-applied details; `links.length===0` is silently `continue`d at line 210, losing information).

Change `SymbolSyncResult`:
```ts
export interface SymbolSyncResult {
  applied: Array<{ cardKey: string; oldSymbol: string; newSymbol: string; file: string; changeType: 'renamed'|'moved' }>;
  skipped: Array<{ reason: 'no_links_referencing_old_symbol'|'symbol_removed_manual_review_required'|'card_not_found'; symbol?: string; file?: string; details?: Record<string, unknown> }>;
  // Note: `metadata_write_failed` is a 4th reason that the CLI synthesizes AFTER the
  // op returns (see spec.ts upsertWarning handling). The op itself never emits it.
  // §1.7's response shape unions the op's 3 reasons with the CLI's 1 reason.
}
```
Drop `updated`/`broken` counters (derivable from `applied`/`skipped` length). Inside `syncSymbolChanges` (current branching at spec-sync.ts:189-263), make these exact edits:
1. The current `continue` at line 210 (no links found): push to `skipped` with `reason: 'no_links_referencing_old_symbol'`, carrying `symbol: oldName, file: oldFile`.
2. The `removed` branch (currently increments `broken++` at line 251-261): replace `broken++` with `skipped.push({ reason: 'symbol_removed_manual_review_required', symbol: oldName, file: oldFile, details: { card_key: link.cardKey } })`. The existing `details.push(...)` call in this branch is REMOVED — `skipped[]` is the new sink.
3. Successful `renamed`/`moved` paths (lines 213-249): replace `details.push(...)` with `applied.push({ cardKey, oldSymbol: oldName, newSymbol: ..., file: ..., changeType: 'renamed'|'moved' })`. Drop the `updated++` counter.
4. The defensive `card_not_found` reason: insert a check right after `findBySymbol` returns links (line 208), before the per-link loop: `for (const link of links) { const card = ctx.cardRepo.findByKey(link.cardKey); if (!card) { skipped.push({ reason: 'card_not_found', symbol: oldName, file: oldFile, details: { card_key: link.cardKey } }); continue; } ... }`. This handles the rare DB-skew case where a code link survives its card deletion (foreign-key races during card delete).

If gildash ever returns a changeType outside the filtered set `['renamed','moved','removed']` (line 197), nothing reaches the loop — no extra case needed.

The CLI layer at `spec.ts:91-98` then maps directly to §1.7 — no transformation needed.

**OP-3 — Add `getCardSymbolCoverage(ctx, key)` op**

File: `src/ops/spec-sync.ts` (or a new `src/ops/coverage.ts` — agent decides at write time based on whether the file gets too long; default: same file, since it shares helpers with `getLinkCoverage` and `getUncoveredSymbols`). Verified absent: only `getLinkCoverage` (declared codeLinks resolution) and project-wide `getUncoveredSymbols` exist.

Signature:
```ts
export interface CardSymbolCoverageResult {
  key: string;
  total_symbols: number;       // # symbols in the union of files declared in this card's codeLinks
  covered_symbols: number;      // # symbols actually referenced by this card's codeLinks
  coverage_ratio: number | null; // covered/total, null if total===0
  uncovered: Array<{ file: string; symbol: string; kind: string }>;
}

export async function getCardSymbolCoverage(
  ctx: EmberdeckContext,
  cardKey: string,
): Promise<CardSymbolCoverageResult>
```
Implementation sketch: load the card's codeLinks (`ctx.codeLinkRepo.findByCardKey`); collect the set of distinct files; query gildash for ALL symbols in those files (mirrors `getUncoveredSymbols` per-file query); set-difference with the card's actually-referenced symbols. `kind` comes from gildash symbol metadata.

The CLI at `check.ts` mode='card' branch calls this instead of `getLinkCoverage`. The existing `getLinkCoverage` stays — it is repurposed for `check drift`'s link-validity dimension and the broken-link counting in `validate links`.

**Phase 2.3a DOES rewrite op-tests (v2.12 change, retiring D36)**: the v2.11 attempt to defer op-tests to Phase 3.0a created an unworkable commit-boundary — the new interfaces would either break `bunx tsc --noEmit` (GATE 2.1) or force "delete the assertion" silent-pass vacuity. Both unacceptable. v2.12 collapses: Phase 2.3a now atomically edits BOTH the op file AND its op-tests in the same commit. Affected test files (verified by `rg` against v2.10's drop list):

- `test/ops/bulk-create.test.ts` — ~32 assertion lines (`result.created` as number, `result.failed`, `result.keys`, `result.partialKeys`).
- `test/ops/spec-sync.test.ts` — ~22 assertion lines (`result.updated`, `result.broken`, `result.changes[]`).
- `test/integration/crud-sync.test.ts` — ~6 lines (bulkCreateCards callers at lines 398-776).
- `test/e2e/chaos.test.ts` + `test/e2e/flows.test.ts` — ~8 lines combined.

Rewrite rules (mechanical):
- `result.created` (number) → `result.created.length`
- `result.failed` (number) → `result.errors.length`
- `result.keys` (string[]) → `result.created.map(c => c.key)` (compat shim) OR direct `result.created[i].key`
- `result.partialKeys` → unchanged.
- `result.errors[i]` gains `input_index` — add `expect(result.errors[i].input_index).toBe(N)` where input order matters.
- **Scope qualifier (v2.13)**: these `result.updated`/`result.broken` rules apply ONLY to `syncSymbolChanges` results. `getLinkCoverage` results ALSO have a `.broken` field (number of broken codeLinks) which is UNCHANGED in v2 — DO NOT mass-replace `result.broken`. Identify by call site: `syncSymbolChanges` returns `SymbolSyncResult` (v2: applied/skipped); `getLinkCoverage` returns `LinkCoverageResult` (unchanged).
- `result.updated` (number, SymbolSyncResult only) → `result.applied.length` (per OP-2 contract, applied[] is exactly renamed+moved).
- `result.broken` (number, SymbolSyncResult only) → `result.skipped.filter(s => s.reason === 'symbol_removed_manual_review_required').length`. The `LinkCoverageResult.broken` is untouched.
- `result.changes[i]` → `result.applied[i]` OR `result.skipped[i]` per the test's intent.
- `result.changes.toHaveLength(N)` → `expect(result.applied.length + result.skipped.length).toBe(N)`. (Filling F5 gap from 14th hostile.)

Estimated effort (v2.13 §8 update): Phase 2.3a is ~400 LOC across **6 files total** (2 op files: bulk-create.ts, spec-sync.ts; plus 4 test files: test/ops/bulk-create.test.ts, test/ops/spec-sync.test.ts, test/integration/crud-sync.test.ts, and ONE of test/e2e/chaos.test.ts or flows.test.ts depending on which actually calls the affected ops — verify by grep, the other may need 0 changes). Phase 3.0a is retired; its row removed from §8.

#### 2.4 — `src/cli/errors.ts` adjustments

- Move `ERROR_CODE_TO_EXIT` from `output.ts` to `errors.ts` (export it).
- **Add `OUTPUT_ENCODE_FAILED: EXIT.GENERIC_ERROR` to `ERROR_CODE_TO_EXIT`** so emitResult's catch path has a registered mapping (per D18 footnote and §1.3 emitResult code).
- `toCliError` returns `{ code: string, message: string, details?: Record<string, unknown> }` (already similar). D18 documents the current details schema; if Phase 2.4 chooses to enrich (e.g. add `{key}` to CARD_NOT_FOUND), update D18 in the same commit.

#### 2.5 — Delete obsolete files

- `src/cli/commands/contract.spec.ts` (D12).
- `test/cli/json-envelope-schema.test.ts`.
- `src/cli/output.spec.ts` (if exists).

#### 2.6 — Adjust `src/cli/runner.spec.ts`

- Delete the `mergeCardSyncWarnings` describe block (7 tests).
- **Delete the `classifyErrorStatus` tests** (lines 17-18 reference `GILDASH_TRANSIENT` which is no longer exported — function is removed in Phase 2.2 per v2.8 note).
- Delete `src/cli/output.spec.ts` (envelope assertions; already listed in 2.5).

**Phase 2 GATE 1** (v2.13 — end-of-phase only, not per-sub-step): `bunx tsc --noEmit` must be CLEAN at the **end** of Phase 2 (after 2.7). Intermediate states between 2.3a and 2.3 will have tsc errors (op interfaces changed, CLI commands not yet adapted) — this is expected. Do NOT try to keep tsc clean between sub-steps; the v2.12 collapse of 3.0a into 2.3a creates an unavoidable mid-phase red window. End-of-phase: zero tsc errors.

**Phase 2 GATE 2** (end of phase): `bunx tsc --noEmit` clean. `bun test` will have failures (expected). **Record the failing count**. Expected-failure scope (v2.13): tests under `test/cli/` (~100-400 failures, rewritten in 3.1/3.2). Tests under `test/ops/`, `test/integration/crud-sync.test.ts`, `test/e2e/{chaos,flows}.test.ts` are REWRITTEN inside Phase 2.3a (per v2.12 collapse) and MUST pass at end of Phase 2. Non-CLI unit tests under `src/**/*.spec.ts` (excluding `output.spec.ts` and the dedup tests deleted) must still pass.

### Phase 3 — Tests

#### 3.0 — Extend existing helpers.ts (per D14)

**Do NOT create a new file.** `test/cli/helpers.ts` already exports `runEd(args, cwd)` that returns `{exitCode, stdout, stderr}` via in-process `buildProgram` + `parseAsync` with `exitOverride` (verified). Phase 3.0 task:

1. **Add `parseJsonLines` export** to `test/cli/helpers.ts`:
   ```ts
   export function parseJsonLines(stderr: string): Array<{ level: string; code: string; message: string; details?: Record<string, unknown> }> {
     return stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l));
   }
   ```

2. **Delete per-file private spawners** in the 6 subprocess-spawning files (these use `bun spawn` because they test signal handling, real subprocess behavior, or EPIPE — NOT in-process):
   - `test/cli/fs-race.test.ts`
   - `test/cli/flag-overrides.test.ts`
   - `test/cli/symlink.test.ts`
   - `test/cli/db-corruption.test.ts`
   - `test/cli/fs-error.test.ts`
   - `test/cli/malformed-yaml.test.ts`

   These tests legitimately need subprocess. Add a SEPARATE exported `spawnCli(args, cwd): Promise<RunResult>` to `helpers.ts` that uses `bun spawn` (same shape as `runEd`'s return). Replace the per-file private versions with this import.

3. **Special case**: `test/cli/signal-handling.test.ts` uses `spawnEd` for SIGINT testing — keep its private spawner (signal handling needs custom interrupt logic) OR rewrite as `spawnCli` with a `signal` option. Plan-level decision: keep private until proven non-essential.

**Net result**: `helpers.ts` exports `runEd` (in-process, fast — used by ~30 tests), `spawnCli` (subprocess, used by ~6 tests), `parseJsonLines`. No new file. No parallel helper.

(Phase 3.0a was retired in v2.12 — its rewrites are absorbed into Phase 2.3a so op + op-tests change atomically in the Phase 2 commit. See D36 retired note.)

#### 3.1 — Test pattern remap

**Process**: Before applying the table, run
```
rg -nE 'parsed\.(status|data|warnings|errors|error|schemaVersion)' test/ src/ > /tmp/patterns.txt
```
and confirm every line maps to a row in the table below. **If a line matches no row, STOP. Add a new row to the table in §3.1 of this plan (`REDESIGN_PLAN.md`) in the same commit as the test rewrites.** Do not silently skip unmapped patterns. The plan is a living document during Phase 3.1; cumulative edits land with the Phase 3 commit.

Run `rg` to enumerate every assertion pattern. Apply per the table below:

| v1 assertion | v2 replacement |
|---|---|
| `expect(parsed.status).toBe('ok')` | `expect(exitCode).toBe(0)` |
| `expect(parsed.status).toBe('partial')` | `expect(exitCode).toBe(2)` |
| `expect(parsed.status).toBe('error')` | `expect(exitCode).not.toBe(0); expect(stdout).toBe('')` (no stdout; `JSON.parse('')` throws, so don't `parsed` — assert on raw `stdout`) |
| `expect(parsed).toEqual({status:'ok', data:D, errors:[], warnings:[]})` (full envelope match) | decompose: `expect(exitCode).toBe(0); expect(JSON.parse(stdout)).toEqual(D); expect(parseJsonLines(stderr).filter(l=>l.level!=='verbose')).toEqual([])` |
| `parsed.data?.X` / `parsed.X ?? Z` (conditional) | parsed is the data directly; rewrite as `parsed.X` (no `.data` unwrap). If logic depended on envelope presence, split by exit code: `if (exitCode === 0) parsed.X else ...` |
| `expect(parsed.data.X).toBe(...)` | `expect(parsed.X).toBe(...)` (parsed is data directly) |
| `expect(parsed.errors.some(e => e.code==='BROKEN_LINK'))` | `expect(parsed.links.items.some(i => i.broken_links?.length))` |
| `expect(parsed.errors.some(e => e.code==='CARD_SYNC_FAILED'))` | `expect(parseJsonLines(stderr).some(l => l.code==='CARD_SYNC_FAILED'))` |
| `expect(parsed.errors.some(e => e.code==='ORPHAN_FILE'))` | `expect(parsed.cards.file_level_issues.some(i => i.code==='ORPHAN_FILE'))` |
| `expect(parsed.errors.some(e => e.code==='VALIDATION_FAILED'))` | `expect(parsed.links.items.some(i => i.io_error))` |
| `expect(parsed.errors.some(e => e.code==='KEY_MISMATCH_SKIPPED'))` | `expect(parsed.links.items.some(i => i.skipped?.reason==='key_mismatch'))` |
| `expect(parsed.schemaVersion).toEqual({major:1,minor:0})` | DELETE assertion |
| `expect(parsed.error?.code).toBe(...)` | `expect(parseJsonLines(stderr).find(l=>l.level==='error')?.code).toBe(...)` |
| `expect(parsed.warnings.some(...))` | `expect(parseJsonLines(stderr).some(...))` |
| `parsed.found` / `parsed.entry` (glossary lookup v1 single-word) | `expect(parsed.entries.length).toBe(0 \| 1); expect(parsed.entries[0]?.word).toBe(W)` (D32) |
| `expect(parsed.created).toBe(N)` (bulk create / spec sync — v1 numeric) | `expect(parsed.created).toHaveLength(N)` (v2 array per D30/D31) |
| `expect(parsed.unmatched).toBe(N)` (spec sync v1 numeric) | `expect(parsed.unmatched).toHaveLength(N)` (v2 array per D30) |
| `expect(parsed.updated).toBe(N)` / `parsed.broken` (spec sync-symbols v1) | `expect(parsed.applied).toHaveLength(N)` / `expect(parsed.skipped.filter(s=>s.reason==='symbol_removed_manual_review_required'))` (D30) |
| `parsed.results` (glossary define v1) | `parsed.defined` (v2 array; non-defined go to `parsed.failed`) (D32) |
| `parsed.renamed_from` / `parsed.renamed_to` / `parsed.cards_updated` (glossary rename v1) | `parsed.old_word` / `parsed.new_word` / `parsed.affected_card_keys` (D32) |
| `parsed.declared` / `parsed.unreferenced_symbols` / `parsed.unreferenced_total` (check coverage `<key>` v1, link-coverage) | DELETE the assertion — v2 switches to symbol-coverage with different fields (`total_symbols`, `covered_symbols`, `uncovered:[{file,symbol,kind}]`) per D29. Tests asserting link-coverage semantics for `check coverage <key>` MUST be rewritten or deleted — flag this with the test's owner if the semantic change breaks an SLA. |
| `parsed.page.{limit,offset,has_more}` (card list v1) | `parsed.{limit,offset,has_more}` (flat per D23) |
| `parsed.frontmatter.X` (card get v1) | `parsed.X` (flat per D23; the `frontmatter` wrapper is dropped) |
| `parsed.keys` / `parsed.partial_keys` / `parsed.succeeded` / `parsed.rejected_pre_write` (bulk create v1) | DELETE — derivable. Use `parsed.created` (array) and `parsed.failed` (array). (D31) |
| `parsed.errors` as NUMBER (bulk sync v1 dir-mode) | `parsed.failed` as ARRAY (D31) |

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

Mark envelope-rooted entries resolved (one-line note "closed by envelope-removal commit `<sha>`"):
- `L-006`, `N-021`, `N-034`
- Plus any others found via `grep -E "envelope|status: 'partial'|errors\[\]" PROBLEM.md` that are genuinely envelope-rooted (verify case-by-case; do NOT include `M-018` which is status: refuted, NOR `H-005`/`H-006` which are commander-rooted).

**Separately**, mark commander-rooted entries resolved (one-line note "closed by commander `exitOverride()` in Phase 2.7 commit `<sha>`"):
- `H-005` (`--limit abc` bypassed envelope)
- `H-006` (missing positional bypassed envelope)
- Any others matching `grep -E "InvalidArgumentError|commander" PROBLEM.md` that Phase 2.7's exitOverride actually fixes.

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
| G1 (Phase 1.3) | after creating 32 cards | `ed validate cards` → `total_issues: 0` | fix card content; re-run |
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
| SIGINT mid-stdout-write | Low | Med | `process.stdout.write` is NOT atomic for >PIPE_BUF (64KB) writes. Partial JSON possible. Documented in D16; consumers MUST check exitCode===130 before parsing |
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
| 1.3 | 6–10 | 32 new cards | ~30 × 60 = ~1800 |
| 1.4 | 1–2 | 1 (SKILL.md) | ~100 changed |
| 2.1 | 1 | 1 (output.ts) | ~80 |
| 2.2 | 1 | 1 (runner.ts) | ~100 |
| 2.3a (v2.12) | 4–5 | 2 op files + 4 op-test files (bulk-create + tests, spec-sync + tests, integration/crud-sync, e2e/{chaos,flows}) | ~400 changed |
| 2.3 | 5–7 | 7 (command files) | ~500 changed (up from ~400; reflects systematic restructures per D23/D24/D28–D32) |
| 2.4 | 1 | 1 (errors.ts) | ~20 |
| 2.5 | 1 | 3 deletes | n/a |
| 2.6 | 1 | 1 (runner.spec.ts) | ~50 deleted |
| 3.0 | 2 | 1 new + ~10 edits | ~80 |
| (3.0a retired in v2.12 — folded into 2.3a) | — | — | — |
| 3.1 | 6–10 | ~20 test files | ~600 changed |
| 3.2 | 1 | 1 new test | ~60 |
| 3.3 | 2–3 | ~5 e2e/integration | ~200 changed |
| 4.1 | 1 | 1 (PROBLEM.md) | ~30 |

**Total estimate (v2.11): 35–47 turns**, 56–86 files touched, ~4000 LOC delta.

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
4. **Execute Phase 1.2.5 (NEW in v2.2)** — read §3 Phase 1.2.5; direct-edit brief G-003/G-004/G-005 + spec POST-005 to match v2.2 D5/D19 wording; run `ed bulk sync`; GATE: `ed validate cards` `total_issues: 0`. Commit before Phase 1.3.
5. **Detect Phase 1.3 progress**:
   ```bash
   ls .emberdeck/cards/cli-surface/command-routing-and-output/commands/ 2>/dev/null | wc -l
   ```
   If 0: Phase 1.3 not started. If 32: done (verify via `ed validate cards`). If 1-31: partial — diff against §1.6 list to find missing keys.
6. **Start Phase 1.3**:
   - Create directory: `mkdir -p .emberdeck/cards/cli-surface/command-routing-and-output/commands`
   - For each of the 32 cards in §1.6, write the file (use §3.1 Phase 1.3 template; fill placeholders from §1.7 + §1.8).
   - Run `ed bulk sync` → expect synced=77, errors=0.
   - Run `ed validate cards` → expect `total_issues: 0`. This is GATE G1.
7. **Phase 1.4**: edit `.claude/skills/emberdeck/SKILL.md` per §3.2 patches. GATE G2.
8. **Commit Phase 1.3 + 1.4** as one or two commits (atomic per Phase is fine; Phase 1 sub-phases need not be one commit).
9. **Phase 2**: read §3.2 sub-steps. Stage all changes. Do NOT commit between sub-steps. Run GATE G3 (`bunx tsc --noEmit`) after 2.4+2.1+2.2 (note: 2.4 must precede 2.2 per D13). After 2.1–2.7 all done, commit as one. GATE G4.
10. **Phase 3**: 3.0 first (helpers.ts extension), then 3.1/3.2/3.3 in any order. GATE G5 after 3.0, GATE G6 after 3.3.
11. **Phase 4**: PROBLEM.md edit. GATE G7.
12. **Final GATE G8**: end-to-end smoke. Commit Phase 4 changes (subject: `docs(problem): close envelope-removal entries`). Push.

If you (the agent) encounter ambiguity NOT resolved in this plan, STOP and document the gap in §2 Decisions. Do not invent.

---

## 10. Why this design survives (the meta-argument)

The v1 envelope produced 11 review rounds because every defect touched the shared `errors[]` / `status` / `data` wrapper — the surface was small (one envelope) but the coupling was total (every command instance of the envelope had to satisfy every invariant). One defect = N commands needed updating.

v2's surface is larger (31 per-command shapes) but coupling is zero (a defect in `ed validate links`'s shape cannot induce a defect in `ed card create`'s shape). Cost of round-N review on v1 = O(commands × envelope-invariants); on v2 = O(1) per command found defective. Reviewers may find more total defects across more commands, but each is locally fixable and cannot cascade. The defect class that produced 11 rounds — `errors[]` mixing 3 concerns — is structurally impossible in v2 (no `errors[]`).

This is the trade we accept.

---

## 11. Cards/files inventory at end of redesign (for verification)

After all phases complete:

**New cards** (32):
- `.emberdeck/cards/cli-surface/command-routing-and-output/commands/*.md` (32 files: 31 subcommand shapes + 1 commander-fallback)

**Rewritten cards** (3, done in 1.2):
- `cli-surface/command-routing-and-output.md`
- `cli-surface/command-routing-and-output/runner-and-output.md`
- `card-storage/persistence/sync.md` (POST-005 + failures)

**Total cards in `ed validate cards`**: previous count (45 or current) + 32 = ~77. Verify with `ed validate cards` output count.

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
