# Card Model Design (v19)

emberdeck 카드 모델(노드 타입 · 계층 · 관계 · 흐름)의 확정 설계.
(*envelope 제거는 `REDESIGN_PLAN.md` — 별개 주제.*)

> v19 = **v18 전파 완성(설계 변경 0)** — 최종 독립 검증이 찾은 전파 누락 4건 정정: `case_of` 개명을 §10 Phase1.3·§2 카탈로그·§9 현실노트에 반영(구 `derives?` 잔재 제거), v18 신규 스키마(`shapes[]`/`invokes[]`/`failures{id,case_of,owner,references}`)를 §8 마이그레이션 표·§6.5 변경전파 다이어그램+SoT표에 전파. 모델/논리 결함 0·신규 모순 0(검증 확인) — 순수 doc-내부 정합.
> v18은 **5축(관계/프로퍼티/시나리오/흐름/설명가능성) 통합 재설계 + 3라운드 엄격 ground-truth 진단**의 수렴 결과를 반영. 핵심 결론: **모델 스키마는 수렴했고, "카드만으로 완벽 이해 / 무누락 SSOT"는 스키마만으로 도달 불가 — `enforcement-bound`**(아래 §9.1).
> - **프로퍼티(②):** spec에 `shapes[]`(IO/에러 형태계약 — 32 command spec이 POST 산문에 ```jsonc``` 누출하던 것 흡수) 추가. SHP id=**덱-전역 레지스트리 key**(owner-uniqueness 결정론 강제 가능하게). post는 `references:SHP-id`로 형태 참조(복제 금지). 형태 owner 1곳.
> - **관계(①):** spec-level **`invokes[]` 엣지**(횡단 per-call 의존, navigable) 신설 — 직전 제안 `steps[]`(순서있는 여정)는 **거부**(실저장소에 순서 cross-domain 여정 0건, createCard는 한 spec 내 fan-out 합성이라 선형체인 미스핏 = 과설계). invokes는 INV-002(runner→card-storage `ensureCardsSynced`) 같은 실수요를 타격.
> - **시나리오(③):** `failures` behavior는 **free-prose 유지**(닫힌 mode enum은 idempotent-noop/silent-swallow 강제오분류 = 거부). `case_of`를 **전 failure mode**가 brief#S-F 가리키게(reject 한정 해제). cross-domain 거부 double-home(cli card-create ↔ lifecycle create-card 6복제) 닫으려 `failures`에 **`owner`/`references`** 추가.
> - **거부 재확인:** `steps[]`·`vision 노드`·`mode 닫힌 enum`·area/group/facet·model/service/event-contract(미실증). vision은 §9.1 긴장 노트 참조.
> - **enforcement 천장:** 위 신규 owner 경계(shapes/invokes/case_of/owner)는 전부 cross-card인데 현 validate는 intra-card → 강제 0. (a)강제가능 부분(엣지 타깃 존재)은 구현 이연, (b)의미적 owner-uniqueness는 **원리적 결정불가**(validate가 의미 drift 못 잡음). → 완전성 = 미구현 강제 + 사람/LLM 리뷰 잔여에 묶임. **이게 재리뷰마다 결함이 나온 근본 이유.**
> v17은 3자+자체 독립리뷰가 찾은 **설계 결함을 닫음**(구현 이연 아님): ①**derives 규칙 정정** — `invariants`는 derives 없음(심볼 국소 항상성, brief goal에 1:1 안 매임). 스키마 `SpecInvariant`(id/statement/always_holds, derives 필드 부재)와 §3 필드표가 derives 규칙과 어긋났던 **자기모순 해소**: `pre/post→goal`, `failures→S-F`, **inv는 derives 없음**. ②**cross-process 제거를 §10에 명문화**(현 코드 enum 잔존=0/56 미사용 → Phase 1에서 제거, MSA 게이트 시 재확장). ③**`note?` 필드 스키마 추가를 §10 Phase 2.2에 명시**(relationship enum 격상이 free-text 정보를 잃으므로 note?로 보존 — 현 `DomainCrossDependency`={domain, relationship}만). ④**§10 사실 정정** — `normalizeBrief`는 실제 3함수(Body/Design/Compatibility), **`update.ts:60`은 하드코딩 required-list 문자열이라 typecheck가 못 잡음**(리스크 ② 자기모순 해소), DI-001이 14 brief에 중복 → spec id 재명명 시 brief-key 접두 유일화, parent cycle은 `query.ts:121`. ⑤**cross_domain 규모 수치 통일** — 실측 **6 도메인 / 13 엣지 / 6-of-7**으로 §4·§10 정정(기존 "14엣지"·"9카드"는 오류, §8/§9 "6/7"은 정확). ⑥**§10 좌표 정밀화** — `src/ops/update.ts:57`(required-list, 함수 51-67)·`src/ops/query.ts:121`·`src/ops/sync/sync-in.ts:137`·`searchable-text.ts:54-57+62-63`(주장은 v16부터 참, 좌표만 정정).
> v16는 그동안 채팅에만 있던 것을 문서에 반영: **§10 구현 로드맵 신설**(Phase 1~4 + 3단 불변식 + 코드결합 4곳 + 리스크), **§9에 연결성 갭 추가**(`context`/`relations`가 trace 엣지 surface — 소스 없이 연결 이해의 핵심), **§9 머리에 "현 실재 = v15 미반영(구현 0)" 갭 명시**. 사용성 평가(실카드 체험) 결과 반영.
> v15는 **glossary 운용 흐름 확정**(2자, Codex+general 코드기반+실측): ①정확사용=field↔yaml 정합+코드심볼 advisory suggest(**본문 출현 강제 lint는 NG-002+drift 260회 noise로 비실용** — 제 이전 "출현 lint 정공법" 정정), 의미정확=사람/LLM. ②추가=outline→4기준→define. ③**카드↔용어 관계=word-set 양방향 조회로 충분, traverse 엣지=과설계**(relation BFS 섞으면 false 의존경로); graphify는 derive. rename body=수동+affectedCardKeys(자동치환=trust 위반 reject).
> v14는 **glossary 오버레이 확정**: 노드 아닌 어휘 오버레이. yaml=정의 단일 SoT/카드 필드=참조만. 기준 ③ "load-bearing 용어" 약화. unused→warning 분리.
> v13는 **전체 통합 재검증**(3자) 결과: 모델 본질 결함 0(5노드 정체성 정합·누적결정 충돌 없음·추적사슬 설계상 닫힘). 정정 — 문서 §6.5 흐름이 *미구현 impact 순회*를 "확정 현행"처럼 서술한 톤 결함을 "설계 확정 / impact 구현 미결"로 분리, §2 다이어그램 폐기된 `calls` 잔재 제거.
> v12는 **spec 노드 확정**(3자): per-symbol 행동계약. pre/post/inv/failures 4 req(total 함수 null-failure 명시), state_transitions opt. **failures에 id+derives(→S-F) 추가** = brief negative flow↔spec.failures 추적 구멍 메움(케이스 분담 trace 완성). invariants cross-process 제거. derives 타입 규칙(pre/post→goal, failures→flow; **inv 없음** — v17 정정). 재귀=코드 포함관계만. brief 케이스표 edge=pre+failures로 정정. section-aware derives 검증 등 §9 구현 이연.
> v11: v10 재검증 결함 4건 정정(failure/exception 이중투영, 횡단여정 비표현, criteria/post/inv 경계, facet 용어).
> v10: vision→brief 흐름 시뮬레이션 4 시나리오 닫힘 확인 + 작성 경계 규칙. 모델 골격 변경 없음 — 전부 작성 가이드/확장 후보.
>
> v9: brief = **기능 단위 명세**(기획 아님), 필드 10→6req+3opt, 케이스 5종 계층 분담. v8: principle verify.class + 흐름(기존 SoT 순회).
>
> v8: principle 강제(verify.class) + end-to-end 흐름(전부 기존 SoT 순회, 새 저장 0).
>
> v7: domain 골격 확정(root/재귀없음, scope 산문, relationship enum, area 폐기, 코어 5). v6: vision 골격(4필드 필수+목적 가이드). 표기: **[현존]** 현 스키마, **[신규]** 변경 필요, **[신규-derived]** 도출(저장X), **[신규·미결노드]** 대상 노드가 §9 미결.

---

## 1. 핵심 원칙

1. **카드 = 그 자체로 완전한 지식 그래프.** 시각화(graphify류)는 이 그래프의 *뷰*일 뿐, 구조의 근거가 아니다. 따라서 프로젝트 최상위 맥락(vision)도 그래프 안에 있어야 한다 — 카드 밖 config로 빼면 "소스 없이 카드만으로 직관 이해" 목적이 깨진다. *(단 이 맥락을 별도 `vision` 노드로 둘지 vs root domain summary로 도출할지는 §9.1 긴장 노트 — 미해소.)*
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
        SPEC    [현존]  ◄── conflicts-with (n:n, 검증전용) ──► SPEC   [신규] (calls 제거 — code_link 흡수)
          │ ── invokes (n:n, 횡단 per-call 의존) ──► SPEC     [v18] (steps[] 거부 대체)
          │ derives (pre/post→brief#G, n:1) · case-of (failure→brief#S-F, 전mode) · shape-ref (post→SHP)  [v18 case-of/shape-ref]
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
| **brief** [현존] | **기능 단위 명세**(구현 독립·검증가능): 문제·범위·시나리오·정책·합격·근거. *기획서가 아니라 명세서* — 아래. | 필드 축소(design→approach, compatibility 제거) — 아래 |
| **spec** [현존] | **per-symbol** 행동 계약(pre/post/invariant/failures + **shapes[]·invokes[]** [v18]). 코드 결합(@spec). (brief=기능단위 명세, spec=심볼단위 명세) | failures에 **id+case_of** 추가, **shapes[]/invokes[] 신규**[v18], cross-process 제거 — 아래 |
| **principle** [현존] | 횡단 규범 (검증가능 MUST/SHALL 문장). | |

#### glossary — 어휘 오버레이 (노드 아님)

> **정체성:** glossary는 **노드가 아니라 코어 5노드 본문을 가로지르는 어휘 오버레이**다. 결정적 근거: derive되는 코드도, 규율하는 대상도 없고(domain=경계/principle=규범과 달리 glossary는 *명명*), 본질적으로 flat·횡단이라 4-tier 계층에 안 속한다. graph에서 노드도 엣지도 아닌 *노드를 가로지르는 용어 attribute*(노드화하면 모든 사용처로 fan-out 엣지 폭증).

- **owner/SoT (한-owner 정합):** `glossary.yaml`{word→definition} = **정의 단일 SoT**. 카드 `glossary: string[]` = **참조(word only)만** — 정의를 복제하지 않으므로 drift 없음. `ed glossary`가 관리.
- **추가 기준 4 (③ 약화):** ①프로젝트 고유 의미 ②cross-cutting(≥2 카드 — 1 카드면 그 본문에서 정의, 오버레이 불요) ③**설계상 load-bearing 용어**(~~설계 결정 인코딩~~ — "그래서 어때야 한다"는 규범은 principle, glossary는 "이 단어가 가리키는 것"까지만; 정의에 enforcement 서술 금지 = domain/principle 침범 차단) ④단일 코드심볼 X(단일 심볼이면 그 JSDoc이 SoT).
- **검증:** `glossary-broken`(참조 단어가 yaml에 부재=dangling) = **error**(exit 게이트). `glossary-unused`(yaml 정의됐으나 참조 0) — *현행 코드는 둘 다 exit2 게이트*, 설계상 **unused→warning 분리 권장**(백필 "정의 먼저, 참조 나중" 보호)(§9). **본문 free-text 스캔은 비-목표(NG-002)** — 의미 정확은 코드가 검증 안 함(definition 산문 미파싱), 사람/LLM 영역.
- (사용자 프로젝트에 `glossary.md` 카드가 `type:domain`으로 있을 수 있으나, 그건 모델 차원 타입이 아니라 한 도메인 카드.)

**운용 흐름 (정확 사용 / 추가 / 관계):**
- **정확 사용** = `field↔yaml 정합`(검증가능, 오타·dead-ref 차단) + **코드심볼 한정 advisory suggest**(현 `buildGlossaryMatcher`, suggestCardScope). **본문 출현 강제 lint는 안 함**(NG-002 + `drift` 본문 260회 등 noise 폭탄으로 비실용). 구조적 최대치=*어휘 정합+인지*, *의미 정확*은 사람/LLM(작성 시 definition in-band 노출로 확률↑).
- **새 용어 추가** = outline 확정 → 4기준 게이트 → `ed glossary define` → 영향 카드 field 갱신. (cross-cutting 기준이 카드 존재를 전제 → "용어 먼저" 불가, *outline 먼저·용어/카드 동시*.)
- **카드↔용어 관계** = **word-set 양방향 조회로 충분**(카드→word=`glossaryJson`, word→카드=`findCardsByGlossaryWord`). **별도 traverse 엣지 추가 = 과설계** — 카드↔카드 relation BFS에 용어 노드 섞으면 "카드A→용어X→X쓰는 카드B"가 *false 의존경로*(어휘 인접≠derive 의존). graphify "용어↔카드" 뷰는 엣지 없이 derive, impact는 1-hop flat 조회(용어는 용어로 전파 안 됨).
- **rename body 갭** = frontmatter `glossary` 필드는 자동 갱신, **본문 산문은 수동**(POST-001 명문 — 자동치환은 opaque mutation=trust-breaking이라 reject). `affectedCardKeys`로 "본문 검토 권장" surface. (본문 stale은 NG-002라 silent — 설계상 수용.)

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

#### brief — 기능 단위 명세 (정체성·필드·케이스 분담)

> **brief = "기획서"가 아니라 "기능 단위 명세서".** "구현 모르고 검증 가능"은 *명세*(인수테스트)의 속성이다 — brief를 기획이라 부르면 자기모순. brief가 flow/criteria/policy를 담는 결정적 근거: **flow/criteria는 per-symbol(spec)보다 크고 goal(의도)보다 작은 "기능 단위 검증 계약" = 추적 허브**. `goals → flow → {policy, criteria}` + `flow ← spec.derives` cross-ref 사슬이 *한 카드에서 닫힌다*. 옮기면 goal↔spec 추적이 끊김. 4-tier 중 이 단위를 담는 계층은 brief 하나뿐.

**필드 (현행 10 → 6 required + 3 optional, HOW는 spec에 반환):**

| 필드 | 상태 | 목적 |
|---|---|---|
| `context{problem}` | req | 왜 이 기능이 필요한가(동기). `impact`는 opt |
| `scope{goals, non_goals}` | req | 무엇을/경계. `assumptions`는 opt |
| `flow[]` | req | given/when/then 검증가능 시나리오, covers:goals (명세 핵심) |
| `policy[]` | req(국소규칙 시) | 기능 국소 규칙, governs:flow (principle=횡단과 분리) |
| `criteria[]` | req | 합격기준, verifies:flow |
| `rationale` | req | 대안(≥1, 의미기반)·선택·근거, addresses:limits\|assumptions |
| `approach` | opt | 개념 설계(산문) — 구 `design`을 축소 |
| `limits[]` / `external[]` | opt | 한계 / 진짜 외부참조만 |

**제거:** `compatibility`(행동계약=spec 소관, 의례적), `design.components/data_flow/invariants`(설계는 spec/구현; `invariants`→spec.invariants 이동). **케이스/기준은 한 카드에만 정의, 나머지는 derives/verifies 참조(복제=drift).**

**5W1H · 케이스 5종 계층 배치:**

| 케이스 | 정의 위치 | 관점 |
|---|---|---|
| happy | `brief.flow` kind:happy | 사용자: 정상 |
| negative | `brief.flow` kind:failure | 사용자: 거부 |
| edge/boundary | `spec.preconditions`(경계 전제) + `spec.failures`(경계 위반 동작) | 계약: 경계값+위반 |
| exception | `spec.failures`{id,violation,behavior,case_of?} (비경계 throw) | 계약: throw |
| completion | `spec.postconditions`(MUST) + `brief.criteria`(합격선) | 계약+기획 **계층**(trace 연결, 복제 금지) |

> edge·exception 둘 다 `spec.failures`를 쓰므로 구분: **edge=경계 전제(preconditions) 위반 시 동작, exception=비경계 throw/에러**. negative flow(brief `S-F`) ↔ `spec.failures`는 **`failures[].case_of`로 trace**(전 mode, [v18] — 구 `derives` 명칭 개명; 추적 구멍 메움). **추적 타깃 타입 규칙**: `preconditions/postconditions.derives → goal(G-ID)`, `failures.case_of → failure flow(S-F)`. **`invariants`는 derives 없음** — 심볼 국소 항상성(per-call/cross-call)이라 단일 brief goal에 1:1 안 매임(스키마 `SpecInvariant`도 derives 미보유; goal 추적은 그 심볼의 pre/post가 담당). (현 validator는 flat id-set이라 종류 미구분 → section-aware 검증은 §9 구현.)

> 5W1H: Who/When/Where=`flow.given`+`spec.preconditions`, What=`flow.when/then`, Why=`context.problem`+`rationale`, How=개념 `approach`/계약 `spec.postconditions`. Where는 source `@spec`이 SoT(위치 필드 없음). `flow.kind`는 **happy|failure 2종 유지** — 5종 확장은 spec.preconditions/failures와 본문 중복(drift 제도화). edge/exception은 spec 소관(brief는 "구현 모르고 검증 가능"이라 계약 디테일 못 담음).

**작성 경계 규칙 (시나리오 시뮬레이션이 드러낸 모호점 — `ed card guide`로 in-band 노출):**
- **failure(brief.flow) vs exception(spec.failures) — 배타 아니라 이중 투영:** *사용자/업무가 보는 결과 경로*(거부·실패 상태)=`brief.flow` kind:failure. *내부 복구·재시도·트랜잭션 보상*=`spec.failures`{violation,behavior}. **공존 처리:** 타임아웃·재고소진처럼 한 사건이 사용자 거부 + 내부 보상을 *동시* 유발하면 → 사용자 경로는 `brief.flow`(failure), 보상 동작은 `spec.failures`에 **각각 정의 + trace 연결**(어느 한쪽에 몰아넣지 않음). 한 사건의 두 계층 효과는 둘 다 기재.
- **criteria(brief) vs postcondition vs invariant(spec):** criteria=*관찰 가능한 합격 검증문*(외부 테스트). postcondition=*완료(호출 종료) 시점에 성립하는 상태*(per-call MUST). invariant=*호출 내내/교차 지속 성립*(`always_holds`). completion이 criteria+postcondition 둘 다 등장 시 같은 goal/flow **trace 연결**, 문장 복제 금지(복제=drift 신호).
- **횡단 사용자 여정**(FE/BE 걸침, 예 "체크아웃 플로우"): 각 domain의 brief로 분해(각 brief는 자기 domain 조각만, 단일 parent). **brief↔brief 엣지 없음** — `invokes`는 domain↔domain 전용이라 brief 연결에 쓰지 말 것. **end-to-end 여정 합성은 카드 노드로 두지 않음(의도적 비표현)**: 실제 여정은 코드의 실제 호출이 `code_link`(@spec) 그래프로 만나는 지점에서 impact 분석으로 재현. 여정 *방향*은 vision, 경계 의존은 domain의 `cross_domain_dependencies`(invokes)가 담당. (emberdeck은 기능 단위 SSOT지 여정 시뮬레이터가 아님.)
- **호환성 보존 요구의 행방**(compatibility 제거 후): 행동계약 호환=`spec`(postcondition/invariant), 정책 호환·deprecation·migration 결정=`principle`(횡단 규범, applies_to로 영향 범위), 깨질 수 있는 전제=`brief.scope.assumptions`/`limits`. brief에 compatibility 필드 부활 안 함.

#### spec — per-symbol 행동계약 (역할·필드·재귀)

> **spec = 부모 brief의 goal을 *하나의 코드 심볼 집합*(같은 `@spec` 결합 셋)의 행동계약으로 번역하는 노드.** 소스 `@spec` 어노테이션으로만 코드와 결합(유일). WHAT(행동 보장) 표현, HOW(구현) 금지. brief.flow 서사를 반복하지 않음(derives로 참조).

| 필드 | 상태 | 비고 |
|---|---|---|
| preconditions[]{id, condition, derives→G} | req ≥1 | 호출 전제(positive) |
| postconditions[]{id, guarantee, keyword:MUST\|SHALL, derives→G, **references?:SHP-id**} | req ≥1 | 완료 시점 보장. 형태는 산문 복제 X, `references`로 shapes 가리킴 |
| invariants[]{id, statement, always_holds:**per-call\|cross-call**} | req ≥1 | 구간적 항상성(post로 환원 불가). **cross-process 제거**(0/56+미구현) |
| failures[]{**id:FAIL-NNN, violation, behavior**(free-prose), **case_of?→S-F**(전 mode), **owner?\|references?**} | req ≥1 | 에러 완전목록. **behavior=free-prose 유지**(닫힌 mode enum 거부 — idempotent-noop/silent-swallow 강제오분류). `case_of`=전 failure가 brief#S-F 추적(reject 한정 해제). `owner`/`references`=cross-domain 거부 double-home dedup [v18] |
| **shapes[]{id:SHP(덱-전역), role:output\|error-output, when?, schema:단일 fenced block}** | **req≥0 [v18]** | IO/에러 **형태 계약**(필드명/타입/exit). spec 단일 owner지만 **SHP id=덱-전역 레지스트리 key**(owner-uniqueness 강제 가능); 공유형태는 한 owner + 타 spec이 `references`로 참조. schema=단일 블록 고정(무한깊이 트리 금지) |
| state_transitions[]{from,trigger,to} | **opt 유지** | 현 0/56(single-process라 FSM 부재), stateful 도메인용 비용0 |

- **required 근거**: spec 될 자격(cross-file invariant)인 심볼은 pre/post/inv/failures 4관점이 의미. **단 total(순수) 함수는 `failures: [{violation: "없음", behavior: "입력 타입 외 실패 경로 없음"}]` 명시적 null-failure 기재**(허위 강제 방지). `shapes`는 IO/에러 형태가 있을 때만(순수 내부 계산은 0).
- **derives/추적 타입 규칙**: pre/post→`goal(G-ID)`, failures→`failure flow(S-F)`(`case_of`, 전 mode). **invariants는 derives 없음**(심볼 국소 항상성, goal 1:1 부적합 — 스키마도 미보유). (현 validator flat-set → section-aware 검증 §9.)
- **형태(shapes) vs 행동(post) 경계**: *필드명/타입/exit*=`shapes`, *그 형태가 언제 성립하나*=`postconditions`(references로 연결). card-get POST-001의 산문 보장에 임베드된 ```jsonc``` 펜스(형태)를 shapes로 분리·흡수(산문 보장은 post에 남고 references로 연결).
- **`invokes[]{to:spec-key, kind:per-call\|setup, note?}` [v18]**: spec-level **횡단 의존** 엣지(§4). 한 spec이 호출/의존하는 타 도메인 spec을 navigable하게 declare. 예: runner-and-output `invokes ensureCardsSynced(card-storage, setup)`; createCard `invokes {validate(card-model, per-call), persist(card-storage, per-call)}`(**changelog 아님** — createCard는 changelog 미호출, changelog는 updateCard·card-storage 소관). 순서있는 여정 노드(`steps[]`)는 **거부**(과설계 — §9.1).
- **재귀(parent=spec)**: **코드 symbol 포함관계**(orchestrator→step, public→helper) 표현 시만. 기획 분해 금지. 현 0/56. *validate가 판정 못 함 → 작성 가이드.*
- **cross-process 재도입**: MSA/분산 게이트 충족 시 always_holds enum 비파괴 재확장(영구 배제 아님).

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
| `derives` | spec.pre/post → brief#G | n:1 | 추적(메타, 엣지 아님) | spec 항목 namespace | [현존] |
| `case-of` | spec.failure → brief#S-F | n:1 | 추적(전 mode) | spec.failures 항목 | [v18] |
| `invokes` | spec → spec(횡단) | n:n | 횡단 per-call 의존 | `spec.invokes{to,kind,note?}`(caller 단일 저장) | [v18] (steps[] 거부 대체) |
| `shape-ref` | spec.post → SHP | n:1 | 형태 참조 | `references:SHP-id`(SHP=덱-전역) | [v18] |
| `depends-on` | domain → domain | n:n | 추적(거친) | `cross_domain_dependencies{domain, relationship, note?}` (depender 단일 저장, **impact가 namespace 직접 순회**) | [현존, relationship enum화=신규] |
| `conflicts-with` | spec → spec | n:n | 정합성 검사(변경전파 아님) | `relations` | [신규-검증전용] |
| `references` | model → model | n:n | 데이터 관계(FK/composition) | model | [신규·미결노드] |
| `emits` / `consumes` | spec → event-contract | n:n | 추적 | spec | [신규·미결노드] |
| `deployed_in` | domain → service | n:n | 배포 | domain | [신규·미결노드] |
| `code_link` | spec → symbol | n:n | 코드 다리 | **@spec 어노테이션(source SoT), 카드 저장 X** | [현존-derived] |
| glossary ref | 노드 → term | n:n | 오버레이 | `glossary` 필드 | [현존] |

> `derives`는 검증 메타(spec namespace 잔류, 그래프 엣지 아님 — 카드 연결은 parent로 닫힘). broken-derives 무결성 검사로 dangling 방지.
> `calls`(호출) 엣지 **제거** — code_link + gildash import graph가 spec간 호출 영향을 이미 흡수(카드 엣지로 두면 코드 호출관계와 이중 SoT). `conflicts-with`(배타)만 보존 — import 관계가 아니라 흡수 불가, 단 변경전파가 아닌 validate 정합성 검사.
> **[신규·미결노드]** 엣지(references/emits/consumes/deployed_in)는 대상 노드(model/event-contract/service)가 §9 미결이므로 **엣지도 미결** — 노드 도입 결정 시 owner·타깃·방향·검증을 함께 확정. 표에 형태만 예시.
> `parent`에 model은 미포함 — model은 도입 시 `domain→model`(optional) 추가 예정(§9).
> **`invokes`(spec) vs `depends-on`(domain) 경계** [v18]: 둘 다 횡단 의존이나 입도가 다르다 — `depends-on`은 *도메인↔도메인 거친 지도*, `invokes`는 *spec→spec per-call 결합*(예 runner→card-storage `ensureCardsSynced`가 산문 invariant에만 갇혀 relations/context에 안 보이던 것을 navigable화). 같은 사실을 둘 다 적으면 이중 owner이므로 **rollup 규칙**: spec.invokes가 있으면 domain.depends-on은 그 집계(derived 가능)로 보고 수동 중복 금지. *순서있는 여정 노드 `steps[]`는 거부* — 저장소에 순서 cross-domain 여정 0건이고 createCard는 한 spec 내 fan-out 합성이라 선형체인이 미스핏(§9.1).
> **`relationship` enum 격상**: 현행 free-text(기계검증 불가, 코드정합성 결함)를 `invokes`|`consumes` 2값 enum + optional `note?`로. 판별 기준: *호출 계약*이 바뀌면 깨짐=`invokes`(reads/validates/serializes 흡수), *데이터 형태*가 바뀌면 깨짐=`consumes`(persists/writes 흡수). **실카드 13엣지(6 도메인) → 2축 분류, 모호 케이스는 `note?`로 원문 보존**(2값이 깨끗이 안 갈리는 엣지가 있을 수 있어 enum이 의미를 잃지 않게 note?가 fallback). DDD pattern(shared-kernel 등)은 실사용 0이라 미도입(YAGNI).
> **graph root ≠ parent-tree root.** vision은 *graph root*(scopes로 모든 domain을 맥락화)이고, domain은 여전히 *parent-tree root*(parent 없음). scopes는 추적 엣지라 domain의 parent를 만들지 않으므로 4-tier 트리는 불변(5-tier 아님).

---

## 5. principle 강제 메커니즘 (verify.class)

**역할:** principle = 횡단 규범의 **단일 owner**. `statement`는 *의도(산문 MUST/SHALL)*로 두고, **principle이 자신의 검증 방식을 `verify.class`로 선언**한다 — "무엇이 위반인가"를 산문 statement가 아니라 verify.class가 정의한다(이것이 §9의 principle-violation 알고리즘을 닫는다). 강제 = **class × enforcement**, 단 검증 가능한 경계 내에서만. "산문이라 강제 불가"는 거짓 — machine-check 가능한 형태로 설계하고, 진짜 불가능한 것만 사람에게 남긴다.

| verify.class | 검증 대상 | `blocking`이 막는 것 |
|---|---|---|
| **structural** | 카드그래프 **폐쇄 술어 9종**(shape/required/enum/ref-existence/ref-direction/owner-uniqueness/glob-match/governed_by-consistency/forbidden-edge). 임의 DSL 금지 | 구조 술어 실패. 단 deterministic + **explainable**(실패 위치/기대값) + payload 인자 evaluable일 때만 |
| **binding** | `@principle <key>` 어노테이션 evidence present/missing (`@spec`-family, 이미 추적됨) | **증거 누락만**(내용 옳음은 사람 — false compliance 인정) |
| **metric** | `PrincipleMetric` budget 선언 | (measurement feed 구현 후) threshold 초과. **feed 전엔 blocking 금지** |
| **prose** | 사람 리뷰 체크리스트 | **blocking 금지**(schema error) |

**거버넌스 관계 (전부 기존 SoT 순회, 저장 0):**
- `governs` owner = `principle.applies_to`(glob) **한 곳**. `governed_by`는 *저장 안 함* — validate/impact가 `matchesAnyGlob`로 **lazy 도출**(§8 흐름).
- `applies_to` `*` 금지 → 실제 카드키/glob (변별 가능해야 도출 의미 있음). [데이터 수정]

**무결성 규칙 (패배주의·과기계화 양쪽 차단):**
- `prose`/`metric(feed 전)` + `enforcement:blocking` = **schema error**(거짓 강제 금지).
- **class별 payload validation**: structural=폐쇄술어만, binding=tracked annotation만, metric=comparator+측정근거 필수.
- **structural은 스키마가 이미 강제하는 술어 선언 금지**(이중소유 = drift 재생산). 경계 3분: ①타입 고정→타입 스키마, ②전역 무조건→공통 스키마, ③**applies_to 동적 횡단→principle**.
- **코드그래프 레이어링(import 방향 금지)은 structural 밖** — gildash 코드그래프 영역(현 scope-out). ref-direction은 카드그래프 전용.

> vision은 principle이 아니므로 이 규칙·`*` 금지와 무관. binding principle은 활성화가드 @spec coverage와 present-검증 중복 금지(메타 검증).

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

## 6.5 흐름 — 작성·변경 순회 (모델 레이어)

> **표기 주의 — 설계 확정 / 구현 미결 구분:** 아래 흐름은 *목표 설계*다(새 저장/스키마 0, 모든 엣지가 기존 단일 SoT 순회). **현행 `impact`는 `card_relation`(=`relations` 필드)만 순회하고 parent·cross_domain_dependencies는 안 탄다** — 즉 "전부 기존 SoT 순회"는 §9 impact BFS 재구현으로 달성할 타깃이지 현행 동작이 아니다. 아래 표의 "순회하는 SoT"는 *어느 SoT를 순회해야 하는가*(설계)를 뜻한다.

노드를 잇는 end-to-end 흐름. **설계 핵심: 새 저장/스키마 0 — 모든 엣지가 *기존 단일 SoT*를 순회**(캐시 없음 = drift 표면 0).

```
작성 (위→아래, 하위가 상위 참조, 한 계층씩 — 점프 구조 강제):
  vision ─scope─▶ domain ─parent─▶ brief ─parent─▶ spec ─@spec─▶ code
                    ◀─depends-on─▶ domain      principle ─governance(glob)─▶ 횡단

변경 전파 (아래→위 + 횡단):
  code → @spec(code_link) → spec → (parent⁻¹) brief → (parent⁻¹) domain
                                       ├─ depends-on⁻¹ → 타 domain
                                       ├─ scope⁻¹ → vision
                                       └─ governance(lazy) → principle 재검증
       (spec 레벨 횡단) spec ─ invokes⁻¹ → 이 spec을 호출하는 타 spec(per-call) 재검증   [v18]
```

| 엣지 | 순회하는 SoT (기존) | 새 저장 |
|---|---|---|
| parent | `card.parent` 컬럼 (impact BFS가 직접 walk) | 0 |
| binding | `code_link`(@spec) — impact 진입점 | 0 |
| depends-on | domain namespace `cross_domain_dependencies` (impact 직접 순회) | 0 |
| invokes [v18] | spec namespace `spec.invokes{to}` (spec→spec per-call, impact 직접 순회) | 0 |
| scope | vision 1장 → 모든 domain (lazy 도출) | 0 |
| governance | `principle.applies_to` glob (lazy 도출) | 0 |

- **점프 금지**(구조 강제): vision→spec, brief→vision 직접, principle→code 직접 — 엣지 부재로 표현 불가.
- **calls/conflicts/derives는 (변경전파) 엣지 아님**: 호출(coarse)=code_link 흡수, 배타=conflicts-with 검증전용, goal추적=derives 메타. **단 [v18] `invokes`(spec→spec per-call 의존)는 변경전파 엣지로 순회**(code_link import로 안 잡히는 per-call 결합 — calls 일반론과 구별), `case-of`(failure→S-F)·`shape-ref`(post→SHP)는 추적 메타(전파 아님, navigable surface 대상).
- **`card_relation.type` 스키마 변경 불요** — dependency를 캐시하지 않고 namespace 직접 순회하므로(이전 캐시안은 stale drift 재현이라 폐기).

> **impact BFS 순회 알고리즘은 카드 모델이 아니라 구현 스펙(§9 이연):** phase 조합(상향 code→spec→brief→domain → 도달 domain의 횡단 depends-on → 후처리 governance), depth 회계, affected-set 결과 구조(linkType enum: direct/transitive/parent/scope/governance + invokes/case-of/shape-ref [v18]), write-free validate. 이는 `impact`/`check` spec 카드의 구현 설계.

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
| vision 코어 노드 추가 *(코어성 §9.1 미결)* | 0 (없으면 미생성, optional) | 신규 root 타입 등록 + vision 1장 작성 |
| **spec `shapes[]`·`invokes[]` 신규** [v18] | spec 56장(현 미보유) | optional 추가 → 형태/의존 백필 → strict. dual-read. SHP=덱-전역 레지스트리 |
| **spec `failures{id, case_of?, owner?, references?}`** [v18] | spec 56장(현 violation/behavior만) | id+case_of optional 추가 → 백필 → required(§10 Phase1.3). owner/references=cross-domain dedup |
| `relationship` enum 격상 | cross_domain_dependencies 보유 카드(현행 6/7) | free-text→`invokes`\|`consumes` 매핑 + `note?` 보존. dual-read |
| model/service/event-contract 노드 | 0 (현재/소규모는 미생성) | optional 타입 등록 |
| `governed_by` | 0 (derived, 저장 X) | validate 도출 로직만 |
| `applies_to` 실키화 | principle 4장만 | 데이터 수정(4장) |
| typed 엣지(calls/references/emits/…) | 0 (relations 확장, optional) | validator에 엣지 타입 추가 |

> **dry-run 선행 (write-free validate는 [신규] — 현재 미존재, 마이그레이션 전 구현 필요):** 현행 `ed validate`는 진입 시 자동 disk→index sync를 하여 DB write를 시도한다(진짜 read-only 환경에서 `SQLITE_READONLY`). 따라서 마이그레이션 게이트로 쓰려면 **sync를 건너뛰거나 DB를 read-only로 여는 write-free 검증 경로를 먼저 추가**해야 한다. 그 경로로 신규 optional 필드가 기존 카드를 invalid화하지 않음을 확정한 뒤 적용.
> closed-schema에 신규 optional 필드 추가 → validator 업데이트 → 기존 카드는 신규 필드 없이도 valid(dual-read). 단계적, 비파괴.

---

## 9. 확정 / 미결

### 9.1 핵심 결론 — `enforcement-bound` (3라운드 엄격 ground-truth 진단)

> **스키마 설계는 수렴했다. "에이전트가 카드만으로 프로젝트를 완벽 이해 / 카드가 무누락 코드 SSOT"는 스키마만으로 도달 불가능하다.** 엄격 진단 3라운드(실카드 전수 대조)의 **정성 추정**(측정 metric 아님 — 산출식·표본 없는 리뷰어 판단; `ed analyze` 의 coverageRatio=0.2046=125/611 같은 *실측*과 다른 축이니 혼동 금지): 카드-only 이해 "중간 정도"(횡단여정이 도메인-국소보다 현저히 낮음). 스키마 정정(invokes/case_of/shape-ref 추가)은 *표현 가능성*만 올렸고 **navigable surface는 실측상 미실현(전 카드 relations total:0) = 실효 lift ≈ 0**(구현 전제) — 이유는 **이중 천장**:
>
> 1. **구현 이연** — 강제 *가능한* 검사(엣지 타깃 존재: `invokes.to`/`shape-ref`/`derives` 대상)조차 안 만들어짐. 현 `ed validate`는 intra-card, `ed card relations/context`는 모든 카드 `total:0`(trace 엣지가 frontmatter 문자열로만 존재, surface 안 됨). → navigable 엣지를 *스키마로 선언*해도 validate/index를 **구현하기 전엔 0% lift**.
> 2. **원리적 결정불가** — cross-card 의미 계약 중복(같은 거부집합이 cli card-create + lifecycle create-card에 6복제; CardSummary×4·CardFrontmatter×6 산문복제; exit-map 삼중 owner)은 **어떤 validator도 기계적으로 못 잡음**(두 산문이 같은 계약인지 판정 불가 = `card-drift-root-cause`). → cross-card 계약 유일성은 **영구적 사람/LLM 리뷰 잔여**.
>
> **이것이 재리뷰마다 새 결함이 나온 근본 이유다** — 모델의 무드리프트/무누락 보장은 종이로 못 닫는다. 닫으려면 **(a) cross-card 강제를 *구현***하고 **(b) 의미 유일성은 사람이 검토**해야 한다.
>
> **강제가능 천장을 올리는 3 구조수정**(스키마 차원, [v18] 반영): ① SHP=**덱-전역 레지스트리 key**(owner-uniqueness에 강제가능 key 부여) ② `failures`에 `owner`/`references`(cross-domain 거부 double-home dedup) ③ invokes 예시 정정(changelog 제거). 그 이상의 실측 상승은 **enforcement 구현이 유일한 ceiling-raiser**(§10 Phase 3-3·4).
>
> **vision 긴장(미해소):** 4-철학 합성은 vision 노드를 *거부*(실카드 0장, scopes derived=정보0 추가, 프로젝트 한 줄은 root domain summary로 도출)했으나, 이는 **원칙1**("최상위 맥락도 그래프 안에")과 충돌하고 "root domain 7개 중 무엇이 대표인가" under-design 갭을 남긴다. → **미결**: vision을 코어 노드로 둘지(현 §2/§3 서술) vs 거부할지는 도출 계약(scopes materialization) 확정과 함께 결정.

**확정:**
- 코어 = **vision + domain/brief/spec/principle** (5) + glossary 오버레이. *(vision 코어성은 §9.1 긴장 노트 — 미해소.)*
- vision = **enforcement 없는 graph-root 노드**(principle 흡수 폐기). 필드 `summary`/`statement`/`rationale`/`success_direction` **전부 필수**, 각 필드는 목적 가이드로 정의(§3). 구조 검증(필드 비어있지 않음·vision ≤1장·`scopes`로 domain 연결)을 받도록 *설계* — 구현은 미결(아래).
- **domain = root only, 재귀 없음** (3자 6+라운드 confirm). `summary`/`overview`/`scope`(산문) 필수. **scope는 산문 유지** — IN/OUT 구조화 안 함(경계강제는 `@spec` 결합이 이미 SoT로 보유, 구조화=중복·drift 표면 확대). 분류는 `tags` 현행 유지.
- **brief = 기능 단위 명세**(기획 아님 — §3). 필드 6 req + 3 opt(design→approach 축소, compatibility·design.components/data_flow 제거, invariants→spec). flow.kind happy|failure 2종 유지. 케이스 5종 계층 분담(happy/negative=brief.flow, edge/exception=spec, completion=criteria+postcondition trace). 케이스·기준은 한 카드 정의+참조(복제 금지).
- **spec = per-symbol 행동계약**(§3 spec 블록). pre/post/inv/failures 4 req(total 함수는 null-failure 명시), state_transitions opt. **[v18] `shapes[]`(IO/에러 형태계약, SHP=덱-전역 key) + `invokes[]`(횡단 per-call 의존, steps[] 거부 대체) 추가.** failures behavior=free-prose 유지(닫힌 mode enum 거부), `case_of`=전 mode→S-F, `owner`/`references`=cross-domain double-home dedup. post `references→SHP`로 형태 참조(복제 금지). invariants cross-process 제거(per-call|cross-call). 추적 규칙(pre/post→G, failures.case_of→S-F; **inv는 추적 없음** — 심볼 국소 항상성, 스키마 미보유). 재귀=코드 포함관계만. flow 서사 반복 금지.
- **area/group/facet 폐기** — 도메인 묶음/분류 의미가 scope·cross_domain_dependencies·principle.applies_to·tags에 완전 흡수(§3 거부표). 미정의 노드를 검증 시스템에 두는 것은 자기모순. 수요 실증 + tags 부족 시에만 typed facet 재론.
- **cross_domain_dependencies** = `{domain, relationship, note?}`, depender 단일 저장. `relationship`을 **`invokes`|`consumes` enum 격상**(§4) — free-text는 코드정합성 결함.
- vision→domain `scopes` = derived(저장 X, 고립 방지) — 도출 계약은 미결(아래).
- **principle = 횡단 규범 단일 owner** (§5). statement=의도(산문) + **`verify.class`(structural 폐쇄술어9종/binding/metric/prose)로 검증방식 선언** → "무엇이 위반인가"를 verify.class가 정의(principle-violation 알고리즘 닫힘). 강제=class×enforcement. governs owner=applies_to 단일, governed_by=lazy 도출. 무결성(prose/metric+blocking 금지, 폐쇄술어, 스키마중복 금지).
- **흐름 *설계* 확정**(§6.5): 모든 엣지가 기존 단일 SoT 순회(새 저장/스키마 0). 엣지 parent(card.parent)/binding(code_link)/depends-on(namespace 직접)/scope·governance(lazy). calls 제거, conflicts-with 검증전용, derives 메타. `card_relation.type` 불요. **단 impact BFS *구현*은 미결** — 현행은 `card_relation`(relations 필드)만 순회, parent·cross_domain 미순회 → 설계대로 재구현 필요(아래).
- code-binding/drift 현행 보존(코어 spec). 확장 노드 결합은 노드 도입 시.
- 비파괴 점진 마이그레이션. design/story/actor/epic/area/calls 거부.
- **glossary = 어휘 오버레이**(노드 아님 — §3). yaml=정의 단일 SoT, 카드 필드=참조만(drift 없음). 기준 4(③ "load-bearing 용어"로 약화). 운용: 정확사용=field↔yaml 정합+코드심볼 suggest(본문 강제 안 함, NG-002), 추가=outline→4기준→define, **관계=word-set 양방향 조회로 충분(traverse 엣지=과설계, false 의존)**, rename body=수동+affectedCardKeys surface. glossary-broken=error/unused→warning 분리(§9).

**미결 (다음 설계/구현 단계 — 본질적 순서 의존):**

> **현 실재 상태 = v15 미반영(구현 0).** 실카드/코드는 이 설계 이전 상태다: vision 0장, brief 구 스키마(`design`/`compatibility` 잔존), spec `failures`에 id/case_of 0(+shapes/invokes 0), principle `verify.class` 0 + `applies_to:['*']`, `relationship` free-text. **아래 미결 = 이 갭을 닫는 작업이고, §10 로드맵이 그 순서다.**

- **vision 타입을 스키마 SoT에 등록** (`SKILL.md <card_fields>` + `src/card/types.ts` 의 CardType 에 `vision` 추가; 현재 4타입만 존재) + **구조 검증 구현**(4필드 비어있지 않음·vision ≤1장·scopes 연결).
- **필드 목적 가이드의 단일 정의 + `ed card guide <type>`(read-only) 노출** + validate 에러가 필드 목적 인용 (in-band 작성 가이드 — vision부터, 이후 전 타입). MCP wrap은 모델·가이드 안정 후 **별도 표면 트랙**(스키마 reload 마찰 때문에 지금은 CLI).
- **가상(derived) 엣지 materialization 계약**: `scopes`·`governed_by` 를 *누가/어떤 API·인덱스로* 도출해 그래프 traverse를 보장하는가 (저장 안 하므로 도출 주체·포맷·validate 증명 방식 정의 필요).
- **principle verify.class 구현**: structural 폐쇄술어 9종 평가 엔진(케이스별 cross-ref 패턴, DSL 금지), binding coverage(@principle), metric measurement feed(가장 비싼 미실현 — feed 전 metric blocking 금지), class별 payload validation + 무결성 메타 검증.
- **impact BFS 순회 알고리즘**(§6.5 이연 — `impact`/`check` spec 구현): phase 조합(상향→횡단→후처리), depth 회계, affected-set 결과구조(linkType enum direct/transitive/parent/scope/governance + invokes/case-of/shape-ref [v18]), governance 후처리 frontier.
- 확장 노드(model/service/event-contract)는 **방향만 확정(도입 후보)** — 각 **필수 필드 스키마**, 그에 의존하는 엣지(references/emits/consumes/deployed_in)·코드결합, `domain→model` parent는 도입 결정 시 함께 확정.
- **typed facet 확장 후보**(게이트=FE/BE 모노레포): 시나리오 시뮬레이션(모노레포)이 레이어 직교성 수요를 실증 — `domain.layer` 같은 검증가능 enum tag-축(현 자유 tags는 오타 무검증). **주의: 이건 §3에서 폐기한 facet *노드*가 아니라 domain의 *필드/enum 축***(노드≠필드, 원칙5 — 폐기된 건 노드, 이건 필드). 코어 변경 불요(흐름은 invokes로 이미 닫힘), 수요 실증된 프로젝트에서만 도입.
- **`relationship` enum 격상 구현**(`cross_domain_dependencies.relationship`: free-text → `invokes`|`consumes` + `note?`; validator + 현행 6/7 카드 마이그레이션 매핑).
- **write-free `ed validate` 경로** (마이그레이션 dry-run + lazy 도출 게이트 전제 — 현재 모든 명령이 진입 시 sync로 write 시도; 미구현 시 CLI 출력을 게이트로 못 씀).
- parent cycle 거부(현 seen-set silent-stop → 명시 거부), conflicts-with 정합성 검증, broken-derives 검증.
- **section-aware 추적 검증**(현 flat `collectBriefRefIds` → pre/post.derives는 goal-id set, failures.case_of는 flow-id set 분리 대조) + **check-impact가 failures.case_of 신설 엣지 순회**(negative flow 변경→failures 영향 전파) + spec 재귀 "코드 포함관계" 약식 검사(gildash: child @spec 심볼 ⊆ parent callee/member) 후보.
- **glossary 검증 정정**: `glossary-unused`를 exit 게이트(현 byCode 합산→exit2)에서 **warning으로 분리**(백필 워크플로 보호); `glossary-broken`은 error 유지. **본문 free-text 스캔 lint는 도입 안 함**(NG-002 비-목표 + `drift` 260회류 noise로 비실용) — matcher는 현행대로 코드심볼 한정 advisory suggest. rename 후 본문 stale 용어는 `affectedCardKeys` surface로 가시화(자동치환 금지=trust).
- **[연결성·핵심] `ed card context`/`relations`가 trace 엣지를 surface**: 현재 두 명령은 `parent`와 무타입 `relations` 필드만 보여주고, `derives`·**`invokes`·`case-of`·`shape-ref`[v18]**·`cross_domain_dependencies`·`scopes`·`governed_by`는 **카드 body 문자열로만** 존재해 읽는 에이전트가 연결을 못 따라간다(`create-card` context = upstream/downstream 빈 배열, 전 카드 `relations` total:0). → body의 trace를 **navigable edge로 surface**(impact BFS 재구현과 같은 그래프 기반). **이게 "소스 없이 카드만으로 연결 이해"라는 emberdeck 목적의 핵심 갭** — impact(영향분석)와 별개로 *읽기/탐색* 경로. *(§10 Phase 3-3의 surface set·BFS·linkType enum이 이 목록 전부를 포함해야 함.)*

---

## 10. 구현 로드맵 (§9 갭을 닫는 순서)

> **[v18] 천장-raiser 명시:** §9.1대로 스키마 정정은 실측 lift ≈0%p다. **실제 완전성을 올리는 것은 Phase 3-3(trace 엣지 navigable surface)와 cross-card 강제 validate 구현** — 그 전엔 invokes/shape-ref/case_of가 선언만 되고 안 보인다. 단, 의미적 owner-uniqueness는 구현해도 결정불가라 **사람/LLM 리뷰가 영구 잔여**(§9.1). 새 [v18] 작업: `shapes[]` 스키마 + 덱-전역 SHP 레지스트리 + `failures.owner/references` + `invokes[]` 엣지·타깃검증.

**불변식**: 데이터 변경 step = `스키마(optional) → 데이터 → strict 승격` 3단, **각 step 종료 시 `ed validate` exit0**(HC-4). 데이터 마이그레이션은 원자 커밋 + 변환 전 git 태그(롤백=revert만). 코드결합은 대부분 구현 시 typecheck가 잡지만(키 제거 시 컴파일러가 잔여 *타입* 참조를 잡음), **`src/ops/update.ts:57`(`assertCompleteNamespace`의 required-list, 함수 51-67)의 하드코딩 required-key 문자열 배열은 런타임 문자열이라 typecheck 사각 — 수동 동기화 필수**(누락 시 strict 승격 후 정상 brief가 invalid).

**Phase 1 — 기반 (validate 안전화 + 저위험)**
1. `write-free validate` — **DB read-only open**(sync-skip 아님, stale 회피). **`runner.ts:66` + `validate.ts:100` 두 sync 사이트 모두**. 후속 마이그레이션 dry-run·게이트의 전제.
2. `glossary-unused` → warning 분리(byCode 합산 제외; `glossary-broken`은 error 유지). 비파괴.
3. `spec.failures{id, case_of?}` optional 추가 → 56 spec 백필 → required 승격. (case_of=§3 schema 명칭; 구 `derives` 아님)
4. parent cycle 거부(`src/ops/sync/sync-in.ts:137`은 cycle을 'parent 없음'으로 *오분류* → 명시 거부 + `src/ops/query.ts:121` getCardContext seen-set silent-stop → surface) + broken-derives.
5. `spec.invariants.always_holds`에서 **`cross-process` 제거**(현 0/56 사용 → 비파괴 enum 협소화; `types.ts:243` + `serialize.ts:457 VALID_ALWAYS_HOLDS`). MSA/분산 게이트 충족 시 비파괴 재확장.

**Phase 2 — 추적 정합 (lossy 원자 묶음)**
1. **brief 필드 정정**(`design→approach` + `compatibility` 제거 한 묶음): 선행 `#DI-` derives 측정(=0 확정). 코드결합 **6 사이트 / 4 파일 동시**(`serialize.ts`의 `normalizeBriefBody`+`normalizeBriefDesign`(276)+`normalizeBriefCompatibility`(340) **3함수** + `searchable-text.ts:54-57`(design)+`:62-63`(compatibility) + `src/spec/validate-refs.ts collectBriefRefIds` + `src/ops/update.ts:57 assertCompleteNamespace`(하드코딩 required-list=typecheck 사각, 수동)). ① 결합부 optional-guard + approach 추가(dual-read) → ② 14카드 원자 변환(design.invariants 35개→spec.invariants, **각 항목 `always_holds` 부여 + `DI-`→spec id 재명명 — DI-001이 14 brief에 중복이므로 brief-key 접두로 유일화**; compatibility 제거; spec derives 재작성 0) + section-aware derives 동시 → ③ design+compatibility 키 제거(3 normalizer 함수 삭제 포함) + strict.
2. `relationship` enum: **`note?` 필드 스키마 추가**(현 `DomainCrossDependency`={domain, relationship}만 — enum 격상 시 free-text를 note?로 보존) → `*`warning validator → **6 도메인 13엣지 매핑**(free-text→`invokes`\|`consumes`, 원문은 note?로) → error.
3. conflicts-with 검증.

**Phase 3 — 흐름 엔진**
1. vision 타입 등록 + 구조검증 + `scopes` lazy 도출 함수(materialization 계약).
2. `applies_to` 실키화: `'*'` deprecated-warning validator → 4장 실키화 → `'*'` error + 타입에서 `'*'` 제거.
3. **`context`/`relations` trace surface**(§9 연결성 — `linkType` enum을 direct/transitive/parent/scope/governance + **[v18] invokes/case-of/shape-ref**로 확장 = `RelationGraphNode`/affected-set 타입 변경) + impact BFS 재구현(parent+cross_domain+scope+governance + **invokes(spec→spec per-call)**, golden snapshot + **context/relations 출력 회귀** + gildash 보존, 순회≠강제 명문화). **invokes/case-of/shape-ref가 이 enum·BFS·surface set에 반드시 포함돼야** §머리·§9.1이 약속한 "invokes navigable화"가 실제 닫힌다(누락 시 자기모순).

**Phase 4 — 강제·확장 (게이트 충족 시만)**
1. `@principle` 코드 어노테이션 심기(현 0개 — binding principle 전제).
2. verify.class 엔진(structural 폐쇄9종/binding/metric/prose + 무결성).
3. model/service/domain.layer — **MSA/모노레포 게이트 실증 시만**(설계 §9 "도입 후보").

**리스크 ranked**: ①brief lossy 변환(14카드+35DI 원자, DI 중복 유일화) ②**`src/ops/update.ts:57` 하드코딩 required-list 누락**(typecheck 사각 — 빠뜨리면 strict 승격 후 정상 brief가 invalid) ③write-free 2-사이트 ④impact BFS 회귀(golden) ⑤relationship/applies_to enum 매핑.

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
- v8: principle 강제(verify.class — statement는 산문이라 강제불가가 아니라 검증방식을 class로 선언; structural 폐쇄술어/binding/metric/prose, class×enforcement, 무결성 규칙) + 흐름/엣지 레이어(전부 기존 SoT 순회, 새 저장 0, calls 제거·conflicts 검증전용·dependency namespace 직접). impact BFS 순회는 구현 이연.
