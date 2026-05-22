# Card Model Design (v4)

emberdeck 카드 모델(노드 타입 · 계층 · 관계)의 확정 설계.
(*envelope 제거는 `REDESIGN_PLAN.md` — 별개 주제.*)

> v4는 v3의 재검증(서브에이전트 + Codex)이 짚은 결함을 반영. 핵심: vision은 **enforcement 없는 root 노드**(검증 면제 아님 — 구조 검증 O)이며 `scopes` derived 엣지로 domain과 연결(고립 해소). 미결 노드에 의존하는 엣지·결합은 §9 미결로 일관 표기. dry-run용 write-free validate는 미존재→구현 필요로 정정. 표기: **[현존]** 현 스키마, **[신규]** 변경 필요, **[신규·미결노드]** 대상 노드가 §9 미결.

---

## 1. 핵심 원칙

1. **카드 = 그 자체로 완전한 지식 그래프.** 시각화(graphify류)는 이 그래프의 *뷰*일 뿐, 구조의 근거가 아니다. 따라서 프로젝트 최상위 맥락(vision)도 그래프 안에 있어야 한다 — 카드 밖 config로 빼면 "소스 없이 카드만으로 직관 이해" 목적이 깨진다.
2. **트리 + 그래프 분리** (SysML/NASA/KAOS 표준). 트리(`parent`) = 분해, 타입 엣지 = 추적.
3. **한 계약 = 한 owner (SSOT).** 복제 금지. 역방향 관계는 *저장하지 않고* 도출(derived).
4. **코어 = 정확히 필요한 만큼.** 항목 삭제가 심플함이 아니다 — 프로젝트 지식을 무오염으로 표현하는 데 필요한 노드는 코어에 둔다. 스케일 전용(MSA/모노레포)만 게이트 optional로 분리.
5. **노드 vs 필드 판정 = cardinality OR owner 귀속.** 1:n이고 단일 owner에 귀속 → 필드. **n:n이거나 어느 단일 owner에도 안 속함 → 노드.** (막연한 분류로 노드 추가 금지)

---

## 2. 카드 구조 그래프

```
        VISION  [신규 코어]  ── 프로젝트당 1장, root 맥락 (구조 검증 O, enforcement X)
          │ scopes (vision→domain, derived: 모든 domain) [신규-derived]
          ▼  (전체 그래프의 루트 컨텍스트 — 그래프상 연결됨, 고립 아님)
╔════════════ 거버넌스 평면 (트리 밖, 횡단) ════════════╗
║  PRINCIPLE ── governs (applies_to glob, owner) ──► 노드 ║  [현존 필드, 강제=신규]
║              ◄── governed_by (derived index, 저장 X)    ║  [신규, validate가 도출]
╚═══════════════════════════╪════════════════════════════╝
   GLOSSARY = 용어 오버레이 (glossary.yaml + 각 카드 glossary 필드) — 노드 타입 아님  [현존 오버레이]
                            ┃
─────────────── 구조 트리 (수직, parent = 1:n) ───────────────
                            ┃
        DOMAIN  [현존]  ◄── depends-on (n:n) ──► DOMAIN      [현존: cross_domain_dependencies]
          │ 1:n         (group: 스칼라 필드로 영역 묶음)     [신규 필드: domain.group]
          ▼
        BRIEF   [현존]                            ← 기능 기획 (WHAT/WHY)
          │ 1:n
          ▼
        SPEC    [현존]  ◄── calls / conflicts-with (n:n) ──► SPEC   [신규: relations 확장]
          │ derives (item→brief#item, n:1)  [현존]
          │ emits / consumes (n:n) ──► EVENT-CONTRACT        [신규]
          │ code_link (derived, @spec, 카드 저장 X) ──► CODE SYMBOL  [현존]
          ▼
       CODE SYMBOL (gildash)

── 확장 노드 (게이트 optional · 비강제 · 도입 후보 · 노드+엣지 둘 다 §9 미결) ──   [전부 신규·미결]
   MODEL          parent=domain. 공유 엔티티 — spec이 derives로 참조;
                  MODEL ◄── references (n:n) ──► MODEL  (FK/composition 관계)
   SERVICE        domain ◄── deployed_in (n:n) ──► SERVICE (배포 경계, MSA)
   EVENT-CONTRACT spec ── emits/consumes ──► event (발행/구독 계약, MSA)
   ※ 위 노드·엣지·코드결합은 전부 도입 결정 시 확정 — 현재 비바인딩.
```

---

## 3. 노드 타입

### 코어 (항상)

| 노드 | 담는 것 | 비고 |
|---|---|---|
| **vision** [신규] | 프로젝트 WHY/방향/최상위 성공 방향. 프로젝트당 1장, root. 필드: `statement`(필수, 방향 산문) / `rationale`(optional) / `success_direction`(optional). | enforcement·applies_to 없음. 구조 검증은 받음 — 아래 |
| **domain** [현존] | bounded context 경계 (IN/OUT). | + `group` 필드[신규]로 영역 묶음 |
| **brief** [현존] | 기능 기획 — 문제·범위·시나리오·정책·근거·**가정·한계**(=risk). | risk는 신규 필드 아님 → §7 |
| **spec** [현존] | 행동 계약 (pre/post/invariant/failures). 코드 결합. | |
| **principle** [현존] | 횡단 규범 (검증가능 MUST/SHALL 문장). | |

> **glossary는 노드 타입이 아니다.** 용어는 `glossary.yaml` 오버레이 + 각 카드의 `glossary` 필드(주요 토픽 색인)로 표현하고 `ed glossary` 명령이 관리한다. (사용자 프로젝트에 `glossary.md` 카드가 `type:domain`으로 있을 수 있으나, 그건 모델 차원의 타입이 아니라 한 도메인 카드일 뿐.)

> **왜 vision을 코어 노드로?** v2는 vision을 advisory principle로 흡수했으나 두 결함이 있었다: (a) `principle.statement`는 규범문(MUST/SHALL) 필수인데 vision은 *방향성* → 타입 의미 오염; (b) advisory principle은 `applies_to:'*'`를 요구해 §5의 "`*` 금지"와 자기모순. vision은 규범(enforcement 대상)이 아니므로 principle에 넣을 수 없다. 그렇다고 카드 밖 config로 빼면 원칙 1을 위배. → **enforcement 없는 root 노드**가 정공법. `applies_to`/`enforcement` **없음**(principle과 구별되는 지점).
>
> **"검증 면제"가 아니라 "enforcement 면제".** 모든 카드는 *내용 의미*는 검증하지 않고 *구조*만 검증한다(emberdeck 공통) — vision도 동일하게 구조 검증을 받는다: `statement` 비어있지 않음, vision ≤1장, 그리고 **`scopes` 엣지로 모든 domain과 연결됨**(고립 금지). 따라서 "카드=검증가능 그래프" 정체성과 충돌하지 않는다. vision이 다른 점은 오직 *규범 강제(enforcement)가 없다*는 것뿐.
>
> **그래프 연결.** vision→domain `scopes` 엣지는 *저장하지 않고 도출*(derived) — 프로젝트당 vision 1장이므로 모든 domain이 그 vision의 scope에 속함을 validate/그래프가 도출(governed_by와 동일 패턴, 한 owner 복제 없음). 이로써 vision은 degree-0 고립이 아니라 그래프상 모든 domain의 루트로 traverse 가능.

### 확장 (게이트 충족 시 도입 후보 — 전부 [신규], optional·비강제)

| 노드 | 노드인 이유 (원칙 5) | 게이트 | parent/엣지 |
|---|---|---|---|
| **model** | 공유 엔티티가 어느 단일 brief에도 안 귀속(owner 부재) | 모노레포/공유 타입 | parent=domain; spec `derives` 참조; model `references` model |
| **service** | domain↔service = n:n | MSA | 트리 X; domain `deployed_in` n:n |
| **event-contract** | 발행·구독 여러 spec 공유(n:n owner); 코드 import로 안 잡힘 | MSA | 트리 X; spec `emits`/`consumes` |

### 필드로 흡수 (노드 아님 — 원칙 5: 1:n + 단일 owner 귀속)

| 항목 | 흡수처 | 이유 |
|---|---|---|
| **area** (도메인 영역 묶음) | `domain.group` 스칼라 필드 [신규] | 1:n + domain에 귀속 → 필드면 충분. 노드화 = 4단 트리 강제(과설계) |

### 거부 (과설계 — 기존 필드 흡수)

| 후보 | 흡수처 |
|---|---|
| design 노드 | `brief.design` [현존] |
| story 노드 | `brief.scope.goals` [현존] |
| actor 노드 | `brief.flow.given` [현존] |
| epic 노드 | 없음 — 릴리스 묶음은 코드 정합성 SSOT 대상 아님 (필요 시 brief tag). *epic=domain 등치는 의미 오류라 폐기* |

---

## 4. 관계(엣지) + cardinality + owner

| 엣지 | from → to | cardinality | 종류 | owner / 저장 | 상태 |
|---|---|---|---|---|---|
| `parent` | domain→brief→spec→spec | 1:n | 분해 | 자식 frontmatter | [현존] |
| `scopes` | vision → domain (전체) | 1:n | 루트 맥락 | **저장 안 함, validate가 도출** | [신규-derived] |
| `governs` | principle → 노드 | n:n | 거버넌스 | `principle.applies_to`(glob) | [현존 필드, 강제 신규] |
| `governed_by` | 노드 → principle | n:n | 거버넌스(역) | **저장 안 함, validate가 도출** | [신규-derived] |
| `derives` | spec.item → brief#item | n:1 | 추적 | spec 항목 | [현존] |
| `depends-on` | domain → domain | n:n | 추적 | `cross_domain_dependencies` | [현존] (typed화=신규) |
| `calls` / `conflicts-with` | spec → spec | n:n | 추적 | `relations` 확장 | [신규] |
| `references` | model → model | n:n | 데이터 관계(FK/composition) | model | [신규·미결노드] |
| `emits` / `consumes` | spec → event-contract | n:n | 추적 | spec | [신규·미결노드] |
| `deployed_in` | domain → service | n:n | 배포 | domain | [신규·미결노드] |
| `code_link` | spec → symbol | n:n | 코드 다리 | **@spec 어노테이션(source SoT), 카드 저장 X** | [현존-derived] |
| glossary ref | 노드 → term | n:n | 오버레이 | `glossary` 필드 | [현존] |

> `derives`는 한 spec 항목이 단수 `brief-key#item-id`를 가리킴(스키마: 문자열). 카드 레벨에선 한 spec이 여러 brief 항목을 참조하므로 **n:1**(spec항목→brief항목).
> **[신규·미결노드]** 엣지(references/emits/consumes/deployed_in)는 대상 노드(model/event-contract/service)가 §9 미결이므로 **엣지도 미결** — 노드 도입 결정 시 owner·타깃·방향·검증을 함께 확정. 표에 형태만 예시.
> `parent`에 model은 미포함 — model은 도입 시 `domain→model`(optional) 추가 예정(§9).

---

## 5. principle 강결합 메커니즘 (형해화 → 실효화)

**현 상태(정확):** `enforcement` enum(blocking/warning/advisory)은 *존재하고 라벨도 차등* 부여됨. 그러나 (a) 이를 읽어 위반을 검출하는 **generic 강제 엔진이 없고**, (b) principle 4장 전부 `applies_to:['*']` 라 적용 대상이 변별되지 않는다(형해화는 이 둘).

| 항목 | 변경 | 상태 |
|---|---|---|
| `applies_to` | `*` 금지, 실제 카드키/glob (예: `[spec/**, code-binding/**]`) | [데이터 수정] |
| `governs` owner | `principle.applies_to` 한 곳이 SoT | [현존] |
| `governed_by` | 하위에 *저장하지 않고* validate가 applies_to 매칭으로 **도출(index)** | [신규-derived] |
| `enforcement`→validate (방향 확정) | blocking=validate 실패(exit 2) / warning=경고 / advisory=리포트 | [신규-방향] |

> **방향만 확정, 처방 알고리즘은 미결(§9).** `enforcement`를 validate에 연결한다는 *방향*은 확정이나, `principle-violation`을 실제로 판정하는 검증 알고리즘(무엇이 위반인지 machine-judgable 규칙)은 §9 미결이다 — 이게 닫혀야 "강제 실효화"가 구현 가능해진다.
> 거버넌스 관계는 **applies_to 한 곳에만 저장**(한 계약 한 owner). 역방향은 파생이므로 복제 아님. vision은 principle이 아니므로 이 규칙·`*` 금지와 무관(모순 없음).

---

## 6. Code Binding & Drift (재설계가 보존해야 할 현행 동작)

코드 정합성은 emberdeck의 절반이다. 재설계는 아래 현행 동작을 **보존**한다.

| 메커니즘 | 동작 | 상태 |
|---|---|---|
| 결합 SoT | 소스 `/** @spec <card-key> */` 어노테이션 → `ed spec sync` → `code_link` 캐시. **카드 frontmatter는 결합 필드 미보유**(`source-as-binding-sot`). | [현존, 보존] |
| 활성화 가드 | active spec은 `@spec` ≥1 + 전부 resolve. | [현존, 보존] |
| drift | `broken_link`(심볼 소실) / `glossary_broken`. `check-drift`는 read-only. | [현존, 보존] |
| coverage | 미결합 심볼 보고. | [현존, 보존] |
| **확장 결합** | (확장 노드 도입 시) model/event-contract도 동일 `@spec`-family 어노테이션으로 코드에 결합. 특히 **event-contract는 발행/구독 코드가 서로 import하지 않아 코드 그래프로 안 잡히는 결합**을 카드 결합(emits/consumes)으로 표현. | [신규·미결노드] |

## 7. 정책 / 위험 경계 (중복 해소)

| 구분 | owner | 상태 |
|---|---|---|
| 횡단 규범 (2+ 카드/도메인) | **principle** (applies_to) | [현존] |
| 기능 국소 규칙 (단일 flow) | **brief.policy** (`governs:[S-id]`) | [현존] |
| 가정 (깨질 수 있는 전제) | **brief.scope.assumptions** | [현존] |
| 알려진 한계/위험 | **brief.limits** | [현존] |
| 행동 레벨 실패 | **spec.failures** | [현존] |

> "risk"를 위한 신규 필드는 만들지 않는다 — `assumptions`(전제) + `limits`(한계/위험)로 흡수(중복 회피). 2+ 카드에 반복되는 규칙은 principle로 승격, 원 카드엔 참조만.

---

## 8. 마이그레이션 (비파괴 점진)

원칙: **코어 트리(domain/brief/spec)+glossary 불변. vision·신규는 전부 optional 추가. reset 불요.**

| 변경 | 기존 81카드 영향 | 방식 |
|---|---|---|
| vision 코어 노드 추가 | 0 (없으면 미생성, optional) | 신규 root 타입 등록 + vision 1장 작성 |
| `domain.group` 필드 | 0 (optional) | closed-schema에 optional 추가 |
| model/service/event-contract 노드 | 0 (현재/소규모는 미생성) | optional 타입 등록 |
| `governed_by` | 0 (derived, 저장 X) | validate 도출 로직만 |
| `applies_to` 실키화 | principle 4장만 | 데이터 수정(4장) |
| typed 엣지(calls/references/emits/…) | 0 (relations 확장, optional) | validator에 엣지 타입 추가 |

> **dry-run 선행 (write-free validate는 [신규] — 현재 미존재, 마이그레이션 전 구현 필요):** 현행 `ed validate`는 진입 시 자동 disk→index sync를 하여 DB write를 시도한다(진짜 read-only 환경에서 `SQLITE_READONLY`). 따라서 마이그레이션 게이트로 쓰려면 **sync를 건너뛰거나 DB를 read-only로 여는 write-free 검증 경로를 먼저 추가**해야 한다. 그 경로로 신규 optional 필드가 기존 카드를 invalid화하지 않음을 확정한 뒤 적용.
> closed-schema에 신규 optional 필드 추가 → validator 업데이트 → 기존 카드는 신규 필드 없이도 valid(dual-read). 단계적, 비파괴.

---

## 9. 확정 / 미결

**확정:**
- 코어 = **vision + domain/brief/spec/principle** + glossary 오버레이.
- vision = **enforcement 없는 root 노드**(principle 흡수 폐기). 필드 `statement`(필수)/`rationale`/`success_direction`. 구조 검증(statement 비어있지 않음·vision ≤1장·`scopes`로 domain 연결)은 받음. area = `domain.group` 필드. epic 폐기.
- vision→domain `scopes` = derived(저장 X, 고립 방지).
- 거버넌스 = applies_to owner + governed_by derived + (enforcement→validate는 *방향* 확정).
- code-binding/drift 현행 보존(코어 spec). 확장 노드 결합은 노드 도입 시.
- 비파괴 점진 마이그레이션. design/story/actor/epic 노드 거부. glossary는 오버레이(노드 아님).

**미결 (다음 설계 단계 — 본질적 순서 의존):**
- 확장 노드(model/service/event-contract)는 **방향만 확정(도입 후보)** — 각 **필수 필드 스키마**, 그에 의존하는 엣지(references/emits/consumes/deployed_in)·코드결합, `domain→model` parent는 도입 결정 시 함께 확정.
- typed 엣지(calls/conflicts-with) **검증 규칙**(타깃 존재·타입·방향·순환).
- `principle-violation` issue code의 정확한 검증 알고리즘 (§5 강제 실효화의 처방).
- **write-free `ed validate` 경로** (마이그레이션 dry-run 게이트 전제 — 현재 sync가 write 시도).

---

## 부록 — 근거

- 트리+그래프 분리: SysML, NASA SE, DOORS, KAOS, IEEE 42010.
- cross-cutting 중앙정의+참조: GovStack (`docs/research-brief-system-gaps.md` §5).
- brief=기획서: `docs/research-planning-terminology.md`.
- typed decomposition tree가 차별점(AI 도구는 전부 플랫/선형): `docs/research-hierarchical-spec-methods.md`.
- 근본 원인(ownerless 복제)·principle 형해화·4-layer 평가: 메모리 `card-drift-root-cause`, `architecture-4layer-assessment`.
- v4 교정 근거: v3 재검증(서브에이전트 + Codex) — vision 고립/검증면제 모순/미결노드 의존 엣지/dry-run 거짓전제 정정.
