# Phase 3: CRUD Ops + MCP 동시 갱신 + 도구 제거

선행: Phase 2

---

## 1. create — `src/ops/create.ts`

### CreateCardInput
- [ ] `slug` → `key`로 리네이밍 (REDESIGN_PLAN MCP 도구 테이블: create_card 입력이 `key`)
- [ ] `parent?: string` 추가
- [ ] `boundary?: string[]` 추가
- [ ] `status?: CardStatus` 추가 (기본값 'draft', 지정 시 activation guard 적용)
- [ ] `relations` 타입을 `CardRelation[]` → `string[]`로 변경
- [ ] `priority?` 제거
- [ ] `acceptance?` 제거
- [ ] `constraints?` 제거
- [ ] `keywords?` 제거

### createCard 함수
- [ ] **82-84행 acceptance 강제 체크 제거**: `if (!input.acceptance || input.acceptance.length === 0) throw` — 이것이 남아있으면 카드 생성 불가
- [ ] parent 저장 (DB + 파일)
- [ ] boundary 저장 (DB boundaryJson + 파일)
- [ ] relations를 string[]로 `relationRepo.replaceForCard` 전달
- [ ] status 지정 시 activation guard 호출 (`validateActivationGuard`)
- [ ] tags 저장 시 lowercase 정규화 적용 확인
- [ ] acceptance, priority, constraints, keywords 관련 로직 전부 제거
- [ ] `classificationRepo.replaceKeywords` 호출 제거
- [ ] `import { RelationTypeError }` 제거
- [ ] `import { CardRelation, CardPriority, AcceptanceCriterion }` 제거

---

## 2. update — `src/ops/update.ts`

### UpdateCardFields
- [ ] `parent?: string | null` 추가 (null은 parent 해제)
- [ ] `boundary?: string[]` 추가
- [ ] `status?: CardStatus` 추가 (기존에 updateCardStatus가 별도지만, update에서도 status 변경 가능하게)
- [ ] `relations` 타입을 `string[]`로 변경
- [ ] `priority?` 제거
- [ ] `acceptance?` 제거
- [ ] `constraints?` 제거
- [ ] `keywords?` 제거

### updateCard 함수
- [ ] parent 변경 시 parent 무결성 검증 (존재, 타입, 순환)
- [ ] boundary 변경 시 형식 검증
- [ ] status=active 지정 시 activation guard 호출
- [ ] type 변경 시 + active 상태면 새 타입 activation 재검증 (미충족 → draft 강제)
- [ ] type 변경 시 자식 카드 parent-type 계층 검증 (`validateChildrenHierarchy`)
- [ ] parent, boundary 변경을 card_changelog에 기록
- [ ] acceptance, priority, constraints, keywords 관련 로직 제거

### updateCardStatus 함수
- [ ] `reason?: string` 파라미터 추가 (REDESIGN_PLAN 517행: `key, status, reason?`)
- [ ] activation guard 적용 (status=active일 때)
- [ ] status 변경을 card_changelog에 기록 (reason 포함)

---

## 3. delete — `src/ops/delete.ts`

### deleteCard 함수
- [ ] `force?: boolean` 파라미터 추가
- [ ] force=false(기본): 자식이 있으면 에러 반환
- [ ] force=true: 자식이 있어도 삭제 진행
- [ ] 삭제 시 자식 카드 파일에서 parent 필드 제거 + 파일 재작성
- [ ] 삭제 시 relation으로 이 카드를 참조하는 다른 카드 파일에서 해당 key 제거 + 파일 재작성
- [ ] DB CASCADE가 card_relation, card_tag, code_link, card_changelog를 자동 정리하는지 확인

---

## 4. rename — `src/ops/rename.ts`

### renameCard 함수
- [ ] 참조하는 모든 카드 파일 재작성: relations 필드에서 구 key → 새 key
- [ ] 참조하는 모든 카드 파일 재작성: parent 필드에서 구 key → 새 key
- [ ] body 본문에서 구 key가 발견되면 응답에 `bodyReferencesFound: string[]` 반환
- [ ] card_changelog에 key 변경 기록 (field="key", oldValue=구key, newValue=새key)
- [ ] newKey 중복 체크 유지 확인 (`CardAlreadyExistsError`)
- [ ] RenameCardResult에 `bodyReferencesFound?: string[]` 추가

---

## 5. sync — `src/ops/sync.ts`

### syncCardFromFile
- [ ] parent, boundary 필드 파싱하여 DB에 저장
- [ ] relations를 string[]로 처리

### bulkSyncCards
- [ ] 중복 key 파일 감지 시 에러 반환 (데이터 소실 방지)
- [ ] parent, boundary 반영

### validateCards (읽기 시점 검증 추가)
- [ ] 고아 카드 감지: parent=null + type≠architecture (경고)
- [ ] 깨진 parent 감지: parent가 존재하지 않는 카드 참조
- [ ] type 계층 위반 감지: parent type 규칙 불일치
- [ ] 깨진 relation 감지: relation 대상이 존재하지 않음
- [ ] 빈 트리 감지: architecture 카드에 하위 spec 없음 (경고, draft architecture 제외)
- [ ] boundary 겹침 감지: 두 카드 boundary가 같은 파일 포함 (parent-child 간 허용, 그 외 경고)
- [ ] 재작업 의존성 감지: active 카드가 draft 카드에 relation (경고)

### exportCardToFile
- [ ] parent, boundary 필드 직렬화

---

## 6. bulk-create — `src/ops/bulk-create.ts`

- [ ] Phase 1: parent 의존성에 따른 위상 정렬 순서로 카드 생성
- [ ] 같은 배치 내 parent 참조 보장 (부모가 먼저 생성)
- [ ] Phase 2: relations 추가 (기존 2단계 패턴 유지)
- [ ] 각 카드에 status 지정 시 activation guard 적용
- [ ] relations를 string[]로 처리
- [ ] CreateCardInput 변경 반영 (parent, boundary 추가, 제거 필드)

---

## 7. query — `src/ops/query.ts`

### listCards
- [ ] CardListFilter 확장 반영: parent, tag, roots, updatedSince 필터 전달

### getRelationGraph
- [ ] 출력에서 `relationType` 필드 제거 (`RelationGraphNode.relationType`)

### searchCards
- [ ] `type?: CardType` 필터 파라미터 추가 (REDESIGN_PLAN 459행: `query, type?, status?`)
- [ ] `status?: CardStatus` 필터 파라미터 추가

### getCard, listCardRelations
- [ ] 반환 타입이 새 CardRow/RelationRow와 일치하는지 확인

### getCard 확장
- [ ] `includeHistory?: boolean` 옵션 추가
- [ ] true면 `changelogRepo.findByCardKey(key)`에서 최근 변경 내역 포함 (rename 이력 포함)
- [ ] 반환 타입에 `history?: ChangelogRow[]` 추가

---

## 8. MCP 도구 갱신 — `src/mcp/tools.ts`

### 스키마 갱신
- [ ] `emberdeck_create_card`: parent, boundary 추가. priority, acceptance, constraints, keywords 제거. relations를 `z.array(z.string())`로. `.strict()` 적용
- [ ] `emberdeck_update_card`: parent, boundary, status 추가. priority, acceptance, constraints, keywords 제거. relations를 `z.array(z.string())`로. `.strict()` 적용
- [ ] `emberdeck_update_card_status`: `reason?: z.string()` 추가. activation guard 적용 안내 설명 갱신
- [ ] `emberdeck_search_cards`: `type?: z.enum()`, `status?: z.enum()` 필터 추가
- [ ] `emberdeck_delete_card`: `force?: z.boolean()` 추가
- [ ] `emberdeck_rename_card`: 응답에 bodyReferencesFound 포함
- [ ] `emberdeck_get_card`: `includeHistory?: z.boolean()` 파라미터 추가
- [ ] `emberdeck_list_cards`: parent, tag, roots, updatedSince 필터 추가. sortBy에서 priority 제거
- [ ] `emberdeck_bulk_create_cards`: Phase 3 CreateCardInput 변경 반영. 활성화 (현재 disabled 상태)
- [ ] `emberdeck_bulk_sync_cards`: 변경 없음 확인
- [ ] `emberdeck_validate_cards`: 새 검증 항목 반영 (고아, 계층위반, boundary 겹침, 재작업 의존성 등)

### IMP-3: .strict() 적용
- [ ] `emberdeck_create_card` Zod 스키마에 `.strict()` 적용
- [ ] `emberdeck_update_card` Zod 스키마에 `.strict()` 적용
- [ ] 기타 입력을 받는 모든 도구에 `.strict()` 적용 검토

### 도구 제거 + 파일 삭제
- [ ] `emberdeck_verify_acceptance` 제거
- [ ] `emberdeck_list_unverified` 제거
- [ ] `emberdeck_get_card_history` 제거 (get_card includeHistory로 대체)
- [ ] `emberdeck_find_affected_cards` 제거 (pre_change_check로 흡수, Phase 4)
- [ ] `emberdeck_generate_context` 제거 (get_card_context로 통합, Phase 5)
- [ ] `import { verifyAcceptance, listUnverified, getCardHistory } from '../ops/acceptance'` 제거 (tools.ts 46-50행)
- [ ] `import { generateContext } from '../ops/context'` 제거 (tools.ts 52행)
- [ ] `import { findAffectedCards } from '../ops/link'` 제거 (tools.ts 43행)
- [ ] **`src/ops/acceptance.ts` 파일 삭제** (Phase 2에서 이동됨 — tools.ts import 제거와 동시에 삭제해야 컴파일 에러 방지)

---

## 9. 테스트

- [ ] create: parent/boundary 포함 생성, activation guard 검증 (spec+active+no codeLinks → 에러), relations string[]
- [ ] update: parent 변경, type 변경 + activation 재검증, 자식 계층 검증, changelog 기록
- [ ] delete: force=true 자식 있는 카드 삭제 → 자식 parent=null, 참조 카드 파일에서 key 제거
- [ ] rename: 참조 파일 갱신 (relations, parent), bodyReferencesFound, changelog 기록
- [ ] sync: parent/boundary 반영, 중복 key 에러, validateCards 읽기 시점 검증 전체
- [ ] bulk-create: 위상 정렬, parent 참조, activation guard
- [ ] query: listCards 필터 (parent, tag, roots, updatedSince), getRelationGraph relationType 제거
- [ ] get_card: includeHistory=true → changelog 포함, rename 이력 포함
- [ ] MCP: .strict()로 미정의 키 거부, 제거된 도구 호출 시 에러

---

## 완료 조건

- [ ] **`tsc --noEmit` 에러 없음** — Phase 1-3 통합 후 최초로 전체 컴파일 통과
- [ ] 모든 CRUD ops 테스트 통과
- [ ] MCP 도구 31개 → 26개 (5개 제거)
- [ ] `src/ops/acceptance.ts` 파일 삭제 완료
- [ ] acceptance, priority, keywords, CardRelation, RelationTypeError 관련 코드가 전체 코드베이스에 남아있지 않음
