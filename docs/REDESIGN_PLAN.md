# Emberdeck 카드 스키마 재설계

## 배경

현재 카드는 작업 분류 타입(`feature | bug | refactor | spike | decision`)을 사용하고 계층 구조가 없다. 카드는 정책이어야 하고, 정책은 계층을 가진다. 상위 정책이 하위 정책의 존재 이유를 설명한다.

## 확정: 카드 스키마 (10 필드)

```
key           — 식별자 (필수)
summary       — 한 줄 요약 (필수)
status        — draft | accepted | implementing | implemented | deprecated (필수)
type          — architecture | spec | plan | task (필수)
parent        — 상위 카드 key (선택, 같은 type 또는 바로 위 type만 허용)
acceptance    — [{id, description, verified}] (선택)
relations     — [target_key] (선택, 문자열 배열. 방향은 선언자 기준)
codeLinks     — [{kind, file, symbol}] (선택)
tags          — string[] (선택, 카테고리 검색용)
body          — 마크다운 본문 (필수)
```

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

## 확정: 4개 타입

```
architecture  → 시스템의 기획 구조. 어떤 영역들이 존재하고, 영역 간 경계와 관계가 무엇인가. (영속)
spec          → 특정 영역이 무엇을 보장해야 하는가. 구현이 바뀌어도 유효한 계약. (영속)
plan          → spec을 어떻게 실현할 것인가. 완료되면 역할 종료. (비영속)
task          → plan 안의 개별 작업 단위. 가장 작은 실행 단위. (비영속)
```

## 확정: parent 규칙

- architecture: parent는 null(루트) 또는 다른 architecture
- spec: parent는 architecture 또는 다른 spec
- plan: parent는 spec 또는 다른 plan
- task: parent는 plan 또는 다른 task
- 순환 참조 금지 (체인 최대 깊이 20)
- FK: ON UPDATE CASCADE, ON DELETE SET NULL

## 확정: 제거된 필드

- priority → 에이전트는 find_affected_cards로 관련 카드를 가져옴. 우선순위 필터링 불필요.
- keywords → tags로 통합. 두 필드의 구분이 불가능했음.
- constraints → body에 담으면 되는 내용. 쿼리하는 API 없음.
- inScope/outOfScope → body에 담으면 되는 내용. 구조화해도 쿼리 API 없음.
- relation type → 모든 알고리즘이 타입을 구분하지 않음. 무의미한 분류.

## 확정: 유지된 필드

- tags → 카테고리 검색용. FTS5는 텍스트 매칭이지 의미 매칭이 아님.
- relations → 횡단 참조. parent(트리)와 독립. 타입 없이 문자열 배열로 단순화.
- codeLinks → 코드-카드 연결. emberdeck의 핵심 기능. kind는 심볼 속성이라 유지.
- acceptance → 정책 충족 검증. spec-driven의 핵심.

## 리트머스 테스트

카드 body가 올바른지 판별: "구현을 완전히 다시 쓰면 이 카드가 여전히 유효한가?"
- architecture, spec: 유효해야 한다
- plan, task: 유효하지 않아도 된다

## 검증 완료 (10개 시나리오)

1. 신규 프로젝트 — PASS
2. 기능 추가 — PASS
3. 작은 버그 수정 — PASS (spec AC 업데이트, task 카드 불필요)
4. 구조 문제 발견 — PASS (새 architecture + spec + plan)
5. 구현 변경 (REST→GraphQL) — PASS (spec 유지, plan만 교체)
6. 교차 관심사 (인증) — PASS (relations로 연결)
7. 레거시 코드베이스 카드화 — PASS (architecture + spec만)
8. 스펙 변경 (파괴적) — PASS (spec 수정 + plan 교체)
9. 팀 간 기능 — PASS (새 architecture + 양쪽 relations)
10. 프로젝트 피봇 — PASS (deprecated + 새 카드)

## DB 스키마 (새로 만듦, 마이그레이션 없음)

- `card` 테이블: key, summary, status, type, parent, acceptanceJson, body, filePath, updatedAt
- `parent` FK: ON UPDATE CASCADE, ON DELETE SET NULL, 인덱스
- `card_relation` 테이블: srcCardKey, dstCardKey, isReverse (type 컬럼 없음)
- unique constraint: `(src, dst, isReverse)`
- `tag` + `card_tag` 테이블 유지 (keywords 테이블 제거)
- `code_link` 테이블 유지
- `card_changelog` 테이블 유지
- `card_fts` FTS5 유지
- `constraints_json`, `priority`, `keywords` 관련 컬럼/테이블 제거
- `allowedRelationTypes` 설정 제거

## 검증 기준 (validate_cards 확장 또는 신규 도구)

### 쓰기 시점 검증 (create/update에서 거부)

- parent가 존재하지 않는 카드를 가리키면 거부
- parent의 type이 규칙에 맞지 않으면 거부 (예: task의 parent가 architecture이면 거부)
- 순환 parent 참조 감지 시 거부 (체인 최대 20)
- relation 대상이 존재하지 않으면 거부
- relation 배열에 빈 문자열이 있으면 거부
- relation에 자기 자신을 참조하면 거부
- type 변경 시 자식 카드들의 parent-type 계층이 깨지면 거부 (예: 자식 spec이 있는 architecture를 task로 변경 불가)
- key 길이 제한 (최대 200자)
- acceptance criteria 개수 제한 (최대 100개)
- acceptance criteria ID 중복 거부
- acceptance criteria id/description 빈 문자열 거부
- codeLinks file/symbol 빈 문자열 거부

### 읽기 시점 검증 (전체 카드셋 일괄 진단)

- 고아 카드: parent가 null인데 type이 architecture가 아닌 카드 (parent가 삭제되어 SET NULL된 경우)
- 깨진 parent: DB에는 parent가 있지만 해당 카드가 존재하지 않는 경우 (파일 sync 시 발생 가능)
- type 계층 위반: parent의 type이 규칙에 맞지 않는 카드 (파일 직접 편집으로 유입 가능)
- 깨진 relation: relation 대상이 존재하지 않는 카드
- 빈 트리: architecture 카드인데 하위 spec이 하나도 없는 경우 (경고, 거부 아님)
- codeLinks 정합성: 기존 validate_code_links가 담당 (변경 없음)
- DB↔파일 정합성: 기존 validate_cards가 담당 (parent 필드 추가 반영)

### relation 생성 순서

relation 대상이 존재해야 하므로, 상호 참조하는 카드를 만들 때는 관계 없이 먼저 생성하고 update로 relation을 추가한다. 이건 기존 bulk_create의 2단계 패턴과 동일한 접근이며, 단일 create 시에도 적용된다.

### 고아 카드 정책

parent: null인 비-architecture 카드(spec, plan, task)는 **쓰기 시 허용**된다. 거부하지 않는다. 교차 관심사 spec은 특정 architecture에 속하지 않을 수 있다. 읽기 시 진단에서 **경고**(거부 아님)로 표시한다.

### 기존 코드 버그 수정 (재설계와 함께 해결)

- rename 후 참조하는 카드 파일의 relation 대상 및 **자식 카드 파일의 parent 값**이 갱신되지 않음 (DB는 CASCADE로 갱신되지만 파일은 구 key 유지 → sync 시 복원됨). 해결: rename 시 영향받는 모든 카드 파일을 재작성.
- bulkSync 시 중복 key 파일이 조용히 덮어씀 (데이터 소실 위험). 해결: 중복 key 감지 시 에러 반환.

## 추가 구현 사항

### tag 검색 지원

tags 필드를 유지한 이유가 카테고리 검색인데, 현재 `list_cards`에 tag 필터가 없고 FTS5도 tags를 인덱싱하지 않음. tags를 넣어도 검색할 수 없는 상태.

해결: `list_cards`에 tag 필터 추가. `listCards(ctx, { tag: "security" })` → 해당 태그가 있는 카드만 반환.

### get_card_tree MCP 도구 상세

- 입력: `{ key: string, maxDepth?: number }`
- 출력: 카드의 하위 트리. 각 노드는 `{ key, summary, type, status, depth, children: [] }` 재귀 구조.
- maxDepth 기본값: 10. 최대값: 20.
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
| parent 검증 | 존재 확인, type 계층, 순환 감지, type 변경 시 자식 계층 검증 |
| findChildren(key) | 자식 카드 조회 (Repository 신규 메서드) |
| findAncestors(key) | 조상 체인 조회 (Repository 신규 메서드) |
| get_card_tree MCP 도구 | 하위 트리 반환 (신규 도구) |
| list_cards 필터 확장 | parent, roots, tag 필터 추가 |
| delete 경고 | 자식이 있는 카드 삭제 시 경고 반환 |

### 제거 대상

| 대상 | 이유 |
|------|------|
| priority 필드 | 에이전트가 사용하지 않음 |
| constraints_json 컬럼 | body로 대체 |
| keywords 테이블 + card_keyword 테이블 | tags로 통합 |
| allowedRelationTypes 설정 | relation type 자체 제거 |
| RelationTypeError 에러 클래스 | relation type 검증 불필요 |
| addRelationType / removeRelationType | 설정 제거에 따라 |
| CardRelation.type | relation에서 type 제거 |

### 변경 없는 부분

| 대상 | 상태 |
|------|------|
| codeLinks `{kind, file, symbol}` | 현상유지 |
| gildash 연동 (reindex, resolve, validate) | 현상유지 |
| findAffectedCards | 현상유지 (codeLinks 기반, relation 무관) |
| validateCodeLinks (planned/broken 분류) | 현상유지 (status 기반 분류) |
| check_drift (drift score 공식) | 현상유지 |
| syncSpecAnnotations / syncSymbolChanges | 현상유지 |
| getLinkCoverage | 현상유지 |
| safeWriteOperation / withCardLock / withRetry | 현상유지 |
| FTS5 인덱스 (key, summary, body) | 현상유지 |
| card_changelog | 현상유지 |
| CompensationError | 현상유지 |

## 구현 순서

1. 타입 정의 변경 (새 CardType, parent 추가, relations 문자열 배열, 제거 대상 삭제)
2. 검증 로직 (parent 존재/타입/순환, type 변경 시 자식 검증, key 길이, AC 중복/빈값, relation 빈값/자기참조)
3. DB 스키마 새로 작성 (마이그레이션 없음, 밀고 새로 만듦)
4. 마크다운 파서 (parent 파싱/직렬화, relations 문자열 배열, 제거 필드 정리)
5. Repository 갱신 (CardRow, RelationRepository, findChildren, findAncestors, tag 필터)
6. Ops 레이어 (create, update, delete, rename, sync, query, context, bulk-create에 parent/relations 반영)
7. MCP 도구 (스키마, 설명, 제거 필드 정리, 신규 get_card_tree 도구, list_cards 필터 확장)
8. 배럴 export 갱신
9. 테스트 갱신
10. SKILL.md
