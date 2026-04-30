> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# Remaining Work — Enterprise-Grade Readiness

현재 상태: 33개 MCP 도구 구현, 894 테스트 통과, 커버리지 96%+.

---

## 보류 항목

### P-1. regressionGuard N+1 checkDrift 호출 (조건부)

**위치**: `src/ops/impact.ts:292-293`

**현상**: `regressionGuard`가 영향받는 카드 각각에 대해 `checkDrift(ctx, key, { maxDepth: 0 })`를 개별 호출. N개 카드 → N번 `collectSymbolChanges` → 각각 내부에서 동일한 gildash.getSymbolChanges 쿼리 반복.

**절약량**: gildash가 로컬 SQLite 쿼리이므로 N=10 기준 5-20ms 절약. 단, REMAIN.md 기존 제안(전체 카드 배치)은 boundary glob scan 추가로 오히려 느림.

**올바른 해법**: `collectSymbolChanges`를 루프 밖으로 추출하여 결과를 공유. 인터페이스 리팩토링 필요.

**판정**: 절약량 대비 리팩토링 비용이 높음. 프로파일링에서 실측 병목 확인 시 진행.

---

## 완료 내역

### 아키텍처

| # | 항목 | 수정 내용 |
|---|------|-----------|
| 1 | DB-파일 원자성 | context.ts, link.ts autoTransition에 `safeWriteOperation` 적용. rename.ts `failedReferenceUpdates` 반환 |
| 2 | gildash 장애 격리 | dead code `isErr` 제거, try/catch로 교체, `gildash-unavailable` reason 추가, transient 에러 시 auto-transition 방지 |

### 내구성

| # | 항목 | 수정 내용 |
|---|------|-----------|
| D-1 | writeCardFile 원자적 쓰기 | `Bun.write` → write-to-temp-then-rename 패턴. `rename(2)`은 같은 파일시스템 내에서 원자적이므로 부분 기록 불가 |
| D-2 | validateCards content-mismatch | DB↔파일 `status`/`summary` 비교 추가. 불일치 시 `content-mismatch` 경고 반환 |
| D-3 | auto-transition targeted UPDATE | `{ ...row, status: 'drifted' }` 전체 row 덮어쓰기 → `UPDATE SET status=?, updated_at=? WHERE key=? AND status=?` targeted UPDATE + optimistic lock. 동시 updateCard와 race 방지 |

### 버그

| # | 항목 | 수정 내용 |
|---|------|-----------|
| 3 | delete_card 파일 미존재 | DB 존재 기준으로 guard 변경, 파일 없어도 DB 정리 가능. `deleteCardFile`을 fileAction 선두로 이동하여 compensation 시 side-effect 파일 미수정 보장 |
| 4 | boundary overlap 검증 | 샘플 경로 생성 기반 교집합 검사(`generateSamplePaths` + `globPatternsOverlap`)로 재구현 |
| 5 | regressionGuard 드리프트 누락 | `info.driftType \|\| info.status === 'drifted'`로 체크 통일 |
| B-1 | writeSpecAnnotations 동일 심볼 | 동일 line targets를 그룹화하여 한 번의 splice로 복수 `@spec` 태그 삽입. 안정 정렬(line desc, cardKey asc) 적용 |
| B-2 | relation-repo FK silent drop | `replaceForCard`가 FK violation 시 실패한 target 배열 반환. `bulkCreateCards`에 `partialKeys` 필드 추가 |
| B-3 | gildashIgnore 빈 배열 | `assertStringArray(obj, 'gildashIgnore', errors, true)` — `allowEmpty=true`로 변경. config-resolution 카드 계약도 업데이트 |
| B-4 | FTS5 search 견고성 | catch 조건을 `fts5`, `unterminated`, `unknown special query`, `parse error` 4개 패턴으로 확장하여 모든 FTS5 구문 오류 포괄 처리 |

### 성능

| # | 항목 | 수정 내용 |
|---|------|-----------|
| P-2 | listCards/searchCards body 제외 | `CardSummaryRow = Omit<CardRow, 'body'>` 타입 도입. list/search 응답에서 body 필드 제거 (응답 크기 81% 감소) |
| 12 | 대규모 벤치마크 | `bench/large-scale.bench.ts` — 1000 cards, 100K code links. 병목 없음 (analyze 114ms, checkDrift 127ms) |

### 기능

| # | 항목 | 구현 내용 |
|---|------|-----------|
| 6 | @spec 역방향 쓰기 | `writeSpecAnnotations` + `emberdeck_write_spec_annotations` MCP 도구 |
| 7 | 배치 카드 읽기 | `getCards` + `emberdeck_get_cards` MCP 도구 |
| 8 | 온보딩 요약 | `getOnboardingSummary` + `emberdeck_onboarding_summary` MCP 도구. `OnboardingDriftedCard.driftType` optional로 변경, 하드코딩 default 제거 |
| 9 | 분석 페이지네이션 | `analyze`에 offset/limit 파라미터 + `driftedCardsTotal` 필드. `DriftedCardSummary.driftType` optional로 변경, DB-drifted 카드도 배열 포함하여 `health.drifted === driftedCardsTotal` 보장 |

### 품질

| # | 항목 | 구현 내용 |
|---|------|-----------|
| 10 | analyze.ts 단위 테스트 | `analyze.spec.ts` — analyze + getOnboardingSummary 엣지케이스 22건 (pagination, includeBody, staleBoundary, 일관성 검증 추가) |
| 11 | 도구 description AX 통일 | 전체 33개 도구 "Use..." 패턴 통일 완료 |

### 검토 후 삭제 (불필요 확인됨)

| # | 항목 | 삭제 사유 |
|---|------|-----------|
| P-3 | checkInteractions O(n²) | MCP 핸들러만 호출, 사용자 입력 키만 받음 (일반 2-5개). 자동 대량 호출 경로 없음 |
| P-4 | getOnboardingSummary N+1 | 인덱스 탄 SQLite 쿼리 0.033ms/건, onboarding 1회 경로. 1000카드=33ms |
| O-1 | 구조적 로깅 | MCP 응답이 이미 구조화, 로그 소비자 없음. silent catch는 별도 버그로 분류 |
| R-1 | symlink 무한 루프 | Bun.Glob.scanSync가 symlink 미추적 (실측 확인) |
| R-2 | 동시성 스트레스 | B-2 FK fix와 동일 근본 원인. B-2 수정 완료로 주요 경로 해결 |
| T-7 | migration 업그레이드 | 마이그레이션 1개뿐, 스키마 변경 계획 없음. 두 번째 마이그레이션 시점에 추가 |
