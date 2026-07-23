---
name: emberdeck-brief-card
description: >-
  Create, read, update, and delete brief cards in emberdeck, and write briefs whose
  structure actually holds together (goals covered by flows, flows governed by policies
  and verified by criteria). Use whenever the user works with emberdeck 기획/brief
  cards: "기획 brief 카드 만들어줘", "brief 활성화가 거부돼 / cross-reference 에러",
  "goal/flow/policy/criteria/rationale(alternatives) 추가·수정", "brief에서
  card-sync-failed가 난다", "이 brief에 실패 시나리오가 없대", ID 형식 (G-001, S-H-01,
  R-001, SC-001) 문제, "validate가 active brief에 empty-tree를 낸다", or any
  `ed card ... --type brief` / `.emberdeck/cards` brief work. Do NOT use when the card
  being made or edited is a different type — for a domain/vision/principle/spec card
  use that type's own skill (e.g. emberdeck-domain-card) even though it's also an
  emberdeck card — nor for generic PRDs/기획서 outside emberdeck, or meeting
  briefings/요약.
---

# emberdeck brief card

A brief is planning: it turns intent — for whom, why, what — into a buildable target,
*before* deciding how. Briefs live inside exactly one **domain** (parent must be a
domain card) and their children are **spec** cards. A brief key is usually nested under
its domain (`reports/weekly-digest`).

What makes a brief different from a prose PRD: its structure is a closed web the
engine checks. Goals must be covered by flows, flows must be governed by policies and
verified by criteria. A brief that reads well but has an orphan goal or an unverified
flow will not activate.

## The card

A `.md` under `.emberdeck/cards/`; the frontmatter's `brief:` namespace holds **six
required** namespaces + three optional:

| field | shape |
|---|---|
| `context` | `{ problem, impact: [{ statement, metric? }] }` — the problem and what it costs; `metric` is an object `{value, unit}`, not a string (omit it if you have no measured number) |
| `scope` | `{ goals: [{id, statement}], non_goals: [{id, statement}], assumptions: [{id, statement, verification?, reevaluate_when?}] }` |
| `flow` | `[{ id, kind: happy\|failure, given, when, then, covers: [goal ids] }]` — **≥1 happy AND ≥1 failure required** |
| `policy` | `[{ id, subject, keyword: MUST\|MUST NOT\|SHALL\|SHALL NOT\|SHOULD\|SHOULD NOT\|MAY, predicate, governs: [flow ids] }]` |
| `criteria` | `[{ id, type: numeric\|binary\|verification, measure, verifies: [flow ids] }]` — measure fields differ by type: numeric `{predicate, value, comparator, unit}` · binary `{predicate, method?}` · verification `{method, reference}` |
| `rationale` | `{ alternatives: [{option, pros, cons}] (**≥2 entries**), chosen: {option, reasoning}, trade_off?, addresses: [external/limit ids] }` |
| `approach?` | prose: conceptual design sketch |
| `external?` | `[{ id, statement, reference: {title, locator} }]` — genuine external constraints |
| `limits?` | `[{ id, statement }]` — known limitations |

**ID formats are machine-enforced at parse** (regex): goals `G-001`, non-goals
`NG-001`, assumptions `A-001`, flows `S-H-01`/`S-F-01`, policies `R-001`, criteria
`SC-001`, external `C-001`, limits `KL-001`. Format only — id **uniqueness is not
checked** (never reuse an id), and the flow H/F letter is **not** tied to `kind`
(only `kind` feeds the ≥1-failure rule) — keep them consistent by convention. A wrong-format id (or
`alternatives` < 2, or a bad `keyword`) is not caught at create — it surfaces as a
stderr `card-sync-failed` on the next read and blocks the reads that parse the file
(`get`/`update`/`set-status`); `card list` still serves the stale DB row.

## The coverage web (checked at activation)

Activation runs cross-reference validation and reports **every** violation at once:

- `flow[].covers` → must resolve to `scope.goals[].id`
- `policy[].governs` and `criteria[].verifies` → must resolve to `flow[].id`
- `rationale.addresses` → must resolve to `external[].id` ∪ `limits[].id`
- flow must contain ≥1 `happy` and ≥1 `failure`
- **no orphan goal** — every goal covered by ≥1 flow
- **no ungoverned flow** — every flow governed by ≥1 policy
- **no unverified flow** — every flow verified by ≥1 criterion

Consequence for edits: adding a goal means adding (or extending) a flow that covers
it; adding a flow means wiring it into some policy's `governs` **and** some
criterion's `verifies` — otherwise the next activation fails.

### Rules you cannot break

- **Parent must be a domain.** `--parent <non-domain>` is rejected at create
  (`parent-validation-error`). A parentless brief can be *created* as draft, but
  activation rejects it (`brief card must have parent=domain to activate`) and
  `validate` immediately flags it as gating `orphan-card` — parent it before
  expecting a clean deck.
- **Active briefs need children.** A non-draft brief with no child spec cards is
  flagged `empty-tree` by `ed validate cards` (gating, exit ≠ 0); only draft is
  exempt. The activation guard does NOT check this — activation succeeds and the
  deck fails afterward. So when asked to activate a spec-less brief, don't stop at
  a successful set-status: end with the deck clean — return the brief to draft
  (explaining the missing spec) or add its first spec; explaining while leaving
  validate failing is not done.
- **Status** `draft` → `active`; `drifted` marks a brief whose code has diverged.
  Nothing sets it automatically — drift analysis (`ed analyze`) only detects and
  reports; the status changes via `set-status` alone. Set it when analysis shows
  drift, not speculatively.
- **`--patch` replaces the whole `brief` namespace.** All six required namespaces must
  be present or the patch is rejected (`Missing: …`); the optional `approach`/
  `external`/`limits` are silently dropped if omitted — resend them too
  (read-modify-write).

## Writing a brief that holds together

The engine checks the web; you supply the judgment:

- **Goals are outcomes, not features** — state what becomes different (e.g. "환불이
  3일→즉시 처리된다"), and name what you're cutting in `non_goals` so scope is an
  actual boundary.
- **Failure flows are first-class.** The ≥1-failure rule is a design requirement
  before it is a format one — rejection, duplication, and timeout paths are half the
  plan.
- **Policies bind flows with RFC keywords.** Each policy names the flows it rules via
  `governs`; a flow no policy points at is refused at activation.
- **Criteria make flows checkable.** numeric = number + unit, binary = true/false
  predicate, verification = method + reference — every flow needs at least one hooked
  via `verifies`.
- **Rationale records the road not taken.** `alternatives` ≥2 is the minimum for an
  honest comparison: the chosen option and a discarded one, each with pros/cons, keep
  the decision re-examinable.

## Running the CLI

Invoke as `ed` if emberdeck's `ed` is on `PATH` — check with `ed --version` (bare semver
like `0.3.0`; the Unix line editor is also named `ed` and prints `GNU ed`). Inside the
emberdeck source repo use `bun cli.ts` from the repo root; in a dependent project
`bunx ed`. Examples use `ed` and pass JSON on STDIN (`--from -` / `--patch -`).

## Create

`ed card schema brief` shows the shape. The parent domain must exist first. Default
status `draft` is right here twice over: activation needs the coverage web closed, and
an active brief without specs trips `empty-tree`.

```bash
echo '{ "brief": {
  "context": { "problem": "주간 리포트를 손으로 모아 보내느라 매주 2시간을 쓴다.",
               "impact": [ { "statement": "발송 지연과 누락이 반복된다." } ] },
  "scope": {
    "goals": [ { "id": "G-001", "statement": "주간 다이제스트가 자동 생성·발송된다." } ],
    "non_goals": [ { "id": "NG-001", "statement": "일간 리포트는 다루지 않는다." } ],
    "assumptions": [ { "id": "A-001", "statement": "리포트 원천 데이터는 매주 월요일까지 적재된다." } ]
  },
  "flow": [
    { "id": "S-H-01", "kind": "happy", "given": "월요일 오전, 데이터 적재 완료",
      "when": "스케줄러가 다이제스트 생성을 실행", "then": "구독자에게 발송된다", "covers": ["G-001"] },
    { "id": "S-F-01", "kind": "failure", "given": "데이터 적재 미완료",
      "when": "생성 시각 도래", "then": "발송을 보류하고 운영자에게 알린다", "covers": ["G-001"] }
  ],
  "policy": [
    { "id": "R-001", "subject": "다이제스트 생성기", "keyword": "MUST",
      "predicate": "적재 완료를 확인한 뒤에만 발송한다", "governs": ["S-H-01", "S-F-01"] }
  ],
  "criteria": [
    { "id": "SC-001", "type": "binary",
      "measure": { "predicate": "적재 미완료 주에는 발송되지 않는다" }, "verifies": ["S-H-01", "S-F-01"] }
  ],
  "rationale": {
    "alternatives": [
      { "option": "자동 생성·발송", "pros": ["시간 절약", "누락 방지"], "cons": ["오발송 위험"] },
      { "option": "수동 발송 유지", "pros": ["검수 가능"], "cons": ["매주 2시간", "지연 반복"] }
    ],
    "chosen": { "option": "자동 생성·발송", "reasoning": "지연·누락이 문제의 본질이므로 자동화가 직접 해결" },
    "addresses": []
  }
} }' | ed card create reports/weekly-digest --type brief --parent reports \
        --summary "주간 다이제스트 자동화" --from -

ed validate cards   # prove it: total 0, stderr quiet
```

## Read

```bash
ed card get <key>                       # full card JSON incl. the brief namespace
ed card list --type brief               # all briefs
ed card list --parent <domain-key>      # a domain's briefs
ed card tree <domain-key>               # domain → briefs → specs
ed card context <key>                   # neighbors + governedBy (principles over this card)
```

## Update

Read-modify-write: `ed card get` → edit → send **all six** required namespaces back
(plus any optional ones the card has — omitted optionals are dropped).

```bash
ed card get reports/weekly-digest   # copy the whole brief namespace from here
# … edit one part (e.g. add G-002 + a flow covering it + wire governs/verifies) …
echo '{ "brief": { …all six namespaces… } }' | ed card update reports/weekly-digest --patch -

ed card update <key> --summary "…"            # summary only
ed card set-status <key> active --reason "…"  # runs the coverage-web validation
```

`set-status … active` is also the cheapest way to check the web: it lists **all**
broken refs/coverage gaps at once in `unmetConditions`.

## Delete

```bash
ed card delete <key> --yes          # child specs? --force detaches them (not deleted)
```

## Verify

After every create/update/delete, run `ed validate cards` and watch **both** channels:

- stdout findings — `empty-tree` on a non-draft brief without specs (gating); fix by
  adding the first spec or returning the brief to `draft`.
- **stderr** `card-sync-failed` — parse-level defects (bad ID format, `alternatives`
  < 2, bad `keyword`): the JSON stays `total 0`, so a quiet stdout alone proves
  nothing. `-q` hides these warnings — don't use it while verifying.

Fix and re-run until `total` is `0` and stderr is quiet. Don't report the task done
without both.
