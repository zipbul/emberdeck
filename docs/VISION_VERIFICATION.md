# Emberdeck v2 Vision 검증 문서

> EMBERDECK_V2_VISION.md 설계의 완결성, 최적성, 무결점 보장 여부를 9개 차원에서 검증

---

## 검증 차원 1: 케이스 커버리지

> 분류(Classify)가 현실에서 발생 가능한 모든 유형의 사용자 요청을 잡는가?

### 현재 분류 체계

| # | 분류 | 판별 기준 |
|---|------|---------|
| 1 | 온보딩 | `.emberdeck/` 없음 또는 카드 0개 |
| 2 | 설계 변경 | 기존 spec의 AC가 변경되어야 함 |
| 3 | 기능 추가 | 기존 설계 범위 안 새 구현 |
| 4 | 버그 수정 | 기존 AC 위반 코드 수정 |
| 5 | 리팩토링 | AC 불변, 내부 구조만 변경 |
| 6 | 탐색 | 수정 의도 없음 |
| 7 | No match | 어떤 분류에도 안 맞음 |

### 테스트 케이스

#### 기본 케이스 (분류가 명확한 것)

| # | 사용자 요청 | 기대 분류 | 분석에서 잡히는가 | 판정 |
|---|-----------|---------|----------------|------|
| B1 | "새 프로젝트 시작할게" | 온보딩 | `.emberdeck/` 없음 (기계적) | ✓ PASS |
| B2 | "JWT로 인증 방식 바꿔줘" | 설계 변경 | auth spec의 AC "세션 기반" 충돌 감지 | ✓ PASS |
| B3 | "다크모드 추가해줘" | 기능 추가 | UI 영역 카드 존재, AC 변경 불필요 | ✓ PASS |
| B4 | "로그인이 안 돼" | 버그 수정 | auth spec의 AC "로그인 성공" 위반 감지 | ✓ PASS |
| B5 | "auth 모듈 코드 정리해줘" | 리팩토링 | auth 카드의 AC 불변, 구조만 변경 | ✓ PASS |
| B6 | "이 모듈이 뭐 하는 건지 설명해" | 탐색 | 수정 의도 없음 감지 | ✓ PASS |

#### Edge Case — 복합 분류

| # | 사용자 요청 | 문제 | 기대 동작 | 현재 설계에서 가능한가 | 판정 |
|---|-----------|------|---------|-------------------|------|
| E1 | "리팩토링하면서 새 기능도 넣어줘" | 리팩토링 + 기능 추가 | 더 무거운 쪽으로 분류 (기능 추가) 또는 분리 | 현재 설계: 단일 분류만 지원. **복합 분류 처리 규칙 없음** | ⚠ GAP |
| E2 | "이 버그 고치려면 설계를 바꿔야 할 것 같아" | 버그 수정 → 설계 변경 | 분석에서 AC 충돌 감지 → 설계 변경으로 분류 | 분석이 AC 충돌을 감지하면 자동으로 설계 변경. 가능 | ✓ PASS |
| E3 | "성능 최적화 해줘" | 리팩토링? 기능 추가? | 외부 동작 불변이면 리팩토링, 새 캐싱 레이어 등이면 기능 추가 | 분석에서 AC 변경 여부로 판별 가능. 모호하면 사용자에게 질문 | ✓ PASS |
| E4 | "의존성 업데이트 해줘" | 어디에도 안 맞음 | ??? | **현재 분류에 "Chore" 없음** | ⚠ GAP |
| E5 | "테스트 추가해줘" | 코드 변경이지만 구현이 아님 | ??? | **현재 분류에 "테스트 추가" 없음** | ⚠ GAP |
| E6 | "문서 업데이트 해줘" | 코드 변경 아님 | ??? | **현재 분류에 "문서" 없음** | ⚠ GAP |
| E7 | "CI/CD 파이프라인 고쳐줘" | 코드가 아닌 인프라 | ??? | **현재 분류에 "인프라" 없음** | ⚠ GAP |
| E8 | "보안 취약점 패치해줘" | 버그 수정? 설계 변경? | 취약점 종류에 따라 다름 | AC에 보안 관련 항목이 있으면 버그 수정, 없으면 모호 | ⚠ PARTIAL |
| E9 | "이 라이브러리를 다른 걸로 교체해줘" | 리팩토링? 설계 변경? | 외부 API 불변이면 리팩토링, 변하면 설계 변경 | 분석에서 판별 가능하지만 라이브러리 교체가 AC를 건드리는지 판단이 어려울 수 있음 | ⚠ PARTIAL |
| E10 | "이전 커밋 롤백해줘" | 어디에도 안 맞음 | ??? | **현재 분류에 "롤백" 없음** | ⚠ GAP |

#### Edge Case — 카드 상태 관련

| # | 상황 | 문제 | 현재 설계에서 가능한가 | 판정 |
|---|------|------|-------------------|------|
| C1 | 카드가 있지만 영향받는 영역에 카드가 없음 | 일부 영역만 카드 커버 | 분석에서 `card_coverage` 감지 → 온보딩 부분 플로우? | **부분 온보딩 플로우 없음** | ⚠ GAP |
| C2 | 카드와 코드가 이미 심하게 drift | 분석 결과 drift score 높음 | drift 해소가 분류 어디에 해당? | **drift 해소 전용 플로우 없음** | ⚠ GAP |
| C3 | AC가 정의 안 된 spec | spec은 있지만 AC가 비어있음 | 버그 수정/리팩토링에서 검증 기준이 없음 | **AC 없는 spec에 대한 처리 규칙 없음** | ⚠ GAP |

#### Edge Case — 요청 크기

| # | 요청 | 문제 | 현재 설계 | 판정 |
|---|------|------|---------|------|
| S1 | "오타 수정" | 1줄 변경에 9단계 워크플로우? | 분류 → 버그 수정 (경량). Plan Review 스킵. 적절 | ✓ PASS |
| S2 | "전체 아키텍처 재구성" | 매우 큰 작업 | 설계 변경으로 분류, 전체 플로우. 적절 | ✓ PASS |
| S3 | "5개 모듈에 걸친 대규모 리팩토링" | 매우 넓은 범위 | 리팩토링으로 분류. 태스크가 많아짐 | ✓ PASS |

### 케이스 커버리지 종합

| 결과 | 수 |
|------|---|
| ✓ PASS | 12 |
| ⚠ GAP | 7 |
| ⚠ PARTIAL | 2 |

### 발견된 갭

**GAP-1: 복합 분류 처리 규칙 없음**
- 하나의 요청이 여러 분류에 걸칠 때 어떻게 하는가?
- 제안: 가장 무거운 분류로 통합, 또는 순차 분리 (설계 변경 먼저 → 기능 추가)

**GAP-2: Chore 분류 없음**
- 의존성 업데이트, CI 수정, 문서 업데이트, 린트 설정 등 "설계와 무관한 잡일"
- 제안: Chore 분류 추가 — Implement → Verify → Commit (최경량)

**GAP-3: 테스트 추가 분류 없음**
- 기존 코드 변경 없이 테스트만 추가
- 제안: Chore에 포함하거나 별도 "Testing" 분류

**GAP-4: 롤백 분류 없음**
- git 히스토리 조작은 워크플로우와 성격이 다름
- 제안: No match → 인간에게 보고로 처리하거나, Chore에 포함

**GAP-5: 부분 온보딩 없음**
- 프로젝트에 카드가 있지만 일부 영역만 커버
- 제안: 분석에서 `card_coverage < threshold` 감지 시 해당 영역만 온보딩 서브플로우

**GAP-6: Drift 해소 전용 플로우 없음**
- 코드와 카드가 이미 어긋나 있을 때 정상화하는 플로우
- 제안: 분석에서 `drift_score > threshold` 감지 시 drift 해소 플로우 제안

**GAP-7: AC 없는 spec 처리 규칙 없음**
- spec은 존재하지만 AC가 비어있으면 검증 기준이 없음
- 제안: 분석에서 감지 → Spec 단계에서 AC 정의를 사용자에게 요청

---

## 검증 차원 2: 스텝 최적화

> 각 플로우에서 스텝이 과하거나 부족하지 않은가?

### 플로우별 드라이런

#### Bug Fix: "로그인이 안 돼"

```
현재 플로우: Analyze → Test(RED) → Execute(GREEN) → Verify → Validate → Commit
```

| 스텝 | 수행 | 필요한가 | 판정 |
|------|------|---------|------|
| Analyze | auth 영역 카드/AC 조회, 위반된 AC 식별 | 필수 — 뭐가 깨졌는지 알아야 함 | ✓ |
| analysis-reviewer | 영향 범위 누락 확인 | 버그 수정에서 영향 범위 실수하면 다른 곳이 깨짐 | ✓ |
| Classify | 버그 수정으로 분류, 사용자 승인 | 필수 — 잘못된 분류 방지 | ✓ |
| classify-reviewer | 분류 정확성 확인 | 버그인 줄 알았는데 설계 변경이면 큰일 | ✓ |
| Test(RED) | 실패하는 테스트 작성 | 필수 — 수정 전에 실패 케이스 정의 | ✓ |
| **test-reviewer?** | 테스트가 올바른 AC를 커버하는지 | **현재 없음** | ⚠ GAP |
| Execute(GREEN) | 테스트 통과하도록 코드 수정 | 필수 | ✓ |
| execution-reviewer | 코드 품질, AC 충족 | ✓ | ✓ |
| Verify | 테스트/린트/타입체크 | 필수 | ✓ |
| Validate | 실제 실행 경로 추적 | 버그 수정에서도 필요 — 수정이 다른 곳을 안 깨뜨렸는지 | ✓ |
| validate-reviewer | 검증 깊이 확인 | ✓ | ✓ |
| Commit | atomic commit | 필수 | ✓ |

**발견:** Test(RED) 스텝에 리뷰어가 없음. 잘못된 테스트(AC를 제대로 안 검증하는 테스트)를 작성하면 GREEN 통과해도 실제 버그가 안 고쳐질 수 있음.

#### Design Change: "JWT로 인증 방식 바꿔줘"

```
현재 플로우: Analyze → Spec(Question) → Research → Plan → [Plan Review]* → [Execute → Verify]* → Validate → Commit
```

| 스텝 | 수행 | 필요한가 | 판정 |
|------|------|---------|------|
| Analyze | auth 영역 전체 분석, AC 충돌 감지 | 필수 | ✓ |
| analysis-reviewer | 영향 범위 완결성 | 필수 — 설계 변경은 범위가 넓어서 누락 위험 높음 | ✓ |
| Classify | 설계 변경, 사용자 승인 | 필수 | ✓ |
| classify-reviewer | 분류 정확성 | ✓ | ✓ |
| Spec(Question) | 변경 범위, 새 AC, 설계 결정 수집 | 필수 — 설계 변경의 핵심 | ✓ |
| spec-reviewer | 빠진 결정, 모호한 답변 | ✓ | ✓ |
| Research | 기존 패턴, JWT 라이브러리, 제약 조사 | 필수 — 기술적 기반 없으면 계획이 부실 | ✓ |
| research-reviewer | 조사 깊이 | ✓ | ✓ |
| Plan | 설계 카드 기반 태스크 분해 | 필수 | ✓ |
| plan-reviewer* | AC 매핑, 의존성, 검증 커맨드 | 필수 — 계획 오류는 전체 재실행 유발 | ✓ |
| Execute | 태스크별 서브에이전트 | 필수 | ✓ |
| execution-reviewer | 계획 일치, AC 충족 | ✓ | ✓ |
| Verify* | 테스트/린트/타입체크 Ralph Loop | 필수 | ✓ |
| Validate | 실행 경로 추적 | 필수 — 설계 변경은 가장 깊은 검증 필요 | ✓ |
| validate-reviewer | 검증 깊이 | ✓ | ✓ |
| Commit | atomic commit | 필수 | ✓ |
| **Spec 업데이트** | auth spec의 AC를 "JWT 기반"으로 변경 | **현재 플로우에 명시 안 됨** | ⚠ GAP |

**발견:** 설계 변경 플로우에서 spec 카드 업데이트 시점이 없음. 코드를 JWT로 바꿨는데 spec이 여전히 "세션 기반"이면 drift 발생.

#### Refactoring: "auth 모듈 정리"

```
현재 플로우: Analyze → Plan → [Plan Review]* → [Execute → Verify]* → Validate → Commit
```

| 스텝 | 수행 | 필요한가 | 판정 |
|------|------|---------|------|
| Analyze | 전체 AC 수집 (이게 보존 기준) | 필수 | ✓ |
| analysis-reviewer | AC 수집 완결성 | 필수 — 하나라도 빠지면 리팩토링 후 깨짐 | ✓ |
| Classify | 리팩토링, 사용자 승인 | 필수 | ✓ |
| classify-reviewer | 정말 리팩토링인가 (외부 동작 변경 없는가) | 필수 | ✓ |
| **Spec 스킵** | Spec Skip Condition 적용 | 리팩토링은 새 설계 결정이 없으므로 스킵 적절 | ✓ |
| **Research 스킵** | — | 리팩토링은 기존 코드를 정리하는 것이므로 스킵 가능? | ⚠ QUESTION |
| Plan | 태스크 분해 | 필수 | ✓ |
| plan-reviewer | AC 보존 매핑 | 필수 | ✓ |
| Execute → Verify* | Ralph Loop | 필수 | ✓ |
| execution-reviewer | AC 보존 확인 | ✓ | ✓ |
| Validate | **모든 기존 AC가 여전히 통과** | 필수 — 리팩토링의 핵심 검증 | ✓ |
| validate-reviewer | happy path 외에 error path도 확인했는가 | ✓ | ✓ |

**발견:** 리팩토링에서 Research 스킵이 적절한가? 대규모 리팩토링이면 기존 패턴 조사가 필요할 수 있음.

#### Exploration: "이 모듈이 뭐 하는 건지 설명해"

```
현재 플로우: Analyze → Report
```

| 스텝 | 판정 |
|------|------|
| Analyze | 필수 | ✓ |
| analysis-reviewer | 탐색에서 리뷰어가 필요한가? 리포트 정확성은 중요 | ⚠ QUESTION |
| Report | 리포트 생성 | ✓ |
| **report-reviewer?** | 리포트가 정확한지 검증 | **없음** | ⚠ GAP |

**발견:** 탐색 플로우의 리포트에 리뷰어가 없음. 부정확한 설명을 사용자에게 전달할 수 있음.

### 스텝 최적화 종합

| 결과 | 수 |
|------|---|
| ✓ 스텝 적절 | 다수 |
| ⚠ 빠진 스텝 | 3건 |
| ⚠ 질문 | 2건 |

**GAP-8: Bug Fix에 Test(RED) 리뷰어 없음**
- 잘못된 테스트가 통과하면 버그가 그대로 남음
- 제안: test-reviewer 추가 또는 spec-reviewer가 겸임

**GAP-9: Design Change에 Spec 업데이트 시점 없음**
- 설계 변경 플로우에서 코드만 바뀌고 카드가 안 바뀌면 drift
- 제안: Validate 통과 후, Commit 전에 "Spec Update" 스텝 삽입. spec-reviewer가 검증

**GAP-10: Exploration 리포트에 리뷰어 없음**
- 제안: analysis-reviewer가 리포트도 겸임, 또는 report-reviewer 추가

**QUESTION-1: 리팩토링에서 Research 스킵이 항상 적절한가?**
- 제안: 분류 시 영향 범위 크기에 따라 Research 포함/스킵 결정

**QUESTION-2: 탐색에서 analysis-reviewer가 필요한가?**
- 제안: 탐색은 코드 변경이 없으므로 리뷰어 비용 대비 가치가 낮을 수 있음. 선택적.

---

## 검증 차원 3: 에이전트/리뷰어 완결성

> 모든 LLM 생성 출력에 리뷰어가 있는가?

| 스텝 | LLM 생성 출력 | 리뷰어 | 판정 |
|------|-------------|--------|------|
| Analyze | 영향 분석 결과 (기계적 부분 + LLM 해석) | analysis-reviewer | ✓ |
| Classify | 분류 결과 + 이유 | classify-reviewer | ✓ |
| Spec | 질문 설계 + 결정 구조화 | spec-reviewer | ✓ |
| Research | 조사 결과 리포트 | research-reviewer | ✓ |
| Plan | 계획 + 태스크 분해 | plan-reviewer | ✓ |
| Execute | 코드 변경 | execution-reviewer | ✓ |
| Verify | 기계적 (LLM 생성 아님) | 리뷰어 불필요 | ✓ N/A |
| Validate | 실행 경로 추적 보고 | validate-reviewer | ✓ |
| **Test(RED)** | 테스트 코드 | **없음** | ⚠ GAP |
| **Spec Update** | 카드 업데이트 | **없음 (스텝 자체가 없음)** | ⚠ GAP |
| **Exploration Report** | 설명 리포트 | **없음** | ⚠ GAP |

**GAP-11: Test 작성에 리뷰어 없음 (GAP-8과 동일)**

**GAP-12: Spec Update에 리뷰어 없음 (GAP-9와 연관)**

**GAP-13: Exploration Report에 리뷰어 없음 (GAP-10과 동일)**

---

## 검증 차원 4: 비용 정당성

> 스텝별 리뷰어의 비용이 에러 비용보다 낮은가?

### 토큰 추산 (대략적)

| 단위 | 토큰 추산 |
|------|---------|
| Analyze (기계적 + LLM 해석) | ~5-10k |
| 리뷰어 1회 | ~5-10k |
| Classify | ~3-5k |
| Spec (질문 3-4개) | ~10-15k |
| Research | ~15-25k |
| Plan | ~10-20k |
| Execute (태스크 1개) | ~20-40k |
| Verify (기계적) | ~1-2k (LLM 아님) |
| Validate | ~10-20k |

### 시나리오별 비용 비교

#### Bug Fix (경량)

**리뷰어 있음:**
```
Analyze(8k) + reviewer(8k) + Classify(4k) + reviewer(4k) + Test(10k) + reviewer(8k)
+ Execute(30k) + reviewer(10k) + Verify(2k) + Validate(15k) + reviewer(10k)
= ~109k tokens
```

**리뷰어 없음 + 1회 실패 재실행:**
```
Analyze(8k) + Classify(4k) + Test(10k) + Execute(30k) + Verify(2k) + Validate(15k)
→ Validate에서 실패 발견 → 전체 재실행
= ~69k + ~69k = ~138k tokens
```

**결과:** 리뷰어가 21% 더 저렴 (109k vs 138k)

#### Design Change (중량)

**리뷰어 있음:**
```
Analyze(10k) + reviewer(8k) + Classify(5k) + reviewer(5k) + Spec(15k) + reviewer(10k)
+ Research(25k) + reviewer(10k) + Plan(20k) + reviewer(10k) × 1.5회 평균
+ Execute(80k, 3태스크) + reviewer(30k) + Verify(2k) + Validate(20k) + reviewer(15k)
= ~280k tokens
```

**리뷰어 없음 + 1회 실패 재실행:**
```
Analyze(10k) + Classify(5k) + Spec(15k) + Research(25k) + Plan(20k)
+ Execute(80k) + Verify(2k) + Validate(20k) → 실패 → Plan부터 재실행(120k)
= ~177k + ~120k = ~297k tokens
```

**결과:** 리뷰어가 6% 더 저렴 (280k vs 297k). 거의 동일하지만 리뷰어 있는 쪽이 **품질이 확실히 높음**.

**리뷰어 없음 + 2회 실패:**
```
= ~177k + ~120k + ~120k = ~417k tokens
```

**결과:** 2회 실패 시 리뷰어가 33% 더 저렴 (280k vs 417k)

### 비용 정당성 결론

- **단일 실패 시:** 리뷰어가 동등하거나 더 저렴
- **복수 실패 시:** 리뷰어가 확실히 더 저렴
- **실패 확률이 높을수록 리뷰어의 가치가 올라감**
- LLM의 실패율은 0이 아니므로, 리뷰어는 통계적으로 비용 절감

**추가 가치:** 비용뿐 아니라 **시간**. 실패 후 재실행은 사용자 대기 시간을 2배 이상 늘림.

---

## 검증 차원 5: 루프 종료 보장

> Ralph Loop가 무한 루프에 빠지지 않는가?

### 현재 설계의 Ralph Loop 지점

1. `[Plan Review]*` — planner ↔ plan-reviewer
2. `[Execute → Verify]*` — executor ↔ execution-reviewer + verify

### 무한 루프 시나리오

| # | 시나리오 | 현재 방어 | 판정 |
|---|---------|---------|------|
| L1 | plan-reviewer가 계속 문제를 찾음 (planner가 수정해도 새 문제 발생) | **방어 없음** | ⚠ GAP |
| L2 | execution-reviewer가 계속 문제를 찾음 | **방어 없음** | ⚠ GAP |
| L3 | Verify가 계속 실패 (테스트가 통과하지 않음) | **방어 없음** | ⚠ GAP |
| L4 | 리뷰어와 에이전트가 서로 모순된 판단 (리뷰어: "X를 해라" → 에이전트 수정 → 리뷰어: "X를 하지 마라") | **방어 없음** | ⚠ GAP |

### GAP-14: Ralph Loop에 max_iteration 없음

모든 루프에 하드 리밋이 필요:
- `max_plan_review_iterations` (제안: 3)
- `max_execute_verify_iterations` (제안: 5)
- `max_overall_iterations` (제안: 10)

초과 시: 현재까지의 결과와 미해결 문제를 사용자에게 보고하고 인간 결정 요청.

### GAP-15: 리뷰어/에이전트 모순 감지 없음

리뷰어가 iteration N에서 "A를 해라"라고 하고, iteration N+1에서 "A를 하지 마라"라고 하면 루프가 끝나지 않음.

제안: 이전 리뷰 피드백을 기록하고, 모순 감지 시 사용자에게 에스컬레이션.

---

## 검증 차원 6: 도구 강제 실현 가능성

> 에이전트별 도구 제한이 실제로 작동하는가?

| 강제 메커니즘 | 실현 방법 | Claude Code에서 작동하는가 | 판정 |
|-------------|---------|------------------------|------|
| YAML frontmatter `allowed-tools` | 슬래시 커맨드에서 도구 화이트리스트 | ✓ Claude Code 지원 | ✓ |
| 서브에이전트별 도구 제한 | `Task()` 호출 시 에이전트 정의에서 제한 | ✓ Claude Code Agent 도구 지원 | ✓ |
| ed-tools CLI | Bash 도구를 통한 호출 | ✓ | ✓ |
| 리뷰어의 Write/Edit 차단 | 리뷰어 에이전트 정의에서 Write/Edit 제외 | ✓ | ✓ |

**판정:** 도구 강제는 Claude Code의 기존 메커니즘으로 실현 가능. ✓ PASS

---

## 검증 차원 7: 데이터 흐름

> 스텝 N의 출력이 스텝 N+1의 입력으로 정확히 연결되는가?

| 출력 → 입력 | 전달 방법 | 스키마 정의 | 판정 |
|------------|---------|-----------|------|
| Analyze → Classify | JSON (ed-tools) | ✓ 정의됨 | ✓ |
| Classify → Spec | 분류 결과 + 분석 JSON | 분류 타입 + 깊이 레벨 | ✓ |
| Spec → Research | 결정 파일 (.emberdeck/decisions/) | YAML frontmatter | ✓ |
| Spec → Plan | 결정 파일 + 분석 JSON | YAML + JSON | ✓ |
| Research → Plan | 리서치 아티팩트 파일 | Markdown | ⚠ 스키마 느슨 |
| Plan → Plan Review | PLAN.md + TASK-XX.md | XML 구조 | ✓ |
| Plan → Execute | TASK-XX.md (plans are prompts) | XML 구조 | ✓ |
| Execute → Verify | 변경된 파일 (git diff) | 파일 시스템 | ✓ |
| Execute → execution-reviewer | 코드 + SUMMARY | ⚠ SUMMARY 스키마? | ⚠ PARTIAL |
| Verify → Validate | Verify 결과 (pass/fail + 상세) | ⚠ 스키마 미정의 | ⚠ GAP |
| Validate → Commit | Validate 결과 | ⚠ 스키마 미정의 | ⚠ GAP |

### GAP-16: 일부 스텝 간 데이터 스키마가 미정의

Research → Plan, Execute → execution-reviewer, Verify → Validate, Validate → Commit의 데이터 형식이 느슨하거나 미정의.

제안: 모든 스텝 간 데이터에 JSON 스키마 또는 YAML frontmatter 스키마를 정의. ed-tools가 스키마 검증을 수행.

---

## 검증 차원 8: 실패 복구

> 각 스텝에서 실패 시 어떻게 되는가?

| 스텝 | 실패 유형 | 현재 복구 전략 | 판정 |
|------|---------|-------------|------|
| Analyze | ed-tools CLI 오류 | ??? | ⚠ 미정의 |
| Analyze | gildash 인덱싱 실패 | ??? | ⚠ 미정의 |
| Classify | 사용자가 모든 옵션 거부 | No match → 인간 보고 | ✓ |
| Spec | 사용자가 질문에 답 안 함 | ??? | ⚠ 미정의 |
| Research | 웹 검색 실패 | ??? | ⚠ 미정의 |
| Plan | planner가 유효한 계획 생성 불가 | Ralph Loop → max iteration → 인간 보고 (GAP-14 해결 전제) | ⚠ 조건부 |
| Execute | 코드 수정 중 에러 | deviation rules (자동 수정/질문/금지) | ✓ |
| Execute | 컨텍스트 윈도우 초과 | GSD-2 철칙으로 방지 (태스크 크기 제한) | ✓ |
| Verify | 테스트 실패 | Ralph Loop → executor 재실행 | ✓ |
| Validate | 검증 실패 | executor 재실행? 아니면 Plan부터? | ⚠ 미정의 |
| Commit | git 충돌 | ??? | ⚠ 미정의 |
| **아무 스텝** | 프로세스 크래시 | ??? | ⚠ 미정의 |
| **아무 스텝** | API 한도 초과 | ??? | ⚠ 미정의 |

### GAP-17: 실패 복구 전략이 대부분 미정의

제안:
- 모든 스텝에서 상태를 파일로 영속화 (GSD `.planning/STATE.md` 패턴)
- 크래시 시 마지막 완료 스텝부터 재개 가능
- API 한도: 대기 후 재시도, 또는 사용자에게 보고
- Validate 실패: 실패 원인에 따라 분기 (코드 문제 → Execute 재실행, 계획 문제 → Plan 재생성)

---

## 검증 차원 9: Edge Case

> 극단적 상황에서 워크플로우가 어떻게 동작하는가?

| # | 상황 | 기대 동작 | 현재 설계 | 판정 |
|---|------|---------|---------|------|
| X1 | 사용자가 중간에 마음을 바꿈 ("아 그거 말고 다른 거 해줘") | 현재 워크플로우 중단, 새로 시작 | **워크플로우 중단/재시작 메커니즘 미정의** | ⚠ GAP |
| X2 | 사용자가 장시간 응답 안 함 (체크포인트에서 대기 중) | 상태 보존하고 대기, 재개 가능 | 상태 파일 영속화로 가능하지만 **타임아웃 미정의** | ⚠ GAP |
| X3 | 매우 큰 코드베이스 (10만+ 줄) | gildash 인덱싱이 느려질 수 있음 | **대규모 코드베이스 대응 미정의** | ⚠ GAP |
| X4 | 동시에 두 명이 같은 프로젝트에서 emberdeck 사용 | 상태 충돌 | **동시성 미정의** | ⚠ GAP |
| X5 | 카드 수가 매우 많음 (500+) | BFS 영향 분석이 느려질 수 있음 | ed-tools CLI가 처리하지만 **성능 한계 미정의** | ⚠ PARTIAL |
| X6 | 사용자가 emberdeck 워크플로우 밖에서 코드를 직접 수정 | drift 발생 | 다음 `/ed:start`에서 Analyze가 감지 | ✓ |
| X7 | git 히스토리가 없는 프로젝트 | atomic commit이 의미 없음 | **git 없는 환경 미정의** | ⚠ GAP |

### GAP-18: 워크플로우 중단/재시작 미정의
### GAP-19: 타임아웃 미정의
### GAP-20: 대규모 코드베이스 성능 미정의
### GAP-21: 동시성 미정의
### GAP-22: git 없는 환경 미정의

---

## 갭 종합

| GAP | 내용 | 심각도 | 카테고리 |
|-----|------|--------|---------|
| GAP-1 | 복합 분류 처리 규칙 없음 | 높음 | 케이스 커버리지 |
| GAP-2 | Chore 분류 없음 | 중간 | 케이스 커버리지 |
| GAP-3 | 테스트 추가 분류 없음 | 낮음 | 케이스 커버리지 (Chore에 포함 가능) |
| GAP-4 | 롤백 분류 없음 | 낮음 | 케이스 커버리지 (No match로 처리 가능) |
| GAP-5 | 부분 온보딩 없음 | 중간 | 케이스 커버리지 |
| GAP-6 | Drift 해소 전용 플로우 없음 | 중간 | 케이스 커버리지 |
| GAP-7 | AC 없는 spec 처리 규칙 없음 | 중간 | 케이스 커버리지 |
| GAP-8 | Bug Fix의 Test(RED)에 리뷰어 없음 | 높음 | 에이전트 완결성 |
| GAP-9 | Design Change에 Spec 업데이트 시점 없음 | 높음 | 스텝 최적화 |
| GAP-10 | Exploration Report에 리뷰어 없음 | 낮음 | 에이전트 완결성 |
| GAP-11-13 | (GAP-8,9,10과 동일) | — | — |
| GAP-14 | Ralph Loop에 max_iteration 없음 | 높음 | 루프 종료 |
| GAP-15 | 리뷰어/에이전트 모순 감지 없음 | 중간 | 루프 종료 |
| GAP-16 | 일부 스텝 간 데이터 스키마 미정의 | 중간 | 데이터 흐름 |
| GAP-17 | 실패 복구 전략 대부분 미정의 | 높음 | 실패 복구 |
| GAP-18 | 워크플로우 중단/재시작 미정의 | 중간 | Edge Case |
| GAP-19 | 타임아웃 미정의 | 낮음 | Edge Case |
| GAP-20 | 대규모 코드베이스 성능 미정의 | 낮음 | Edge Case |
| GAP-21 | 동시성 미정의 | 낮음 | Edge Case |
| GAP-22 | git 없는 환경 미정의 | 낮음 | Edge Case |

### 심각도별 분류

**높음 (설계 수정 필요):**
- GAP-1: 복합 분류 처리 규칙
- GAP-8: Test(RED) 리뷰어
- GAP-9: Design Change Spec 업데이트 시점
- GAP-14: Ralph Loop max_iteration
- GAP-17: 실패 복구 전략

**중간 (설계 보완 필요):**
- GAP-2: Chore 분류
- GAP-5: 부분 온보딩
- GAP-6: Drift 해소 플로우
- GAP-7: AC 없는 spec
- GAP-15: 리뷰어/에이전트 모순 감지
- GAP-16: 데이터 스키마
- GAP-18: 워크플로우 중단/재시작

**낮음 (후순위 또는 기존 메커니즘으로 처리 가능):**
- GAP-3, 4, 10, 19, 20, 21, 22
