---
name: emberdeck-spec-card
description: >-
  Create, read, update, and delete spec cards in emberdeck, and bind them to source
  code with @spec annotations. Use whenever the user works with emberdeck spec cards:
  "spec 카드 만들어줘", "@spec 바인딩 / ed spec sync", "spec 활성화가 소스 바인딩 없다고
  거부돼", "broken-derives / broken-invoke / duplicate-shape-id가 떠",
  precondition/postcondition/invariant/failure/shape/invokes 추가·수정, sub-spec,
  or any `ed card ... --type spec` / `.emberdeck/cards` spec work. Do NOT use when
  the card being made or edited is a different type — vision/principle/domain/brief
  cards have their own skills — nor for generic API specs/OpenAPI/test specs outside
  emberdeck.
---

# emberdeck spec card

A spec is the contract for one built thing, written so that conformance can be judged
from the artifact alone — and it is the **only** card tier bound to code. The binding
mechanism is a `/** @spec <card-key> */` JSDoc annotation on the implementing symbol;
`ed spec sync` reconciles those annotations into the code-link cache that activation
and binding principles check. Parent must be a **brief** (or another **spec** —
sub-specs are allowed); keys are typically nested (`reports/weekly-digest/generate`).

## The card

A `.md` under `.emberdeck/cards/`; the frontmatter's `spec:` namespace holds **four
required arrays** (each needs ≥1 entry to activate) + three optional:

| field | shape |
|---|---|
| `preconditions` | `[{ id, condition, derives }]` — what must hold before the call |
| `postconditions` | `[{ id, guarantee, keyword: MUST\|SHALL, derives, references? }]` — what is guaranteed after; `references?` names a SHP shape id |
| `invariants` | `[{ id, statement, always_holds: per-call\|cross-call }]` — no `derives` (symbol-local) |
| `failures` | `[{ id, violation, behavior, case_of?, owner?, references? }]` — `id` format `FAIL-001` is regex-enforced at parse |
| `shapes?` | `[{ id, role: output\|error-output, when?, schema }]` — IO/error form contracts; SHP ids are **deck-global**; `schema` is a single **string** (fenced-block text), not a JSON object — an object parses at create but bricks the next read |
| `invokes?` | `[{ to, kind: per-call\|setup, note? }]` — cross-spec call edges; `to` must be an existing **spec** key |
| `state_transitions?` | `[{ from, trigger, to }]` |

Enums (`keyword`, `always_holds`, `role`, `kind`) and the `FAIL-` id format are
parse-enforced — violations surface as stderr `card-sync-failed` on the next read.
`PRE-001`/`POST-001`/`INV-001`/`SHP-001` id formats are convention (not machine-checked).

## Two-phase reference checking (get this right)

`derives` ties a spec back to its ancestor brief, in the form `"brief-key#item-id"`:
pre/postconditions derive from brief **goals** (`G-*`); a failure's `case_of` maps to a
brief **failure flow** (`S-F-*`). The checking is split in two phases:

- **Activation** checks the reference **format** (`brief-key#item-id`), the ≥1
  minimums, and the parent — but does **not** resolve targets. A spec deriving from a
  nonexistent `G-999` activates fine.
- **`ed validate cards`** resolves the targets deck-wide and flags misses as
  **`broken-derives`** (gating, exit ≠ 0). So a green activation is not proof the
  wiring is right — only a clean validate is.

Cross-card edges are also validate-time and gating, checked on non-draft specs:
`broken-invoke` (invokes target missing or not a spec), `duplicate-shape-id` (a SHP id
declared by two active specs), `broken-shape-ref` (postcondition references an
undeclared SHP), `broken-failure-owner` / `broken-failure-ref` (failure dedup edges;
`references` requires an `owner`), `foreign-derive` (a derives/case_of whose
`brief-key` prefix is not this spec's ancestor brief — fires on the key alone, whether
or not the target exists, stacking with `broken-derives` when it doesn't), and
`rework-dependency` (an active spec `invokes` a draft spec).

## Source binding (the point of spec)

**A binding is a conformance claim, not mere linkage** — `@spec` on a symbol declares
"this code implements this contract," and nothing machine-checks that the claim is true.
Writing the spec ahead of the code? Keep the card **draft** and do not annotate until the
implementation actually conforms; binding and activating against a known-nonconforming
symbol makes the deck assert a falsehood.

- **When the code index is empty** (no `projectRoot`, or nothing indexed yet),
  activation treats it as "no information" and demands nothing.
- **When the index is non-empty**, activation requires ≥1 cached binding for this card
  (zero bindings → `spec card has no source bindings — add at least one '@spec <key>'
  JSDoc annotation`) and every cached binding must still resolve in the index (a stale
  one → `source binding '<file>:<symbol>' unresolved`).

The workflow, in order:

```ts
/** @spec reports/weekly-digest/generate */
export function generateDigest(week: Date): Digest { … }
```

```bash
ed spec sync        # reconcile @spec annotations into the code-link cache
ed card set-status reports/weekly-digest/generate active
```

Annotate first, `spec sync` second, activate third — activating before sync fails
because the cache, not the source text, is what the guard reads. This same cache is
what a binding-class principle checks at validate time.

The cache is **additive**: sync adds newly discovered links but never deletes rows. A
removed annotation is only *reported* under `markerMissing` in the sync output — the
stale row remains and keeps satisfying activation and binding principles. So after any
annotation change, read the sync output: a non-empty `markerMissing` means the card's
declared binding no longer exists in source even though everything still passes. For a
source **symbol rename or file move**, run `ed spec sync-symbols` (then `spec sync`) —
ordinary sync only adds, never repairs moved links. A **card rename** (`ed card rename`)
rewrites neither inbound `invokes`/failure-`owner` references nor `@spec` marker text in
source — rewrite those, sync, and check `unmatched`/`markerMissing` before calling the
rename done.

### Rules you cannot break

- **Parent must be a brief or a spec.** Anything else is rejected at create
  (`spec card parent must be brief or spec`). A parentless spec can be *created* as
  draft, but it cannot activate and `validate` immediately flags it — gating
  `orphan-card` + `broken-chain` — so parent it before expecting a clean deck.
- **Status** `draft` → `active` → (`drifted` when code diverges). Nothing sets
  `drifted` automatically — `ed analyze` detects and reports drift; the status changes
  only via `set-status`. `empty-tree` does not apply to specs.
- **`--patch` replaces the whole `spec` namespace.** All four required arrays must be
  present or the patch is rejected (`Missing: …`); omitted optional arrays
  (`shapes`/`invokes`/`state_transitions`) are silently dropped — resend them
  (read-modify-write).
- **Draft specs are skipped as enforcement subjects** — cross-card checks, derives
  resolution, and binding principles don't evaluate them, and a draft's shapes don't
  count for SHP uniqueness. But draft-declared shapes **can** satisfy an active spec's
  `references` (the SHP registry includes drafts).

## Writing a spec that can judge conformance

- **Postconditions are the contract's spine** — each one a MUST/SHALL guarantee an
  observer could check on the artifact, deriving from the goal it serves.
- **Failures mirror the brief's rejection paths**: wire `case_of` to the brief's
  `S-F-*` flow when the failure is user-visible; use `owner`/`references` only to
  dedup a failure another spec canonically owns.
- **Shapes own form, prose owns meaning** — put the output/error schema in a SHP once
  and point at it with `references`, instead of restating field lists in guarantees.
  The schema must state the form the artifact actually has — when bound source exists,
  read its types instead of inventing field names.
- **`invokes` is a confession of runtime coupling** — declare the spec you call
  per-call; boundary principles (`forbids-relation-to`) read these edges.
- **Split, don't bloat**: when one symbol's contract grows unrelated concerns, add a
  sub-spec (`--parent <this-spec>`) rather than stretching one card.

## Running the CLI

Invoke as `ed` if emberdeck's `ed` is on `PATH` — check with `ed --version` (bare semver
like `0.3.0`; the Unix line editor is also named `ed` and prints `GNU ed`). Inside the
emberdeck source repo use `bun cli.ts` from the repo root; in a dependent project
`bunx ed`. Examples use `ed` and pass JSON on STDIN (`--from -` / `--patch -`).
In a deck with a `glossary.yaml`, every `card create` additionally requires
`--glossary <existing-word>` — without it create fails (`glossary field is required
when project glossary exists`).

## Create

`ed card schema spec` shows the shape. A top-level spec's parent brief must exist first; a sub-spec's parent spec must exist first. Default
`draft` is right: activate only after the @spec annotation is in the source and
`ed spec sync` has cached it.

```bash
echo '{ "spec": {
  "preconditions": [
    { "id": "PRE-001", "condition": "해당 주의 원천 데이터 적재가 완료되어 있다",
      "derives": "reports/weekly-digest#G-001" }
  ],
  "postconditions": [
    { "id": "POST-001", "keyword": "MUST", "derives": "reports/weekly-digest#G-001",
      "guarantee": "구독자 전원에게 다이제스트가 발송되고 발송 기록이 남는다" }
  ],
  "invariants": [
    { "id": "INV-001", "always_holds": "cross-call",
      "statement": "같은 주에 대한 발송은 최대 1회다" }
  ],
  "failures": [
    { "id": "FAIL-001", "violation": "원천 데이터 미적재",
      "behavior": "발송을 보류하고 운영자에게 알린다",
      "case_of": "reports/weekly-digest#S-F-01" }
  ]
} }' | ed card create reports/weekly-digest/generate --type spec \
        --parent reports/weekly-digest --summary "다이제스트 생성·발송 계약" --from -

ed validate cards   # prove it: total 0, stderr quiet (broken-derives would show here)
```

## Read

```bash
ed card get <key>                        # full card JSON incl. the spec namespace
ed card list --type spec                 # all specs
ed card list --parent <brief-key>        # a brief's specs
ed card list --symbol <name>             # specs bound to a code symbol
ed card context <key>                    # neighbors + invokes/derives trace edges
```

## Update

Read-modify-write: `ed card get` → edit → send all four required arrays back (plus any
optional arrays the card has — omitted optionals are dropped).

```bash
echo '{ "spec": { …all four (+ optional) arrays… } }' | ed card update <key> --patch -

ed card update <key> --summary "…"            # summary only
ed card set-status <key> active --reason "…"  # format+minimums+parent+binding check
```

## Delete

```bash
ed card delete <key> --yes          # sub-specs? --force detaches them (not deleted)
```

Stale `@spec` annotations left in source after deleting a card surface under
`unmatched` in the next `ed spec sync` output (an annotation naming an existing
non-spec card surfaces under `nonSpecTargets`) — remove them with the card.

## Verify

After every create/update/delete — and after every `spec sync` — run
`ed validate cards` and watch both channels:

- stdout findings — `broken-derives`, `broken-invoke`, `duplicate-shape-id`,
  `broken-shape-ref`, `broken-failure-owner/-ref` (all gating): the declared edges
  don't resolve; fix the reference or the target.
- **stderr** `card-sync-failed` — parse defects (bad enum, bad `FAIL-` id): the JSON
  stays `total 0`, so a quiet stdout alone proves nothing; `-q` hides these.

Fix and re-run until `total` is `0` and stderr is quiet. Don't report the task done
without both.
