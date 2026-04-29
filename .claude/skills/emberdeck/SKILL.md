---
name: emberdeck
description: Emberdeck `ed` CLI 로 코드베이스의 설계 지식을 관리한다. 사용자가 emberdeck 가 설정된 프로젝트에서 코드를 만들거나 변경/수정/리팩토링 요청할 때 트리거. "/emberdeck", spec, 설계 카드, 도메인, acceptance criteria 같은 단어가 나올 때도 트리거.
---

<rules>
<critical>
1. 코드를 수정하기 **전에** 관련 카드를 읽는다. 수정 후에는 반드시 `ed validate links` 실행. 예외 없음.
</critical>
2. 카드를 만들기 전 사용자에게 card-analysis 를 보여주고 확인 받는다.
3. brief 카드는 설계 문서다. `frontmatter.brief` 네임스페이스의 10개 필드(`context`, `scope`, `flow`, `design`, `policy`, `external`, `compatibility`, `limits`, `criteria`, `rationale`) 를 모두 채우고 cross-reference 까지 만족하도록 작성한다. 본문은 자유 산문(예시·부연 설명) 으로 사용한다 — 본문 섹션 강제는 없다. 검증은 카드 파싱 시점 + activation guard (`validateBriefRefs`) 가 자동.
   spec 카드는 코드에 묶인 검증 가능한 contract 를 담는다. 카드에는 **코드만 봐서는 알 수 없는 지식**만 넣는다 — 함수 시그니처, 파일 경로, 기술 스택 같은 항목은 카드에 들어가면 에이전트 성능을 떨어뜨린다.
4. 카드를 만들기 전에 glossary 를 정의한다. `glossary.yaml` 에 항목이 하나라도 있으면 새로 만드는 모든 카드는 비어있지 않은 `glossary` 필드(주요 토픽 나열)가 필요하다. 같은 용어를 여러 카드가 선언하는 것은 정상이다 — 같은 개념을 다른 관점에서 다루는 카드들은 모두 그 용어를 선언할 수 있다.
5. **4-tier 계층은 strict 하다**: `principle` (프로젝트 전반, 루트) / `domain` (bounded context, 루트) / `brief` (도메인 내부 설계 토픽, parent 는 반드시 domain) / `spec` (코드 contract, parent 는 brief 또는 spec). brief 재귀는 금지 — 비대해지면 같은 domain 아래 sibling brief 로 분리한다. spec 재귀는 허용 (sub-spec).
</rules>

<glossary_semantics>
프로젝트 glossary (`glossary.yaml`) 는 도메인 어휘의 단일 진실 공급원이다. 용어는 glossary 에 **한 번만 정의**되고, 카드들은 그 용어를 **참조**한다.

카드의 `glossary` 필드 = **토픽 스코프 선언**: "이 카드는 다음 도메인 개념들을 다룬다." 이건 본문 단어 색인이 아니다 (본문에 등장하는 모든 glossary 단어를 나열하는 게 아님). 소유권 표시도 아니다 ("이 카드가 이 개념의 권위" 가 아님).

카드의 glossary 필드는 그 카드가 다루는 **주요 토픽**만 나열해야 한다. 본문에서 잠깐 언급한 용어를 굳이 선언할 필요는 없다. 같은 용어를 여러 카드가 선언하는 것은 정상이다.

**glossary 에 새 용어를 추가하는 시점** (`ed glossary define` 호출 기준이며, 카드의 glossary 필드 작성 기준이 아니다):

다음 4가지가 모두 충족될 때만 glossary 에 추가한다:
1. **프로젝트 고유 의미** — 일반 사전에 없거나, 있더라도 사전 의미만으로는 추론 불가능한 프로젝트 고유 규칙/결정/제약을 가진다.
2. **Cross-cutting** — 2+ 카드 또는 설계 영역에 등장한다.
3. **결정을 담는다** — 어떤 설계 결정을 인코딩한다.
4. **코드 심볼이 아니다** — 단일 클래스/함수/타입 하나만 봐서는 이해할 수 없다.
</glossary_semantics>

<route_table>
신호 컬럼이 true 인 첫 번째 행을 매치하고 해당 워크플로를 따른다.

| # | 신호 | 워크플로 |
|---|------|----------|
| 1 | `.emberdeck/` 가 없거나 카드 0장 | onboarding |
| 2 | 카드는 있는데 `glossary.yaml` 가 없거나 항목 0개 | glossary-backfill |
| 3 | 코드 변경이 어떤 카드 스코프에 영향을 줌 | feature |
| 4 | 코드 변경이 모든 카드 스코프 밖에 있음 | feature (1단계에서 미커버 파일이 드러남) |
| 5 | 코드 변경 없음 (deps, CI, lint, docs) | 카드 워크플로 스킵 |
| 6 | 수정 의도 없음 | 컨텍스트 용도로만 카드 읽기 |
</route_table>

<workflows>

<workflow name="onboarding">
1. `ed analyze` — 현재 상태 파악. 그다음 `ed spec annotate` 로 reconcile (이전 세션의 orphan @spec 제거, 빠진 것 추가). 멱등.
2. **`src/` 아래 모든 소스 파일을 읽는다.** 샘플링 금지 — 전부. 각 파일에 대해 single-file 테스트 적용: "이 지식을 이 파일 하나만 읽고 발견할 수 있는가?" 만약 NO (여러 파일에 걸치거나 cross-module contract 를 인코딩) → 반드시 카드화한다. 수집할 항목:
   - Cross-module contract (2+ 파일에 걸쳐 강제되는 invariant)
   - 실패 처리 정책 (X 컴포넌트 실패 시 어떻게 — caller + callee 양쪽 관여)
   - 아키텍처 제약 (왜 이 접근이고 다른 게 아닌지 — 코드만 봐서는 안 보임)
   - 순서/우선순위 결정 (예: DB 먼저 then 파일, lock 순서, drift 우선순위)
   수집하지 말 것: 함수 시그니처, 타입 정의, 스키마 컬럼, 설정 값, 단일 파일 구현 디테일.
   **읽기 후 모든 `src/` 파일의 cross-module contract 를 리스트업해 사용자에게 audit 으로 보여준다.** 카드화할 contract 가 없는 파일은 그 이유를 명시한다.
3. **변경 독립성으로 카드 경계를 정한다.** 설계 결정 그룹마다: "결정 A 가 바뀌면 결정 B 도 반드시 바뀌어야 하는가?" 아니라면 → 별도 카드. `<card_splitting>` 의 분할 기준 적용.
4. **도메인 경계를 먼저 식별한다** (본문은 아직 X). domain 은 자기 자신의 관심사를 가진 bounded context. cross-module contract 들을 도메인별로 묶는다. 후보 `key`, 한 줄 `summary`, 짧은 overview/scope 만 초안. 도메인 outline 을 사용자에게 보여준다.
5. **각 도메인 아래의 brief 영역을 식별한다.** 도메인 안에서 독립적으로 설계 가능한 토픽마다: 후보 `key`, parent (도메인 키), 한 줄 `summary`, 주요 토픽 초안. outline 사용자 확인.
6. glossary 를 사용자에게 제안 (glossary-proposal 템플릿 — Evidence 컬럼 포함). 제안에는 반드시 (a) 5단계 brief 주요 토픽에서 도출한 용어, (b) 2단계에서 표면화된 cross-cutting 개념이 포함돼야 한다. 확인 받고 `ed glossary define WORD=정의 ...` (또는 `--from file.yaml`).
7. domain 카드 생성 (`type: domain`, `domain.overview` / `domain.scope` 채움). card-analysis 템플릿을 보여주고 `<self_review>` 통과.
8. brief 카드 생성 (`type: brief`, `parent: <도메인-키>`, 전체 brief namespace). `<self_review>` 통과.
9. spec 카드 생성 (`type: spec`, `parent: <brief-또는-spec-키>`, `spec` namespace, `codeLinks`, `relations`). `<self_review>` 통과.
10. **COLLECTION REVIEW** — 모든 카드 생성 후, 게이트 전:
    (a) **도메인 분해**: 각 도메인은 ≥1 brief 자식을 가져야 한다. brief 0개인 도메인은 sibling 으로 합쳐야 할 가능성.
    (b) **brief 분해**: 각 brief 의 Scope "Covers" 목록에 무관한 항목 3+ → sibling brief 로 분리 (같은 domain 아래). brief 재귀는 **금지**.
    (c) **함수 커버리지 체크**: 각 `src/` 파일의 export 함수 목록에서 어떤 spec 카드의 codeLinks 에도 안 들어간 함수에 대해: "이 함수가 caller 가정을 바꾸면 깨지는 cross-module 행동을 가지는가?" YES → 기존 spec 의 codeLinks 에 추가하거나 새 spec 카드 생성. 한 spec 이 한 파일을 커버한다고 그 파일의 모든 함수가 커버되는 건 아니다.
    (d) **glossary-brief 정합** (양방향):
        - Forward: 각 glossary 용어에 대해 그 개념을 주로 다루는 brief 가 ≥1 존재하는지 검증. 없으면 → brief 만들거나 glossary 수정.
        - Reverse: 각 brief 의 주요 토픽이 glossary 용어로 존재하는지 검증. 없으면 → 용어 정의 추가 또는 brief 스코프 재고.
    문제 발견 시 게이트 전에 수정.
11. GATE: `ed validate cards` — `glossary-broken`, `broken-chain`, `orphan-card` 경고 0개 통과. (orphan-card 는 root-level brief/spec 을 잡는다 → 올바른 parent 추가로 해결.)
12. GATE: `ed check coverage --uncovered` — `src/` 의 모든 파일이 어떤 spec 카드의 codeLinks 또는 boundary 에 ≥1 참조돼야 한다. 미커버 파일 있으면 spec 카드 추가.
13. `ed spec annotate` — 모든 codeLinks 에 대해 `@spec card-key` JSDoc 태그를 소스에 주입.
</workflow>

<workflow name="glossary-backfill">
1. `ed glossary lookup` — 비어있음을 확인.
2. 기존 카드 본문/요약 읽고 4가지 기준 충족 도메인 용어 추출.
3. glossary 사용자에게 제안 (Evidence 컬럼 포함). `ed glossary define WORD=DEF ...`.
4. 각 카드 갱신: `ed card update KEY --glossary <단어들>` (콤마 구분 또는 반복 플래그).
5. GATE: `ed validate cards` — `glossary-broken` 0개 통과.
</workflow>

<workflow name="feature">
1. `ed check impact <files...>` — 변경할 파일 인자로 호출. 응답에 risk level 별 affected 카드 포함.
   - critical risk: 중단, 사용자에게 영향도 보여주고 확인.
   - high risk: 영향 받는 카드 보여주고 확인.
   - medium/low risk: 진행.
2. 영향 받는 각 카드를 `ed card get KEY` 로 읽는다 — 이게 제약 조건.
   - 직접 영향 카드: 본문 전체 읽기. transitive 카드: summary 만.
3. 해당 영역에 카드가 없으면: 어느 기존 도메인에 속하는지 식별하거나 새 도메인 제안. 그다음 도메인 아래 brief 생성 (card-analysis, glossary 포함), 그다음 spec. 각 카드 생성 전 `<self_review>`.
4. 카드 제약 안에서 코드 작성.
5. 새 도메인 개념이 등장하면: glossary 사용자에게 제안 → `ed glossary define WORD=DEF` → 영향 받는 카드들의 glossary 필드 갱신 (`ed card update KEY --glossary <단어들>`).
6. 기존 spec 의 스코프를 확장하는 변경이면: spec 카드 본문과 glossary 필드 업데이트. 갱신 카드에 `<self_review>` 적용.
7. GATE: `ed validate links` — broken link 0개 통과.
8. `ed spec annotate` — 신규/변경 codeLinks 에 `@spec card-key` JSDoc 태그 주입.
</workflow>

</workflows>

<tool_protocol>

CLI 명령 — 시점과 사용법:

| 명령 | 시점 | 사용자 확인 필요 |
|------|------|-----------------|
| `ed glossary define WORD=DEF [--from file.yaml]` | 새 도메인 개념 또는 정의 갱신. 1회당 최대 50개 (`MAX_ENTRIES_PER_CALL`). all-or-nothing 검증. | 예 — glossary-proposal 먼저 보임 |
| `ed glossary lookup [WORD]` | 용어 의미 조회 또는 세션 시작 시 전체 목록 확인 | 아니오 |
| `ed glossary remove WORD --yes` | 도메인 개념 제거. 참조하는 카드들은 drifted 가 된다. TTY 에서는 프롬프트, non-TTY 는 `--yes` 필수. | 예 |
| `ed glossary rename OLD NEW [--def TEXT]` | 도메인 개념 리브랜딩. glossary + 모든 카드 glossary 필드 자동 갱신. 본문은 수동. 카드 파일 쓰기 일부 실패 시 status=`partial` 반환. | 예 |
| `ed card list --glossary WORD` | 어떤 카드들이 특정 glossary 단어를 선언하는지 찾기. 사용처 audit 또는 제거/리네임 영향 평가. | 아니오 |
| `ed reset --yes` | 파괴적. 모든 카드 (DB+파일) + glossary 삭제. 이후 `ed spec annotate` 로 소스의 orphan @spec 제거. TTY 프롬프트. | 예 |
| `ed card create KEY --type {principle\|domain\|brief\|spec} --summary S --parent P [--from f.yaml]` | 카드 생성. frontmatter+body 는 `--from`. | 예 |
| `ed card update KEY --field name=value [--patch f.yaml] [--body f.md] [--glossary 단어들]` | 카드 수정. 네임스페이스는 `--patch`, 스칼라 (summary/status/parent/type) 는 `--field`. | 예 (자명한 변경 외) |
| `ed card get KEY [--history]` | 파일에서 카드 읽기 (frontmatter + body, 옵션으로 changelog). | 아니오 |
| `ed card delete KEY [--force] --yes` | 파괴적. `--force` 는 자식까지 cascade (parent=null). TTY 프롬프트. | 예 |
| `ed card rename OLD NEW` | 카드 리네임. FK CASCADE + 파일 이동 + 본문 참조 재작성. 일부 참조 재작성 실패 시 status=`partial`. | 예 |
| `ed card export KEY [--out FILE\|--in-place]` | DB 의 카드 내용을 STDOUT (기본) / 파일 (`--out`) / 원본 위치 (`--in-place`) 로 렌더. | 아니오 (기본 read-only) |
| `ed card set-status KEY STATUS [--reason TEXT\|--reason-from FILE]` | status 변경 (draft/active/drifted/retired). `active` 시 activation guard 실행. | 예 |
| `ed card list [--type T] [--status S] [--parent P] [--tag T] [--symbol N] [--file F] [--glossary W] [--limit N --offset N]` | 리스트/필터. `--symbol`/`--glossary` 은 `--tag` 와 상호 배타. | 아니오 |
| `ed card search "<query>"` | FTS5 전문 검색 (key/summary/body/namespace). 잘못된 쿼리 시 `FTS_SYNTAX_ERROR` (exit 2). | 아니오 |
| `ed card tree KEY [--depth N]` | KEY 기점 parent-child 계층. | 아니오 |
| `ed card context KEY [--depth N]` | relations + parent BFS 순회. | 아니오 |
| `ed card relations KEY` | 단일 카드의 forward + reverse 직접 관계. | 아니오 |
| `ed validate cards` | 파일/DB 정합, 계층, broken-chain, orphan-card, type-hierarchy-violation, empty-tree 경고. partial → exit 2. | 아니오 |
| `ed validate links [KEY]` | 모든 codeLinks 가 gildash 통해 resolve 되는지. 카드 단위 또는 프로젝트 전체. | 아니오 |
| `ed validate` (인자 없음) | cards + links 종합. | 아니오 |
| `ed check drift [KEY] [--max-depth N] [--no-auto-transition]` | drift 탐지 (broken_link / boundary_inactive / symbol_changed / glossary_broken). 기본 active→drifted 자동 전이. | 예 (기본 status 변경) |
| `ed check coverage [KEY] [--uncovered\|--suggest]` | 카드별 커버리지 / 프로젝트 미커버 심볼 / 신규 카드 제안. | 아니오 |
| `ed check impact <files...> [--symbol names...]` | 변경 전 영향 분석 (direct/boundary/transitive). | 아니오 |
| `ed check regression <files...>` | 영향 받는 카드의 drifted 비율 vs threshold. fail 시 exit 2. | 아니오 |
| `ed check interactions <keys...>` | 카드들 간 shared symbol/file/import + 잠재 충돌. | 아니오 |
| `ed spec annotate [KEY]` | 소스의 `@spec` JSDoc 재구성 (멱등). | 예 |
| `ed spec sync` | 소스의 `@spec` 어노테이션에서 DB codeLinks 재구성. | 아니오 |
| `ed spec sync-symbols [--since TS]` | gildash 의 renamed/moved 심볼 적용. `--since` 는 ISO8601 또는 epoch ms; 기본은 마지막 sync 시간. | 아니오 |
| `ed bulk create --from FILE` | YAML/JSON 배열에서 일괄 생성. partial → exit 2 (CI 게이트). | 예 |
| `ed bulk sync [PATH]` | 카드 파일 (디렉토리 또는 단일 파일) → DB 동기화. partial → exit 2. | 아니오 |
| `ed analyze` | 프로젝트 전체 리포트 (health/coverage/drift/glossary). | 아니오 |

출력 모드 (모든 명령 공통):
- `--json` / `--quiet` / `--output={human,json,quiet}` — 명시 지정
- TTY 자동 기본값: stdin=TTY → human, pipe → json
- 모든 JSON 봉투: `{schemaVersion: {major, minor}, status, data, warnings, errors, error?}`
- exit code: 0=ok, 1=generic, 2=validation/usage, 3=not_found, 4=conflict, 5=permission/IO, 6=config_missing, 7=transient, 130=SIGINT

Glossary 리네임 시퀀스:
1. `ed glossary rename OLD NEW [--def TEXT]` — glossary.yaml + 모든 카드 `glossary` 필드 자동 재작성. 본문은 자동 X.
2. `ed card search "OLD"` — 본문에 옛 단어가 있는 카드 찾기.
3. `ed card update KEY --patch patch.yaml` — 영향 받는 카드별 본문 patch 적용.

카드 생성 시 항상 포함:
- `type`: principle / domain / brief / spec (4-tier strict)
- `glossary`: 이 카드가 다루는 주요 도메인 개념 (glossary.yaml 에 항목 있을 때 필수)
- `parent`: brief 는 도메인 카드, spec 은 brief 또는 spec 카드. principle 과 domain 은 root 전용 (parent 금지).
- `codeLinks`: spec 카드 필수 (≥1, active 면 모두 gildash 로 resolve 되어야 함)
- `relations`: spec 은 ≥1 brief 카드와 관계
- `boundary`: 이 카드가 책임지는 파일 glob 패턴 (spec 권장)

</tool_protocol>

<card_analysis_template>
모든 카드 생성 전 사용자에게 보여줄 것:

```
### Card analysis: {key}
- **타입**: principle | domain | brief | spec
- **부모**: {parent 키, 또는 principle/domain 의 경우 "root"}
- **Glossary**: [{이 카드가 다루는 주요 도메인 개념}]
- **반드시 보장**: {이 카드가 보장하는 것}
- **제외**: {의도적으로 스코프 밖인 것}
- **위반 시 깨지는 것**: {구체적 결과}
```
</card_analysis_template>

<glossary_proposal_template>
`ed glossary define` 호출 전 사용자에게 보여줄 것:

```
### Glossary 제안

| 용어 | 정의 | Evidence (≥1 파일 경로 또는 카드) |
|------|------|----------------------------------|
| ... | 한 줄 도메인 의미 | src/foo.ts:42 / brief 'order-payment' scope |
```
</glossary_proposal_template>

<error_recovery>
`ed validate cards` 가 경고를 낼 때:

| 경고 타입 | 원인 | 해결 |
|-----------|------|------|
| orphan-card | brief/spec 에 parent 없음 (4-tier 는 brief.parent=domain, spec.parent=brief\|spec 요구) | `ed card update KEY --field parent=<올바른-parent>` |
| broken-parent | parent 키가 존재하지 않음 | `ed card update KEY --field parent=<존재하는 키>` 또는 빠진 parent 생성 |
| type-hierarchy-violation | 자식 타입에 잘못된 parent 타입 | 4-tier 에 맞는 타입으로 parent 재지정 |
| broken-relation | relation 타깃이 존재하지 않음 | `ed card update KEY --patch patch.yaml` 로 dead reference 제거 |
| broken-cross-domain-dep | domain 의 `cross_domain_dependencies` 가 존재하지 않거나 type≠domain 인 카드를 가리킴 | 타깃 domain 카드 생성 또는 `ed card update KEY --patch patch.yaml` 로 entry 제거 |
| glossary-broken | 카드가 glossary.yaml 에 없는 단어를 선언함 | `ed glossary define` 로 재추가 또는 `ed card update KEY --glossary <새 목록>` 으로 제거 |
| broken-chain | spec 카드가 brief 까지 도달하는 relation/parent chain 이 없음 | parent=brief 또는 relations=[brief-key] 추가 |
| empty-tree | active brief 또는 domain 에 자식이 없음 | 자식 카드 추가 또는 draft 로 강등 |
| stale-db-row | DB row 의 파일이 사라짐 | `ed bulk sync` 로 정리 또는 `ed card delete KEY` |
| orphan-file | .card.md 파일에 해당하는 DB row 가 없음 | `ed bulk sync PATH` |
| key-mismatch | frontmatter.key ≠ 경로 도출 키 | 파일 이름 변경 또는 frontmatter 갱신 |

`ed validate links` 가 broken link 를 찾았을 때:
1. 심볼이 리네임됐는지 확인 → `ed spec sync-symbols`.
2. 심볼이 다른 파일로 이동했는지 → 같은 명령으로 처리.
3. 심볼이 의도적으로 제거됐다면 → 카드를 갱신하거나 삭제.

</error_recovery>

<card_types>

## principle — 프로젝트 전반 제약

principle 카드는 다음 질문에 답한다: **"여러 brief/domain 에 걸쳐 적용되는 규칙이 무엇인가?"**

여러 카드를 governs 하는 단일 프로젝트 전반 제약 (process / 품질 / 컴플라이언스 / 보안 / 아키텍처) 을 담는다. 코드 바인딩 없음. **항상 root-level (parent 없음)**. 여러 brief 가 본문 또는 `relations` 로 하나의 principle 을 참조할 수 있다.

### 필수 frontmatter 필드:

- `key` — 식별자 (예: `payment-idempotency`)
- `type: principle` — 고정
- `status` — `draft` / `active` / `retired` (`drifted` 는 없음 — codeLinks 가 없으니까)
- `summary` — 한 줄 요약
- `principle.statement` — 규칙 자체. MUST/SHALL/SHOULD/MAY 한 문장.
- `principle.rationale` — 왜 이 규칙이 존재하는지 (배경/동기)
- `principle.applies_to` — `"*"` (모든 카드) 또는 카드 키 / boundary glob 배열
- `principle.enforcement` — `blocking` (위반 거절) / `warning` (보고만) / `advisory` (정보)

### 선택 `principle` namespace 필드:

- `metric` — 정량 임계값 배열. `{name, threshold, unit, comparator, kind?: "threshold"|"budget", window_kind?, distributable?}`.
- `exemptions` — 명시적 예외 타깃. `{target, reason}` 배열.
- `references` — 외부 출처 (규정, 표준). `{title, url}` 배열.

### 본문

자유 형식 산문. 필수 섹션 없음. 검증은 namespace 레벨만.

### GOOD principle 예시:

```yaml
---
key: payment-idempotency
type: principle
status: active
summary: 모든 결제 mutation 은 idempotency_key 필요
principle:
  statement: 결제 mutation 작업은 클라이언트 제공 idempotency_key 를 받아야 하며 24시간 이내 동일 요청 재시도에 동일 결과를 반환해야 한다(MUST).
  rationale: 네트워크 재시도, timeout, 더블클릭은 중복 청구를 유발한다. 결제는 비가역이고 보정 비용이 크다.
  applies_to:
    - src/payment/**
    - src/billing/**
    - src/refund/**
  enforcement: blocking
  metric:
    - {name: duplicate_payment_rate, threshold: 0, unit: per_million_requests, comparator: "="}
  exemptions:
    - {target: src/payment/webhook-receiver.ts, reason: 외부 게이트웨이 콜백은 자체 idempotency 보유}
  references:
    - {title: Stripe API idempotency, url: https://stripe.com/docs/api/idempotent_requests}
---

본문 설명. 자유 산문.
```

### BAD principle 예시:

- ✗ 영역 한정 규칙: "Order checkout 은 inventory 검증해야 함" → brief.policy 에 들어가야지 principle 아님
- ✗ `applies_to` 또는 `enforcement` 누락
- ✗ RFC 2119 키워드 없는 `statement`
- ✗ 무관한 여러 규칙을 한 principle 에 (분리해야 함)
- ✗ `parent` 필드 존재 (principle 은 항상 root)

---

## domain — Bounded context 개관

domain 카드는 다음 질문에 답한다: **"이 bounded context 가 무엇이고, 무엇이 스코프 안이고, 어떤 의존을 가지는가?"**

domain 은 시스템의 최상위 영역이며 자기 관심사를 가진다. 가벼운 namespace — 본문 섹션 강제 없고 `overview` + `scope` + 선택적 `cross_domain_dependencies` 만. **항상 root-level (parent 없음)**. brief 카드들이 domain 아래 산다 (brief.parent=domain). 상세 설계는 brief 자식들에 둔다.

### 필수 frontmatter 필드:

- `key` — 식별자 (예: `payment`, `auth`, `inventory`)
- `type: domain` — 고정
- `status` — `draft` / `active` / `retired`
- `summary` — 한 줄 요약
- `domain.overview` — 이 domain 이 무엇이고 왜 존재하는지 (산문)
- `domain.scope` — 무엇이 스코프 안/밖인지 (산문; 명시적 경계)

### 선택 `domain` namespace 필드:

- `cross_domain_dependencies` — `{domain: <다른-domain-키>, relationship: <한 줄 설명>}` 배열. 타깃은 다른 domain 카드여야 함 (활성화 시 검증).

### 본문

자유 산문. 필수 섹션 없음.

### GOOD domain 예시:

```yaml
---
key: payment
type: domain
status: active
summary: 결제 처리 — authorize / capture / refund / 정산
domain:
  overview: |
    payment 도메인은 시스템의 모든 금전 거래를 다룬다: 카드 authorize, capture,
    환불, 백오피스 정산. payment_id 의 단독 소유자이며 멱등성이 강제되는 경계다
    (principle:payment-idempotency 참고).
  scope: |
    IN: PG 통합, 멱등성, 재시도 정책, 환불 흐름, 정산 reconciliation.
    OUT: cart 가격 산정 (→ checkout), 세금 계산 (→ tax), 사기 점수 (→ risk).
  cross_domain_dependencies:
    - {domain: checkout, relationship: authorize 시점에 확정된 cart total 수신}
    - {domain: risk, relationship: authorize 전 fraud score 조회; 고위험 차단}
---

선택적 산문 본문.
```

### BAD domain 예시:

- ✗ `parent` 존재 (domain 은 항상 root)
- ✗ `overview` 또는 `scope` 비어있음 — activation guard 가 거절
- ✗ `cross_domain_dependencies` 가 brief 또는 spec 을 가리킴 — 타깃은 반드시 `domain`
- ✗ `cross_domain_dependencies` 에 self-reference
- ✗ 단일 기능 스코프 (예: "신용카드 charge") — 그건 brief, domain 아님

---

## brief — Domain 내부의 설계 가능 영역

brief 카드는 다음 질문에 답한다: **"이 영역에서 무엇을, 왜, 어떤 제약 아래 만드는가?"**

구조화된 본문은 `frontmatter.brief` namespace 에 존재. 모든 섹션은 필수이고 parse 시점에 검증. 섹션 간 cross-reference 는 `validateBriefRefs` 가 검증. **`parent` 는 반드시 domain 카드** (brief 재귀는 금지 — 비대해지면 같은 domain 아래 sibling brief 로 분리).

### 필수 frontmatter 필드:

- `key` — 식별자
- `type: brief` — 고정
- `parent: <domain-키>` — 필수, domain 카드를 가리켜야 함
- `status` — `draft` / `active` / `drifted` / `retired`
- `summary` — 한 줄
- `brief: { ... }` — 전체 namespace

### `brief:` namespace 필수 구조:

| 섹션 | 내용 | 필수 ID |
|------|------|---------|
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

### Cross-reference (자동 검증):

- `flow[].covers` 는 존재하는 `scope.goals[].id` 를 가리켜야 함
- `policy[].governs` 는 존재하는 `flow[].id` 를 가리켜야 함
- `criteria[].verifies` 는 존재하는 `flow[].id` 를 가리켜야 함
- `rationale.addresses` 는 존재하는 `external[].id` 또는 `limits[].id` 를 가리켜야 함
- 모든 `goal` 은 ≥1 `flow` 에 의해 covers 돼야 함
- 모든 `flow` 는 ≥1 `policy` 에 governs 되고 ≥1 `criterion` 에 verifies 돼야 함

### 예시 (발췌):

```yaml
---
key: payment/order-payment
type: brief
parent: payment
status: active
summary: 카트 결제 → 주문 확정 흐름
brief:
  context:
    problem: 결제 도중 재고 경쟁/가격 변경으로 일관성 깨짐
    impact:
      - {statement: 미스픽 1건당 보정 비용 $12, metric: {value: 12, unit: USD}}
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

### BAD (흔한 실수):

- ✗ markdown 본문 섹션 (`## Motivation` 헤딩) — 구조화된 `brief` namespace 사용 必
- ✗ `flow[].covers: [G-999]` 처럼 존재하지 않는 ID 참조
- ✗ Goal 정의해놓고 어떤 flow 도 covers 안 함 (orphan goal)
- ✗ Flow 정의해놓고 governs/verifies 매핑 없음
- ✗ `alternatives` 1개만 (chosen + 비교 1개 = 최소 2개)
- ✗ `parent` 없음 또는 비-domain 카드 가리킴 → activation 거절
- ✗ `parent` 가 다른 brief (4-tier 는 brief 재귀 금지)

---

## spec — 코드에 묶인 행동 contract

spec 카드는 다음 질문에 답한다: **"바인딩된 코드가 어떤 contract 를 보장하는가?"**

구조화된 본문은 `frontmatter.spec` namespace. cross-ref 는 `validateSpecRefs` 가 검증. **`parent` 는 반드시 brief 또는 다른 spec** (sub-spec 재귀 가능).

### 필수 frontmatter 필드:

- `key` — 식별자 (관례적으로 `<brief-key>/<spec-name>`)
- `type: spec` — 고정
- `parent: <brief-또는-spec-키>` — 필수
- `codeLinks: [{kind, file, symbol}, ...]` — 필수 ≥1
- `status` — `draft` / `active` / `drifted` / `retired`
- `summary` — 한 줄
- `spec: { ... }` — 전체 namespace

### `spec:` namespace 필수 구조:

| 섹션 | 내용 | 필수 ID |
|------|------|---------|
| `preconditions` | `[{id, condition, binds, derives}]` (≥1) | PRE-001 |
| `postconditions` | `[{id, guarantee, keyword: MUST/SHALL, binds, derives}]` (≥1) | POST-001 |
| `invariants` | `[{id, statement, binds, always_holds: per-call/cross-call/cross-process}]` (≥1) | INV-001 |
| `failures` | `[{violation, behavior, exception: {class, file}}]` (≥1) | — |
| `state_transitions` | `[{from, trigger, to, binds}]` | — (선택) |

### Cross-reference (자동 검증):

- 모든 `binds` 참조 (`{file, symbol}`) 는 카드의 `codeLinks` 에 존재해야 함
- 모든 `derives` 참조 (`"brief-key#R-001"`) 는 형식 준수 + (brief 로딩 가능 시) 실제 brief 항목을 가리켜야 함

### 예시:

```yaml
---
key: payment/order-payment/charge
type: spec
parent: payment/order-payment
relations: [payment/order-payment]
codeLinks:
  - {kind: function, file: src/payment/charge.ts, symbol: chargeCard}
spec:
  preconditions:
    - {id: PRE-001, condition: idempotency_key 형식 UUIDv4, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], derives: payment/order-payment#R-001}
  postconditions:
    - {id: POST-001, guarantee: 성공 시 payment_id 반환 status=AUTHORIZED, keyword: MUST, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], derives: payment/order-payment#S-H-01}
  invariants:
    - {id: INV-001, statement: PAN 패턴 어떤 인자/반환/로그에도 등장 X, binds: [{file: src/payment/charge.ts, symbol: chargeCard}], always_holds: cross-call}
  failures:
    - {violation: PG 5xx, behavior: fallback PG 라우팅 후 재시도, exception: {class: PaymentGatewayUnavailable, file: src/payment/errors.ts}}
---
```

### BAD (흔한 실수):

- ✗ markdown 본문 그대로
- ✗ `binds` 에 codeLinks 없는 file/symbol 참조
- ✗ `derives` 형식 위반 (예: "R-001" — brief key prefix 누락)
- ✗ 본문에 구현 메커니즘 (WeakMap, FK CASCADE 등) — 행동 보장으로 다시 쓸 것
- ✗ Task list 또는 verification command
- ✗ `parent` 가 domain (반드시 brief 또는 spec)

---

## 요약: 무엇이 어디에

| 내용 | principle | domain | brief | spec | 카드 X |
|------|:---:|:---:|:---:|:---:|--------|
| 프로젝트 전반 규칙 (statement + rationale) | ✓ | | | | |
| Cross-cutting 메트릭 / 쿼터 | ✓ | | | | |
| 외부 규정 참조 | ✓ | | | | |
| Bounded context 개관 / 스코프 | | ✓ | | | |
| Cross-domain 의존 선언 | | ✓ | | | |
| 동기 (도메인 내 brief 가 왜 존재하는지) | | | ✓ | | |
| 스코프 (도메인 내 goals / non-goals) | | | ✓ | | |
| 시나리오 (사용자 흐름) | | | ✓ | | |
| 룰 (영역 한정 정책) | | | ✓ | | |
| 제약 (외부 의무) | | | ✓ | | |
| 위험 (실패 시나리오) | | | ✓ | | |
| 기준 (성공 메트릭) | | | ✓ | | |
| 결정 (대안 + 합리성) | | | ✓ | | |
| Contract (GIVEN/WHEN/THEN 코드 보장) | | | | ✓ | |
| Invariant (항상 참인 조건) | | | | ✓ | |
| Failure (위반 → 행동 표) | | | | ✓ | |
| 코드 구조 설명 | | | | | ✗ 코드에서 발견 가능 |
| 파일 경로, 클래스명 | | | | | ✗ 코드에서 발견 가능 |
| Task 체크리스트 | | | | | ✗ 실행 계획 |
| Verification command | | | | | ✗ tooling |

계층 (4-tier strict):
- principle / domain — root only, parent 없음
- brief — parent 반드시 domain (brief 재귀 금지)
- spec — parent 반드시 brief 또는 spec (sub-spec 가능)

</card_types>

<card_splitting>
Contract 들이 한 카드에 속하는지 별도 카드로 분리할지 결정.

**다음 중 하나라도 true 면 분리:**
1. **변경 독립성** — Contract A 가 drift 해도 B 는 valid 일 수 있다.
2. **다른 codeLink 파일** — Contract 가 다른 소스 파일의 심볼을 참조한다.
3. **"X and Y" 요약** — 카드 summary 가 "and" 로 무관한 두 능력을 잇는다면 두 토픽이다.

**다음이 모두 true 면 합침:**
1. Contract 들이 **같은 작업**의 다른 입력 케이스를 묘사 (예: deleteCard force=true vs force=false).
2. **같은 codeLink 셋** 공유 — 묶인 심볼이 바뀌면 모든 contract 가 동등하게 영향.
3. 한 contract 가 drift 하면 **반드시** 나머지도 drift.

**Brief 분해 (도메인 내):**
각 brief 는 부모 도메인 안에서 **독립적으로 설계 가능한 토픽** 하나여야 한다 — 같은 도메인의 다른 brief 와 상의 없이 결정할 수 있는 영역. 분해 부족 신호:
- brief 에 직접 자식 spec 4+ → sibling brief 로 분리 고려 (같은 domain 아래)
- brief Scope 의 "Covers" 항목 3+ 무관 → 각각이 별도 brief
- brief 의 요구가 무관한 두 서브시스템에 걸친다 → 서브시스템별 분리 (그리고 다른 domain 인지 확인)

**Domain 분해:**
각 domain 은 자기 관심사를 가진 **bounded context** 하나여야 한다. 분해 부족 신호:
- domain 에 직접 brief 6+ → 분리 고려 (특히 sub-concern 로 자연 묶일 때)
- 같은 domain 아래 brief 들이 공유 glossary 용어가 없음 → 다른 domain 일 가능성
- `cross_domain_dependencies` 화살표가 양방향 동등 → 한 domain 으로 합칠 가능성

</card_splitting>

<self_review>
모든 카드를 만들거나 제안하기 전 실행. 어떤 항목이라도 실패 → 수정 후 재검토.

single-file 테스트는 어디서나 적용: "한 소스 파일만 읽고 발견 가능한가? YES → 카드 X. 여러 파일에 걸친다 → 반드시 카드화."

**Domain (4 체크):**
1. `overview` 와 `scope` 가 비어있지 않고 경계가 분명한 산문 (기능 나열 X)
2. Scope 가 OUT 도 명시 (IN 만이 아니라)
3. `cross_domain_dependencies` (있다면) 는 다른 `domain` 카드를 가리킴 (brief/spec 아님)
4. domain 이 단일 기능이 아니라 bounded context 임

**Brief (6 체크):**
1. 모든 요구사항이 single-file 테스트에 실패 (단일 파일에서 발견 불가)
2. 모든 성공 기준에 숫자 또는 zero-tolerance 임계값
3. 본문에 구현 기술명 X (WeakMap, FTS5, Drizzle, temp-rename, ON CONFLICT, WAL 금지)
4. 모든 시나리오가 구현을 모르고도 검증 가능한 Given/When/Then
5. Scope 섹션이 EXCLUDED 명시 (단지 다루는 것만이 아니라)
6. `parent` 가 domain 카드 (4-tier)

**Spec (8 체크):**
1. 모든 contract 가 WHAT (행동) 기술, HOW (구현 메커니즘) X
2. 본문에 구현 메커니즘명 X (FK CASCADE, raw UPDATE, WeakMap, temp-rename, ON CONFLICT, upsert SQL, targeted UPDATE, WAL, atomic rename 금지). 행동 보장으로 재작성: "FK CASCADE 전파" → "키 변경은 모든 참조 레코드에 전파돼야 함(MUST)"
3. failure 표가 묶인 심볼이 던지는 모든 에러 타입을 커버
4. 분리 체크 (contract 단위): 한 contract 변경 시 ALL 다른 contract 도 반드시 변경? NO → 분리
5. **분리 체크 (파일 단위)**: `codeLinks` 가 2+ 다른 소스 파일 심볼을 참조? YES + 그 파일들이 독립 변경 가능 (`<card_splitting>` 룰 #2) → 파일별 카드로 반드시 분리
6. 모든 codeLinks 가 실제 존재 심볼 (grep / `ed validate links` 로 검증)
7. `parent` 필드 설정돼있고 brief 또는 spec 카드를 가리킴
8. `glossary` 는 주요 토픽만 나열

</self_review>

<model_notes>
- 정확한 카드 적게 > 모호한 카드 많이. 단 cross-module contract 는 무조건 카드화. "적게" 는 "모호한 대안보다 적게" 이지 "커버리지 요구보다 적게" 가 아니다.
- `ed` 를 직접 호출 — 서브에이전트는 카드 컨텍스트를 잃는다. CLI 는 빠르고 stateless.
- 간결할 때도 카드 생성 전엔 항상 card-analysis 템플릿 표시.
- 모든 카드에 `<self_review>` 체크리스트 적용 후 사용자에게 제안. self-review 실패한 카드는 사용자 시간 낭비.
- 카드는 코드가 표현 못 하는 것을 보존: 설계 합리성, cross-module invariant, 실패 정책, 스코프 경계. 카드를 지웠을 때 잃을 지식이 없으면 그 카드는 존재해서는 안 된다.
- 4-tier strict — "root brief" 또는 "brief 안의 brief" 같은 건 없다. brief 재귀가 필요해 보이면 → domain 이 필요하거나 sibling brief 분해 신호다.
</model_notes>

<critical>
1. 코드 수정 전 카드 읽기. 수정 후 `ed validate links` 실행. 항상.
2. 모든 카드 생성/갱신 전 `<self_review>` 실행. 예외 없음.
3. single-file 테스트: 한 소스 파일만 읽고 발견 가능? → 카드 X. 여러 파일에 걸친다 → 반드시 카드화.
4. 4-tier 계층은 strict: principle / domain (루트) → brief (도메인 아래) → spec (brief 또는 spec 아래). activation guard 가 위반을 거절한다.
</critical>
</content>
