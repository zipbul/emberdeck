# Emberdeck v2: Design-Driven Workflow Automation

## 한 줄 정의

사용자의 의도를 받아 코드와 설계 카드를 분석/분류하고, 설계 지식 기반으로 계획/태스크를 자동 생성하며, 스텝마다 전문 리뷰어가 공격/방어 루프를 돌려 무결점을 보장하고, 사용자에게는 꼭 필요한 질문만 던지며 끝까지 주도하는 워크플로우 자동화 시스템.

## 핵심 원칙

1. **사용자는 의도만 말한다** — 나머지는 emberdeck이 주도
2. **질문은 최소, 섬세, 적극적** — 기계적으로 알 수 있는 건 묻지 않는다. 사람만 판단할 수 있는 것만 묻는다
3. **스텝마다 공격/방어** — 모든 LLM 생성 출력은 전문 리뷰어의 공격을 받는다. 문제 0이 될 때까지 루프 (Ralph Loop)
4. **설계가 기반** — 모든 계획과 태스크가 설계 카드 그래프에서 나온다
5. **도구로 강제** — 프롬프팅이 아닌 도구 접근 제한, 파일 게이트, CLI 기계적 연산으로 품질 보장
6. **카드는 소스 오브 트루스** — 코드가 카드를 따른다. 코드가 바뀌었다고 카드를 자동 변경하지 않는다
7. **서브에이전트 결과는 입력이지 출력이 아니다** — "문제 없음"을 그대로 믿지 않는다. 독립적으로 검증한다
8. **Verify ≠ Validate** — Verify는 기계적 검증 (테스트/타입체크). Validate는 실제 코드 경로를 추적하여 설계 의도 확인

---

## 사용자 경험

### 사용자가 하는 것

1. 의도를 말한다 ("JWT로 바꿔줘", "알림 기능 추가", "이 버그 고쳐")
2. 분류 결과를 승인한다 (emberdeck이 제안, 사용자가 확인)
3. 설계 질문에 답한다 (최소한의, 꼭 필요한 질문만)
4. 체크포인트에서 확인한다 (필요시)
5. 최종 결과를 확인한다

### 사용자가 하지 않는 것

- 카드를 수동으로 만들거나 업데이트하지 않는다
- drift를 수동으로 체크하지 않는다
- MCP를 설정하지 않는다
- 어떤 플로우를 탈지 선택하지 않는다
- 검증을 수동으로 실행하지 않는다

---

## 워크플로우 엔진

### 전체 흐름

```
Classify (→ human approval)
  ├→ Onboarding:      Analyze → Spec(Question) → Plan → [Plan Review]* → Execute → Verify → Validate → Commit
  ├→ Design Change:   Analyze → Spec(Question) → Research → Plan → [Plan Review]* → [Execute → Verify]* → Validate → Commit
  ├→ New Feature:     Analyze → Spec(Question) → Research → Plan → [Plan Review]* → [Execute → Verify]* → Validate → Commit
  ├→ Bug Fix:         Analyze → Test(RED) → Execute(GREEN) → Verify → Validate → Commit
  ├→ Refactoring:     Analyze → Plan → [Plan Review]* → [Execute → Verify]* → Validate → Commit
  ├→ Exploration:     Analyze → Report
  └→ No match:        Report to human, do not proceed
```

`[]*` = Ralph Loop — 리뷰어가 문제 0을 확인할 때까지 자율 반복.

**Spec Skip Condition**: Plan에 설계 결정(근거 포함), 구현 TODO, 영향 범위(수정 파일), 테스트 플랜이 모두 있으면 Spec 스킵. 없으면 별도 Spec 작성 + 인간 승인.

---

### 1단계: 분석 (Analyze)

사용자 질의를 받으면 **먼저 코드와 카드를 본다.** 질문하기 전에, 분류하기 전에, 현재 상태를 파악한다.

**기계적 수행 (LLM 판단 불필요):**
- gildash CLI로 관련 심볼/파일 탐색
- 카드 DB에서 연결된 카드/AC/relations 조회
- code_link 정합성 확인 (broken link 감지)
- 현재 상태 파악: 카드 존재 여부, 코드-카드 매칭, drift score

**출력:** 구조화된 JSON — 후속 단계가 파싱 없이 사용

**→ analysis-reviewer 공격:**
- 영향 범위 누락 없는가 (import 체인을 따라가면 더 있지 않은가)
- 카드 연결이 빠진 심볼이 있지 않은가
- drift score 계산에 오류가 없는가

**참고 패턴:**
- Google ADK 4단계 스코프 상태 — 분석 결과를 구조적으로 분류
- GSD `gsd-tools init` — 기계적 연산을 CLI로 분리
- Pydantic AI 타입 안전 — 분석 결과를 스키마로 정의

---

### 2단계: 분류 (Classify) → 인간 승인 필수

분석 결과를 기반으로 작업 유형을 판별. **emberdeck이 제안하고, 사용자가 승인한다. 승인 없이 작업 시작 불가.**

```
AskUserQuestion(
  header: "분류"
  question: "분석 결과 이 작업은 '설계 변경'입니다. 이유: auth-middleware spec의 AC-2 '세션 기반 인증'이 변경되어야 합니다. 맞나요?"
  options: [
    "맞다 — 설계 변경으로 진행",
    "아니다 — 내부 구현만 바뀐다 (리팩토링)",
    "설명할게"
  ]
)
```

**분류 기준:**

| 신호 | 분류 | 판별 방법 |
|------|------|---------|
| `.emberdeck/` 없음 또는 카드 0개 | 온보딩 | 파일 시스템 확인 (기계적) |
| 영향받는 카드의 AC가 변경되어야 함 | 설계 변경 | AC와 의도의 충돌 감지 |
| 영향받는 카드 범위 안에서 새 구현 | 기능 추가 | 카드 존재 + AC 변경 불필요 |
| 기존 AC를 위반하는 코드의 수정 | 버그 수정 | AC 위반 감지 (기계적) |
| AC 변경 없이 내부 구조만 변경 | 리팩토링 | 외부 인터페이스 불변 확인 |
| "이 코드가 뭐 하는 건지 설명해" | 탐색 | 수정 의도 없음 |
| 어떤 분류에도 맞지 않음 | 인간에게 보고 | 진행하지 않음 |

**분류에 따른 단계별 깊이:**

| | Spec(질문) | Research | Plan Review | 실행 중 체크포인트 | Validate 깊이 |
|---|---|---|---|---|---|
| **온보딩** | 다수 (영역/계약 정의) | 전체 코드베이스 | ✓ | — | 카드 구조 검증 |
| **설계 변경** | 다수 (범위/새 AC) | 영향 영역 전체 | ✓ | ✓ | 전체 정합성 + 실행 경로 추적 |
| **기능 추가** | 2-4개 | 대상 영역 | ✓ | 선택적 | 영향 범위 |
| **버그 수정** | 0-1개 | 스킵 | 스킵 | — | 해당 AC만 |
| **리팩토링** | 0-1개 | 대상 영역 | ✓ | — | 전체 AC 보존 확인 |
| **탐색** | 0개 | 대상 영역 | — | — | — (리포트만) |

**→ classify-reviewer 공격:**
- 분류가 정확한가 (리팩토링으로 분류했는데 실제로는 외부 동작이 바뀌는 건 아닌가)
- 영향도를 과소/과대 평가하지 않았는가
- edge case — 기능 추가 + 설계 변경이 동시에 필요한 경우를 놓치지 않았는가

**참고 패턴:**
- pyreez workflow.md — "Every task begins with Classify. You propose a flow, human approves."
- LangGraph conditional edges — 코드 함수가 다음 노드 결정
- Mastra `.branch()` — 기계적 라우팅

---

### 3단계: Spec — 질문 (Question)

분류 결과에 따라 깊이가 조절. **사람만 판단할 수 있는 설계 결정을 수집하고 구조화.**

**기계적으로 알 수 있는 것 (묻지 않음):**
- 영향받는 파일/심볼 (gildash)
- 관련 카드/AC (code_link)
- 기존 코드 패턴 (리서치에서 파악)

**사람만 판단할 수 있는 것 (묻는다):**
- 여러 구현 방식 중 선택
- 설계 변경의 범위
- 새로운 AC 정의
- 기존 AC 수정 여부

**질문 설계 원칙:**

| 원칙 | 출처 | 적용 |
|------|------|------|
| 코드 컨텍스트를 옵션에 녹임 | GSD | "Cards (기존 Card 컴포넌트 재사용)" |
| freeform 탈출구 | GSD | "직접 설명할게요" 선택 시 AskUserQuestion 중단 |
| 구체적 예시, 추상적 질문 금지 | GSD | "좋은 UX" → "3초 이내 로딩" |
| downstream awareness | GSD | 이 답변이 누구에게 어떻게 쓰이는지 명시 |
| 타입 안전한 답변 수집 | Pydantic AI | 답변을 스키마로 검증, 모호하면 재질문 |
| 승인 게이트 | OpenAI Agents SDK, Vercel AI SDK | 설계 변경 시 명시적 승인 |
| scope creep 방지 | GSD | 범위 밖 아이디어는 캡처하되 즉시 실행하지 않음 |
| 핵심 지시 반복 배치 | Instruction Gap 연구 | 프롬프트 시작과 끝에 핵심 제약 반복 → 준수율 20-35% 회복 |
| 배제 제약 + 긍정 지시 결합 | 템플릿 연구 | "이렇게 해라" + "저렇게 하지 마라" 결합 시 준수율 극적 향상 |

**anti-pattern:**
- 체크리스트 나열 (GSD)
- 기업적 표현 "성공 기준이 뭔가요?" (GSD)
- 심문 — 답변 위에 쌓지 않고 새 질문만 나열 (GSD)
- 사용자 기술 수준 질문 (GSD)
- 이미 기계적으로 알 수 있는 걸 묻기
- LLM이 판단할 수 있는 걸 사용자에게 떠넘기기

**결정 영속화:**
모든 답변은 `.emberdeck/decisions/` 에 YAML frontmatter + Markdown body로 저장. 이전 결정을 로드하여 같은 질문 반복 방지.

**→ spec-reviewer 공격:**
- 핵심 설계 결정이 빠지지 않았는가
- 질문이 불필요하게 많지 않았는가 (기계적으로 알 수 있는 걸 물어보진 않았는가)
- 수집된 결정이 모호하지 않은가 ("잘 되게 해줘" 같은 답이 구체화 없이 통과되진 않았는가)
- scope creep이 있지 않은가

---

### 4단계: 리서치 (Research)

코드베이스의 현재 상태를 조사하여 계획의 기반을 만든다. **분류에 따라 스킵 가능.**

**수행 내용:**
- 대상 영역의 기존 패턴/라이브러리/구현 방식 조사
- 재사용 가능한 컴포넌트/유틸리티 탐색
- 기술적 제약 파악 (의존성, 호환성)
- 기존 테스트 구조 파악

**리서치 에이전트 도구 접근:** Read, Grep, Glob, WebSearch, WebFetch — **코드 수정 불가**

**리서치 결과는 파일 아티팩트로 영속화.**

**→ research-reviewer 공격:**
- 패턴을 빠뜨리지 않았는가 (다른 모듈에서 같은 문제를 어떻게 풀었는지 봤는가)
- 재사용 가능한 코드를 놓치지 않았는가
- 기술적 제약을 정확히 파악했는가

**참고 패턴:**
- GSD 4개 병렬 리서치 에이전트 — 병렬화로 시간 단축
- GSD `gsd-research-synthesizer` — 병렬 결과 통합
- BMAD Analysis 단계 — 구현 전 분석을 별도 단계로 분리

---

### 5단계: 계획 (Plan)

분석 + 분류 + Spec + 리서치를 종합하여 실행 가능한 계획 생성.

**"Plans are prompts" 원칙 (GSD):**
계획 파일은 executor 에이전트의 프롬프트 그 자체. 별도 변환 없음:

```xml
<task id="01">
  <name>JWT 토큰 발급 서비스 생성</name>
  <related_cards>auth-middleware, session-management</related_cards>
  <preserve_ac>AC-1: 모든 API는 인증을 거친다</preserve_ac>
  <files>src/auth/token.ts, src/auth/jwt.ts</files>
  <reuse>기존 hashPassword() 유틸 (리서치에서 발견)</reuse>
  <action>jose 라이브러리로 JWT 발급/검증 구현</action>
  <verify>npm run test -- --grep "jwt"</verify>
  <done>토큰 발급, 검증, 갱신 API가 동작하고 AC-1 충족</done>
</task>
```

**태스크 분해 원칙:**
- "태스크가 하나의 컨텍스트 윈도우에 맞지 않으면, 두 개의 태스크다" (GSD-2 철칙)
- 태스크 간 의존성 명시 → wave 기반 병렬 실행

**→ plan-reviewer 공격 (= pyreez의 Plan Review):**
- 모든 영향받는 카드가 계획에 반영되었는가
- 모든 관련 AC가 태스크에 매핑되었는가
- 태스크 간 의존성에 순환이 없는가
- 각 태스크의 파일 범위가 충돌하지 않는가
- verify 커맨드가 존재하는가
- 태스크가 컨텍스트 윈도우에 맞는 크기인가

**실패 시:** 문제 리스트를 planner에게 반환 → 5단계로 돌아감. 문제 0까지 반복.

**참고 패턴:**
- GSD `gsd-plan-checker` — 9개 차원 검증, Read-only
- pyreez "Spec Skip Condition" — Plan이 충분하면 Spec 스킵
- Anthropic 공식 "plan-validate-execute" 패턴 — 오류를 일찍 잡음

---

### 6단계: 실행 (Execute)

태스크별 서브에이전트 스폰. 각 서브에이전트는 fresh 컨텍스트 윈도우.

**실행 구조:**
1. 태스크 의존성 그래프에서 wave 추출 (독립 태스크를 병렬 그룹화)
2. wave 단위로 서브에이전트 스폰
3. 각 서브에이전트: TASK-XX.md를 프롬프트로 로드 → 코드 수정 → atomic git commit
4. wave 완료 후 다음 wave

**체크포인트:**
- `checkpoint: human-verify` 태스크에서 사용자 확인 대기
- 인증/권한 에러 → 체크포인트 게이트 (실패 아닌 대기)
- `analysis_paralysis_guard` — 연속 5회 Read만 하면 강제 중단

**deviation rules:**
- 자동 수정: 버그, 누락된 보안/검증, 깨진 import
- 사용자에게 질문: 아키텍처 변경 (새 DB 테이블, 라이브러리 교체)
- 금지: spec의 AC를 변경하는 것

**executor 도구:** Read, Write, Edit, Bash, ed-tools — **AskUserQuestion 불가**

**참고 패턴:**
- GSD executor — deviation rules, analysis paralysis guard, atomic commit
- GSD thin orchestrator — 15-30% 컨텍스트, 서브에이전트에 70-85%
- Claude Agent SDK subagent — fresh context, 결과만 반환
- GSD-2 worktree isolation — 슬라이스별 git branch

---

### 7단계: Verify (기계적 검증)

**각 태스크 완료 직후 즉시.** 기계적이고 결정적.

**수행:**
1. 태스크의 `verify` 커맨드 실행 (테스트, 린트, 타입체크)
2. 변경된 파일의 심볼 재추출 — gildash CLI
3. code_link 정합성 확인
4. AC 중 자동 검증 가능 항목 체크
5. drift score 재계산

**통과 조건:** 모든 테스트 pass + 타입체크 pass + lint pass. 하나라도 실패 시 executor에게 반환 → 수정 → 재검증. 이것이 Ralph Loop.

**→ execution-reviewer 공격 (Verify 통과 후에도):**
- 코드가 계획과 일치하는가 (계획에 없는 변경이 있진 않은가)
- AC를 형식적으로만 충족하고 실질적으로 위반하진 않았는가
- 코드 품질은 괜찮은가

**참고 패턴:**
- pyreez "Verify" — 자동화된 검증으로 진행 차단
- GSD verification_commands — `npm run lint`, `npm run test`
- Anthropic 공식 피드백 루프 패턴 — Run validator → fix → repeat

---

### 8단계: Validate (설계 의도 검증)

**모든 태스크 완료 후.** Verify와 근본적으로 다르다.

> **Verify**: 테스트가 통과하는가? (기계적)
> **Validate**: 설계 의도대로 동작하는가? (추적 기반)

**Validate 절차 (pyreez에서 차용):**

```xml
<validate_procedure>
1. Plan/Spec의 각 설계 결정에 대해, 해당 코드(file:line)를 찾아 정확성 확인
2. 최소 하나의 복잡한 실행 경로를 end-to-end로 실제 코드에서 추적
   — "함수가 존재한다"가 아니라 "데이터가 올바르게 흐르는가"
3. 전체 테스트 스위트 + 타입체크 통과 확인
4. 현재 플로우의 모든 워크플로우 스텝이 실행되었는지 확인
5. 전체 영향 범위 drift 재계산
6. code_link 전체 정합성 확인

Done: 모든 항목 pass. 이것이 확인된 후에만 완료 보고.
</validate_procedure>
```

**Good validate vs Bad validate (pyreez 예시):**

```
Good: "멀티홉 swap에서 팀을 최종 모델로 업데이트"
→ 실제 추적: worker-0 실패 → fallback-A 실패 → fallback-B 성공.
  코드가 B로 해결되는지 확인? YES → PASS

Bad: "swappedModels map이 engine.ts에 존재? Yes. PASS."
→ 이건 존재 확인이지 동작 확인이 아님. 실제로 첫 번째 hop으로 해결되는 버그를 놓침.
```

**→ validate-reviewer 공격:**
- 실행 경로 추적이 충분히 깊은가 (happy path만 확인하고 error path를 놓치진 않았는가)
- 모든 설계 결정이 코드에 반영되었는가
- 형식적 검증을 실질적 검증으로 착각하지 않았는가

**참고 패턴:**
- pyreez "Validate" — "Tests passing ≠ requirements met"
- pyreez "Don't validate by checking 'does the code exist'" — 실행 경로 추적 필수
- GSD `gsd-integration-checker` — 마일스톤 통합 검증
- Metacognitive Prompting 연구 — 예비 판단 → 비판적 평가 → 최종 결정

---

### 최종 리포트

Validate 통과 후:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 EMBERDECK > 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 의도: JWT 인증 전환
 분류: 설계 변경 (사용자 승인 완료)
 태스크: 3/3 완료

 | spec              | AC  | 상태 |
 |-------------------|-----|------|
 | auth-middleware    | 4/4 | ✓    |
 | session-management | 3/3 | ✓    |
 | api-gateway        | 2/2 | ✓    |

 Validate 추적:
   ✓ JWT 발급 → 검증 → 갱신 경로 end-to-end 확인
   ✓ 만료 토큰 → 401 → refresh → 재시도 경로 확인

 커밋:
   abc1234: feat(auth): replace session with JWT
   def5678: feat(auth): add token refresh endpoint
   ghi9012: feat(auth): update API gateway auth check

 테스트: 42 passed, 0 failed
 린트: 0 errors
 drift: 0.00

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

수동 검증 필요 시:
```
 ⚠ 수동 검증 필요 (1건):
   auth-middleware AC-3: "만료 토큰은 401 반환"
   → curl -H "Authorization: Bearer expired_token" localhost:3000/api/me
```

---

## 공격/방어 시스템 (스텝별 전문 리뷰어)

### 원칙

> "스텝별 리뷰어는 비용이 아니라 비용 절감이다."
>
> 1단계에서 10k 토큰으로 잡으면 끝.
> 7단계에서 잡으면 100k+ 토큰 낭비 후 전체 재실행.

모든 LLM 생성 출력은 해당 스텝의 전문 리뷰어에게 공격받는다. 문제 0이 될 때까지 루프 (Ralph Loop).

### 리뷰어 매핑

| 스텝 | 에이전트 | 전문 리뷰어 | 공격 대상 |
|------|---------|-----------|---------|
| 1. 분석 | analyst | **analysis-reviewer** | 영향 범위 누락, 카드 연결 빠짐, 의존성 미탐지 |
| 2. 분류 | (기계적 + analyst) | **classify-reviewer** | 분류 오류, edge case, 영향도 과소/과대 |
| 3. Spec | interviewer | **spec-reviewer** | 빠진 결정, 불필요한 질문, 모호한 답변, scope creep |
| 4. 리서치 | researcher | **research-reviewer** | 패턴 누락, 재사용 코드 미발견, 제약 미파악 |
| 5. 계획 | planner | **plan-reviewer** | AC 매핑 누락, 의존성 오류, 태스크 과대/과소, verify 없음 |
| 6. 실행 | executor | **execution-reviewer** | 계획 불일치, AC 위반, 코드 품질, 미완성 |
| 7. Validate | validator | **validate-reviewer** | 피상적 검증, 실행 경로 미추적, 형식적 통과 |

### 리뷰어의 공통 특성

- **Read-only** — 출력을 수정할 수 없다. 문제만 지적한다
- **적대적** — "문제를 찾는 것"이 임무. "괜찮다"는 실패
- **구체적** — "분석이 불충분하다" ✗ → "src/auth/session.ts의 createSession이 영향 범위에 빠져있다" ✓
- **검증 가능** — 리뷰어의 지적이 맞는지 원본 에이전트가 확인할 수 있어야 함

### 리뷰어 프롬프트 원칙 (연구 기반)

| 원칙 | 출처 | 적용 |
|------|------|------|
| 핵심 지시 시작/끝 반복 | Lost in the Middle, Instruction Gap | "문제를 찾아라" 시작과 끝에 배치 |
| 배제 제약 결합 | 템플릿 연구 | "문제를 찾아라" + "문제 없다고 하지 마라" |
| Metacognitive Prompting | Wang & Zhao 2024 | 예비 판단 → 비판적 평가 → 최종 결정 |
| 구체적 속성명 + 설명 | 템플릿 연구 | 리뷰 결과를 구조화된 형식으로 강제 (준수율 3.09→4.90) |
| 서브에이전트 불신 | pyreez workflow.md | "no issues found"는 "한 모델이 못 찾은 것"이지 "없는 것"이 아님 |

### 리뷰어가 불필요한 경우

**순수 기계적 연산** (ed-tools CLI 결과)은 리뷰 불필요. 코드가 돌았으면 정확.
리뷰어는 **LLM이 생성한 출력**에만 필요.

---

## 에이전트 역할 (14개: 7 스텝 + 7 리뷰어)

도구 접근으로 역할을 기계적으로 강제. 스키마에 없는 도구는 호출 불가능.

### 스텝 에이전트

| 에이전트 | Read | Write | Edit | Bash | AskUser | WebSearch | ed-tools |
|---------|------|-------|------|------|---------|-----------|----------|
| **analyst** | ✓ | | | | | | ✓ |
| **interviewer** | ✓ | ✓(.emberdeck/decisions/만) | | | ✓ | | ✓ |
| **researcher** | ✓ | ✓(.emberdeck/research/만) | | | | ✓ | ✓ |
| **planner** | ✓ | ✓(.emberdeck/plans/만) | | | | | ✓ |
| **executor** | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| **verifier** | ✓ | | | ✓(테스트만) | | | ✓ |
| **validator** | ✓ | | | ✓(테스트만) | | | ✓ |

### 리뷰어 에이전트 (전부 Read-only + ed-tools)

| 리뷰어 | Read | ed-tools | 그 외 |
|--------|------|----------|------|
| **analysis-reviewer** | ✓ | ✓ | 없음 |
| **classify-reviewer** | ✓ | ✓ | 없음 |
| **spec-reviewer** | ✓ | ✓ | 없음 |
| **research-reviewer** | ✓ | ✓ | 없음 |
| **plan-reviewer** | ✓ | ✓ | 없음 |
| **execution-reviewer** | ✓ | ✓ | 없음 |
| **validate-reviewer** | ✓ | ✓ | 없음 |

**핵심 제약:**
- executor만 코드를 수정할 수 있다
- 리뷰어는 절대 코드를 수정할 수 없다 — 문제만 지적
- interviewer만 사용자에게 질문할 수 있다
- executor는 사용자에게 질문할 수 없다

---

## ed-tools CLI

LLM에게 맡기면 안 되는 모든 기계적 연산. 확정적 결과, 구조화된 JSON.

```bash
# 코드 분석
ed-tools index <path>              # gildash CLI 호출, 심볼 추출
ed-tools symbols <file>            # 파일의 심볼 목록

# 카드 연산
ed-tools cards affected <file>     # 파일과 연결된 카드 조회
ed-tools cards impact <key>        # BFS 영향 범위
ed-tools cards ac <key>            # acceptance criteria 목록
ed-tools cards coverage            # 코드-카드 커버리지

# 분석/분류
ed-tools analyze <intent> <files>  # 1단계 분석 전체, JSON
ed-tools classify <analysis-json>  # 분석 → 분류 (가능한 범위)

# 검증
ed-tools verify drift              # 전체 drift score
ed-tools verify links              # broken code_link
ed-tools verify ac <key>           # AC 자동 검증
ed-tools diff symbols <before> <after>  # 심볼 변경 감지

# 상태
ed-tools state load                # 현재 워크플로우 상태 JSON
ed-tools state update <field> <value>
ed-tools plan list                 # 현재 계획 목록
ed-tools task status               # 태스크 진행 상태
ed-tools task dependencies         # 의존성 그래프 → wave 계산
```

---

## 프롬프트 엔지니어링

연구 기반 적용 — 상세는 `docs/PROMPT_ENGINEERING_REFERENCE.md` 참조.

### 구조적 기법

| 기법 | 출처 | 적용 |
|------|------|------|
| XML 태그 경계 | GSD, Anthropic | `<objective>`, `<process>`, `<step name="X">` |
| YAML frontmatter | GSD | `allowed-tools`로 도구 접근 강제 |
| `@`-reference | GSD, Claude Code | 파일 경로 참조, 컨텍스트 효율 |
| downstream awareness | GSD | 이 출력을 누가 왜 소비하는지 명시 |
| named steps | GSD | `<step name="X" priority="first">` |
| 핵심 지시 시작/끝 반복 | Lost in the Middle, Instruction Gap | 준수율 20-35% 회복 |
| 배제 제약 결합 | 템플릿 연구 | 긍정 + 부정 결합 시 준수율 극적 향상 |
| 속성명 + 설명 강제 출력 | 템플릿 연구 | 형식 준수 3.09 → 4.90 |
| context budget table | GSD, OpenDev 논문 | 컨텍스트 사용률별 품질 테이블 |

### 품질 보장 기법

| 기법 | 출처 | 적용 |
|------|------|------|
| anti-pattern 목록 | GSD | 하지 말아야 할 것을 명시적으로 나열 |
| good/bad 예시 쌍 | GSD, Anthropic | "이렇게 해라" + "이건 나쁜 예시" |
| analysis paralysis guard | GSD | 연속 N회 읽기만 하면 강제 중단 |
| deviation rules | GSD | 예상 외 상황별 대응 규칙 |
| Stop Hook 품질 게이트 | Claude Code Hooks, OpenDev | 응답 종료 전 기계적 검증 |
| Metacognitive Prompting | Wang & Zhao | 예비 판단 → 비판 → 최종 결정 |
| SIFo 완화 | SIFo 벤치마크 | 각 단계를 독립 검증 단위로 분리 |

### 컨텍스트 관리

| 기법 | 출처 | 적용 |
|------|------|------|
| thin orchestrator | GSD | 오케스트레이터 15-30%, 서브에이전트 70-85% |
| fresh context per task | GSD-2, Claude Agent SDK | 태스크마다 새 컨텍스트 윈도우 |
| 파일 기반 inter-agent 통신 | GSD | 직접 메시지 없음, 파일 아티팩트로 간접 소통 |
| deterministic state loading | GSD | CLI가 JSON 반환, LLM이 파일 파싱하지 않음 |
| 참조 깊이 1단계 제한 | Anthropic 공식 | SKILL.md → 참조파일 (직접), 2단계 이상 금지 |

---

## 파일 구조

### 배포 패키지

```
emberdeck/
  commands/ed/                # 슬래시 커맨드
    init.md                   # /ed:init — 온보딩
    start.md                  # /ed:start <intent> — 작업 시작
    status.md                 # /ed:status — 현재 상태
    resume.md                 # /ed:resume — 중단 재개
  agents/                     # 스텝 에이전트 (7개)
    ed-analyst.md
    ed-interviewer.md
    ed-researcher.md
    ed-planner.md
    ed-executor.md
    ed-verifier.md
    ed-validator.md
  reviewers/                  # 리뷰어 에이전트 (7개)
    analysis-reviewer.md
    classify-reviewer.md
    spec-reviewer.md
    research-reviewer.md
    plan-reviewer.md
    execution-reviewer.md
    validate-reviewer.md
  workflows/                  # 워크플로우 정의
    analyze.md
    classify.md
    onboarding.md
    design-change.md
    feature-add.md
    bug-fix.md
    refactor.md
    exploration.md
    questioning.md
    research.md
    plan-check.md
    execute.md
    verify.md
    validate.md
  references/                 # 참조 문서
    card-schema.md
    quality-rules.md
    anti-patterns.md
    context-budget.md
    deviation-rules.md
  templates/                  # 출력 템플릿
    card.md
    plan.md
    task.md
    report.md
    decision.md
  bin/
    ed-tools.js               # 기계적 연산 CLI
  hooks/
    PostToolUse.md
    Stop.md
```

### 프로젝트 내 생성 파일

```
.emberdeck/
  cards/                      # 설계 카드 (소스 오브 트루스)
  decisions/                  # 사용자 결정 기록
  research/                   # 리서치 결과
  plans/                      # 실행 계획
  state.json                  # 워크플로우 상태
  emberdeck.db                # 카드 DB (SQLite)
```

---

## 기존 REDESIGN_PLAN.md와의 관계

카드 스키마 개선 (type 계층, parent, relations 단순화)은 **그대로 유효**.

추가 고려:
- AC에 `verifiable: auto | manual` — 자동 검증 가능 여부
- AC에 `verify_command` — 자동 검증 커맨드 (optional)
- 카드에 `boundary` — 파일/디렉토리 범위 (gildash에서 자동 추출 가능)
