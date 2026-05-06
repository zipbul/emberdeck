> ⚠️ **Historical document.** SKILL.md design plan written when emberdeck shipped as MCP server (`mcp__emberdeck__*` tool names throughout). emberdeck is now CLI-only; the current SKILL.md lives at `.claude/skills/emberdeck/SKILL.md`. Kept for design history.

# SKILL.md Rewrite Plan

> Emberdeck SKILL.md를 프롬프트/컨텍스트/하네스 엔지니어링 기법으로 재작성하는 계획.
> 모든 변경은 학술 연구, Anthropic 공식 문서, 또는 이 프로젝트에서 관찰된 사실에 근거.

---

## 1. 현재 상태 진단

### 1.1 서브에이전트 테스트 결과 (v2→v5, 4회 반복)

| 문제 | v2 | v3 | v4 | v5 | 근본 원인 |
|------|----|----|----|----|----------|
| orphan-card (parent 미설정) | 7건 | 0 | 0 | 0 | N1 해결 (tool_protocol에 parent 필수 명시) |
| 커버리지 부족 (13 codeLinks) | ✗ | 0 | 0 | 0 | N2 해결 (coverage gate 추가) |
| CRUD/query/sync 미커버 | ✗ | ✗ | 0 | 0 | N3 해결 (single-file test 통일) |
| 전수조사 결과 미제시 | ✗ | ✗ | 0 | 0 | N4 해결 (audit 출력 강제) |
| 카드 과소 생성 | ✗ | ✗ | 0 | 0 | N5 해결 ("fewer" 하한 명확화) |
| brief over-scope | 미확인 | ✗ | 0 | 0 | collection review (a) 해결 |
| checkInteractions 미커버 | ✗ | ✗ | ✗ | 0 | function coverage check 해결 |
| **spec 5 contracts 초과** | 미확인 | 0 | 2건 | **2건** | **미해결** — self_review가 텍스트 지시라 스킵됨 |

### 1.2 잔존 문제의 구조적 원인

F1 (이 프로젝트에서 관찰된 사실):
> "도구 호출 기반 단계: **전부 준수**. 순수 텍스트 단계: **누락**."

self_review는 순수 텍스트 지시. 에이전트가 "mentally run"하라는 지시를 받지만 실제 실행을 증명할 방법이 없음. spec-link-resolution(7 contracts)과 spec-glossary-ops(6 contracts)가 "max 5" 규칙을 위반한 채 생성됨.

B4 (OpenDev 논문 [7]):
> "에이전트에게 좋은 코드를 쓰라고 말하는 대신, 좋은 코드의 모양을 기계적으로 강제하라"

---

## 2. 적용할 기법과 근거

### 2.1 프롬프트 엔지니어링 (SKILL.md 텍스트)

#### P1. 체크리스트 복사 패턴 (H1)

**현재**: `Run <self_review> on each card before proposing.`
**변경**: collection review에서 체크리스트를 복사하여 출력하도록 강제.

```markdown
7. COLLECTION REVIEW — copy this checklist into your response and complete every item:

Collection audit:
- [ ] Brief decomposition: [each brief's Covers count listed]
- [ ] Function coverage: [each src/ops/*.ts file + exported functions + coverage status]
- [ ] Glossary-brief alignment: [each glossary term + governing brief]
- [ ] Contract counts: [each spec card + WHEN count + PASS/FAIL]
Fix all FAIL items before proceeding to gates.
```

**근거**:
- H1 (Anthropic 공식 [17]): "Break complex operations into clear, sequential steps. For particularly complex workflows, provide a checklist that Claude can copy into its response and check off as it progresses."
- H1: "Clear steps prevent Claude from skipping critical validation. The checklist helps both Claude and you track progress through multi-step workflows."
- G5 (Template 연구 [16]): 속성명+설명 포함 시 형식 준수 점수 3.09 → 4.90/5.00.

**왜 효과적인가**: 에이전트가 체크리스트를 **출력**해야 하므로 멘탈 스킵이 불가능. 각 항목에 구체적 데이터(카드명, 숫자)를 채워야 하므로 실제 검증을 수행해야 함.

---

#### P2. 배제 제약 결합 (G3)

**현재**: self_review가 긍정 지시만 ("Every contract states WHAT").
**변경**: 각 긍정 지시에 배제 제약을 결합.

```markdown
**Spec (5 checks):**
1. Every contract states WHAT (behavior), not HOW (implementation mechanism).
   Do NOT mention: internal data structures, SQL patterns, specific library APIs, file system operations.
2. ...
5. Max 5 contracts per card. Do NOT proceed with creation if count exceeds 5 — split first.
```

**근거**:
- G3 (Template 연구 [16]): "긍정 지시에 배제 제약을 결합하면 형식 준수율이 극적으로 향상. LLaMA3에서 준수율 40% → 100%."
- D3 (시스템 프롬프트 분석): Claude Code 시스템 프롬프트가 `Do NOT` 패턴을 핵심 제약에 사용.

**왜 효과적인가**: "max 5 contracts"만으로는 에이전트가 무시할 수 있지만, "Do NOT proceed with creation if count exceeds 5"는 행동 차단 지시.

---

#### P3. 핵심 위반항목 반복 배치 (A3)

**현재**: "max 5 contracts"가 self_review에 1회만 등장.
**변경**: 3곳에 반복 배치.

1. `<self_review>` spec check 5번 (현재 위치)
2. `<card_splitting>` size threshold (현재 위치)
3. `<critical>` 끝 (신규 추가)

```markdown
<critical>
...
4. Spec cards MUST NOT have more than 5 WHEN contracts. Split before creating.
</critical>
```

**근거**:
- A3 (Instruction Gap [4]): "긴 프롬프트에서 핵심 지시를 반복하면 준수율 20-35% 회복."
- A1 (Lost in the Middle [1]): 끝 위치는 고주의 영역.

---

#### P4. 피드백 루프 명시 (H2)

**현재**: GATE 단계에서 실패 시 행동 미명시.
**변경**: 검증→수정→재검증 루프를 명시.

```markdown
8. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken, 0 broken-chain, 0 orphan-card.
   IF warnings exist: fix each warning, then re-run validate_cards. Repeat until 0 warnings.
```

**근거**:
- H2 (Anthropic 공식 [17]): "Common pattern: Run validator → fix errors → repeat. This pattern greatly improves output quality."

---

#### P5. 일반 지시 vs 처방적 단계 균형 (C4)

**현재**: onboarding이 10단계 처방적 워크플로우.
**판단**: 유지. 이유:

- C4: "Prefer general instructions over prescriptive steps"는 추론 태스크에 해당.
- onboarding은 추론이 아니라 **절차적 실행** — 도구 호출 순서가 중요.
- A2 (SIFo): 순차 지시에서 후반 누락이 문제이므로, 단계를 줄이는 것이 아니라 **각 단계를 도구 호출 기반으로 고정**하는 것이 해결책.
- F1: "도구 호출 기반 단계는 전부 준수" — 현재 GATE 단계(validate_cards, get_link_coverage)는 100% 준수됨.

collection review(step 7)만 텍스트 단계인데, P1(체크리스트 복사)으로 보완.

---

### 2.2 컨텍스트 엔지니어링

#### C1. Dynamic Context 연결 (B5)

**현재**: GATE 도구 결과가 다음 단계로 연결되지 않음.
**변경**: 도구 결과를 명시적으로 다음 단계의 입력으로 지정.

```markdown
8. GATE: `emberdeck_validate_cards`
   IF warnings exist: read each warning, fix the card, re-run. Repeat until 0.
   Pass the final result's warning count (must be 0) to confirm before step 9.
9. GATE: `emberdeck_get_link_coverage`
   IF uncovered files: create spec cards for them, re-run. Repeat until all covered.
```

**근거**:
- B5 (NxCode [8]): "Dynamic Context: 관찰 데이터 (로그, 메트릭)"을 다음 행동의 입력으로 사용.
- H4 (Anthropic 공식 [17]): "plan-validate-execute" 패턴. 검증 결과가 다음 실행을 결정.

---

#### C2. Context Offloading — 전수조사 결과 파일 저장 (B5)

**현재**: step 2에서 "Show this audit to the user before proceeding."
**변경**: audit 결과를 파일로 저장하여 컨텍스트 압축 시에도 유실 방지.

```markdown
2. ... After reading, create a temporary audit file listing every `src/ops/*.ts` file
   with its exported functions and cross-module contracts.
   Show the audit to user. Keep the audit accessible for step 7 (collection review).
```

**근거**:
- B5 (Simon Willison [10]): "Context Offloading: 정보를 LLM 컨텍스트 외부에 저장. 코딩 에이전트가 plan.md 파일을 만들어 작업하면서 업데이트하는 것이 대표적 예시."
- 긴 온보딩 세션에서 Progressive Compaction (B4)이 발생하면 step 2의 audit가 유실됨. 파일로 저장하면 step 7에서 Read로 복원 가능.

---

#### C3. 지연 로딩 — card_types 분리 (E3)

**현재**: card_types(118줄, 전체의 35%)가 SKILL.md에 항상 로드.
**판단**: 현 시점에서는 **유지**. 이유:

- H5 (Anthropic 공식 [17]): "The context window is a public good." — 118줄은 토큰 비용이 있으나...
- card_types는 **모든 workflow에서 필요** (onboarding: step 5-6, feature: step 3, glossary-backfill: step 4). 별도 파일로 분리하면 매번 Read 호출 필요.
- 340줄 → 분리 후 ~220줄. 500줄 한도 내이므로 분리의 실질적 이득이 적음.
- 분리 시 에이전트가 card_types.md를 읽지 않을 위험 > 토큰 절약 이득.

**조건**: SKILL.md가 500줄을 초과하면 그때 분리.

---

### 2.3 하네스 엔지니어링

#### H1. PostToolUse Hook — 카드 생성 후 기계적 검증 (E2, B3)

**현재**: 없음.
**변경**: `emberdeck_create_card` 호출 후 LLM prompt hook으로 검증.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "toolName": "mcp__emberdeck__emberdeck_create_card" },
        "hooks": [
          {
            "type": "prompt",
            "prompt": "A card was just created. Verify: (1) If type=spec, does the card have a parent field? (2) Count WHEN clauses in the body — is it 5 or fewer? (3) Does the body contain any of these implementation keywords: WeakMap, FTS5, Drizzle, temp-rename, ON CONFLICT, WAL, writeFileSync, readFileSync? (4) If type=spec, does the card have at least 1 codeLink? Answer with JSON: {\"pass\": true} or {\"pass\": false, \"reason\": \"...\"}"
          }
        ]
      }
    ]
  }
}
```

**근거**:
- E2 (Claude Code [14]): "Hooks — 유일한 결정적 강제." PostToolUse로 도구 실행 후 검증.
- B3 (LangChain/NxCode [8]): "PreCompletionChecklistMiddleware가 핵심: 에이전트가 응답 제출 전에 체크리스트를 강제 실행."
- F1 (프로젝트 관찰): "도구 호출 기반 단계: 전부 준수." Hook은 도구 호출 기반이므로 준수율 100%.
- B4 (OpenDev [7]): "좋은 코드의 모양을 기계적으로 강제하라."

**왜 효과적인가**: 에이전트가 SKILL.md의 self_review를 건너뛰어도, Hook이 기계적으로 검증. SKILL.md(소프트) + Hook(하드) 이중 방어.

**검증 항목 근거**:
- (1) parent 필수: v2에서 7건 orphan-card 발생. 가장 빈번한 구조 결함.
- (2) max 5 contracts: v5에서 2건 초과. self_review로 해결 안 된 유일한 항목.
- (3) 구현 키워드: v1에서 6+ 건 발견. 발견가능 내용의 가장 흔한 형태.
- (4) codeLink 필수: spec 카드의 존재 이유.

---

#### H2. bulk_create_cards Hook (E2)

**변경**: `emberdeck_bulk_create_cards` 호출 후에도 동일 검증 적용.

```json
{
  "matcher": { "toolName": "mcp__emberdeck__emberdeck_bulk_create_cards" },
  "hooks": [
    {
      "type": "prompt",
      "prompt": "Cards were bulk-created. For each created card in the result, verify: (1) spec cards have parent, (2) body WHEN count <= 5, (3) no implementation keywords, (4) spec cards have codeLinks. List any failures as JSON array."
    }
  ]
}
```

**근거**: 온보딩에서 bulk_create_cards가 사용됨. create_card만 Hook하면 bulk 경로를 우회 가능.

---

#### H3. Stop Hook — 온보딩 품질 게이트 (I4) [선택사항]

**판단**: 현 시점에서는 **보류**. 이유:

- Stop Hook은 **모든 응답 종료 시** 실행됨. 온보딩이 아닌 일반 feature workflow에서도 불필요하게 실행.
- matcher 조건이 toolName 기반이 아니라 응답 내용 기반이어야 하므로, prompt hook의 판단이 부정확할 수 있음.
- PostToolUse Hook(H1, H2)이 카드 단위 검증을 커버하므로, Stop Hook의 추가 가치가 제한적.

**조건**: PostToolUse Hook으로 해결 안 되는 collection-level 문제(brief over-scope 등)가 반복되면 추가.

---

## 3. 변경 계획

### 3.1 SKILL.md 변경 (프롬프트 + 컨텍스트)

#### 변경 1: collection review를 체크리스트 복사 패턴으로 교체

**위치**: L59-63 (step 7)
**적용 기법**: P1 (H1 체크리스트 복사), P2 (G3 배제 제약), I2 (G5 속성 명세)

**Before**:
```markdown
7. **COLLECTION REVIEW** — after creating all cards, before gates:
   (a) **Brief decomposition**: For each brief, count unrelated items in its Scope "Covers" list. 3+ unrelated items → split into separate briefs.
   (b) **Function coverage check**: For each `src/ops/*.ts` file, list all exported functions. For each exported function NOT referenced by any spec card's codeLinks, apply the counter-test: "Does this function have cross-module behavior that breaks if a caller changes assumptions?" If yes → add it to an existing spec's codeLinks or create a new spec card. A file being covered by one spec does NOT mean all functions in that file are covered.
   (c) **Glossary-brief alignment**: For each glossary term, verify at least one brief primarily discusses this concept. If a glossary term has no governing brief → create a brief or revise glossary.
   Fix any issues found before proceeding to gates.
```

**After**:
```markdown
7. **COLLECTION REVIEW** — copy this checklist into your response and complete every item:

   ```
   ## Collection Audit
   ### (a) Brief decomposition
   | Intent | Covers count | Items | PASS/FAIL |
   |--------|-------------|-------|-----------|
   | {key}  | {N}         | {list}| {N<3: PASS, else FAIL} |
   (all briefs)

   ### (b) Function coverage
   | File | Exported functions | In codeLinks? | Counter-test result |
   |------|--------------------|---------------|---------------------|
   | {file} | {func1, func2, ...} | {yes/no per func} | {skip/need spec} |
   (all src/ops/*.ts files)

   ### (c) Glossary-brief alignment
   | Glossary term | Governing brief | PASS/FAIL |
   |---------------|-----------------|-----------|
   | {term} | {brief key or NONE} | {PASS/FAIL} |
   (all glossary terms)

   ### (d) Contract count
   | Spec card | WHEN count | PASS/FAIL |
   |-----------|-----------|-----------|
   | {key}     | {N}       | {N<=5: PASS, else FAIL} |
   (all spec cards)
   ```

   Do NOT proceed to gates until all items show PASS. Fix FAIL items first.
```

---

#### 변경 2: self_review에 배제 제약 추가

**위치**: L307-325
**적용 기법**: P2 (G3 배제 제약)

**Before**:
```markdown
**Spec (5 checks):**
1. Every contract states WHAT (behavior), not HOW (implementation mechanism)
...
5. Max 5 contracts per card; `parent` field is set; `glossary` lists primary topics only
```

**After**:
```markdown
**Spec (5 checks):**
1. Every contract states WHAT (behavior), not HOW (implementation mechanism).
   Do NOT mention: internal data structures, SQL patterns, specific library APIs, file I/O methods.
...
5. Max 5 WHEN contracts per card. Do NOT create the card if count exceeds 5 — split first.
   `parent` field MUST be set. `glossary` lists primary topics only.
```

---

#### 변경 3: critical에 max 5 반복

**위치**: L335-339
**적용 기법**: P3 (A3 핵심 지시 반복), A1 (끝 위치 배치)

**Before**:
```markdown
<critical>
1. Read cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
2. Run self_review on every card before creation or update. No exceptions.
3. Single-file test: can you discover this by reading ONE source file? Then it does not belong in a card. If it spans multiple files, it MUST be carded.
</critical>
```

**After**:
```markdown
<critical>
1. Read cards before modifying code. Run `emberdeck_validate_code_links` after. Always.
2. Run self_review on every card before creation or update. No exceptions.
3. Single-file test: can you discover this by reading ONE source file? Then it does not belong in a card. If it spans multiple files, it MUST be carded.
4. Spec cards MUST NOT have more than 5 WHEN contracts. Do NOT create — split first.
</critical>
```

---

#### 변경 4: GATE에 피드백 루프 명시

**위치**: L64-66
**적용 기법**: P4 (H2 피드백 루프)

**Before**:
```markdown
8. GATE: `emberdeck_validate_cards` — pass with 0 glossary-broken, 0 broken-chain, and 0 orphan-card warnings before finishing.
9. GATE: `emberdeck_get_link_coverage` — every file under `src/ops/` MUST be referenced by at least one spec card's codeLinks or boundary. If uncovered files exist, create spec cards for them.
```

**After**:
```markdown
8. GATE: `emberdeck_validate_cards` — 0 glossary-broken, 0 broken-chain, 0 orphan-card.
   IF warnings exist → fix each warning → re-run validate_cards. Repeat until 0 warnings.
9. GATE: `emberdeck_get_link_coverage` — every `src/ops/` file covered.
   IF uncovered files exist → create spec cards → re-run coverage. Repeat until all covered.
```

---

#### 변경 5: step 2에 context offloading

**위치**: L48-54
**적용 기법**: C2 (B5 Context Offloading)

**Before**:
```markdown
   **After reading, list every `src/ops/*.ts` file with its cross-module contracts. Show this audit to the user before proceeding.** If a file has no contracts worth carding, state why explicitly.
```

**After**:
```markdown
   **After reading, output the audit of every `src/ops/*.ts` file with its exported functions and cross-module contracts.** Show to the user before proceeding. If a file has no contracts worth carding, state why. This audit is re-used in step 7 (collection review).
```

---

### 3.2 settings.json 변경 (하네스)

#### 변경 6: PostToolUse Hook for create_card

**적용 기법**: H1 (E2 PostToolUse, B3 PreCompletionChecklist, B4 기계적 강제)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "toolName": "mcp__emberdeck__emberdeck_create_card" },
        "hooks": [
          {
            "type": "prompt",
            "prompt": "A card was just created via emberdeck_create_card. Check the tool result and verify ALL of the following. Answer ONLY with JSON.\n\n1. If the card type is 'spec', does the frontmatter include a 'parent' field? (parent_set: true/false)\n2. Count the number of lines in the body that start with '- WHEN' or '- Given'. Is it 5 or fewer? (contract_count: N, within_limit: true/false)\n3. Does the body contain any of these implementation keywords: WeakMap, FTS5, Drizzle, temp-rename, ON CONFLICT, WAL, writeFileSync, readFileSync, txDb, cardRepo? (has_impl_keywords: true/false, found: [...])\n4. If the card type is 'spec', does it have at least 1 codeLink? (has_codelinks: true/false)\n\nRespond: {\"pass\": true} if ALL checks pass.\nRespond: {\"pass\": false, \"failures\": [...]} if ANY check fails.\n\nDo NOT explain. JSON only.",
            "timeout": 15000
          }
        ]
      },
      {
        "matcher": { "toolName": "mcp__emberdeck__emberdeck_bulk_create_cards" },
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Cards were bulk-created via emberdeck_bulk_create_cards. For each successfully created card key in the result, state whether it likely passes these checks based on the input that was provided: (1) spec cards have parent, (2) body has <=5 WHEN/Given contracts, (3) no implementation keywords in body, (4) spec cards have codeLinks. List any suspected failures. JSON only: {\"pass\": true} or {\"pass\": false, \"suspected_failures\": [...]}",
            "timeout": 20000
          }
        ]
      }
    ]
  }
}
```

---

## 4. 변경하지 않는 항목과 이유

| 항목 | 이유 |
|------|------|
| onboarding 10단계 구조 | C4는 추론 태스크에 해당. 온보딩은 절차적 실행. F1: 도구 기반 단계는 100% 준수 |
| card_types 118줄 인라인 | 모든 workflow에서 필요. 340줄 < 500줄 한도. 분리 시 미로딩 위험 > 토큰 절약 |
| Stop Hook | PostToolUse가 카드 단위 검증 커버. Stop은 모든 응답에 실행되어 비용 과다 |
| A5 메타인지 프롬프팅 | 온보딩은 절차적 실행이지 추론이 아님. 메타인지는 feature workflow의 설계 판단에 더 적합 (향후 추가 가능) |
| E3 지연 로딩 | 500줄 미만이므로 실질적 이득 없음 |

---

## 5. 실행 순서

1. SKILL.md 변경 1-5 적용 (프롬프트 + 컨텍스트)
2. settings.json 변경 6 적용 (하네스)
3. 리셋 → 서브에이전트 테스트 (v6)
4. 결과 분석:
   - spec 5 contracts 초과 0건? → Hook 작동 확인
   - collection review 체크리스트 출력됨? → P1 작동 확인
   - validate_cards 0 warnings? → P4 피드백 루프 작동 확인
5. 잔존 문제 있으면 SKILL.md 추가 수정 → 재테스트 (v7)

---

## 6. 검증 기준 (v6 통과 조건)

| # | 기준 | 검증 방법 |
|---|------|----------|
| 1 | validate_cards: 0 glossary-broken, 0 broken-chain, 0 orphan-card | 도구 호출 결과 |
| 2 | 모든 src/ops/*.ts 파일 커버 | get_link_coverage 결과 |
| 3 | 모든 spec 카드 parent 설정 | validate_cards orphan-card 0 |
| 4 | 모든 spec 카드 5 contracts 이하 | Hook 결과 + collection review (d) |
| 5 | 발견가능 내용 0건 | Hook의 impl_keywords 검사 + 수동 검토 |
| 6 | collection review 체크리스트 출력됨 | 서브에이전트 응답에 audit 테이블 존재 |
| 7 | brief over-scope 0건 | collection review (a) PASS |
| 8 | glossary-brief 정렬 | collection review (c) PASS |

---

## 참고 출처

### 학술 논문
| ID | 논문 | 적용 기법 |
|----|------|----------|
| [1] | Liu et al., "Lost in the Middle" (2023) | A1: 시작/끝 배치 |
| [3] | Chen et al., SIFo Benchmark (EMNLP 2024) | A2: 순차 지시 최소화 |
| [4] | "The Instruction Gap" (arxiv 2601.03269, 2026) | A3: 반복, 구조 분리, 포맷팅 |
| [6] | Wang & Zhao, Metacognitive Prompting (NAACL 2024) | A5: 비판적 평가 (향후 적용) |
| [7] | "Building AI Coding Agents for the Terminal" (arxiv 2603.05344, 2026) | B4: 기계적 강제 |
| [16] | Zheng et al., "From Prompts to Templates" (arxiv 2504.02052, 2025) | G3: 배제 제약, G5: 속성 명세 |

### 산업 자료
| ID | 자료 | 적용 기법 |
|----|------|----------|
| [8] | NxCode, "Harness Engineering" (2026) | B1-B6: 하네스 4 메커니즘 |
| [10] | Simon Willison, "Context Engineering" (2025-2026) | B5: Context Offloading |

### Anthropic 공식 문서
| ID | 문서 | 적용 기법 |
|----|------|----------|
| [12] | Prompting Best Practices | C1-C4: XML, CoT, 자기 검증 |
| [13] | Claude Code Skills | E3: 지연 로딩 |
| [14] | Claude Code Hooks | E2: PostToolUse, Stop |
| [17] | Skill Authoring Best Practices | H1-H6: 체크리스트, 피드백 루프, 간결성 |

### 프로젝트 관찰
| ID | 관찰 | 적용 |
|----|------|------|
| F1 | 도구 호출 단계 100% 준수, 텍스트 단계 누락 | Hook 도입 근거 |
| v2-v5 | 서브에이전트 4회 테스트 결과 | 각 SKILL.md 수정의 효과 측정 |
