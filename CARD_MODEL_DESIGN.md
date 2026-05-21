# Card Model Design

emberdeck 카드 모델(노드 타입 · 계층 · 관계)의 확정 설계.
(*envelope 제거는 `REDESIGN_PLAN.md` — 별개 주제.*)

---

## 1. 핵심 원칙

1. **카드 = 그 자체로 완전한 지식 그래프.** 시각화(graphify류)는 이 그래프를 *보여주는 뷰*일 뿐, 구조의 근거가 아니다. 시각화에 의존해 구조를 만들지 않는다.
2. **트리 + 그래프 분리** (SysML/NASA/KAOS 표준).
   - 트리(`parent`) = **분해** ("이 카드는 저 카드의 일부다").
   - 그래프(typed 엣지) = **추적** ("이 카드는 저 카드에 의존/충돌/참조한다").
3. **한 계약 = 한 owner (SSOT).** 같은 계약을 여러 카드에 복제하지 않는다. owner 1장 + 나머지는 참조.
4. **코어는 최소 충분, 확장은 스케일 게이트 optional(비강제).** 소규모 프로젝트가 확장 노드를 강제당하지 않는다(과설계 방지).

---

## 2. 카드 구조 그래프

```
╔══════════════ 거버넌스 평면 (트리 밖, 횡단) ══════════════╗
║  PRINCIPLE ── governs / governed_by (n:n) ──► 모든 노드   ║   횡단 규범, enforcement로 강제
║  GLOSSARY  ── defines (n:n) ───────────────► 모든 노드   ║   용어 사전 (오버레이)
╚════════════════════════════╪═════════════════════════════╝
                             ┃
──────────────── 구조 트리 (수직, parent = 1:n) ────────────────
                             ┃
        VISION                         ← 프로젝트 1장. 최상위 WHY/목적/방향
          │ 1:n
          ▼
       (AREA)                          ← [확장] domain 상위 그룹핑 (엔터프라이즈)
          │ 1:n
          ▼
        DOMAIN  ◄── depends-on (n:n, typed) ──► DOMAIN
          │ 1:n
          ▼
        BRIEF                          ← 기능 기획 (WHAT/WHY)
          │ 1:n
          ▼
        SPEC   ◄── calls/emits/conflicts-with (n:n, typed) ──► SPEC
          │ derives (n:n, 추적) ──► BRIEF#item
          │ n:n
          ▼
     CODE SYMBOL (gildash)             ← @spec 어노테이션이 다리

────────────── 확장 노드 (게이트 optional, 비강제) ──────────────
   MODEL        [확장] 공유 데이터 엔티티 — spec이 derives로 참조
   SERVICE      [확장] 배포 경계 (MSA) — domain을 묶거나 매핑
   EVENT-CONTRACT [확장] 발행/구독 계약 (MSA) — spec이 emits/consumes
```

---

## 3. 노드 타입

### 코어 (항상 — 소규모도 이 5 + glossary로 충분)

| 노드 | 담는 것 (책임) | 안 담는 것 |
|---|---|---|
| **vision** | 프로젝트가 *왜* 존재하고 무엇을 지향하는가 (목적·대상·방향·최상위 성공). 프로젝트당 1장. | 규칙(principle), 경계(domain) |
| **domain** | bounded context 경계 (IN/OUT 책임). | 다른 도메인의 책임 |
| **brief** | 한 기능의 기획 — 문제·범위·시나리오·정책·근거·**위험**. (=기획서, WHAT/WHY) | 행동 계약 세부(spec), 횡단 규범(principle) |
| **spec** | 한 동작의 행동 계약 — preconditions/postconditions/invariants/failures. 코드와 결합. | exit/stderr 같은 횡단 규칙(owner 참조) |
| **principle** | 횡단 규범/제약 (MUST/SHALL). enforcement로 강제. | 특정 기능 국소 규칙(brief.policy) |
| **glossary** | 프로젝트 고유 용어 정의 (오버레이, 트리 밖). | 단일 심볼로 유추 가능한 것 |

### 확장 (스케일 게이트 충족 시에만 — optional, 계층 비강제)

| 노드 | 진입 게이트 | 정당화 (없으면 표현 불가능한 것) |
|---|---|---|
| **model** | 모노레포/공유 타입 | 여러 brief가 공유하는 엔티티의 불변식·관계(n:n owner)가 어느 단일 brief에도 안 속함 → spec 본문 매몰 |
| **area** | 엔터프라이즈(domain 다수) | domain이 root라 수십 개가 평탄화 → "결제 영역 전체" 계층 질의 불가 |
| **service** | 마이크로서비스 | domain=논리, service=배포. 둘이 1:1이 아님 → 배포 경계 질의 불가 |
| **event-contract** | 마이크로서비스 | 발행자·구독자가 코드 import 관계가 없어 코드 그래프로 못 잡음 → "이 이벤트 깨지면 누가 영향" 질의가 *유일하게 표현 불가* |

### 거부 (과설계 — 기존 필드로 흡수)

| 후보 | 흡수처 |
|---|---|
| design 노드 | `brief.design` (이미 1급) |
| epic / story 노드 | epic = domain, story = `brief.scope.goals` |
| actor 노드 | `brief.flow.given` / domain 필드 |
| 비전을 여러 곳에 | vision 1장으로 단일화 |

---

## 4. 관계(엣지) + cardinality

| 엣지 | from → to | cardinality | 종류 |
|---|---|---|---|
| `parent` | vision→domain→brief→spec→spec | **1:n** | 분해 (트리) |
| `governs` / `governed_by` | principle ↔ 노드 | **n:n** | 거버넌스 (강제) |
| `derives` | spec.item → brief#item | **n:n** | 추적 (상위 근거) |
| `depends-on` | domain → domain | **n:n** | 추적 (typed) |
| `calls` / `emits` / `consumes` / `conflicts-with` | spec → spec / event | **n:n** | 추적 (typed) |
| `defines` | glossary ↔ 노드 | **n:n** | 오버레이 |
| `code_link` | spec → symbol | **n:n** | 코드 다리 (@spec) |

---

## 5. principle 강결합 메커니즘 (현재 형해화 → 실효화)

현재 문제: principle 4장 전부 `applies_to: ['*']`, enforcement가 validate와 미연결 → 고립된 선언.

| 항목 | 변경 |
|---|---|
| `applies_to` | `*` 금지. 실제 카드키/glob로 적용 대상 명시 (예: `[spec/*, code-binding/*]`) |
| `governed_by: [principle-key]` | 하위 노드가 자신을 지배하는 principle을 *역방향* 선언 (양방향 추적 = graph 노드화) |
| `enforcement` → validate | `blocking`=validate 실패(exit 2), `warning`=경고, `advisory`=리포트 |

→ principle이 "장식"에서 "헌법(강제되는 횡단 SoT)"이 된다.

---

## 6. 정책/위험 경계 (중복 해소)

| 구분 | owner |
|---|---|
| 횡단 규범 (2+ 카드/도메인 적용) | **principle** |
| 기능 국소 규칙 (단일 flow에 묶임) | **brief.policy** (`governs: [S-id]`) |
| 설계 의도 레벨 위험/한계 | **brief.risk** (가정 깨짐·한계) |
| 행동 레벨 실패 | **spec.failures** (런타임 에러 동작) |

원칙: 2+ 카드에 반복되면 principle로 승격, 원 카드엔 `governed_by` 참조만.

---

## 7. 확정 / 미결

**확정:**
- 코어 5 노드(vision/domain/brief/spec/principle) + glossary 오버레이.
- 트리+그래프 분리, 한 계약=한 owner, 확장은 게이트 optional.
- principle 실효화(applies_to 실키 + governed_by + enforcement→validate).
- 거부 항목(design/epic/story/actor 노드).

**미결 (다음 설계 단계):**
- vision의 필수 필드 스키마.
- 확장 노드 중 **model만 노드 확정**. `area`/`service`/`event-contract`는 *노드 vs 기존 필드*(domain.boundary / domain.group / spec.emits) 최종 결정 필요.
- typed 엣지(`calls`/`emits`/`conflicts-with`) 검증 규칙.

---

## 부록 — 근거

- 트리+그래프 분리: SysML, NASA SE, DOORS, KAOS, IEEE 42010.
- parent=WHY: KAOS 목표 트리.
- cross-cutting 중앙정의+참조: GovStack (`docs/research-brief-system-gaps.md` §5).
- brief=기획서: `docs/research-planning-terminology.md`.
- typed decomposition tree가 차별점(Kiro/SpecKit/Tessl 등 AI 도구는 전부 플랫/선형): `docs/research-hierarchical-spec-methods.md`.
- 근본 원인(ownerless 복제) / principle 형해화: 세션 분석, 메모리 `card-drift-root-cause`, `architecture-4layer-assessment`.
