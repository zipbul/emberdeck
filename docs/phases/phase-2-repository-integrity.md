# Phase 2: Repository + DB 연결 + 무결성 검증 + 정리

선행: Phase 1

---

## 1. Repository 인터페이스 변경 — `src/db/repository.ts`

### CardRow
- [ ] `parent: string | null` 추가
- [ ] `boundaryJson: string | null` 추가
- [ ] `acceptanceJson` 제거
- [ ] `constraintsJson` 제거
- [ ] `priority` 제거

### RelationRow
- [ ] `type` 제거
- [ ] `metaJson` 제거

### CardListFilter
- [ ] `parent?: string` 추가
- [ ] `tag?: string` 추가
- [ ] `roots?: boolean` 추가 (true면 parent IS NULL인 카드만)
- [ ] `updatedSince?: string` 추가 (ISO 8601)
- [ ] `sortBy`에서 `'priority'` 옵션 제거

### ClassificationRepository
- [ ] `replaceKeywords` 메서드 제거
- [ ] `findKeywordsByCard` 메서드 제거

### CardRepository
- [ ] `findChildren(key: string): CardRow[]` 메서드 추가
- [ ] `findAncestors(key: string): CardRow[]` 메서드 추가

---

## 2. CardRepository 구현 — `src/db/card-repo.ts`

### upsert
- [ ] `parent`, `boundaryJson` 컬럼 저장

### list (필터 확장)
- [ ] `parent` 필터: `WHERE parent = ?`
- [ ] `tag` 필터: `JOIN card_tag + tag WHERE tag.name = ?` (lowercase 매칭)
- [ ] `roots` 필터: `WHERE parent IS NULL`
- [ ] `updatedSince` 필터: `WHERE updatedAt >= ?` (ISO 8601 비교)
- [ ] `sortBy: 'priority'` 분기 제거

### 신규 메서드
- [ ] `findChildren(key)`: `SELECT * FROM card WHERE parent = ?`
- [ ] `findAncestors(key)`: parent 체인을 순회하여 루트까지 조상 배열 반환 (최대 20단계)

---

## 3. RelationRepository 구현 — `src/db/relation-repo.ts`

### replaceForCard
- [ ] 입력 타입 변경: `{type: string, target: string}[]` → `string[]`
- [ ] forward 행 insert에서 `type` 제거
- [ ] reverse 미러 행 insert에서 `type` 제거

### findByCardKey
- [ ] 반환 `RelationRow`에서 `type`, `metaJson` 없음 확인

---

## 4. ClassificationRepository 구현 — `src/db/classification-repo.ts`

- [ ] `replaceKeywords` 메서드 삭제
- [ ] `findKeywordsByCard` 메서드 삭제
- [ ] `pruneOrphans`에서 keyword 테이블 정리 로직 제거
- [ ] `replaceTags`, `findTagsByCard`, `deleteByCardKey` 유지

---

## 5. DB 연결 + 마이그레이션 — `src/db/connection.ts`

- [ ] 기존 마이그레이션 SQL 파일 갱신 또는 새 스키마로 재작성 (사용자 없음, 마이그레이션 호환 불필요)
- [ ] `drizzle/` 폴더의 SQL 마이그레이션 파일 갱신:
  - card 테이블에 parent + boundaryJson 컬럼
  - card 테이블에서 acceptanceJson, constraintsJson, priority 컬럼 제거
  - card_relation에서 type, metaJson 컬럼 제거
  - card_relation unique constraint 변경
  - keyword, cardKeyword 테이블 DROP
- [ ] FTS5 트리거가 새 스키마와 호환되는지 확인 (key, summary, body — 변경 없음)

---

## 6. setup 확인 — `src/setup.ts`

`allowedRelationTypes` 제거와 `coverageIgnore`/`regressionThreshold` 주입은 **Phase 1에서 처리 완료**.

- [ ] `ClassificationRepository` 인스턴스가 keyword 메서드 없이 동작하는지 확인

---

## 7. 무결성 검증 — `src/card/validation.ts` (Phase 1의 형식 검증에 추가)

**DB 조회가 필요한 검증. Repository가 있어야 구현 가능.**

- [ ] `validateParentExists(ctx, parentKey)`: parent가 존재하지 않는 카드를 가리키면 `ParentValidationError`
- [ ] `validateParentType(ctx, cardType, parentKey)`: architecture parent는 null 또는 architecture, spec parent는 architecture 또는 spec. 위반 시 `ParentValidationError`
- [ ] `validateParentCycle(ctx, cardKey, parentKey)`: 조상 체인 순회 (최대 20), 순환 감지 시 `ParentValidationError`
- [ ] `validateRelationTargets(ctx, relations)`: relation 대상 카드가 모두 DB에 존재하는지 확인. 미존재 시 에러 반환 (REDESIGN_PLAN 128행: "relation 대상이 존재하지 않으면 거부"). 현재 코드는 FK 위반 시 silently skip하므로, 명시적 존재 검사로 변경
- [ ] `validateChildrenHierarchy(ctx, cardKey, newType)`: type 변경 시 자식 카드들의 parent-type 계층이 깨지면 에러
- [ ] `validateActivationGuard(ctx, card)`: status=active 설정 시:
  - architecture: 조건 없음, 통과
  - spec: codeLinks 1개 이상 + 모두 resolve + boundary 있으면 최소 1파일 매칭
  - 미충족 시 `ActivationGuardError` (unmetConditions 배열)
- [ ] `validateTypeChangeActivation(ctx, card, newType)`: active 상태에서 type 변경 시 새 타입 조건 재검증. arch→spec 미충족 시 status를 draft로 강제 전환

---

## 8. 파일 삭제

~~`src/ops/acceptance.ts` 삭제는 Phase 3으로 이동.~~ tools.ts가 acceptance.ts를 import하므로 MCP 도구 제거(Phase 3)와 동시에 삭제해야 컴파일 에러 방지.

---

## 9. 테스트

- [ ] Repository 메서드 테스트: findChildren, findAncestors, list 필터 (parent, tag, roots, updatedSince)
- [ ] RelationRepository: string[] 입력, type 없는 insert/query
- [ ] ClassificationRepository: keyword 메서드 없이 동작
- [ ] 무결성 검증 테스트: parent 존재, parent 타입, 순환 참조, **relation 대상 존재**, activation guard (arch/spec), type 변경 + activation 재검증
- [ ] DB 마이그레이션: 새 스키마로 테이블 생성, 제거 컬럼/테이블 부재 확인

---

## 완료 조건

- [ ] **`tsc --noEmit`은 Phase 3 완료 전까지 통과하지 않음** — ops/, mcp/ 파일이 구 타입 참조 중. 예상된 동작
- [ ] Phase 2 범위 단위 테스트 통과 (repository, validation 무결성)
- [ ] keyword 테이블 및 관련 코드 제거 완료
- [ ] `acceptance.ts`는 Phase 3에서 삭제 (tools.ts import 의존성)
