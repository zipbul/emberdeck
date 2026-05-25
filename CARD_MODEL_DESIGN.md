# Card Model Design (v7)

emberdeck 카드 모델(노드 타입 · 계층 · 관계)의 확정 설계.
(*envelope 제거는 `REDESIGN_PLAN.md` — 별개 주제.*)

> v7는 **domain 노드 골격 확정**(3자 6+라운드 토론 종결): root only·재귀없음, `summary/overview/scope`(산문) 필수, `cross_domain_dependencies`의 `relationship`을 `invokes`|`consumes` enum 격상, **area/group/facet 폐기**(묶음/분류 의미가 scope·cross_domain·applies_to·tags에 완전 흡수), 코어 **5 확정**. scope IN/OUT 구조화는 @spec 결합과 중복이라 산문 유지.
>
> v6: **vision 노드 골격 확정** — 4필드 전부 필수 + 목적 중심 가이드(§3, speckit 식) + `ed card guide` in-band. 표기: **[현존]** 현 스키마, **[신규]** 변경 필요, **[신규-derived]** 도출(저장X), **[신규·미결노드]** 대상 노드가 §9 미결.

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
        VISION  [신규 코어]  ── 프로젝트당 1장, **graph root** (enforcement X)
          ┊ scopes (vision→domain, derived: 모든 domain) [신규-derived]
          ┊  ※ scopes는 횡단 추적 엣지 — parent 트리 엣지 아님. domain은 parent-tree root 유지.
          ┊  (그래프상 연결됨, degree-0 고립 아님)
╔════════════ 거버넌스 평면 (트리 밖, 횡단) ════════════╗
║  PRINCIPLE ── governs (applies_to glob, owner) ──► 노드 ║  [현존 필드, 강제=신규]
║              ◄── governed_by (derived index, 저장 X)    ║  [신규, validate가 도출]
╚═══════════════════════════╪════════════════════════════╝
   GLOSSARY = 용어 오버레이 (glossary.yaml + 각 카드 glossary 필드) — 노드 타입 아님  [현존 오버레이]
                            ┃
─────────────── 구조 트리 (수직, parent = 1:n) ───────────────
                            ┃
        DOMAIN  [현존]  ◄── depends-on (n:n) ──► DOMAIN      [현존: cross_domain_dependencies]
          │ 1:n         relationship: invokes|consumes + note?  [신규: enum 격상]
          ▼
        BRIEF   [현존]                            ← 기능 기획 (WHAT/WHY)
          │ 1:n
          ▼
        SPEC    [현존]  ◄── calls / conflicts-with (n:n) ──► SPEC   [신규: relations 확장]
          │ derives (item→brief#item, n:1)  [현존]
          │ emits / consumes (n:n) ──► EVENT-CONTRACT        [신규·미결노드]
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
| **vision** [신규] | 프로젝트 WHY/방향/최상위 성공. 프로젝트당 1장, root. 필드 `summary`/`statement`/`rationale`/`success_direction` **전부 필수**(목적 가이드 아래). | enforcement·applies_to 없음. 구조 검증은 받음 — 아래 |
| **domain** [현존] | bounded context 경계 (IN/OUT). root only, 재귀 없음. | 분류는 `tags`(현행). area/group/facet 도입 안 함 — 아래 |
| **brief** [현존] | 기능 기획 — 문제·범위·시나리오·정책·근거·**가정·한계**(=risk). | risk는 신규 필드 아님 → §7 |
| **spec** [현존] | 행동 계약 (pre/post/invariant/failures). 코드 결합. | |
| **principle** [현존] | 횡단 규범 (검증가능 MUST/SHALL 문장). | |

> **glossary는 노드 타입이 아니다.** 용어는 `glossary.yaml` 오버레이 + 각 카드의 `glossary` 필드(주요 토픽 색인)로 표현하고 `ed glossary` 명령이 관리한다. (사용자 프로젝트에 `glossary.md` 카드가 `type:domain`으로 있을 수 있으나, 그건 모델 차원의 타입이 아니라 한 도메인 카드일 뿐.)

> **왜 vision을 코어 노드로?** v2는 vision을 advisory principle로 흡수했으나 두 결함이 있었다: (a) `principle.statement`는 규범문(MUST/SHALL) 필수인데 vision은 *방향성* → 타입 의미 오염; (b) advisory principle은 `applies_to:'*'`를 요구해 §5의 "`*` 금지"와 자기모순. vision은 규범(enforcement 대상)이 아니므로 principle에 넣을 수 없다. 그렇다고 카드 밖 config로 빼면 원칙 1을 위배. → **enforcement 없는 root 노드**가 정공법. `applies_to`/`enforcement` **없음**(principle과 구별되는 지점).
>
> **"검증 면제"가 아니라 "enforcement 면제".** 모든 카드는 *내용 의미*는 검증하지 않고 *구조*만 검증한다(emberdeck 공통) — vision도 동일하게 구조 검증을 받는다: `statement` 비어있지 않음, vision ≤1장, 그리고 **`scopes` 엣지로 모든 domain과 연결됨**(고립 금지). 따라서 "카드=검증가능 그래프" 정체성과 충돌하지 않는다. vision이 다른 점은 오직 *규범 강제(enforcement)가 없다*는 것뿐.
>
> **그래프 연결.** vision→domain `scopes` 엣지는 *저장하지 않고 도출*(derived) — 프로젝트당 vision 1장이므로 모든 domain이 그 vision의 scope에 속함을 validate/그래프가 도출(governed_by와 동일 패턴, 한 owner 복제 없음). 이로써 vision은 degree-0 고립이 아니라 그래프상 모든 domain의 루트로 traverse 가능.

#### vision 필드 — 목적 중심 가이드 (전부 필수)

각 필드는 *목적*으로 정의한다. 목적이 명확하면 무엇을 넣고 빼는지는 따라온다(speckit 식 — 안티패턴 나열이 아니라 의도를 박는다).

| 필드 | 이 필드의 목적 (왜 존재하는가 → 그래서 무엇을 적는가) |
|---|---|
| `summary` | **그래프·목록에서 이 프로젝트를 한 줄로 알아보게 하는 라벨**(전 카드 공통 — `list`/`tree`/`search`/graph 뷰가 의존). → "이건 ~하는 시스템이다"를 한 문장으로(= statement의 압축). |
| `statement` | **에이전트가 소스를 한 줄도 안 읽고 "이 프로젝트가 무엇을 위해 존재하고 어디로 가는가"를 즉시 파악하게 한다.** vision의 본체. → 존재 이유와 지향을 *방향*으로 서술(기능 목록 X — 그건 `brief.scope.goals`). |
| `rationale` | **하위 모든 설계 결정이 "왜 이 방향인가"를 거슬러 올라가 정당화할 근거.** domain·brief가 트레이드오프를 판단할 기준점. → 이 방향을 택하게 만든 문제의식·배경(기능 단위 문제 X — 그건 `brief.context`). |
| `success_direction` | **"프로젝트가 옳은 방향으로 가는가"의 가늠자.** 개별 기능 성공이 아니라 전체가 제 길을 가는지. → 성공한 상태가 어떤 모습인지 *정성적*으로(숫자 KPI X — 그건 `principle.metric`). |

> 이 가이드는 **단일 정의**(스키마 명세)에 두고 `ed card guide vision`(read-only)로 작성 직전 in-band 노출 + validate 에러가 해당 필드 목적을 인용한다. 가이드가 마크다운/스키마라 고치면 즉시 반영(reload 없음). 같은 단일 정의를 *나중에* MCP 도구 description으로 wrap 가능 — 단 MCP는 스키마 reload 마찰이 있어 모델·가이드 안정 후의 표면 트랙(§9).

### 확장 (게이트 충족 시 도입 후보 — 전부 [신규], optional·비강제)

| 노드 | 노드인 이유 (원칙 5) | 게이트 | parent/엣지 |
|---|---|---|---|
| **model** | 공유 엔티티가 어느 단일 brief에도 안 귀속(owner 부재) | 모노레포/공유 타입 | parent=domain *(candidate, §9)*; spec `derives` 참조; model `references` model |
| **service** | domain↔service = n:n | MSA | 트리 X; domain `deployed_in` n:n |
| **event-contract** | 발행·구독 여러 spec 공유(n:n owner); 코드 import로 안 잡힘 | MSA | 트리 X; spec `emits`/`consumes` |

### 거부 (과설계 — 기존 필드/노드 흡수)

| 후보 | 흡수처 |
|---|---|
| **area / group / facet 노드** | 폐기 — 도메인 묶음/분류의 고유 의미가 **4곳에 완전 흡수**: 경계=`domain.scope`, 도메인 걸침=`cross_domain_dependencies`, 적용 범위=`principle.applies_to`, 분류 라벨=`tags`. 비규범 미션은 CLAUDE.md. *3자 토론(6+라운드) 결론 — 고유 의미 0 정의 = 잉여. 미정의 노드를 검증 시스템에 두는 것은 자기모순.* 분류 수요가 실증되고 tags로 부족할 때만 typed facet 재론 |
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
| `depends-on` | domain → domain | n:n | 추적 | `cross_domain_dependencies{domain, relationship, note?}` (depender 단일 저장) | [현존, relationship enum화=신규] |
| `calls` / `conflicts-with` | spec → spec | n:n | 추적 | `relations` 확장 | [신규] |
| `references` | model → model | n:n | 데이터 관계(FK/composition) | model | [신규·미결노드] |
| `emits` / `consumes` | spec → event-contract | n:n | 추적 | spec | [신규·미결노드] |
| `deployed_in` | domain → service | n:n | 배포 | domain | [신규·미결노드] |
| `code_link` | spec → symbol | n:n | 코드 다리 | **@spec 어노테이션(source SoT), 카드 저장 X** | [현존-derived] |
| glossary ref | 노드 → term | n:n | 오버레이 | `glossary` 필드 | [현존] |

> `derives`는 한 spec 항목이 단수 `brief-key#item-id`를 가리킴(스키마: 문자열). 카드 레벨에선 한 spec이 여러 brief 항목을 참조하므로 **n:1**(spec항목→brief항목).
> **[신규·미결노드]** 엣지(references/emits/consumes/deployed_in)는 대상 노드(model/event-contract/service)가 §9 미결이므로 **엣지도 미결** — 노드 도입 결정 시 owner·타깃·방향·검증을 함께 확정. 표에 형태만 예시.
> `parent`에 model은 미포함 — model은 도입 시 `domain→model`(optional) 추가 예정(§9).
> **`relationship` enum 격상**: 현행 free-text(기계검증 불가, 코드정합성 결함)를 `invokes`|`consumes` 2값 enum + optional `note?`로. 판별 기준: *호출 계약*이 바뀌면 깨짐=`invokes`(reads/validates/serializes 흡수), *데이터 형태*가 바뀌면 깨짐=`consumes`(persists/writes 흡수). 실카드 14엣지 전수→2축 완전 분류. DDD pattern(shared-kernel 등)은 실사용 0이라 미도입(YAGNI).
> **graph root ≠ parent-tree root.** vision은 *graph root*(scopes로 모든 domain을 맥락화)이고, domain은 여전히 *parent-tree root*(parent 없음). scopes는 추적 엣지라 domain의 parent를 만들지 않으므로 4-tier 트리는 불변(5-tier 아님).

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

| 변경 | 기존 카드(현행) 영향 | 방식 |
|---|---|---|
| vision 코어 노드 추가 | 0 (없으면 미생성, optional) | 신규 root 타입 등록 + vision 1장 작성 |
| `relationship` enum 격상 | cross_domain_dependencies 보유 카드(현행 6/7) | free-text→`invokes`\|`consumes` 매핑 + `note?` 보존. dual-read |
| model/service/event-contract 노드 | 0 (현재/소규모는 미생성) | optional 타입 등록 |
| `governed_by` | 0 (derived, 저장 X) | validate 도출 로직만 |
| `applies_to` 실키화 | principle 4장만 | 데이터 수정(4장) |
| typed 엣지(calls/references/emits/…) | 0 (relations 확장, optional) | validator에 엣지 타입 추가 |

> **dry-run 선행 (write-free validate는 [신규] — 현재 미존재, 마이그레이션 전 구현 필요):** 현행 `ed validate`는 진입 시 자동 disk→index sync를 하여 DB write를 시도한다(진짜 read-only 환경에서 `SQLITE_READONLY`). 따라서 마이그레이션 게이트로 쓰려면 **sync를 건너뛰거나 DB를 read-only로 여는 write-free 검증 경로를 먼저 추가**해야 한다. 그 경로로 신규 optional 필드가 기존 카드를 invalid화하지 않음을 확정한 뒤 적용.
> closed-schema에 신규 optional 필드 추가 → validator 업데이트 → 기존 카드는 신규 필드 없이도 valid(dual-read). 단계적, 비파괴.

---

## 9. 확정 / 미결

**확정:**
- 코어 = **vision + domain/brief/spec/principle** (5) + glossary 오버레이.
- vision = **enforcement 없는 graph-root 노드**(principle 흡수 폐기). 필드 `summary`/`statement`/`rationale`/`success_direction` **전부 필수**, 각 필드는 목적 가이드로 정의(§3). 구조 검증(필드 비어있지 않음·vision ≤1장·`scopes`로 domain 연결)을 받도록 *설계* — 구현은 미결(아래).
- **domain = root only, 재귀 없음** (3자 6+라운드 confirm). `summary`/`overview`/`scope`(산문) 필수. **scope는 산문 유지** — IN/OUT 구조화 안 함(경계강제는 `@spec` 결합이 이미 SoT로 보유, 구조화=중복·drift 표면 확대). 분류는 `tags` 현행 유지.
- **area/group/facet 폐기** — 도메인 묶음/분류 의미가 scope·cross_domain_dependencies·principle.applies_to·tags에 완전 흡수(§3 거부표). 미정의 노드를 검증 시스템에 두는 것은 자기모순. 수요 실증 + tags 부족 시에만 typed facet 재론.
- **cross_domain_dependencies** = `{domain, relationship, note?}`, depender 단일 저장. `relationship`을 **`invokes`|`consumes` enum 격상**(§4) — free-text는 코드정합성 결함.
- vision→domain `scopes` = derived(저장 X, 고립 방지) — 도출 계약은 미결(아래).
- 거버넌스 = applies_to owner + governed_by derived + (enforcement→validate는 *방향* 확정).
- code-binding/drift 현행 보존(코어 spec). 확장 노드 결합은 노드 도입 시.
- 비파괴 점진 마이그레이션. design/story/actor/epic/area 노드 거부. glossary는 오버레이(노드 아님).

**미결 (다음 설계/구현 단계 — 본질적 순서 의존):**
- **vision 타입을 스키마 SoT에 등록** (`SKILL.md <card_fields>` + `src/card/types.ts` 의 CardType 에 `vision` 추가; 현재 4타입만 존재) + **구조 검증 구현**(4필드 비어있지 않음·vision ≤1장·scopes 연결).
- **필드 목적 가이드의 단일 정의 + `ed card guide <type>`(read-only) 노출** + validate 에러가 필드 목적 인용 (in-band 작성 가이드 — vision부터, 이후 전 타입). MCP wrap은 모델·가이드 안정 후 **별도 표면 트랙**(스키마 reload 마찰 때문에 지금은 CLI).
- **가상(derived) 엣지 materialization 계약**: `scopes`·`governed_by` 를 *누가/어떤 API·인덱스로* 도출해 그래프 traverse를 보장하는가 (저장 안 하므로 도출 주체·포맷·validate 증명 방식 정의 필요).
- 확장 노드(model/service/event-contract)는 **방향만 확정(도입 후보)** — 각 **필수 필드 스키마**, 그에 의존하는 엣지(references/emits/consumes/deployed_in)·코드결합, `domain→model` parent는 도입 결정 시 함께 확정.
- **`relationship` enum 격상 구현**(`cross_domain_dependencies.relationship`: free-text → `invokes`|`consumes` + `note?`; validator + 현행 6/7 카드 마이그레이션 매핑).
- typed 엣지(calls/conflicts-with) **검증 규칙**(타깃 존재·타입·방향·순환).
- `principle-violation` issue code의 정확한 검증 알고리즘 (§5 강제 실효화의 처방).
- **write-free `ed validate` 경로** (마이그레이션 dry-run 게이트 전제 — 현재 모든 명령이 진입 시 sync로 write 시도; 미구현 시 CLI 출력을 게이트로 못 씀).

---

## 부록 — 근거

- 트리+그래프 분리: SysML, NASA SE, DOORS, KAOS, IEEE 42010.
- cross-cutting 중앙정의+참조: GovStack (`docs/research-brief-system-gaps.md` §5).
- brief=기획서: `docs/research-planning-terminology.md`.
- typed decomposition tree가 차별점(AI 도구는 전부 플랫/선형): `docs/research-hierarchical-spec-methods.md`.
- 근본 원인(ownerless 복제)·principle 형해화·4-layer 평가: 메모리 `card-drift-root-cause`, `architecture-4layer-assessment`.
- v5 교정 근거: v4 재검증(서브에이전트 + Codex) — vision 타입등록·구조검증·가상엣지 materialization을 미결로 정직화, 표기 정합, graph-root/tree-root 구분.
- v6: vision 4필드 전부 필수 + 목적 중심 가이드 확정. 작성 표면은 CLI(`ed card guide`)+동적 문서, MCP는 안정 후 트랙(스키마 reload 마찰).
- v7: domain 골격 확정(3자 토론) — root/재귀없음, scope 산문유지, relationship enum(invokes|consumes), area/group/facet 폐기(scope·cross_domain·applies_to·tags 흡수), 코어 5.
