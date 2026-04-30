> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# Request: writeSpecAnnotations를 양방향 reconciler로 변환

## 배경

`writeSpecAnnotations`(`src/ops/spec-sync.ts:138`)는 현재 INSERT 전용이다.
DB codeLink에 있는데 소스에 없는 `@spec` 주석만 삽입하고, 소스에 있는데 DB에 없는 고아 주석은 건드리지 않는다.

이로 인해 카드 삭제, 카드 리네임, codeLink 제거, DB 초기화 등의 시나리오에서 고아 `@spec` 주석이 소스에 남는다.

## 불변식

> codeLink 테이블의 모든 (cardKey, file, symbol) 삼중쌍에 대해, 해당 소스 심볼 위에 정확히 하나의 `@spec cardKey` 주석이 존재한다. 그 외의 @spec 주석은 없다.

## 고아가 발생하는 시나리오

| # | 작업 | DB 변화 | 소스 결과 |
|---|------|---------|----------|
| 1 | deleteCard | FK CASCADE로 codeLink 삭제 | @spec 잔류 → ORPHAN |
| 2 | renameCard (키 변경) | FK CASCADE로 cardKey 갱신 | 구 키 @spec 잔류 + 신 키 부재 |
| 3 | updateCard: codeLink 제거 | codeLink 행 삭제 | @spec 잔류 → ORPHAN |
| 4 | updateCard: codeLink 변경 | 구 행 삭제 + 신 행 추가 | 구 심볼에 ORPHAN + 신 심볼에 MISSING |
| 5 | spec→brief 타입 변경 | codeLinks 무의미화 | @spec 잔류 → ORPHAN |
| 6 | DB 초기화 후 재카드화 | 새 키로 codeLink 생성 | 구 키 ORPHAN + 신 키 중복 삽입 |

## 요구 변경

### 1. `WriteSpecResult` 인터페이스 확장

```typescript
export interface WriteSpecResult {
  annotated: number;       // 삽입된 @spec 수 (기존)
  alreadyPresent: number;  // 이미 존재하여 스킵 (기존)
  symbolNotFound: number;  // 심볼 미발견 (기존)
  removed: number;         // 제거된 고아 @spec 수 (신규)
}
```

### 2. `writeSpecAnnotations` 함수 로직 변경

현재:
```
for each codeLink in DB:
  if @spec not in source → INSERT
```

변경 후:
```
STEP 1 — SCAN: 소스 전체에서 @spec 주석 수집
  → actual: Set<{cardKey, file, line}>
  (gildash.searchAnnotations({tag: 'spec'}) 활용 가능)

STEP 2 — BUILD: DB codeLink 테이블에서 desired set 구축
  → desired: Set<{cardKey, file, symbol}>

STEP 3 — REMOVE: actual에 있는데 desired에 없는 항목
  → 해당 소스 파일에서 @spec 행 삭제
  → JSDoc 블록 안의 @spec 행만 제거 (블록 자체는 유지)
  → 단독 /** @spec card-key */ 주석은 전체 행 삭제

STEP 4 — ADD: desired에 있는데 actual에 없는 항목
  → 기존 INSERT 로직 그대로 사용
```

### 3. REMOVE 시 주의사항

- `/** @spec card-key */` (단독 한 줄 주석) → 해당 줄 전체 삭제
- 멀티라인 JSDoc 안의 ` * @spec card-key` → 해당 줄만 삭제, JSDoc 블록 유지
- 멀티라인 JSDoc에서 `@spec`이 유일한 내용이었을 경우 → JSDoc 블록 전체 삭제
- 삭제 후 빈 줄이 연속되면 하나로 합침

### 4. cardKey 파라미터 동작 변경

- `cardKey` 제공 시: 해당 카드의 codeLink만 ADD, 해당 카드 키의 고아만 REMOVE
- `cardKey` 미제공 시: 전체 reconcile (전체 SCAN + 전체 BUILD + diff)

## 관련 파일

- `src/ops/spec-sync.ts` — writeSpecAnnotations 함수 (L138-L321)
- `src/ops/spec-sync.ts` — scanAbove 함수 (L329-L386, REMOVE 로직에서 재활용 가능)
- `src/ops/spec-sync.ts` — WriteSpecResult 인터페이스 (L121-L129)
- `src/mcp/tools.ts` — MCP 도구 등록 (result에 removed 필드 추가 필요)

## 검증 시나리오

변경 후 아래 시나리오 각각에서 `writeSpecAnnotations()` 실행 후 불변식이 성립해야 한다:

1. 카드 생성 후 실행 → 모든 codeLink에 @spec 존재, removed=0
2. 카드 삭제 후 실행 → 해당 카드의 @spec 전부 제거, removed>0
3. 카드 리네임 후 실행 → 구 키 제거 + 신 키 삽입
4. codeLink 제거 후 실행 → 해당 심볼의 @spec 제거
5. DB 초기화 후 실행 → 모든 @spec 제거, removed=전체 수
6. 정상 상태에서 실행 → annotated=0, removed=0 (멱등성)

## 기존 테스트 영향

- `syncSpecAnnotations` 테스트는 변경 없음 (읽기 방향은 그대로)
- `writeSpecAnnotations` 테스트에 removed 검증 케이스 추가 필요

## 관련 카드

- `code-link-contract` — @spec 주석의 생명주기가 이 카드 스코프에 포함됨
- skill `SKILL.md` onboarding/feature 워크플로우에서 write_spec_annotations 호출 단계가 이미 추가되어 있음
