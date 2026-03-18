# Research: Hierarchical Spec Methodologies

emberdeck의 계층 구조(capability → interface → data → rule → plan)와 유사한 기법 전수조사.

## 가장 유사한 기법들

### KAOS (Goal-Oriented Requirements Engineering)
- 목표 트리. 전략 목표 → AND/OR 분해 → 리프 제약조건
- **parent가 WHY를 설명하는 구조와 가장 가까움**
- capability ≈ KAOS 루트 목표, rule ≈ KAOS 리프 제약조건
- 단점: interface/data 레이어 없음

### B Method (Formal Methods)
- Abstract Machine → Refinement → Implementation. 단계적 정제.
- **각 정제가 상위 불변 조건을 보존해야 함** — parent-child 관계와 유사
- 정책(abstract machine)에서 구현으로의 gradient가 capability→rule→plan과 유사
- 단점: concern type이 아니라 추상화 수준으로 분류

### SysML Requirements Diagrams
- 포함(containment) = 트리, derive/satisfy/verify/trace = 그래프
- **트리와 그래프의 명시적 분리** — emberdeck의 parent(트리) + relations(그래프) 설계와 정확히 일치
- 단점: requirements가 untyped (capability/interface/data/rule 구분 없음)

### MIL-STD-490 Specification Tree
- Type A(시스템) → Type B(개발) → Type C(제품) → Type D(프로세스)
- **각 스펙이 parent를 갖는 구조와 가장 유사**
- 단점: 물리적 제품 계층으로 분류, concern type이 아님

### NASA Systems Engineering Handbook
- 대통령 지시 → 미션 → 프로그램 → 시스템 → 서브시스템 → 컴포넌트
- **모든 요구사항이 상위로 추적 가능해야 함** — emberdeck의 parent 추적과 동일
- 양방향 추적(up + down) 필수

## 부분 유사한 기법들

### C4 Model
- Context → Container → Component → Code (4단계 줌)
- 구조적 줌이지 concern 분해가 아님
- 트리 + 그래프 구조는 유사

### Impact Mapping
- Goal(WHY) → Actors(WHO) → Impacts(HOW) → Deliverables(WHAT)
- 4단계 순수 트리, parent가 WHY를 설명
- 이해관계자 중심이라 기술 스펙 분해에는 부적합

### Design by Contract
- precondition, postcondition, invariant
- rule 레이어와 정확히 매핑
- 클래스 스코프이지 시스템 스코프가 아님

### BDD (Behavior-Driven Development)
- Feature → Scenario → Steps (Given/When/Then)
- 3단계 트리, 정책 지향
- AI 에이전트와 함께 가장 많이 사용된 스펙 형식
- rule 레이어의 검증 예시로 사용 가능

## AI 전용 스펙 도구들

| 도구 | 구조 | 계층? | emberdeck과 비교 |
|------|------|-------|-----------------|
| Kiro | spec → design → tasks → implement | 선형 파이프라인, 트리 아님 | 단일 스펙에서 모든 것 도출 |
| Spec Kit | specify → plan → tasks → implement | 선형 파이프라인 | 스펙 내부 분해 없음 |
| Tessl | 모듈당 .spec.md | 플랫 | 모듈간 계층 없음 |
| OpenSpec | project.md + 플랫 스펙 라이브러리 | 1레벨 | typed 계층 없음 |
| BMAD | 역할별 순차 문서 | 선형 | concern type 없음 |
| Codified Context | 3계층(hot/domain/cold) | 검색 우선순위 기반, 트리 아님 | 라우팅 vs 계층 분해 |

**모든 AI 전용 도구가 플랫 또는 선형 구조**. typed decomposition tree를 사용하는 도구 없음.

## 핵심 발견

### 트리 + 그래프 분리 원칙

이 원칙은 SysML, DOORS, NASA SE, KAOS, IEEE 42010에서 확립된 표준 관행:
- **트리** = 분해 (이 스펙은 저 스펙의 일부다)
- **그래프** = 추적 (이 스펙은 저 스펙에 의존한다)

### emberdeck 구조의 독창적 부분

1. **concern type으로 분류된 분해 트리** — 기존 방법론은 untyped 트리(SysML) 또는 제품 계층(MIL-STD) 또는 추상화 수준(B Method)으로 분류. capability/interface/data/rule/plan이라는 concern 기반 분류는 선례 없음.

2. **interface를 독립 레이어로** — 대부분의 방법론에서 interface는 컴포넌트의 속성이지 별도 레이어가 아님.

3. **정책 트리에 plan 레이어 통합** — 형식 방법론은 정책만, 애자일은 계획만. 하나의 트리에 둘 다 넣은 것은 독특.

4. **AI 에이전트 소비 최적화** — 기존 AI 도구들은 모두 플랫/선형. typed decomposition tree를 쓰는 AI 스펙 도구 없음.

### 가장 가까운 단일 방법론: B Method

B Method의 Abstract Machine → Refinement → Implementation이 "상위가 하위의 존재 이유를 설명하고 불변 조건이 보존되는" 구조에 가장 가까움. 단, B Method는 추상화 수준으로 분류하고 emberdeck은 concern type으로 분류.

### 결론

emberdeck의 계층 구조는 **기존 원칙들의 독창적 조합**:
- SysML/NASA의 트리+그래프 분리
- KAOS의 "parent가 WHY를 설명"
- Z/B/DbC의 정책 지향
- concern type 기반 분류 (capability/interface/data/rule/plan) ← 선례 없음
