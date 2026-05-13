---
name: emberdeck
description: 4-tier 카드(principle/domain/brief/spec)와 glossary 가 프로젝트 그 자체이자 SSOT(single source of truth). 프로젝트의 모든 설계 지식 — 원칙·정책, 영역 경계, 의도·시나리오, 코드 contract·invariant, 가정·한계·rationale, 용어·정의·개념 — 을 표현하고 코드는 이로부터 derive 된다. 프로젝트의 어떤 부분에든 영향을 주거나 그것을 참조하는 모든 작업에 사용한다.
---

<rules>
1. 코드 수정 **전** 관련 카드 읽기. 수정 **후** `ed validate links` 실행.
2. 카드 생성/갱신 **전** `<card_analysis>` 템플릿 사용자 확인.
3. 모든 카드 생성/갱신 전 `<self_review>` 통과.
4. `glossary.yaml` 에 항목 ≥1 시 신규 카드의 `glossary` 필드 필수 (주요 토픽만).
5. 4-tier strict: `principle`/`domain` (root) / `brief` (parent=domain) / `spec` (parent=brief|spec). brief 재귀 금지, spec 재귀 허용.
6. single-file 테스트: 한 소스 파일만 읽고 발견 가능 → 카드 X. 여러 파일 invariant → 반드시 카드. 단일 파일만 있는 production 모듈은 onboarding step 11 의 ignorePatterns 에 명시 추가 (rule 6 우선).
7. `--patch` 는 namespace 전체 교체 (merge X). 누락 필수 필드 시 `VALIDATION_ERROR`. 부분 업데이트가 필요하면 카드 파일 직접 편집 후 `ed bulk sync`.
8. **source ↔ card binding 은 source 가 SoT.** spec 카드의 source 결합은 코드의 `/** @spec card-key */` JSDoc 어노테이션으로만 표현. 카드는 codeLinks/boundary 필드를 갖지 않으며, `ed spec sync` 가 어노테이션을 스캔해 DB code_link 테이블을 채운다.
</rules>

<route>
첫 매치 행 따름.

| 신호 | 워크플로 |
|------|----------|
| `.emberdeck/` 없음 또는 카드 0 | onboarding |
| 카드 ≥1 + `glossary.yaml` 비어있음 | glossary-backfill |
| 코드 변경 (production 소스) | feature |
| 코드 변경 없음 (deps/CI/lint/docs) | 카드 워크플로 스킵 |
| 수정 의도 없음 | 카드 읽기만 |
</route>

<workflow name="onboarding">
1. `ed analyze` → 현 상태. `ed spec sync` → 소스 `@spec` 어노테이션 → DB code_link 재구성 (멱등).
2. 소스 우선순위 순 읽기: 진입점 → 코어 도메인 → 인프라 → 테스트. 모노레포에서 sample/example/fixture 후순위. 컨텍스트 한도까지. `ed analyze` 의 `unlinked_symbols` 가 우선순위 신호. 각 파일 single-file 테스트 적용. cross-module 만 카드화 후보로 수집.
3. cross-module 발견을 사용자에게 audit 으로 보여줌. 각 발견의 도메인 분류.
4. domain outline 사용자 확인 (key, summary, scope IN/OUT).
5. 각 domain 아래 brief outline (key, parent, summary, 주요 토픽).
6. glossary 제안 (`<glossary_proposal>` 템플릿) → 확인 → `ed glossary define`.
7. domain 카드 생성 (`type: domain`).
8. brief 카드 생성 (`type: brief`, `parent: <domain>`, brief namespace).
9. spec 카드 생성 (`type: spec`, `parent: <brief|spec>`, spec namespace). 소스 결합은 카드 작성 후 소스에 `/** @spec <card-key> */` JSDoc 직접 추가.
10. 카드 일괄 검토:
    - 각 domain ≥1 brief 자식
    - 각 brief 의 Scope "Covers" 무관 항목 ≥3 → sibling brief 분리
    - production 파일 함수 중 `@spec` 어노테이션 미커버 시 추가 검토
    - glossary 용어와 brief 토픽 양방향 정합
11. GATE: `ed validate cards` (warnings 0)
12. GATE: `ed check coverage --uncovered`. 카드에 binding 안 된 symbol 발견 시 소스에 `@spec` 추가 또는 명시적 ignorePatterns 갱신.
13. `ed spec sync` → 소스 어노테이션 → DB code_link 동기화. GATE: `ed validate links` (broken 0).
</workflow>

<workflow name="glossary-backfill">
1. `ed glossary lookup` → 비어있음 확인
2. 카드 본문/요약 읽고 4 기준 충족 용어 추출
3. `<glossary_proposal>` → 확인 → `ed glossary define`
4. 각 카드 갱신: `ed card update KEY --glossary <단어>`
5. GATE: `ed validate cards` (glossary-broken 0)
</workflow>

<workflow name="feature">
1. `ed check impact <changed-files>` → risk_level
   - critical: 중단, 사용자 확인
   - high: 영향 카드 보여주고 확인
   - medium/low: 진행
2. 영향 카드 `ed card get`. 직접: 본문, transitive: summary.
3. 카드 없는 영역: 도메인 식별 → brief 생성 → spec 생성. 각 카드 전 `<card_analysis>` + `<self_review>`. spec 작성 후 소스에 `/** @spec <key> */` 추가.
4. 카드 제약 안에서 코드 작성.
5. 새 도메인 개념: `<glossary_proposal>` → `ed glossary define` → 영향 카드 `--glossary` 갱신.
6. 기존 spec 스코프 확장 시: spec 본문/glossary 갱신 + `<self_review>` + 소스 `@spec` 어노테이션 추가.
7. `ed spec sync` → 어노테이션 → DB code_link 동기화.
8. GATE: `ed validate links` (broken 0)
</workflow>

<glossary_rules>
glossary 추가 기준 — 4 모두 충족 시:
1. 프로젝트 고유 의미 (사전 의미만으로 추론 불가)
2. Cross-cutting (≥2 카드 또는 영역)
3. 설계 결정 인코딩
4. 단일 코드 심볼 X (단일 클래스/함수에서 유추 불가)

카드 `glossary` 필드: 그 카드의 주요 토픽만. 본문 단어 색인 X. 같은 용어 여러 카드 선언 OK.
</glossary_rules>

<commands>

| 명령 | 시점 | 사용자 확인 |
|------|------|------------|
| `ed glossary define WORD=DEF [--from f.yaml]` | 새 도메인 개념. 1회 ≤50개. all-or-nothing. | 예 |
| `ed glossary lookup [WORD]` | 조회 | X |
| `ed glossary remove WORD --yes` | 제거. 참조 카드 drifted. | 예 |
| `ed glossary rename OLD NEW [--def TEXT]` | 리네임. glossary + 카드 glossary 필드 자동. | 예 |
| `ed reset --yes` | 파괴적: 모든 카드 + glossary 삭제 | 예 |
| `ed card create KEY --type T --summary S [--parent P] [--from f.yaml] [--glossary W]` | 생성 | 예 |
| `ed card update KEY [--field name=value] [--patch f.yaml] [--body f.md] [--glossary W]` | 수정. 스칼라(summary/status/parent/type)는 `--field`. namespace 는 `--patch`. | 예 (자명한 변경 외) |
| `ed card get KEY [--history]` | 조회 | X |
| `ed card delete KEY [--force] --yes` | 파괴적. `--force`: 자식 cascade + cross_domain_dep 자동 제거. | 예 |
| `ed card rename OLD NEW` | FK CASCADE + 파일 이동 + 본문/cross_domain_dep 재작성 | 예 |
| `ed card export KEY [--out FILE\|--in-place]` | DB→파일/STDOUT 렌더 | X |
| `ed card set-status KEY {draft\|active\|drifted\|retired} [--reason TEXT]` | active 시 activation guard | 예 |
| `ed card list [--type T] [--status S] [--parent P] [--tag T] [--symbol N] [--file F] [--glossary W]` | `--symbol`/`--glossary` 는 `--tag` 와 상호배타 | X |
| `ed card search "<query>"` | FTS5. 잘못된 쿼리 → `FTS_SYNTAX_ERROR` (exit 2) | X |
| `ed card tree KEY [--depth N]` | parent-child 계층 | X |
| `ed card context KEY [--depth N]` | relations + parent BFS | X |
| `ed card relations KEY` | 직접 forward+reverse | X |
| `ed validate cards` | 정합성 (계층/orphan/glossary/chain 등). partial → exit 2 | X |
| `ed validate links [KEY]` | DB code_link resolve 검증 (소스 어노테이션 기반) | X |
| `ed validate` | cards + links 종합 | X |
| `ed check drift [KEY] [--max-depth N]` | broken_link / glossary_broken 검출. 읽기 전용 — status 는 변경하지 않음. 명시적 전이는 `ed card set-status <KEY> drifted`. | X |
| `ed check coverage <KEY>` 또는 `ed check coverage --uncovered\|--suggest` | KEY 위치인자 또는 모드 플래그 둘 중 하나 필수. `--uncovered` 는 카드 binding 안 된 symbol 전체 반환 | X |
| `ed check impact <files...> [--symbol N]` | 변경 전 영향 분석 | X |
| `ed check regression <files...>` | drifted 비율 vs threshold. fail 시 exit 2 | X |
| `ed check interactions <keys...>` | shared symbol/file/import + 충돌 | X |
| `ed spec sync` | 소스 `@spec` JSDoc 어노테이션 → DB code_link 재구성. 사실상 멱등. | X |
| `ed spec sync-symbols [--since TS]` | renamed/moved 심볼 적용 (DB code_link 갱신) | X |
| `ed bulk create --from FILE` | YAML/JSON 배열 일괄 생성. partial → exit 2 | 예 |
| `ed bulk sync [PATH]` | 카드 파일 → DB. partial → exit 2 | X |
| `ed analyze` | health/coverage/drift/glossary 종합 | X |

출력은 항상 JSON 봉투 `{schemaVersion, status, data, warnings, errors, error?}`. `--quiet` 만 stdout 을 결과 key 로 축약 (diagnostics → stderr).
exit: 0=ok, 1=generic, 2=validation/usage, 3=not_found, 4=conflict, 5=permission/IO, 6=config_missing, 7=transient, 130=SIGINT.

</commands>

<card_fields>

## principle (root, 코드 바인딩 X, status: draft|active|retired)

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `key` `type: principle` `status` `summary` | ✓ | |
| `principle.statement` | ✓ | MUST/SHALL/SHOULD/MAY 한 문장 |
| `principle.rationale` | ✓ | 배경 |
| `principle.applies_to` | ✓ | `"*"` 또는 카드 키/glob 배열 |
| `principle.enforcement` | ✓ | `blocking`\|`warning`\|`advisory` |
| `principle.metric` | | `[{name, threshold, unit, comparator, kind?: threshold\|budget, window_kind?, distributable?}]` |
| `principle.exemptions` | | `[{target, reason}]` |
| `principle.references` | | `[{title, url}]` |
| `parent` | ✗ | 금지 (root only) |

## domain (root, status: draft|active|retired)

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `key` `type: domain` `status` `summary` | ✓ | |
| `domain.overview` | ✓ | 비-empty 산문 |
| `domain.scope` | ✓ | 비-empty 산문, IN/OUT 명시 |
| `domain.cross_domain_dependencies` | | `[{domain: <다른-domain-키>, relationship}]`. 타깃 type 반드시 `domain` |
| `parent` | ✗ | 금지 |

## brief (parent=domain, status: draft|active|drifted|retired)

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `key` `type: brief` `parent` `status` `summary` | ✓ | parent 는 domain |
| `brief.context` | ✓ | `{problem, impact: [{statement, metric?}]}` |
| `brief.scope.goals` | ✓ | `[{id: G-001, statement}]`, ≥1, 모두 ≥1 flow 가 covers |
| `brief.scope.non_goals` | ✓ | `[{id: NG-001, statement}]` |
| `brief.scope.assumptions` | ✓ | `[{id: A-001, statement, verification?, reevaluate_when?}]` |
| `brief.flow` | ✓ | `[{id: S-H-01\|S-F-01, kind: happy\|failure, given, when, then, covers: [G-id]}]`, ≥1 happy + ≥1 failure |
| `brief.design` | ✓ | `{overview, components: [{name, responsibility, interacts_with: []}], data_flow: [{from, to, payload, trigger}], invariants: [{id: DI-001, statement}]}`. `interacts_with`/`data_flow` 는 빈 배열 OK |
| `brief.policy` | ✓ | `[{id: R-001, subject, keyword: MUST\|SHALL\|.., predicate, governs: [S-id]}]` |
| `brief.external` | ✓ | `[{id: C-001, statement, reference: {title, locator}}]` |
| `brief.compatibility` | ✓ | `{guarantees: [{subject, version_range, breaks_if}], migration_path?}`. `guarantees` 빈 배열 OK |
| `brief.limits` | ✓ | `[{id: KL-001, statement}]` |
| `brief.criteria` | ✓ | `[{id: SC-001, type, measure, verifies: [S-id]}]`. `measure` 는 type 별 다른 객체: `numeric` → `{predicate, value, comparator, unit, reference?}`, `binary` → `{predicate, method?, reference?}`, `verification` → `{method, reference, predicate?, unit?}`. 모두 flow 가 verifies |
| `brief.rationale` | ✓ | `{alternatives: [≥2개 {option, pros: [], cons: []}], chosen: {option, reasoning}, trade_off?, addresses: []}`. `addresses` 빈 배열이라도 키는 필수 |

cross-ref 자동 검증: `flow.covers→goals`, `policy.governs→flow`, `criteria.verifies→flow`, `rationale.addresses→external\|limits`. 모든 goal 은 flow 가 cover, 모든 flow 는 policy/criteria 양쪽에 매핑.

## spec (parent=brief|spec, status: draft|active|drifted|retired)

| 필드 | 필수 | 설명 |
|------|:---:|------|
| `key` `type: spec` `parent` `status` `summary` | ✓ | parent 는 brief\|spec |
| `spec.preconditions` | ✓ | `[{id: PRE-001, condition, derives: "brief-key#item-id"}]`, ≥1 |
| `spec.postconditions` | ✓ | `[{id: POST-001, guarantee, keyword: MUST\|SHALL, derives}]`, ≥1 |
| `spec.invariants` | ✓ | `[{id: INV-001, statement, always_holds: per-call\|cross-call\|cross-process}]`, ≥1 |
| `spec.failures` | ✓ | `[{violation, behavior}]`, ≥1 |
| `spec.state_transitions` | | `[{from, trigger, to}]` |
| `relations` | | brief 키 배열. parent 가 이미 brief 면 불필요 |

cross-ref 자동: 모든 `derives` 는 `"brief-key#item-id"` 형식 + 실제 brief 항목.

**소스 결합**: 카드 자체에는 codeLinks/boundary 필드가 없다. 결합 의도를 표현하려면 소스 코드에 `/** @spec <card-key> */` JSDoc 주석을 함수/클래스/변수 선언 바로 위에 둔다. `ed spec sync` 가 어노테이션을 스캔해 DB code_link 테이블을 채운다. 활성화 가드는 인덱스된 파일이 ≥1 일 때 해당 카드를 가리키는 `@spec` 어노테이션이 ≥1 존재하고 모두 resolve 함을 요구한다.

</card_fields>

<card_splitting>
**분리 트리거 (하나라도 true)**:
1. 변경 독립성: contract A 가 drift 해도 B valid
2. 다른 소스 파일에 결합 (`@spec` 어노테이션이 분리된 파일 셋에 위치)
3. summary 가 무관한 두 능력을 "and"

**합침 조건 (모두 true)**:
1. 같은 작업의 입력 케이스 차이만 (예: force=true vs force=false)
2. 같은 소스 결합 셋 공유
3. A drift → B 도 반드시 drift

**brief 분해 신호** (sibling brief 분리, 같은 domain 아래):
- 직접 자식 spec ≥4
- Scope "Covers" 무관 항목 ≥3
- 무관한 두 서브시스템에 걸침

**domain 분해 신호**:
- 직접 brief ≥6
- brief 들이 공유 glossary 용어 없음
- `cross_domain_dependencies` 양방향 동등
</card_splitting>

<self_review>
모든 카드 생성/갱신 전. 한 항목이라도 실패 → 수정.

**전체 공통**:
- single-file 테스트: 한 파일만 읽고 발견 가능? YES → 카드 X
- 본문에 구현 메커니즘명 X (WeakMap, FTS5, FK CASCADE, ON CONFLICT, WAL 등 금지). 행동 보장으로 재작성
- glossary 필드는 주요 토픽만

**domain**:
- overview/scope 비-empty 산문, 기능 나열 X
- scope OUT 명시
- cross_domain_dependencies 타깃은 type=domain
- 단일 기능 X (bounded context 인지)

**brief**:
- 모든 요구가 single-file 테스트 실패
- 성공 기준에 숫자 또는 zero-tolerance 임계값
- Given/When/Then 구현 모르고도 검증 가능
- parent=domain

**spec**:
- contract 가 WHAT (행동), HOW X
- failure 표가 모든 에러 타입 커버
- 분리 체크 (contract/file 단위)
- 카드 작성 직후 소스에 `@spec <key>` 어노테이션 ≥1 추가 (active 카드는 어노테이션 ≥1 필수)
- parent=brief|spec
</self_review>

<card_analysis>
카드 생성/갱신 전 사용자에게:

```
### Card analysis: {key}
- 타입: principle | domain | brief | spec
- 부모: {parent 키 또는 "root"}
- Glossary: [{주요 도메인 개념}]
- 보장: {이 카드가 보장하는 것}
- 제외: {의도적으로 스코프 밖}
- 위반 시: {구체적 결과}
```
</card_analysis>

<glossary_proposal>
`ed glossary define` 호출 전:

```
### Glossary 제안

| 용어 | 정의 | Evidence (≥1 파일 또는 카드) |
|------|------|------------------------------|
| ... | 한 줄 도메인 의미 | src/foo.ts:42 / brief 'order-payment' |
```
</glossary_proposal>

<error_recovery>

`ed validate cards` warnings:

| 타입 | 해결 |
|------|------|
| orphan-card | `ed card update KEY --field parent=<올바른>` |
| broken-parent | `ed card update KEY --field parent=<존재>` 또는 parent 생성 |
| type-hierarchy-violation | 4-tier 에 맞게 parent 재지정 |
| broken-relation | `ed card update KEY --patch` 로 dead reference 제거 |
| broken-cross-domain-dep | 타깃 domain 생성 또는 entry 제거 |
| glossary-broken | `ed glossary define` 또는 `--glossary <새 목록>` |
| broken-chain | spec 의 parent=brief 또는 relations=[brief-key] |
| empty-tree | 자식 카드 추가 또는 draft 강등 |
| stale-db-row | `ed bulk sync` 또는 `ed card delete KEY` |
| orphan-file | `ed bulk sync PATH` |
| key-mismatch | 파일 이름 변경 또는 frontmatter 갱신 |

`ed validate links` broken:
1. rename → `ed spec sync-symbols`
2. moved → 같은 명령
3. 어노테이션이 제거됨 → `ed spec sync` 로 DB 정리

`ed check drift` driftType 별:

| driftType | 해결 |
|-----------|------|
| broken_link | 소스의 `@spec` 어노테이션 위치 갱신 → `ed spec sync-symbols` 또는 `ed spec sync` |
| glossary_broken | `ed glossary define` 또는 `--glossary <새 목록>` |

envelope `warnings[]` 코드:

| code | 의미 | 해결 |
|------|------|------|
| `CARD_SYNC_FAILED` | 모든 명령 진입 직전 자동 file→DB sync 가 특정 파일을 처리 못 함 (parse error 등). 명령 자체는 진행, exit code 무영향. 같은 파일이 명령 errors[]에 `details.file_path` 로 보고되면 중복 방지 차원에서 표시되지 않음. | message 의 file_path 확인 → 해당 카드 파일 수정 또는 제거 → 다음 명령에서 자동 재시도 |

envelope `errors[]` 코드 (`ed validate` / `ed validate links` 한정):

| code | 의미 | 해결 |
|------|------|------|
| `VALIDATION_FAILED` | 한 카드의 link 검증 중 I/O / 파싱 에러 (주로 TOCTOU — auto-sync 직후 파일 권한 변경 또는 삭제). 다른 카드 검증은 정상 진행, exit 2 (partial). | `details.file_path` 확인 → 파일 권한 / 존재 복구 → 재실행 |

</error_recovery>

<response_shapes>

`ed check drift`:
```json
{"data":{
  "health":{"total":N,"active":N,"drifted":N,"draft":N},
  "cards":[{
    "key":"...",
    "driftType":"broken_link|glossary_broken",  // 조건부: drift 시
    "driftTypes":["...",...],                   // 조건부: 전체
    "brokenLinks":N,"totalLinks":N
  }]
}}
```

`ed check impact`:
```json
{"data":{
  "risk_level":"low|medium|high|critical",
  "affected_count":N,
  "affected_cards":[{"key":"...","linkType":"direct|transitive","affectedLinks":N,"linkStatus":{"valid":N,"broken":N}}],
  "new_uncovered_files":[...],
  "suggested_actions":[...],
  "max_fan_in":N           // 조건부: > 0
}}
```

`ed validate links`:
```json
{"data":{
  "declared":N,"resolved":N,"broken":N,"unresolved":N
}}
```

`ed card list`:
```json
{"data":{
  "items":[{"key":"...","type":"...","status":"...","summary":"...","parent":"..."|null}],
  "total":N,
  "page":{"limit":N,"offset":N,"has_more":bool}
}}
```

`ed check coverage <key>`:
```json
{"data":{
  "key":"...","total_symbols":N,"covered_symbols":N,"coverage_ratio":0~1|null,
  "uncovered":[{"file":"...","symbol":"...","kind":"..."}]
}}
```

`ed check coverage --suggest`:
```json
{"data":{
  "suggestions":[{"key":"...","type":"domain|spec","files":N,"symbols":N,"reason":"...","suggested_glossary":[]}],
  "total":N
}}
```

`ed analyze`:
```json
{"data":{
  "health":{"total":N,"active":N,"drifted":N,"draft":N,"brokenLinks":N,
    "codeStats":{"files":N,"symbols":N},          // 조건부: gildash 활성
    "codeCycles":{"count":N,"samples":[["a.ts","b.ts"]]}  // 조건부
  },
  "coverage":{"totalSymbols":N,"covered":N,"ratio": 0~1 | null},  // null = 인덱스 0
  "drifted":{"cards":[...],"total":N},
  "glossary":{"totalWords":N,"unusedWords":[...],"entries":[...]},
  "unlinked_symbols":[{"file":"...","symbol":"...","kind":"..."}]
}}
```

</response_shapes>

<monorepo>
gildash 발견한 모든 sub-project 자동 집계 (모든 gildash 쿼리에 라우팅 적용). `--project-root` 는 모노레포 루트 지정.
DB code_link `file` 은 모노레포 루트 기준 상대 경로 (예: `packages/common/...`).
파일/심볼 자동 dedup.
</monorepo>

<critical>
1. 코드 수정 전 카드 읽기. 수정 후 `ed validate links`. 항상.
2. 카드 생성/갱신 전 `<self_review>`. 예외 없음.
3. single-file 테스트.
4. 4-tier strict.
5. spec 카드의 source 결합은 카드 필드가 아니라 코드의 `@spec` JSDoc 어노테이션으로만 표현.
6. `ed` 직접 호출 — 서브에이전트 사용 시 카드 컨텍스트 손실.
</critical>
