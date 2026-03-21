# Phase 6: 신규 도구 (get_uncovered_symbols, suggest_card_scope, analyze)

선행: Phase 5

---

## 1. get_uncovered_symbols — `src/ops/spec-sync.ts` 신규 함수

### 함수
- [x] `getUncoveredSymbols(ctx, options?)` 함수 신규 작성
- [x] gildash에서 추출한 전체 심볼 중 어떤 카드의 codeLink에도 연결되지 않은 심볼 반환

### 입력
- [x] `files?: string[]` — 특정 파일만 대상
- [x] `kinds?: string[]` — 특정 심볼 종류만 (function, class, interface 등)
- [x] `exportedOnly?: boolean` — export된 심볼만
- [x] `excludePatterns?: string[]` — 추가 제외 패턴 (`.emberdeck.jsonc`의 `coverageIgnore`와 합산)

### 출력
```typescript
interface UncoveredResult {
  totalSymbols: number;
  coveredSymbols: number;
  uncovered: Array<{ file: string; symbol: string; kind: string; exportType: string }>;
  coverageRatio: number; // 0-1
}
```

### 로직
- [x] `ensureReindexed(ctx)` 호출
- [x] gildash에서 심볼 목록 추출
- [x] `ctx.coverageIgnore` + `excludePatterns` 합산하여 매칭되는 파일 심볼 제외
- [x] 전체 카드의 codeLinks와 대조하여 미연결 심볼 필터
- [x] boundary가 있는 카드는 해당 범위 내 심볼도 covered로 간주

---

## 2. suggest_card_scope — `src/ops/spec-sync.ts` 신규 함수

### 함수
- [x] `suggestCardScope(ctx, options?)` 함수 신규 작성
- [x] 디렉토리 구조 + export 심볼 패턴을 분석하여 카드 생성 단위 제안

### 입력
- [x] `path?: string` — 분석 대상 경로 (생략 시 projectRoot)
- [x] `maxDepth?: number` — 디렉토리 탐색 깊이

### 출력
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

### 로직
- [x] `ensureReindexed(ctx)` 호출
- [x] 대상 경로의 디렉토리 구조 탐색
- [x] 디렉토리별 심볼 그룹핑
- [x] 기존 카드와 겹치지 않는 영역 식별
- [x] 디렉토리 수준이면 architecture, 파일/모듈 수준이면 spec 제안
- [x] 제안만 함, 카드 생성은 에이전트가 create_card 호출

---

## 3. analyze — `src/ops/analyze.ts` 신규 파일

### 함수
- [x] `analyze(ctx, options?)` 함수 신규 작성

### 입력
- [x] `includeBody?: boolean` — true면 카드에 body 포함 (기본 false)

### 출력
```typescript
interface AnalyzeResult {
  health: {
    total: number;
    active: number;
    drifted: number;
    draft: number;
    brokenLinks: number;
    staleBoundary: number;  // boundary glob 매칭 0인 카드 수
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

### 로직
- [x] 전체 카드 목록 조회 → health 카운트
- [x] check_drift 결과 활용 → driftedCards, brokenLinks
- [x] boundary glob 매칭 확인 → staleBoundary
- [x] getUncoveredSymbols 결과 활용 → coverage, unlinkedSymbols (상위 N개)
- [x] **파일/심볼 파라미터 없음** — 프로젝트 전체 대상

---

## 4. MCP 도구 등록 — `src/mcp/tools.ts`

- [x] `emberdeck_get_uncovered_symbols` 등록: files?, kinds?, exportedOnly?, excludePatterns?
- [x] `emberdeck_suggest_card_scope` 등록: path?, maxDepth?
- [x] `emberdeck_analyze` 등록: includeBody?

---

## 5. 테스트

- [x] get_uncovered_symbols: 전체 심볼 vs codeLink 대조, coverageIgnore 제외, excludePatterns 추가 제외, boundary covered 심볼 제외, exportedOnly 필터, kinds 필터
- [x] suggest_card_scope: 디렉토리 기반 제안, 기존 카드와 겹치지 않는 영역, architecture vs spec 판별
- [x] analyze: health 카운트, coverage ratio, driftedCards 목록, staleBoundary, includeBody=true일 때 body 포함

---

## 완료 조건

- [x] `tsc --noEmit` 에러 없음
- [x] Phase 6 범위 모든 테스트 통과
- [x] MCP 도구 수: 27 + 3 = 30개 (최종 목표)
