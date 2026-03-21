# Phase 4: 분석 Ops + IMP 버그 수정 통합

선행: Phase 3

---

## 1. check_drift — `src/ops/context.ts` checkDrift 함수

### sync → async 전환
- [ ] `checkDrift`를 `export function` → `export async function`으로 변경 (boundary glob 파일시스템 체크 + active→drifted 전환 시 파일 쓰기 필요)
- [ ] 모든 호출처(`tools.ts`, `impact.ts` 등)에 `await` 추가
- [ ] `writeCardFile`, `buildCardPath` import 추가 (active→drifted 전환 시 카드 파일 status 갱신)

### 기존 drift score 제거
- [ ] 가중 평균 공식 (`brokenLinkRatio * 0.3 + staleCardRatio * 0.3 + ...`) 제거
- [ ] `DriftResult.driftScore` 제거

### 새 구조
- [ ] 카드별 status 판정: active 또는 drifted
- [ ] `driftType` 분류: `'broken_link' | 'boundary_inactive' | 'symbol_changed'`
  - `broken_link`: codeLinks가 resolve 안 됨
  - `boundary_inactive`: boundary glob이 아무 파일과도 매칭 안 됨
  - `symbol_changed`: boundary 내 심볼이 변경됨 (아래 감지 로직 참조)
- [ ] 카드별 `brokenLinks` / `totalLinks` 카운트
- [ ] 프로젝트 건강도: `drifted 카드 수 / 전체 카드 수`
- [ ] `autoTransition` 파라미터 추가 (기본 true)
  - true: active→drifted 자동 전환 수행 (DB + 파일 갱신)
  - false: 판정만 보고, status 전환하지 않음
- [ ] **boundary 비활성 = drifted 전환 트리거** (경고가 아님)
- [ ] draft 카드의 codeLinks는 planned 취급 → drifted 전환 대상에서 제외

### symbol_changed 감지 로직
- [ ] boundary가 있는 active 카드 중 가장 오래된 `updatedAt` 산출
- [ ] `gildash.getSymbolChanges(oldestUpdatedAt)` 단일 호출 (added/modified/removed/renamed/moved 전부)
- [ ] 변경 목록을 filePath로 인덱싱: `Map<string, SymbolChange[]>`
- [ ] 각 카드별: boundary glob 매칭 파일의 변경 중 `card.updatedAt` 이후 것 필터
- [ ] 변경 존재 시 `driftType = 'symbol_changed'`, 변경 상세(changeType, symbolName, filePath)를 응답에 포함
- [ ] gildash 미지원 시 symbol_changed 감지 건너뜀 (graceful degradation)

### 반환 타입 변경
- [ ] `DriftResult` → `{ cards: Array<{ key, summary, status, driftType?, brokenLinks, totalLinks }>, health: { total, active, drifted, draft } }`

---

## 2. pre_change_check — `src/ops/impact.ts` preChangeCheck 함수

### find_affected_cards 흡수
- [ ] 기존 `findAffectedCards` 함수(`src/ops/link.ts`)의 로직을 `preChangeCheck` 내부로 통합
- [ ] codeLinks 기반 영향 카드 탐지 (기존)
- [ ] **boundary glob 매칭 추가**: 변경 파일이 카드의 boundary 패턴에 매칭되면 affected

### 응답 변경
- [ ] `newUncoveredFiles: string[]` 추가: 변경된 파일 중 어떤 카드에도 연결되지 않은 파일 (coverageIgnore 패턴 적용 후)
- [ ] `AtRiskAcceptance` 제거 (acceptance 필드 자체가 삭제됨)
- [ ] `RiskLevel` 변경: priority 기반 → 카드 수 + drifted 비율 기반
- [ ] 카드별 `linkStatus: { valid, broken }` 포함 (IMP-7)

### IMP-7 반영
- [ ] `pre_change_check` 응답에 카드별 linkStatus 포함

---

## 3. check_interactions — `src/ops/context.ts` checkInteractions 함수

### 기존 변경
- [ ] 출력에서 `relationType` 제거

### 신규 필드
- [ ] `sharedFiles: string[]` 추가: 양쪽 카드가 같은 파일에 codeLink를 가진 경우
- [ ] `importDependencies: Array<{ from: string, to: string, file: string }>` 추가: gildash import graph 기반 코드 수준 의존관계
- [ ] gildash 미지원 시 `importDependencies`는 빈 배열 fallback

### importDependencies 구현 (gildash 메서드)
- [ ] boundary가 있는 카드: `gildash.searchRelations({ srcFilePathPattern: boundaryGlob, type: 'imports' })` 사용 (0.10.0)
- [ ] codeLink만 있는 카드: `gildash.getDependencies(file)` per file 사용
- [ ] 양방향 검사 (A→B, B→A)
- [ ] gildash 없으면 `importDependencies = []` (fallback)

### IMP-5 반영
- [ ] 위 sharedFiles + importDependencies가 IMP-5 해결

---

## 4. validate_cards — `src/ops/sync.ts` validateCards 함수

Phase 3에서 읽기 시점 검증을 추가했으므로, 여기서는 추가 항목만:

- [ ] Phase 3에서 구현한 검증 항목들이 올바르게 작동하는지 확인
- [ ] 검증 결과 반환 구조가 MCP 응답에 적합한지 확인

---

## 5. regression_guard — `src/ops/impact.ts` regressionGuard 함수

- [ ] acceptance 기반 quality gate 제거
- [ ] **drifted 비율 기반 판정**: affected cards에 대해 내부적으로 drift detection 실행
- [ ] 임계값: `ctx.regressionThreshold` (기본 0)
- [ ] drifted 비율 = affected 중 drifted 카드 수 / affected 카드 수
- [ ] drifted 비율 > threshold → fail, 아니면 pass
- [ ] affected 카드 0개 → pass (0/0 = pass)
- [ ] 반환: `{ passOrFail: 'pass' | 'fail', driftedRatio: number, affectedCards: [...], threshold: number }`

---

## 6. validate_code_links — `src/ops/link.ts`

### IMP-2: 반환 타입 변경
- [ ] `BrokenLink[]` → `{ declared: number, valid: number, broken: BrokenLink[], planned: PlannedLink[] }`
- [ ] declared: 카드에 선언된 codeLink 총 수
- [ ] valid: resolve 성공한 수
- [ ] broken: active/drifted 카드에서 resolve 실패한 링크
- [ ] planned: draft 카드에서 resolve 실패한 링크 (정상 취급)

### IMP-4: planned vs broken 분류
- [ ] draft 카드 → 미resolve codeLink를 `planned`로 분류
- [ ] active/drifted 카드 → 미resolve codeLink를 `broken`로 분류
- [ ] broken 감지 시 active → drifted 자동 전환

### IMP-7: key optional
- [ ] `key` 파라미터를 optional로 변경
- [ ] key 생략 시 전체 카드 검증

### IMP-6: reindex 추가
- [ ] `ensureReindexed(ctx)` 함수 시작 시 호출

---

## 6-1. get_link_coverage — `src/ops/link.ts` getLinkCoverage

- [ ] `ctx.coverageIgnore` 패턴에 매칭되는 파일의 심볼을 커버리지 계산에서 제외
- [ ] boundary가 있는 카드는 해당 범위 내 심볼도 covered로 간주

---

## 7. IMP-6: ensureReindexed 공통 가드 — `src/ops/link.ts`

- [ ] `ensureReindexed(ctx: EmberdeckContext): Promise<void>` 함수 추가
- [ ] gildash가 있고 reindex 메서드가 있으면 호출
- [ ] 적용 대상: `resolveCardCodeLinks`, `validateCodeLinks`, `findCardsBySymbol`, `findAffectedCards`(pre_change_check 내부), `getLinkCoverage`, `syncSymbolChanges`

---

## 8. IMP-1: syncSpecAnnotations — `src/ops/spec-sync.ts`

### SpecSyncResult 확장
- [ ] `alreadyLinked: number` 추가: @spec 발견 + codeLink 이미 존재
- [ ] `markerMissing: Array<{ cardKey, file, symbol }>` 추가: codeLink 있지만 @spec 어노테이션 없음
- [ ] `linkMissing: Array<{ cardKey, file, symbol }>` 추가: @spec 있지만 codeLink 미등록

### 함수 변경
- [ ] 기존 `alreadyExists` skip 분기에서 `alreadyLinked` 카운터 증가
- [ ] 모든 카드 codeLinks 순회, 해당 파일에 @spec 존재 여부 역검증 → `markerMissing`
- [ ] ensureReindexed 호출 확인

---

## 9. findAffectedCards 정리 — `src/ops/link.ts`

- [ ] `findAffectedCards` 함수를 export에서 제거 (내부용으로 전환하거나, pre_change_check 내부에 인라인)
- [ ] 다른 곳에서 직접 import하는 곳이 없는지 확인

---

## 10. MCP 도구 갱신 — `src/mcp/tools.ts`

- [ ] `emberdeck_check_drift`: autoTransition 파라미터 추가, 반환 스키마 변경 (driftType, brokenLinks/totalLinks, health)
- [ ] `emberdeck_pre_change_check`: 응답에 newUncoveredFiles, 카드별 linkStatus 추가. atRiskAcceptance 제거
- [ ] `emberdeck_check_interactions`: sharedFiles, importDependencies 추가, relationType 제거
- [ ] `emberdeck_regression_guard`: acceptance 기반 → drifted 비율 기반. 반환 스키마 변경
- [ ] `emberdeck_validate_code_links`: key optional, 반환 {declared, valid, broken, planned}
- [ ] `emberdeck_sync_spec_annotations`: 반환에 alreadyLinked, markerMissing, linkMissing 추가

---

## 11. 테스트

- [ ] check_drift: boundary 비활성 → drifted, codeLink 깨짐 → drifted, symbol_changed 감지 (getSymbolChanges + boundary 매칭), draft 제외, autoTransition=false
- [ ] pre_change_check: boundary 매칭, newUncoveredFiles (coverageIgnore 반영), 카드별 linkStatus
- [ ] check_interactions: sharedFiles 감지, importDependencies (searchRelations + getDependencies, gildash 있을 때/없을 때)
- [ ] regression_guard: affected 0개 → pass, drifted 비율 0 → pass, threshold 초과 → fail
- [ ] validate_code_links: draft→planned, active→broken, key 생략 → 전체, reindex 호출 확인
- [ ] syncSpecAnnotations: alreadyLinked 카운트, markerMissing 감지, linkMissing 감지

---

## 완료 조건

- [ ] `tsc --noEmit` 에러 없음
- [ ] Phase 4 범위 모든 테스트 통과
- [ ] drift score 가중 평균 코드 잔존 없음
- [ ] acceptance 기반 로직 잔존 없음
- [ ] findAffectedCards가 MCP에서 직접 호출 불가 확인
