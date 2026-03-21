# Emberdeck 카드 스키마 재설계

## 배경

현재 카드는 작업 분류 타입(`feature | bug | refactor | spike | decision`)을 사용하고 계층 구조가 없다. 카드는 정책이어야 하고, 정책은 계층을 가진다. 상위 정책이 하위 정책의 존재 이유를 설명한다.

## 확정: 카드 스키마 (10 필드)

```
key           — 식별자 (필수)
summary       — 한 줄 요약 (필수)
status        — draft | active | drifted (필수)
type          — architecture | spec (필수)
parent        — 상위 카드 key (선택, 같은 type 또는 바로 위 type만 허용)
relations     — [target_key] (선택, 문자열 배열. 방향은 선언자 기준)
codeLinks     — [{kind, file, symbol}] (선택)
boundary      — string[] (선택, 이 카드가 담당하는 파일/디렉토리 glob 패턴)
tags          — string[] (선택, 카테고리 검색용. 저장 시 lowercase 정규화)
body          — 마크다운 본문 (필수, 설계 계약)
```

status 설계:
- `draft`: 카드 작성 중 또는 의도적 재작업 중. codeLinks는 planned 취급.
- `active`: 코드와 스펙이 구조적으로 일치하는 상태.
- `drifted`: 코드가 스펙에서 벗어난 상태. 시스템이 자동 감지하여 전환.

deprecated 상태는 없다. 유효하지 않은 카드는 삭제한다. 이력은 git이 보존한다.

**상태 전환 규칙:**
- `draft → active`: activation 조건 충족 시. 수동 전환. 조건은 아래 "activation guard" 참조.
- `active → drifted`: codeLinks가 깨지거나, boundary glob이 아무 파일과도 매칭되지 않거나, boundary 내 심볼이 변경될 때. 시스템이 자동 전환.
- `drifted → active`: 스펙 카드를 코드에 맞게 수정하거나, 코드를 스펙에 맞게 수정한 후. activation 조건 재검증. 수동 전환.
- `active → draft`: 의도적 재작업. 수동 전환. 조건 없음.
- `drifted → draft`: 대폭 재작성 필요 시. 수동 전환. 조건 없음.

**activation guard (모든 status 설정 지점에서 강제):**

`create_card`, `update_card`, `update_card_status`, `bulk_create_cards` — status를 `active`로 설정하는 모든 경로에서 동일하게 적용.

- **architecture**: 조건 없음. 즉시 활성화 가능.
- **spec**: codeLinks가 1개 이상이고 **모두 resolve** 되어야 한다. boundary가 있으면 **최소 1개 파일과 매칭**해야 한다.
- 미충족 시 에러 반환. 에러에 미충족 항목 목록 포함: `{ unmetConditions: ["codeLink 'src/auth/token.ts:refreshToken' unresolved", ...] }`

**타입 변경 시 activation 재검증:**

`update_card`로 type을 변경할 때, 카드가 active 상태이면 새 타입의 activation 조건을 재검증한다.
- architecture → spec: spec 조건(codeLinks/boundary) 미충족 시 status를 `draft`로 강제 전환.
- spec → architecture: architecture 조건은 없으므로 항상 통과.

검증(verify)은 별도 개념이 아니다. 코드-스펙 정합성이 곧 상태다.

**drift score는 없다.** 카드 상태가 active 아니면 drifted다. 프로젝트 수준에서는 `drifted 카드 수 / 전체 카드 수`로 건강도를 판단한다.

**시스템 한계:** status `active`는 구조적 정합성(심볼 존재, boundary 매칭)만 보장한다. body에 기술된 설계 의도와 실제 코드 동작의 의미적 정합성은 검증하지 않는다. 의미적 정합성은 테스트 코드의 책임이다.

## 확정: relations 변경

기존: `[{type: "depends-on", target: "card-b"}]` — 타입 있는 객체 배열
변경: `["card-b"]` — 문자열 배열

이유:
- 모든 알고리즘(BFS, 영향도 분석, 상호작용 감지)이 relation type을 구분하지 않고 동일하게 처리
- 에이전트가 depends-on/references/related 중 무엇을 고를지 결정하는 것 자체가 무의미한 인지 부하
- 방향은 "누가 선언했느냐"로 결정됨 (DB의 isReverse 미러링은 유지)

DB 변경:
- `card_relation` 테이블에서 `type` 컬럼 제거
- unique constraint: `(type, src, dst, isReverse)` → `(src, dst, isReverse)`
- `allowedRelationTypes` 설정 제거

방향 동작:
- 카드 A가 `relations: ["B"]` 선언 → DB에 A→B(forward) + B→A(reverse) 생성
- backward BFS가 B에서 출발하면 A를 발견 ("B가 바뀌면 A가 영향받을 수 있다")

## 확정: 2개 타입

```
architecture  → 시스템의 기획 구조. 어떤 영역들이 존재하고, 영역 간 경계와 관계가 무엇인가.
spec          → 특정 영역이 무엇을 보장해야 하는가. 구현이 바뀌어도 유효한 계약.
```

리트머스 테스트: "구현을 완전히 다시 쓰면 이 카드가 여전히 유효한가?" — 유효해야 한다.

## 확정: parent 규칙

- architecture: parent는 null(루트) 또는 다른 architecture
- spec: parent는 architecture 또는 다른 spec
- 순환 참조 금지 (체인 최대 깊이 20)
- FK: ON UPDATE CASCADE, ON DELETE SET NULL

## 확정: 제거된 필드

- acceptance → 검증 조건은 스펙이 아니다. 코드-스펙 정합성은 상태(status)가 증명한다. 테스트 코드가 검증이다.
- priority → 에이전트는 pre_change_check로 관련 카드를 가져옴. 우선순위 필터링 불필요.
- keywords → tags로 통합. 두 필드의 구분이 불가능했음.
- constraints → body에 담으면 되는 내용. 쿼리하는 API 없음.
- inScope/outOfScope → body에 담으면 되는 내용. 구조화해도 쿼리 API 없음.
- relation type → 모든 알고리즘이 타입을 구분하지 않음. 무의미한 분류.
- plan/task 타입 → 구현 전략과 작업 단위는 오케스트레이션 관심사. 설계 지식이 아님.
- deprecated 상태 → 유효하지 않은 카드는 삭제. 이력은 git이 보존.

## 확정: 유지된 필드

- tags → 카테고리 검색용. FTS5는 텍스트 매칭이지 의미 매칭이 아님. 저장 시 lowercase 정규화.
- relations → 횡단 참조. parent(트리)와 독립. 타입 없이 문자열 배열로 단순화.
- codeLinks → 코드-카드 연결. emberdeck의 핵심 기능. kind는 심볼 속성이라 유지. kind 유효값은 gildash 심볼 kind와 일치: `function`, `class`, `interface`, `type`, `variable`, `enum` 등. 자유 텍스트이며 검증하지 않음.

## DB 스키마 (새로 만듦, 마이그레이션 없음)

- `card` 테이블: key, summary, status, type, parent, boundaryJson, body, filePath, updatedAt
- `parent` FK: ON UPDATE CASCADE, ON DELETE SET NULL, 인덱스
- `card_relation` 테이블: srcCardKey, dstCardKey, isReverse (type 컬럼 없음)
- unique constraint: `(src, dst, isReverse)`
- `tag` + `card_tag` 테이블 유지 (keywords 테이블 제거)
- `code_link` 테이블 유지
- `card_changelog` 테이블 유지
- `card_fts` FTS5 유지
- `acceptanceJson`, `constraints_json`, `priority`, `keywords` 관련 컬럼/테이블 제거
- `allowedRelationTypes` 설정 제거

## 검증 기준 (validate_cards 확장 또는 신규 도구)

### 쓰기 시점 검증 (create/update에서 거부)

- parent가 존재하지 않는 카드를 가리키면 거부
- parent의 type이 규칙에 맞지 않으면 거부 (예: spec의 parent가 다른 spec이나 architecture가 아니면 거부)
- 순환 parent 참조 감지 시 거부 (체인 최대 20)
- relation 대상이 존재하지 않으면 거부
- relation 배열에 빈 문자열이 있으면 거부
- relation에 자기 자신을 참조하면 거부
- type 변경 시 자식 카드들의 parent-type 계층이 깨지면 거부
- **type 변경 시 active 상태면 새 타입의 activation 조건 재검증 (미충족 시 draft로 전환)**
- key 길이 제한 (최대 200자)
- boundary 패턴: 빈 문자열 거부, 최대 50개, 패턴당 최대 500자, 유효한 glob 문법
- codeLinks file/symbol 빈 문자열 거부
- **status를 active로 설정 시 activation guard 적용 (모든 진입점: create, update, update_status, bulk_create)**
- **tags: 저장 시 lowercase 정규화**

### 읽기 시점 검증 (전체 카드셋 일괄 진단)

- 고아 카드: parent가 null인데 type이 architecture가 아닌 카드 (parent가 삭제되어 SET NULL된 경우)
- 깨진 parent: DB에는 parent가 있지만 해당 카드가 존재하지 않는 경우 (파일 sync 시 발생 가능)
- type 계층 위반: parent의 type이 규칙에 맞지 않는 카드 (파일 직접 편집으로 유입 가능)
- 깨진 relation: relation 대상이 존재하지 않는 카드
- 빈 트리: architecture 카드인데 하위 spec이 하나도 없는 경우 (경고, 거부 아님). **단, status가 draft인 architecture는 제외** (아직 구성 중이므로)
- boundary 겹침: 두 카드의 boundary가 같은 파일을 포함 (parent-child 간 허용, 그 외 경고)
- **재작업 의존성: active 카드가 draft 카드에 relation을 가진 경우 (경고). 의존 대상이 재작업 중임을 의미**
- codeLinks 정합성: validate_code_links가 담당
- DB↔파일 정합성: validate_cards가 담당 (parent, boundary 필드 추가 반영)
- **drifted 자동 전환**: active 카드의 codeLinks가 깨지거나, boundary glob이 아무 파일과도 매칭되지 않거나, boundary 내 심볼이 변경되면 status를 drifted로 전환. check_drift가 이를 수행. boundary 비활성은 경고가 아니라 **drifted 전환 트리거**다.

### relation 생성 순서

relation 대상이 존재해야 하므로, 상호 참조하는 카드를 만들 때는 관계 없이 먼저 생성하고 update로 relation을 추가한다. 이건 기존 bulk_create의 2단계 패턴과 동일한 접근이며, 단일 create 시에도 적용된다.

### 고아 카드 정책

parent: null인 spec 카드는 **쓰기 시 허용**된다. 거부하지 않는다. 교차 관심사 spec은 특정 architecture에 속하지 않을 수 있다. 읽기 시 진단에서 **경고**(거부 아님)로 표시한다.

### 기존 코드 버그 수정 (재설계와 함께 해결)

- **rename 후 참조 파일 미갱신**: rename 시 영향받는 모든 카드 파일을 재작성 (relations, parent 필드). body 본문에서 구 key가 발견되면 응답에 `bodyReferencesFound: string[]` 반환 (자동 치환하지 않음, 에이전트가 판단). **rename을 card_changelog에 기록** (field="key", oldValue, newValue). **newKey가 기존 카드와 중복이면 에러 반환** (`CardAlreadyExistsError`). FK CASCADE로 rename 시 changelog 포함 모든 테이블이 새 key로 자동 갱신되므로, 이전 key로의 직접 검색은 불가. rename 이력은 `get_card(key, includeHistory: true)`로 확인.
- **delete 후 참조 파일 미갱신**: delete 시 자식 카드 파일에서 parent 필드 제거 + **relation으로 참조하는 카드 파일에서 해당 key 제거**. DB CASCADE와 파일 상태를 일치시킴.
- bulkSync 시 중복 key 파일이 조용히 덮어씀 (데이터 소실 위험). 해결: 중복 key 감지 시 에러 반환.

## V2 VISION에서 통합된 스키마 확장

### boundary 필드 (신규)

카드가 담당하는 파일/디렉토리 범위. glob 패턴 배열.

```yaml
boundary:
  - "src/auth/**"
  - "src/middleware/auth*.ts"
```

용도:
- `suggest_card_scope` (SPEC-2)가 boundary 기반으로 카드 범위 제안
- `get_uncovered_symbols` (SPEC-1)가 boundary 안의 미연결 심볼만 필터
- `pre_change_check`가 codeLinks 외에 boundary glob 매칭으로도 영향 카드 탐지
- `find_cards_by_symbol`이 codeLink 검색 외에 boundary glob 매칭으로도 카드 탐지
- coverage 계산에서 boundary가 있는 카드는 해당 범위 내 심볼 기준으로 커버리지 산정

DB: `card` 테이블에 `boundaryJson` TEXT 컬럼 추가. JSON 배열.

검증:
- 각 패턴은 유효한 glob 문법 (빈 문자열 거부)
- 최대 50개 패턴
- 패턴당 최대 500자

### 통합 분석 도구 (analyze)

프로젝트 전체 건강도를 단일 도구로 제공하는 대시보드. **파일/심볼 파라미터 없음** — 파일 기반 분석은 `pre_change_check`가 담당.

신규 MCP 도구: `emberdeck_analyze`

```typescript
interface AnalyzeInput {
  includeBody?: boolean;  // true면 카드에 body 포함 (기본 false)
}

interface AnalyzeResult {
  health: {
    total: number;
    active: number;
    drifted: number;
    draft: number;
    brokenLinks: number;
    staleBoundary: number;  // boundary glob이 아무 파일과 매칭 안 되는 카드 수
  };
  coverage: { totalSymbols: number; covered: number; ratio: number };
  unlinkedSymbols: Array<{ file: string; symbol: string; kind: string }>;  // 상위 N개
  driftedCards: Array<{
    key: string;
    summary: string;
    driftType: 'broken_link' | 'boundary_inactive' | 'symbol_changed';
    brokenLinks: number;
    totalLinks: number;
  }>;
}
```

용도: 프로젝트 건강도 대시보드. 에이전트가 전체 상태를 파악한 후 `list_cards(status: "drifted")`로 상세 조회.

대상: `src/ops/analyze.ts` (신규 파일), `src/mcp/tools.ts` (신규 도구)

---

## 추가 구현 사항

### tag 검색 지원

tags 필드를 유지한 이유가 카테고리 검색인데, 현재 `list_cards`에 tag 필터가 없고 FTS5도 tags를 인덱싱하지 않음. tags를 넣어도 검색할 수 없는 상태.

해결: `list_cards`에 tag 필터 추가. `listCards(ctx, { tag: "security" })` → 해당 태그가 있는 카드만 반환. tag는 lowercase 정규화되어 저장되므로 대소문자 무관 매칭.

참고: FTS5는 key/summary/body만 인덱싱하며 tags를 포함하지 않음. 태그 검색은 `list_cards(tag:)`, 텍스트 검색은 `search_cards(query:)` — 용도가 다르므로 의도적 분리.

### get_card_tree MCP 도구 상세

- 입력: `{ key: string, maxDepth?: number }`
- 출력: 카드의 하위 트리. 각 노드는 `{ key, summary, type, status, depth, children: [], truncated?: boolean }` 재귀 구조.
- maxDepth 기본값: 10. 최대값: 20.
- **depth 초과 시 해당 노드에 `truncated: true` 표시** (하위에 더 많은 자식이 존재함을 알림).
- 존재하지 않는 key: 에러 반환.

### 마이그레이션

사용자 없음. 기존 스키마를 밀고 새로 만든다. 마이그레이션 호환 불필요.

## 코드 영향 범위

### relation 변경에 의한 영향

| 대상 | 변경 |
|------|------|
| RelationRepository | `{type, target}[]` → `string[]` 수용. type 없이 DB 저장 |
| card_relation 테이블 | type 컬럼 제거 |
| RelationTypeError | 삭제 |
| allowedRelationTypes | config에서 제거. addRelationType/removeRelationType 삭제 |
| getRelationGraph 출력 | RelationGraphNode.relationType 필드 제거 |
| checkInteractions 출력 | relationType 필드 제거. 관계 존재 여부만 판단 |
| generateContext 출력 | ContextRelation.type 필드 제거 |
| MCP 도구 스키마 | relations 입력: `[{type, target}]` → `[string]` |

### parent 추가에 의한 새 코드

| 대상 | 내용 |
|------|------|
| parent 검증 | 존재 확인, type 계층, 순환 감지, type 변경 시 자식 계층 검증, **type 변경 시 active 상태 activation 재검증** |
| findChildren(key) | 자식 카드 조회 (Repository 신규 메서드) |
| findAncestors(key) | 조상 체인 조회 (Repository 신규 메서드) |
| get_card_tree MCP 도구 | 하위 트리 반환 (신규 도구) |
| list_cards 필터 확장 | parent, roots, tag, **updatedSince** 필터 추가 |
| delete 동작 | 자식이 있는 카드 삭제 시 **자식 파일에서 parent 제거 + relation 참조 카드 파일에서 해당 key 제거** |

### 제거 대상

| 대상 | 이유 |
|------|------|
| acceptance 필드 + acceptanceJson 컬럼 | 검증 조건은 스펙이 아님. 상태가 증명 |
| verify_acceptance / list_unverified 도구 | acceptance 제거에 따라 |
| get_card_history 도구 | `get_card`에 `includeHistory?` 옵션으로 통합 |
| priority 필드 | 에이전트가 사용하지 않음 |
| constraints_json 컬럼 | body로 대체 |
| keywords 테이블 + card_keyword 테이블 | tags로 통합 |
| allowedRelationTypes 설정 | relation type 자체 제거 |
| RelationTypeError 에러 클래스 | relation type 검증 불필요 |
| addRelationType / removeRelationType | 설정 제거에 따라 |
| CardRelation.type | relation에서 type 제거 |
| deprecated 상태 | 삭제로 대체 |
| find_affected_cards 도구 | `pre_change_check`에 흡수 |
| generate_context 도구 | `get_card_context`에 통합 |

### 변경되는 부분

| 대상 | 변경 |
|------|------|
| pre_change_check | **find_affected_cards 흡수**. boundary glob 매칭 추가. 응답에 `newUncoveredFiles` 필드 추가 (coverageIgnore 패턴 적용 후 반환). priority 기반 risk level 제거, 카드 수 + drifted 비율 기반으로 대체 |
| check_drift | drift score 제거. 카드별 status 판정 (active/drifted) + **driftType 분류 (`broken_link` \| `boundary_inactive` \| `symbol_changed`)** + **brokenLinks/totalLinks 카운트** + 프로젝트 건강도(drifted 수/전체 수) 반환. active→drifted 자동 전환 수행. **boundary 비활성 = drifted 전환 트리거** (경고가 아님) |
| check_interactions | **gildash import graph 기반 코드 수준 의존관계 발견** 기능 추가. 기존 sharedFiles/sharedSymbols 외에 `importDependencies` 필드 추가. gildash 미지원 시 fallback: 기존 sharedFiles/sharedSymbols만 반환 |
| find_cards_by_symbol | **boundary glob 매칭 추가**. 응답에 `matchType: 'codeLink' \| 'boundary'` 표시 |
| get_card | **`includeHistory?: boolean` 옵션 추가**. true면 card_changelog에서 최근 변경 내역 포함 (rename 이력 포함) |
| get_card_context | **generate_context와 통합**. `get_card_context(key, depth?)` — depth=1이면 직접 관계만 (기존 get_card_context), depth>1이면 BFS 그래프 탐색 (기존 generate_context). **depth 초과 시 응답에 `truncated: true` 표시** |
| card_changelog | parent, boundary 변경 추적 추가. **rename 시 key 변경 기록 추가** (field="key", oldValue, newValue) |
| regression_guard | acceptance 기반 quality gate 제거. **affected-cards 범위에서 drifted 비율 기반 판정**. 내부적으로 affected cards에 대해 drift detection 실행 후 결과 산출. 임계값 기본 0 (affected 중 drifted 1개라도 있으면 fail). `.emberdeck.jsonc`에 `regressionThreshold` (0-1)로 설정 가능 |
| rename_card | 참조하는 모든 카드 파일 재작성 (relations, parent). **body에서 구 key 발견 시 `bodyReferencesFound` 반환**. **card_changelog에 key 변경 기록** |
| delete_card | **자식 카드 파일에서 parent 제거 + relation 참조 카드 파일에서 해당 key 제거** |
| bulk_create_cards | Phase 1에서 **parent 의존성에 따른 위상 정렬 순서로 생성**. 같은 배치 내 parent 참조 보장 |
| validateCodeLinks | status 분류 업데이트: draft → planned, active/drifted → broken |
| validate_cards | **재작업 의존성 경고 추가**: active 카드가 draft 카드에 relation → 경고. **draft architecture 빈 트리 경고 제외** |

### 변경 없는 부분

| 대상 | 상태 |
|------|------|
| codeLinks `{kind, file, symbol}` | 현상유지 |
| gildash 연동 (reindex, resolve, validate) | 현상유지 |
| syncSpecAnnotations / syncSymbolChanges | 현상유지 |
| getLinkCoverage | 현상유지 |
| safeWriteOperation / withCardLock / withRetry | 현상유지 |
| FTS5 인덱스 (key, summary, body) | 현상유지 |
| CompensationError | 현상유지 |

## API 버그 수정 (IMPROVEMENT_PLAN에서 통합)

스키마 재설계와 동시에 수정. 별도 작업 시 이중 변경 필요.

### IMP-1: syncSpecAnnotations 양방향 정합 보고

현상: `{ created: 0, unmatched: [] }` 반환 시 "스캔 안 됨" vs "이미 매칭됨" 구분 불가.

수정: `SpecSyncResult`에 `alreadyLinked`, `markerMissing`, `linkMissing` 필드 추가.
- `alreadyLinked`: @spec 발견 + codeLink 이미 존재하는 수
- `markerMissing`: codeLink 있지만 @spec 어노테이션 없는 경우
- `linkMissing`: @spec 있지만 codeLink 미등록 (created에 미포함)

대상: `src/ops/spec-sync.ts`, `src/mcp/tools.ts`

### IMP-2: validate_code_links 반환 타입 + reindex

현상: `BrokenLink[]` 반환 → 빈 배열이 "링크 없음" vs "전부 유효" 구분 불가.

수정: `{ declared, valid, broken }` 구조체 반환. gildash reindex 호출 추가.

대상: `src/ops/link.ts`, `src/mcp/tools.ts`

### IMP-3: update_card silent fail

현상: 미정의 키(예: `{ fields: { body: "..." } }`)가 에러 없이 무시됨.

수정: MCP 도구 Zod 스키마에 `.strict()` 적용.

대상: `src/mcp/tools.ts`

### IMP-4: planned link vs broken link 구분 없음

현상: draft 카드의 미존재 codeLink가 broken으로 분류, drift score에 반영.

수정: 카드 status 기반 분기. draft → `planned`, active/drifted → `broken`. planned는 정상 취급. broken 감지 시 active → drifted 자동 전환.

대상: `src/ops/link.ts`, `src/ops/context.ts`

### IMP-5: check_interactions sharedSymbols 항상 빈 배열

현상: codeLinks 심볼 이름만 비교. 실제 import 관계 미탐지.

수정: `sharedFiles` 필드 추가 (양쪽 카드가 같은 파일에 링크). **`importDependencies` 필드 추가**: gildash import graph 기반으로 카드 간 코드 수준 의존관계 발견. gildash 미지원 시 이 필드는 빈 배열로 fallback.

대상: `src/ops/context.ts`

### IMP-6: gildash reindex 일관성

현상: `syncSpecAnnotations`만 reindex 호출. 다른 gildash 의존 함수는 구 인덱스 참조.

수정: `ensureReindexed(ctx)` 공통 가드 추가. 모든 gildash 의존 함수 시작 시 호출.

대상: `src/ops/link.ts`, `src/ops/spec-sync.ts`

### IMP-7: batch API 부재

현상: 다중 카드 검증 시 카드 수만큼 반복 호출 필요.

수정: `validate_code_links`의 key를 optional로 (생략 시 전체). `pre_change_check` 응답에 카드별 linkStatus 포함.

대상: `src/ops/link.ts`, `src/ops/impact.ts`, `src/mcp/tools.ts`

---

## 코드→스펙 방향 도구 (신규)

현재 Emberdeck은 "스펙이 있으면 코드를 검증"하는 방향만 지원. 기존 코드에서 스펙을 생성하는 방향이 없음.

### SPEC-1: get_uncovered_symbols — 카드 미연결 심볼 목록

gildash에서 추출한 심볼 중 어떤 카드의 codeLink에도 연결되지 않은 심볼 목록 반환.

```typescript
interface UncoveredResult {
  totalSymbols: number;
  coveredSymbols: number;
  uncovered: Array<{
    file: string;
    symbol: string;
    kind: string;       // function, class, interface 등
    exportType: string; // exported, internal
  }>;
  coverageRatio: number; // 0-1
}
```

용도: 온보딩 시 "어디부터 카드를 만들어야 하는가" 판단. 에이전트가 uncovered 심볼을 보고 카드 생성.

필터: `{ files?: string[], kinds?: string[], exportedOnly?: boolean, excludePatterns?: string[] }`

`excludePatterns`은 `.emberdeck.jsonc`의 `coverageIgnore`와 합산된다. 호출 시 추가 제외 패턴 지정용.

대상: `src/ops/spec-sync.ts` (신규 함수), `src/mcp/tools.ts` (신규 도구)

### SPEC-2: suggest_card_scope — 파일/디렉토리 기반 카드 범위 제안

디렉토리 구조 + export 심볼 패턴을 분석하여 카드 생성 단위를 제안.

```typescript
interface CardSuggestion {
  suggestedKey: string;           // 디렉토리 또는 모듈명 기반
  type: 'architecture' | 'spec';
  parent?: string;                // 제안된 parent key
  files: string[];                // 포함할 파일들
  boundary: string[];             // 제안된 boundary glob
  symbols: Array<{ file: string; symbol: string; kind: string }>;
  reason: string;                 // "공통 디렉토리", "공유 export" 등
}
```

용도: 에이전트가 코드 구조를 보고 "이 단위로 카드를 만들어라"를 제안받음. LLM이 body 내용을 작성.

입력: `{ path?: string, maxDepth?: number }` — path 생략 시 projectRoot. maxDepth는 디렉토리 탐색 깊이.

대상: `src/ops/spec-sync.ts` (신규 함수), `src/mcp/tools.ts` (신규 도구)

참고: suggest_card_scope는 제안만 한다. 카드 생성은 에이전트가 create_card를 호출해야 한다.

---

## 전체 MCP 도구 목록 (재설계 후)

### 카드 CRUD

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `create_card` | 카드 생성 (status 지정 시 activation guard 적용) | `key, summary, type, status?, parent?, relations?, codeLinks?, boundary?, tags?, body` |
| `get_card` | 카드 조회 | `key, includeHistory?` |
| `update_card` | 카드 수정 (.strict() 적용, status 지정 시 activation guard 적용) | `key, summary?, type?, status?, parent?, relations?, codeLinks?, boundary?, tags?, body?` |
| `delete_card` | 카드 삭제 (자식/참조 카드 파일 자동 갱신. force: 자식이 있어도 즉시 삭제, 자식 parent=null 처리) | `key, force?` |
| `rename_card` | 카드 key 변경 (참조 파일 자동 갱신, body 참조 보고, changelog 기록) | `oldKey, newKey` |
| `list_cards` | 카드 목록 | `type?, status?, parent?, tag?, roots?, updatedSince?` (updatedSince: ISO 8601 문자열, 예 "2025-03-01T00:00:00Z") |
| `search_cards` | FTS5 전문 검색 | `query, type?, status?` |
| `bulk_create_cards` | 다수 카드 생성 (위상 정렬 → 생성 → 관계. status 지정 시 activation guard 적용) | `cards[]` |
| `bulk_sync_cards` | 파일↔DB 전체 동기화 | `dryRun?` |

### 트리/관계

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `get_card_tree` | 하위 트리 조회 (depth 초과 시 truncated 표시) | `key, maxDepth?` |
| `list_card_relations` | 카드의 직접 관계 | `key, direction?` |
| `get_relation_graph` | BFS 관계 그래프 | `key, maxDepth?, direction?` |

### 코드 연결

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `validate_code_links` | codeLink 정합성 검증 | `key?` (생략 시 전체) |
| `resolve_code_links` | gildash로 codeLink resolve | `key` |
| `find_cards_by_symbol` | 심볼/파일로 카드 검색 (codeLink + boundary 매칭, matchType 표시) | `file, symbol?` |
| `get_link_coverage` | 코드-카드 연결 커버리지 | `path?` |

### 스펙 동기화

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `sync_card_from_file` | 단일 .md 파일 → DB 동기화 | `filePath` |
| `sync_spec_annotations` | @spec 어노테이션 → codeLink 동기화 | `path?` |
| `sync_symbol_changes` | gildash 심볼 변경 → codeLink 업데이트 | `since?` |
| `export_card_to_file` | DB → .md 파일 내보내기 | `key, path?` |

### 분석/진단

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `analyze` | 프로젝트 전체 건강도 (driftedCards 포함) | `includeBody?` |
| `check_drift` | 전체 카드 drift 감지 + driftType 분류 + 자동 전환 (autoTransition 기본 true, false면 판정만 보고하고 status 전환하지 않음) | `autoTransition?` |
| `pre_change_check` | 변경 전 영향도 분석 (find_affected_cards 통합, newUncoveredFiles 포함) | `files[]` |
| `check_interactions` | 카드 간 상호작용 (sharedFiles + sharedSymbols + importDependencies) | `cards[]` |
| `validate_cards` | 전체 카드셋 일괄 진단 (고아, 계층위반, boundary, 재작업 의존성 등) | — |
| `regression_guard` | 코드 변경 후 quality gate (drifted 비율 기반, 내부 drift detection 포함) | `files[]` |

### 코드→스펙

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `get_uncovered_symbols` | 카드 미연결 심볼 목록 | `files?, kinds?, exportedOnly?, excludePatterns?` |
| `suggest_card_scope` | 디렉토리 기반 카드 범위 제안 (parent, boundary 포함) | `path?, maxDepth?` |

### 컨텍스트

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `get_card_context` | 카드 컨텍스트 (depth=1: 직접 관계, depth>1: BFS 탐색. truncated 표시) | `key, depth?` |

### 상태 관리

| 도구 | 설명 | 주요 옵션 |
|------|------|-----------|
| `update_card_status` | 카드 상태 수동 전환 (activation guard 적용) | `key, status, reason?` |

### 제거 도구

- ~~`verify_acceptance`~~ → 제거 (acceptance 제거)
- ~~`list_unverified`~~ → 제거 (acceptance 제거)
- ~~`get_card_history`~~ → `get_card`의 `includeHistory?` 옵션으로 통합
- ~~`find_affected_cards`~~ → `pre_change_check`에 흡수
- ~~`generate_context`~~ → `get_card_context`에 통합

총 도구 수: **30개** (기존 31개 - 제거 5개 + 신규 4개)
- 제거 5개: verify_acceptance, list_unverified, get_card_history, find_affected_cards, generate_context
- 신규 4개: get_card_tree, get_uncovered_symbols, suggest_card_scope, analyze
- 기존 도구 중 변경: get_card_context (generate_context 흡수), pre_change_check (find_affected_cards 흡수)

---

## 설정 확장

### coverageIgnore

의도적으로 스펙이 불필요한 영역을 커버리지 계산에서 제외.

```jsonc
// .emberdeck.jsonc
{
  "projectRoot": ".",
  "coverageIgnore": [
    "src/types/**",
    "src/utils/**",
    "test/**",
    "*.test.ts"
  ],
  "regressionThreshold": 0
}
```

`get_uncovered_symbols`, `analyze`, `get_link_coverage`, **`pre_change_check`의 `newUncoveredFiles`**가 이 패턴에 매칭되는 파일의 심볼을 제외한다.

`regressionThreshold` (0-1, 기본 0): `regression_guard`의 quality gate 임계값. 0이면 affected cards 중 drifted 1개라도 있으면 fail.

---

## 고도화 계획

초기 구현은 도구와 옵션을 풍부하게 제공한다. 실사용 데이터가 쌓인 후 고도화:

1. **도구 통합**: 실사용에서 항상 같이 호출되는 도구 쌍을 발견하면 하나로 합친다. 예: `validate_code_links` + `check_drift`가 항상 연속 호출되면 `check_drift`에 link 검증을 내장.
2. **도구 제거**: 호출 빈도가 0에 가까운 도구는 제거한다. MCP 도구 수가 많으면 LLM 컨텍스트에서 도구 설명이 차지하는 토큰이 증가하므로, 사용되지 않는 도구는 비용이다.
3. **옵션 정리**: 사용되지 않는 옵션은 제거. 기본값이 항상 사용되는 옵션은 제거하고 기본 동작으로 고정.
4. **출력 최적화**: 응답이 과도하게 큰 도구는 기본 필드를 줄이고, `verbose?` 옵션으로 상세 정보를 선택적으로 제공.
5. **SKILL.md 도구 설명 최적화**: 도구 description을 에이전트의 실제 사용 패턴에 맞게 개선. 어떤 상황에서 이 도구를 선택해야 하는지 명확히.

이 고도화는 실사용 피드백 없이 선행하지 않는다. 먼저 풍부하게 만들고, 사용 데이터를 보고 깎는다.

---

## 구현 순서

1. 타입 정의 변경 (CardType을 architecture|spec으로, status를 draft|active|drifted로, parent 추가, relations 문자열 배열, boundary 추가, acceptance/priority/constraints/keywords/plan/task/deprecated 제거)
2. 검증 로직 (parent 존재/타입/순환, type 변경 시 자식 검증 + active 상태 activation 재검증, boundary glob 검증, relation 빈값/자기참조, activation guard, tag lowercase 정규화)
3. DB 스키마 새로 작성 (마이그레이션 없음. card에 parent+boundaryJson 추가, acceptanceJson/constraintsJson/priority 제거, card_relation에서 type 제거, keyword 테이블 제거)
4. 마크다운 파서 (parent, boundary 파싱/직렬화, relations 문자열 배열, 제거 필드 정리)
5. Repository 갱신 (CardRow에 parent+boundaryJson, RelationRepository type 제거, findChildren, findAncestors, tag 필터, updatedSince 필터, boundary 저장/조회)
6. Ops 레이어 (create, update, delete, rename, sync, query, context, bulk-create에 parent/relations/boundary 반영. pre_change_check에 find_affected_cards 흡수 + newUncoveredFiles 추가. check_drift에 boundary 비활성 drifted 전환 + driftType 분류. get_card_context에 generate_context 통합 + depth 파라미터 + truncated 표시. find_cards_by_symbol에 boundary 매칭 추가. delete에 참조 카드 파일 갱신. rename에 참조 파일 갱신 + bodyReferencesFound + changelog 기록. bulk_create에 위상 정렬. regression_guard에 drifted 비율 기반 판정. validate_cards에 재작업 의존성 경고 + draft architecture 빈 트리 제외. card_changelog에 parent/boundary/key 변경 추적)
7. API 버그 수정 (IMP-1~7, ops 레이어 변경과 동시)
8. 코드→스펙 도구 (SPEC-1 get_uncovered_symbols, SPEC-2 suggest_card_scope, boundary 기반 필터링)
9. 통합 분석 도구 (emberdeck_analyze, 프로젝트 건강도 전용)
10. MCP 도구 (스키마, 설명, 제거 필드 정리. acceptance 관련 도구 2개 + get_card_history + find_affected_cards + generate_context 제거. 신규 도구: get_card_tree, get_uncovered_symbols, suggest_card_scope. get_card에 includeHistory 추가. list_cards 필터 확장. activation guard 모든 진입점 적용)
11. 배럴 export 갱신
12. 테스트 갱신
13. SKILL.md
