---
name: emberdeck
description: Design knowledge management for codebases using Emberdeck MCP tools. Trigger when the user asks to build, change, fix, or refactor code in a project with emberdeck configured. Also trigger on "/emberdeck" or when the user asks about specs, design cards, or acceptance criteria.
---

<rules>
<critical>
1. Read relevant cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
</critical>
2. Show card analysis to user and get confirmation before creating any card.
3. Brief cards are design documents. When creating a brief card as a **brief** (기획서), structure the body with these 8 required sections using exact `## ` headings:
   - `## Motivation` — Why this exists. Problem statement, background.
   - `## Scope` — Goals and non-goals. What we will and will NOT do.
   - `## Scenario` — How users/consumers interact. Happy path flows.
   - `## Rule` — Internal business rules and policies we define.
   - `## Constraint` — External obligations we cannot change (regulations, compatibility, legal).
   - `## Risk` — Failure scenarios, hazards, known limitations, unresolved questions.
   - `## Criteria` — Success metrics, acceptance criteria.
   - `## Decision` — Alternatives considered and why we chose this approach.
   Run `emberdeck_validate_brief` before creating spec cards to verify completeness and content quality.
   Spec cards capture verifiable contracts bound to code. Only put non-discoverable knowledge in cards — function signatures, file paths, and tech stack details degrade agent performance.
4. Define glossary before creating cards. When `glossary.yaml` has entries, every new card requires a non-empty `glossary` field listing its primary topics. Multiple cards may declare the same term when they discuss it from different perspectives.
</rules>

<glossary_semantics>
The project glossary (`glossary.yaml`) is the single source of truth for domain vocabulary. Terms are **defined once** in the glossary and **referenced** by cards that discuss them.

The `glossary` field on a card = **topic scope declaration**: "this card discusses these domain concepts." It is NOT a text concordance (not every glossary word in the body), and NOT ownership (not "this card is the authority for this concept").

A card's glossary field should list the **primary topics** it addresses. Mentioning a term in passing does not require declaring it. Multiple cards declaring the same term is normal — different cards discuss the same concept from different perspectives.

**When to add a new term to the glossary** (criteria for `emberdeck_define_glossary`, NOT for selecting which existing terms go in a card's glossary field):

A term qualifies for the glossary when ALL four conditions are met:
1. **Project-specific semantics** — either the term does not appear in general dictionaries, OR it does but carries project-specific rules, decisions, or constraints that cannot be inferred from the dictionary meaning alone. (e.g., "glossary" is a dictionary word, but THIS project's glossary has all-or-nothing batch, global lock, file-first rename compensation — those rules are not dictionary-derivable, so the term qualifies.)
2. **Cross-cutting** — appears in 2+ cards or design areas
3. **Decision-bearing** — encodes a design decision
4. **Not a code symbol** — cannot be understood by reading a single class/function/type
</glossary_semantics>

<route_table>
Match the FIRST row whose signal is true, then follow the named workflow.

| # | Signal | Workflow |
|---|--------|----------|
| 1 | No `.emberdeck/` or 0 cards | onboarding |
| 2 | Cards exist, no `glossary.yaml` or 0 glossary entries | glossary-backfill |
| 3 | Code change affects card scope | feature |
| 4 | Code change outside all card scopes | feature (step 1 reveals uncovered files) |
| 5 | No code change (deps, CI, lint, docs) | skip card workflow |
| 6 | No modification intent | read cards for context only |
</route_table>

<workflows>

<workflow name="onboarding">
1. `emberdeck_analyze` — current state. Then `emberdeck_write_spec_annotations` to reconcile (removes orphan @spec from previous sessions, adds missing ones). Reconciler is idempotent.
2. **Read ALL source files** under `src/`. No sampling — read every file. For each file, apply the single-file test: "Can this knowledge be discovered by reading this one file alone?" If NO (it spans multiple files or encodes a cross-module contract), it MUST be carded. Collect:
   - Cross-module contracts (invariants enforced across 2+ files)
   - Failure handling policies (what happens when component X fails — involves caller + callee)
   - Architectural constraints (why this approach and not another — not visible in the code itself)
   - Ordering/priority decisions (e.g., DB before file, lock ordering, drift priority)
   Do NOT collect: function signatures, type definitions, schema columns, configuration values, single-file implementation details.
   **After reading, list every `src/ops/*.ts` file with its cross-module contracts. Show this audit to the user before proceeding.** If a file has no contracts worth carding, state why explicitly.
3. **Determine card boundaries by change independence.** For each group of design decisions: "If decision A changes, must decision B also change?" If no → separate cards. Apply the splitting criteria in `<card_splitting>`.
4. **Identify brief areas first** (no body yet). For each independently designable area, draft only: candidate `key`, one-line `summary`, and the **primary topic** the brief will discuss. Show this outline to the user. This precedes glossary so glossary terms can be derived from real brief topics, not guessed in isolation.
5. Propose glossary to user (see glossary-proposal template — include Evidence column). The proposal MUST include: (a) terms derived from brief primary topics from step 4, (b) cross-cutting concepts surfaced from step 2. Get confirmation. `emberdeck_define_glossary`.
6. Create brief cards with full bodies (with `glossary` field). Show card-analysis template for each. Run `<self_review>` on each card before proposing.
7. Create spec cards under briefs (with `glossary`, `codeLinks`, `relations`). Run `<self_review>` on each card before proposing.
8. **COLLECTION REVIEW** — after creating all cards, before gates:
   (a) **Brief decomposition**: For each brief, count unrelated items in its Scope "Covers" list. 3+ unrelated items → split into separate briefs.
   (b) **Function coverage check**: For each `src/ops/*.ts` file, list all exported functions. For each exported function NOT referenced by any spec card's codeLinks, apply the counter-test: "Does this function have cross-module behavior that breaks if a caller changes assumptions?" If yes → add it to an existing spec's codeLinks or create a new spec card. A file being covered by one spec does NOT mean all functions in that file are covered.
   (c) **Glossary-brief alignment** (bidirectional):
       - Forward: For each glossary term, verify at least one brief primarily discusses this concept. If a glossary term has no governing brief → create a brief or revise glossary.
       - Reverse: For each brief, verify its primary topic exists as a glossary term. If not → define the term or reconsider whether the brief's scope is correct.
   Fix any issues found before proceeding to gates.
9. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken, 0 broken-chain, and 0 orphan-card warnings before finishing.
10. GATE: `emberdeck_get_link_coverage` — every file under `src/ops/` MUST be referenced by at least one spec card's codeLinks or boundary. If uncovered files exist, create spec cards for them.
11. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags into source code for all codeLinks.
</workflow>

<workflow name="glossary-backfill">
1. `emberdeck_lookup_glossary` — confirm empty.
2. Read existing card bodies and summaries. Extract domain terms meeting the 4 criteria.
3. Propose glossary to user (with Evidence column). `emberdeck_define_glossary`.
4. Update each card: `emberdeck_update_card` with `glossary` field.
5. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken warnings before finishing.
</workflow>

<workflow name="feature">
1. `emberdeck_pre_change_check` with files to modify. Response includes full `glossary` and affected cards.
   - critical risk: stop, show impact to user, get confirmation.
   - high risk: show affected cards to user, get confirmation.
   - medium/low risk: proceed.
2. `emberdeck_get_card` for each affected card — these are your constraints.
   - Direct cards: read full body. Transitive cards: summary only.
3. If no cards exist for the area: create brief card first (show card-analysis, include glossary), then spec cards. Run `<self_review>` before proposing each card.
4. Write code within card constraints.
5. If a new domain concept emerges: propose glossary entry to user → `emberdeck_define_glossary` → update affected cards' glossary fields.
6. If your change extends an existing spec's scope: update the spec card body and glossary field. Run `<self_review>` on the updated card.
7. GATE: `emberdeck_validate_code_links` — pass with 0 broken links before finishing.
8. `emberdeck_write_spec_annotations` — inject `@spec card-key` JSDoc tags for new/changed codeLinks.
</workflow>

</workflows>

<tool_protocol>

Glossary tools — when and how:

| Tool | When | Requires user confirmation |
|------|------|---------------------------|
| `emberdeck_define_glossary` | New domain concept or definition update. Batch up to 50. All-or-nothing validation. | Yes — show glossary-proposal first |
| `emberdeck_lookup_glossary` | Check a term's meaning, or list all terms at session start | No |
| `emberdeck_remove_glossary` | Domain concept eliminated from project. Cards referencing it become drifted. | Yes |
| `emberdeck_rename_glossary` | Domain concept rebranded. Auto-updates glossary + all card glossary fields. Card bodies need manual update. | Yes |
| `emberdeck_find_cards_by_glossary_word` | Find which cards declare a specific glossary word. Use to audit term usage or assess impact before removing/renaming. | No |
| `emberdeck_reset` | Delete all cards (DB + files), clear glossary. Run `emberdeck_write_spec_annotations` after to remove orphan @spec from source. | Yes |

Rename sequence:
1. `emberdeck_rename_glossary` with oldWord, newWord, optional definition.
2. `emberdeck_search_cards` for old word in card bodies.
3. `emberdeck_update_card` with bodyPatches to replace old word in each affected body.

Card creation — always include:
- `type`: brief (design documents) or spec (behavioral contracts)
- `glossary`: primary domain concepts this card discusses (required when glossary.yaml exists)
- `parent`: required for spec cards (must be a brief or spec card)
- `codeLinks`: required for spec cards
- `relations`: spec cards relate to at least one brief card
- `boundary`: file glob patterns this card is responsible for (recommended for specs)

</tool_protocol>

<card_analysis_template>
Show this to the user before every card creation:

```
### Card analysis: {key}
- **Type**: brief | spec
- **Glossary**: [{primary domain concepts this card discusses}]
- **Must guarantee**: {what this card ensures}
- **Excluded**: {what is deliberately out of scope}
- **Breaks if violated**: {concrete consequence}
```
</card_analysis_template>

<glossary_proposal_template>
Show this to the user before calling `emberdeck_define_glossary`:

```
### Glossary proposal
| Word | Definition | Evidence |
|------|-----------|---------|
| {word} | {definition} | {which areas use it, what decision it encodes, why non-obvious} |

Register?
```
</glossary_proposal_template>

<error_recovery>

When `emberdeck_validate_cards` reports warnings:

| Warning | Cause | Recovery |
|---------|-------|----------|
| glossary-broken | Card declares a glossary word that no longer exists in glossary.yaml | `emberdeck_define_glossary` to re-add, or `emberdeck_update_card` to remove the word from the card's glossary field |
| glossary-unused | Glossary word not declared by any card | Informational — consider creating a card that discusses this concept or removing the glossary entry |
| content-mismatch | DB and file diverged | `emberdeck_export_card_to_file` to regenerate file from DB |
| broken-chain | Spec card has no link to any brief card | Add a relation or parent to a brief card |

When `emberdeck_validate_code_links` finds broken links:
1. Check if the symbol was renamed → `emberdeck_sync_symbol_changes`.
2. Check if the file was moved → update the card's codeLinks.
3. If the symbol was intentionally removed → update or delete the card.

</error_recovery>

<card_types>

## principle — Project-wide constraint

A principle card answers: **"What rule applies across multiple briefs?"**

It captures a single project-wide constraint (process / quality / compliance / security / architecture) that governs many briefs. No code binding. Always root-level (no parent). Multiple briefs reference one principle via `governed_by`.

### REQUIRED frontmatter fields:

- `key` — identifier (e.g., `payment-idempotency`)
- `type: "principle"` — fixed
- `status` — `draft` / `active` / `retired` (no `drifted` — principle has no codeLinks)
- `summary` — one-line summary
- `statement` — the rule itself, MUST/SHALL/SHOULD/MAY in single sentence
- `rationale` — why this rule exists (background / motivation)
- `applies_to` — `"*"` (all cards) or array of card keys / boundary globs
- `enforcement` — `blocking` (reject violations) / `warning` (report only) / `advisory` (informational)

### OPTIONAL frontmatter fields:

- `metric` — quantitative thresholds. Array of `{name, threshold, unit, comparator, kind?: "threshold"|"budget", window_kind?, distributable?}`. Use `kind: "budget"` for shared/distributable quotas (frame budget, error budget, mass budget).
- `exemptions` — explicit exception targets. Array of `{target, reason}`.
- `references` — external sources (regulations, standards). Array of `{title, url}`.

### Body

Free-form prose explanation. No required sections. Body supports detailed background, examples, edge case discussion. Validation is at frontmatter level only.

### GOOD principle example:

```yaml
---
key: payment-idempotency
type: principle
status: active
summary: All payment mutations require idempotency_key
statement: Payment mutation operations MUST accept a client-provided idempotency_key and return identical results for repeat requests within a 24-hour window.
rationale: Network retries, timeouts, and double-clicks can cause duplicate charges. Payment is irreversible; correction cost is high.
applies_to:
  - src/payment/**
  - src/billing/**
  - src/refund/**
enforcement: blocking
metric:
  - name: duplicate_payment_rate
    threshold: 0
    unit: per_million_requests
    comparator: "="
exemptions:
  - target: src/payment/webhook-receiver.ts
    reason: External gateway callbacks have their own idempotency mechanism
references:
  - title: Stripe API idempotency
    url: https://stripe.com/docs/api/idempotent_requests
---

Body explanation here. Free-form prose.
```

### BAD principle examples:

- ✗ Scope-specific rule: "Order checkout MUST validate inventory" → belongs in brief.policy, not principle (single-area, not project-wide)
- ✗ No `applies_to` or `enforcement`
- ✗ `statement` without RFC 2119 keyword
- ✗ Multiple unrelated rules in one principle (split into separate principles)

---

## brief — Designable area

A brief card answers: **"What are we building in this area, why, and under what constraints?"**

Structured body lives at `frontmatter.brief` namespace. All sections are required and validated at parse time. Cross-references between sections are checked by `validateBriefRefs`.

### REQUIRED structure under `brief:` namespace:

| Section | Content | Required IDs |
|---------|--------|----------|
| `context` | `{problem, impact: [{statement, metric?}]}` | — |
| `scope` | `{goals[], non_goals[], assumptions[]}` | G-001 / NG-001 / A-001 |
| `flow` | `[{id, kind: happy/failure, given, when, then, covers}]` (≥1 happy + ≥1 failure) | S-H-01 / S-F-01 |
| `design` | `{overview, components[], data_flow[], invariants[]}` | DI-001 |
| `policy` | `[{id, subject, keyword: MUST/SHALL/.., predicate, governs}]` | R-001 |
| `external` | `[{id, statement, reference: {title, locator}}]` | C-001 |
| `compatibility` | `{guarantees[], migration_path?}` | — |
| `limits` | `[{id, statement}]` | KL-001 |
| `criteria` | `[{id, type: numeric/binary/verification, measure, verifies}]` | SC-001 |
| `rationale` | `{alternatives[≥2], chosen, trade_off?, addresses}` | — |

### Cross-references (auto-validated):

- `flow[].covers` MUST reference existing `scope.goals[].id`
- `policy[].governs` MUST reference existing `flow[].id`
- `criteria[].verifies` MUST reference existing `flow[].id`
- `rationale.addresses` MUST reference existing `external[].id` or `limits[].id`
- Every `goal` MUST be covered by ≥1 `flow`
- Every `flow` MUST be governed by ≥1 `policy` AND verified by ≥1 `criterion`

### Example (excerpt):

```yaml
---
key: order-payment
type: brief
status: active
summary: 카트 결제 → 주문 확정 흐름
brief:
  context:
    problem: 결제 도중 재고 경쟁/가격 변경으로 일관성 깨짐
    impact:
      - statement: 미스픽 1건당 보정 비용 $12
        metric: {value: 12, unit: USD}
  scope:
    goals:
      - {id: G-001, statement: 카드/페이팔/카카오페이 인증+캡처}
    non_goals:
      - {id: NG-001, statement: 분할 결제 (별도 brief)}
    assumptions:
      - {id: A-001, statement: PG 응답 p95 < 3s, verification: APM, reevaluate_when: PG 변경}
  flow:
    - {id: S-H-01, kind: happy, given: 카트 결제 의도, when: 버튼 클릭, then: 인증→캡처→주문 confirmed, covers: [G-001]}
    - {id: S-F-01, kind: failure, given: 캡처 timeout, when: 30s 응답없음, then: unknown 마킹+reconciliation, covers: [G-001]}
  policy:
    - {id: R-001, subject: 결제 시도, keyword: MUST, predicate: 5분 내 5회 실패 시 다른 수단 권유, governs: [S-F-01]}
  criteria:
    - {id: SC-001, type: numeric, measure: {value: 99.5, comparator: ">=", unit: "%"}, verifies: [S-H-01]}
  # ... external, compatibility, limits, design, rationale ...
---
```

### BAD (common mistakes):

- ✗ markdown body 그대로 (`## Motivation` heading) — 구조화된 namespace 사용 必
- ✗ `flow[].covers: [G-999]`처럼 존재하지 않는 ID 참조
- ✗ Goal 정의해놓고 어떤 flow도 covers 안 함 (orphan goal)
- ✗ Flow 정의해놓고 governs/verifies 매핑 없음
- ✗ `alternatives` 1개만 (chosen + 비교 1개 = 최소 2개)

---

## spec — Behavioral contract bound to code

A spec card answers: **"What contracts does the bound code guarantee?"**

Structured body lives at `frontmatter.spec` namespace. Cross-refs validated by `validateSpecRefs`.

### REQUIRED structure under `spec:` namespace:

| Section | Content | Required IDs |
|---------|--------|----------|
| `preconditions` | `[{id, condition, binds, derives}]` (≥1) | PRE-001 |
| `postconditions` | `[{id, guarantee, keyword: MUST/SHALL, binds, derives}]` (≥1) | POST-001 |
| `invariants` | `[{id, statement, binds, always_holds: per-call/cross-call/cross-process}]` (≥1) | INV-001 |
| `failures` | `[{violation, behavior, exception: {class, file}}]` (≥1) | — |
| `state_transitions` | `[{from, trigger, to, binds}]` | — (optional) |

### Cross-references (auto-validated):

- Every `binds` reference (`{file, symbol}`) MUST exist in card's `codeLinks`
- Every `derives` reference (`"brief-key#R-001"`) MUST follow format and (when brief loadable) point to real brief item

### Example:

```yaml
---
key: order-payment/charge
type: spec
parent: order-payment
relations: [order-payment]
codeLinks:
  - {kind: function, file: src/payment/charge.ts, symbol: chargeCard}
spec:
  preconditions:
    - {id: PRE-001, condition: idempotency_key 형식 UUIDv4, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], derives: order-payment#R-001}
  postconditions:
    - {id: POST-001, guarantee: 성공 시 payment_id 반환 status=AUTHORIZED, keyword: MUST, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], derives: order-payment#S-H-01}
  invariants:
    - {id: INV-001, statement: PAN 패턴 어떤 인자/반환/로그에도 등장 X, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], always_holds: cross-call}
  failures:
    - {violation: PG 5xx, behavior: fallback PG 라우팅 후 재시도, exception: {class: PaymentGatewayUnavailable, file: src/payment/errors.ts}}
---
```

### BAD (common mistakes):

- ✗ markdown body 그대로
- ✗ `binds`에 codeLinks 없는 file/symbol 참조
- ✗ `derives` 형식 위반 (예: "R-001" — brief key prefix 누락)
- ✗ Implementation 기법 본문에 (WeakMap, FK CASCADE 등)
- ✗ Task list 또는 verification command

---

## Summary: what goes where

| Content | principle | brief | spec | Neither |
|---------|:---:|:---:|:---:|---------|
| Project-wide rule (statement + rationale) | ✓ | | | |
| Cross-cutting metric / quota | ✓ | | | |
| External regulation reference | ✓ | | | |
| Motivation (why it exists) | | ✓ | | |
| Scope (goals / non-goals) | | ✓ | | |
| Scenario (user flows) | | ✓ | | |
| Rule (area-specific policy) | | ✓ | | |
| Constraint (external obligations) | | ✓ | | |
| Risk (failure scenarios) | | ✓ | | |
| Criteria (success metrics) | | ✓ | | |
| Decision (alternatives + rationale) | | ✓ | | |
| Contract (GIVEN/WHEN/THEN code guarantees) | | | ✓ | |
| Invariant (always-true conditions) | | | ✓ | |
| Failure (violation → behavior table) | | | ✓ | |
| Code structure descriptions | | | | ✗ discoverable |
| File paths, class names | | | | ✗ discoverable |
| Task checklists | | | | ✗ execution plan |
| Verification commands | | | | ✗ tooling |

Hierarchy: parent-child when scope is strict subset. Flat peers otherwise. Max 3 levels.

</card_types>

<card_splitting>
Deciding whether contracts belong in one card or should be split into separate cards.

**Split when ANY of these is true:**
1. **Change independence** — Contract A can drift while contract B remains valid. (e.g., createCard compensation logic vs bulkCreateCards topological sort — one can change without affecting the other.)
2. **Different codeLink files** — Contracts reference symbols in different source files. Boundary separation signals different domains.
3. **"X and Y" summary** — If the card summary uses "and" to join two unrelated capabilities, the card covers two topics.

**Merge when ALL of these are true:**
1. Contracts describe different input cases of the **same operation** (e.g., deleteCard with force=true vs force=false).
2. They share the **same codeLink set** — a change to any linked symbol affects all contracts equally.
3. One contract drifting **necessarily means** the others also drift.

**Brief decomposition:**
Each brief card should represent one **independently designable area** — an area where design decisions can be made without consulting other briefs. Signs of under-decomposition:
- Brief has 4+ direct spec children → consider splitting the brief
- Brief's Scope section lists 3+ unrelated "Covers" items → each is likely its own brief
- Brief's requirements span two unrelated subsystems → split by subsystem
</card_splitting>

<self_review>
Run on every card before creating or proposing. Any failure → revise and re-check.

The single-file test applies everywhere: "Can you discover this by reading ONE source file? If yes, it does not belong in a card. If it spans multiple files, it MUST be carded."

**Brief (5 checks):**
1. Every requirement fails the single-file test (cannot be found in one file alone)
2. Every success criterion has a number or zero-tolerance threshold
3. No implementation technology names in body (no WeakMap, FTS5, Drizzle, temp-rename, ON CONFLICT, WAL)
4. Every scenario has Given/When/Then verifiable without knowing implementation
5. Scope section states what is EXCLUDED, not just what is covered

**Spec (7 checks):**
1. Every contract states WHAT (behavior), not HOW (implementation mechanism)
2. No implementation mechanism names in body (no FK CASCADE, raw UPDATE, WeakMap, temp-rename, ON CONFLICT, upsert SQL, targeted UPDATE, WAL, atomic rename). Rewrite as behavioral guarantees: "FK CASCADE propagation" → "key change MUST propagate to all referencing records"
3. Failure mode table covers every error type the linked symbols throw
4. Splitting check (contract-level): if one contract changes, must ALL others also change? If not → split
5. **Splitting check (file-level)**: do `codeLinks` reference symbols in 2+ distinct source files? If yes, AND those files can change independently (per `<card_splitting>` rule #2), MUST split into one card per file
6. All codeLinks reference real, existing symbols (verify with grep)
7. `parent` field is set; `glossary` lists primary topics only
</self_review>

<model_notes>
- Fewer precise cards beat many vague ones — but every `src/ops/` file with cross-module contracts MUST have a spec card. "Fewer" means fewer than vague alternatives, not fewer than coverage requires.
- Call emberdeck tools directly — subagents lose card context.
- Always show the card-analysis template before creation, even when being concise elsewhere.
- Run `<self_review>` checklist on every card before proposing to user. A card that fails self-review wastes the user's time.
- Cards preserve what code cannot: design rationale, cross-module invariants, failure policies, scope boundaries. If deleting the card loses no knowledge, the card should not exist.
</model_notes>

<critical>
1. Read cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
2. Run self_review on every card before creation or update. No exceptions.
3. Single-file test: can you discover this by reading ONE source file? Then it does not belong in a card. If it spans multiple files, it MUST be carded.
</critical>
