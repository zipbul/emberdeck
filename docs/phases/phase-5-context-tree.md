# Phase 5: 컨텍스트 통합 + 트리 + 심볼 검색 확장

선행: Phase 4 (Phase 4와 context.ts를 공유하므로 병렬 불가)

---

## 1. get_card_context 통합 — `src/ops/query.ts` getCardContext + `src/ops/context.ts` generateContext

### generate_context 흡수
- [ ] `getCardContext(ctx, key, depth?)` — depth 파라미터 추가
  - depth=1 (기본): 직접 관계만 반환 (기존 getCardContext 동작)
  - depth>1: BFS 그래프 탐색 (기존 generateContext 동작)
- [ ] depth 초과 시 응답에 `truncated: true` 표시
- [ ] `generateContext` 함수 삭제 또는 내부 헬퍼로 전환 (export 제거)
- [ ] 반환 타입에서 `ContextRelation.type` 제거 (relations에서 type 제거 반영)
- [ ] 반환 타입에서 `ContextAcceptance` 제거 (acceptance 제거 반영)

---

## 2. get_card_tree — 신규 함수

### 위치: `src/ops/query.ts` (또는 별도 `src/ops/tree.ts`)

- [ ] `getCardTree(ctx, key, maxDepth?)` 함수 신규 작성
- [ ] 입력: `{ key: string, maxDepth?: number }` — maxDepth 기본 10, 최대 20
- [ ] 출력: 재귀 구조 `{ key, summary, type, status, depth, children: TreeNode[], truncated?: boolean }`
- [ ] `cardRepo.findChildren(key)` 사용하여 하위 트리 구축
- [ ] depth가 maxDepth에 도달하면 해당 노드에 `truncated: true` (자식이 더 있을 때만)
- [ ] 존재하지 않는 key → `CardNotFoundError`

---

## 3. find_cards_by_symbol 확장 — `src/ops/link.ts` findCardsBySymbol

- [ ] 기존: codeLink 기반 검색만
- [ ] **boundary glob 매칭 추가**: 심볼의 파일 경로가 카드의 boundary 패턴에 매칭되면 결과에 포함
- [ ] 응답에 `matchType: 'codeLink' | 'boundary'` 표시
- [ ] ensureReindexed 호출 확인 (IMP-6)

---

## 4. MCP 도구 갱신 — `src/mcp/tools.ts`

### 신규 등록
- [ ] `emberdeck_get_card_tree` 등록: key (필수), maxDepth (선택, 기본 10, 최대 20)

### 스키마 갱신
- [ ] `emberdeck_get_card_context`: depth 파라미터 추가. 응답에 truncated 표시. acceptance 관련 필드 제거
- [ ] `emberdeck_find_cards_by_symbol`: 응답에 matchType 추가

### 제거 확인
- [ ] `emberdeck_generate_context`가 Phase 3에서 이미 제거되었는지 확인
- [ ] `emberdeck_get_card_history`가 Phase 3에서 이미 제거되었는지 확인

---

## 5. 테스트

- [ ] get_card_context depth=1: 직접 관계만 반환
- [ ] get_card_context depth=3: BFS 탐색, 깊이 초과 시 truncated
- [ ] get_card_tree: 3단계 트리 구축, maxDepth 초과 시 truncated, 잎 노드 children=[], 미존재 key → 에러
- [ ] find_cards_by_symbol: codeLink 매칭 → matchType='codeLink', boundary 매칭 → matchType='boundary'

---

## 완료 조건

- [ ] `tsc --noEmit` 에러 없음
- [ ] Phase 5 범위 모든 테스트 통과
- [ ] generateContext가 외부에서 직접 호출 불가 (export 제거 또는 삭제)
- [ ] MCP 도구 수: 26 + 1 (get_card_tree) = 27개
