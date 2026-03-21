# Phase 7: SKILL.md + Barrel Export + E2E 통합 테스트

선행: Phase 6

---

## 1. SKILL.md

- [ ] 도구 설명 갱신: 30개 도구 전체 반영
- [ ] 제거된 도구 설명 삭제 (verify_acceptance, list_unverified, get_card_history, find_affected_cards, generate_context)
- [ ] 신규 도구 설명 추가 (get_card_tree, get_uncovered_symbols, suggest_card_scope, analyze)
- [ ] 변경된 도구 설명 갱신:
  - create_card: parent, boundary 추가, acceptance/priority/keywords 제거
  - update_card: .strict(), status, parent, boundary
  - delete_card: force 옵션
  - list_cards: parent, tag, roots, updatedSince 필터
  - check_drift: autoTransition, driftType
  - pre_change_check: find_affected_cards 흡수, newUncoveredFiles
  - check_interactions: sharedFiles, importDependencies
  - regression_guard: drifted 비율 기반
  - validate_code_links: key optional, {declared, valid, broken, planned}
  - find_cards_by_symbol: boundary 매칭, matchType
  - get_card: includeHistory
  - get_card_context: depth, truncated
  - sync_spec_annotations: alreadyLinked, markerMissing, linkMissing
- [ ] 에이전트가 어떤 상황에서 어떤 도구를 선택해야 하는지 명확히 기술

---

## 2. Barrel Export

- [ ] `src/` 루트에 index.ts가 없으면 생성 불필요 (현재 없음, 직접 import 방식)
- [ ] 각 레이어 디렉토리에 barrel이 있다면 갱신:
  - `src/card/`: 제거된 타입/에러 export 정리, 신규 에러 export 추가
  - `src/db/`: 제거된 repository 메서드 인터페이스 정리
  - `src/ops/`: acceptance.ts export 제거, 신규 함수 export 확인 (analyze, getUncoveredSymbols, suggestCardScope, getCardTree)
- [ ] 외부 패키지에서 import하는 경로가 있다면 확인 (MCP 서버 등)

---

## 3. E2E 통합 테스트

### 시나리오 1: 온보딩 플로우
- [ ] suggest_card_scope로 카드 범위 제안 받기
- [ ] bulk_create_cards로 architecture + spec 카드 생성 (parent 관계 포함)
- [ ] validate_cards로 전체 검증 → 경고 없음
- [ ] analyze로 건강도 확인

### 시나리오 2: 코드 변경 플로우
- [ ] pre_change_check로 영향 카드 확인 (codeLink + boundary 매칭)
- [ ] check_drift로 drift 감지 → active→drifted 자동 전환
- [ ] regression_guard로 quality gate 확인

### 시나리오 3: 설계 변경 플로우
- [ ] update_card로 type 변경 (arch→spec) → activation 재검증
- [ ] update_card_status로 active 전환 → activation guard 검증
- [ ] rename_card → 참조 파일 갱신 + bodyReferencesFound + changelog
- [ ] get_card(includeHistory) → rename 이력 확인

### 시나리오 4: 카드 삭제 + 정리
- [ ] delete_card(force) → 자식 parent=null, 참조 relation 제거
- [ ] validate_cards → 고아 카드 경고
- [ ] bulk_sync_cards → DB↔파일 정합

### 시나리오 5: 코드→스펙 플로우
- [ ] get_uncovered_symbols → 미연결 심볼 확인
- [ ] create_card로 카드 생성 + codeLinks 연결
- [ ] validate_code_links → {declared, valid, broken=0}
- [ ] sync_spec_annotations → alreadyLinked 확인

---

## 4. gildash 최신 버전 최적화 재논의

모든 구현 완료 후, gildash 최신 버전(0.10.0+)의 기능을 최대한 활용하도록 최적화를 재논의한다.

대상:
- [ ] `searchRelations({ srcFilePathPattern })`: check_interactions의 importDependencies를 boundary glob 단위로 일괄 조회하여 per-file `getDependencies` 호출 대체
- [ ] `IndexResult.renamedSymbols/movedSymbols`: ensureReindexed가 IndexResult를 캐시하여, syncSymbolChanges와 check_drift가 changelog 재조회 없이 직접 활용
- [ ] `IndexResult.changedRelations`: import 관계 변경 감지를 check_interactions에 통합
- [ ] 확대된 `modified` 감지: symbol_changed 판정의 정밀도 검증 및 임계값 조정
- [ ] 미사용 gildash API(`getAffected`, `getImportGraph`, `getFanMetrics`) 활용 가능성 검토

이 최적화는 실구현 완료 후 실사용 데이터 기반으로 진행한다.

---

## 완료 조건

- [ ] 전체 테스트 스위트 통과
- [ ] `tsc --noEmit` 에러 없음
- [ ] MCP 도구 정확히 30개
- [ ] SKILL.md에 30개 도구 전부 기술
- [ ] REDESIGN_PLAN.md의 모든 항목이 구현됨
