# Emberdeck Improvement Plan

Emberdeck MCP 도구를 실제 코드베이스에 11개 카드를 생성하고 전체 워크플로우를 시뮬레이션한 결과, 5개 시나리오에서 발견된 마찰점과 구체적 수정 방안을 정리한다.

---

## 1. `syncSpecAnnotations` — 양방향 정합 보고 부재

### 현상

에이전트가 카드 생성 시 codeLinks를 등록하고, 소스 코드에 `@spec card-key` 주석을 추가한 뒤 `syncSpecAnnotations`를 실행하면 `{ created: 0, unmatched: [] }`를 반환한다. codeLinks가 이미 존재하므로 중복 skip되지만, 에이전트 입장에서는 "어노테이션이 스캔되지 않았다"와 "어노테이션이 기존 링크와 매칭되었다"를 구분할 수 없다.

### 재현 시나리오

**시나리오 3: 기존 코드에 카드 적용**

1. 에이전트가 `bulk_create_cards`로 `persistence` 카드를 생성하면서 codeLinks에 `{ kind: "class", file: "src/db/card-repo.ts", symbol: "DrizzleCardRepository" }`를 등록한다.
2. 에이전트가 `src/db/card-repo.ts`에 `// @spec persistence`를 추가한다.
3. `syncSpecAnnotations`를 실행한다.
4. 결과: `{ created: 0, unmatched: [] }` — 어노테이션이 발견되어 기존 링크와 매칭된 건지, 아예 스캔되지 않은 건지 알 수 없다.

**시나리오 2: 리팩토링 후 어노테이션 이동**

1. 에이전트가 `validation.ts`에서 `validators/schema.ts`로 함수를 이동한다.
2. 새 파일에 `@spec card-model`을 추가하지만, 구 파일의 `@spec`을 삭제하는 것을 잊는다.
3. `syncSpecAnnotations` 실행 시 구 파일의 stale 어노테이션에 대한 피드백이 없다.

### 수정 방안

`SpecSyncResult` 반환 타입을 확장한다:

```typescript
// 현재
interface SpecSyncResult {
  created: number;
  unmatched: Array<{ cardKey: string; file: string; symbol: string }>;
}

// 수정
interface SpecSyncResult {
  created: number;
  alreadyLinked: number;  // @spec이 발견됐고 codeLink가 이미 존재하는 수
  unmatched: Array<{ cardKey: string; file: string; symbol: string }>;
  markerMissing: Array<{ cardKey: string; file: string; symbol: string }>;
    // codeLink는 있지만 해당 파일/심볼에 @spec 어노테이션이 없는 경우
  linkMissing: Array<{ cardKey: string; file: string; symbol: string }>;
    // @spec은 있지만 카드의 codeLinks에 등록되지 않은 경우 (created에 포함되지 않은 것)
}
```

`syncSpecAnnotations` 함수 내부에서:
- 기존 `alreadyExists` 분기에서 skip 대신 `alreadyLinked` 카운터를 증가시킨다.
- 모든 카드의 codeLinks를 순회하면서, 해당 파일에 `@spec` 어노테이션이 존재하는지 gildash `searchAnnotations`로 역검증한다. 없으면 `markerMissing`에 추가한다.

수정 대상 파일: `src/ops/spec-sync.ts` (syncSpecAnnotations 함수), `src/mcp/tools.ts` (MCP 도구 응답 스키마)

---

## 2. `validate_code_links` — 빈 배열 반환으로 인한 모호함

### 현상

`validate_code_links`는 `BrokenLink[]`를 반환한다. 모든 링크가 유효하면 `[]`(빈 배열)을 반환하는데, 이것이 "링크가 없다"인지 "모든 링크가 유효하다"인지 에이전트가 구분할 수 없다.

### 재현 시나리오

**시나리오 1: 새 기능 개발**

1. 에이전트가 `ws-notifications` 카드를 생성하면서 codeLinks를 등록한다.
2. 코드를 작성한 후 `validate_code_links({ key: "ws-notifications" })`를 실행한다.
3. 결과: `[]` — 모든 링크가 resolve됐다는 뜻이지만, 에이전트는 `[]`을 보고 "검증 결과 없음"으로 오인할 수 있다.

**시나리오 5: 다중 카드 변경**

1. `public-api` 카드는 codeLinks가 없다.
2. `validate_code_links({ key: "public-api" })`를 실행하면 `[]`를 반환한다.
3. codeLinks가 없어서 검증할 게 없는 것과, codeLinks가 있고 전부 유효한 것이 동일한 응답이다.

### 수정 방안

반환 타입을 변경한다:

```typescript
// 현재
type ValidateResult = BrokenLink[];

// 수정
interface ValidateResult {
  declared: number;  // 카드에 선언된 codeLink 총 수
  valid: number;     // gildash에서 resolve 성공한 수
  broken: BrokenLink[];  // resolve 실패한 링크 목록
}
```

수정 대상 파일: `src/ops/link.ts` (validateCodeLinks 함수), `src/mcp/tools.ts` (MCP 도구 응답 스키마)

추가로, `validateCodeLinks` 내부에서도 `syncSpecAnnotations`처럼 `ctx.gildash.reindex()`를 호출해야 한다. 현재 `syncSpecAnnotations`에만 reindex가 추가되어 있고 `validateCodeLinks`에는 없어서, 코드 변경 직후 검증하면 gildash가 구 인덱스를 참조한다.

---

## 3. `pre_change_check` — atRiskAcceptance가 항상 빈 배열

### 현상

`pre_change_check`는 변경 파일에 영향받는 카드와 at-risk AC를 반환해야 하지만, `atRiskAcceptance`가 항상 빈 배열이다.

### 원인

`impact.ts`의 `preChangeCheck` 구현에서 `atRiskAcceptance`를 채우는 로직이 미구현이거나, verified된 AC만 대상으로 하는데 모든 AC가 unverified 상태이기 때문이다.

### 재현 시나리오

**시나리오 4: 버그 수정**

1. 에이전트가 `src/ops/rename.ts`의 race condition을 수정한다.
2. `pre_change_check({ files: ["src/ops/rename.ts"] })`를 실행한다.
3. `card-crud` 카드가 affected로 반환되지만, `atRiskAcceptance: []`이다.
4. 에이전트는 "영향받는 AC가 없다"로 해석하고, AC 재검증을 건너뛴다.

**시나리오 5: 다중 카드 변경**

1. 에이전트가 `src/card/types.ts`, `src/db/schema.ts` 등 6개 파일을 수정한다.
2. `pre_change_check`에서 5개 카드가 affected로 나오지만 `atRiskAcceptance: []`이다.
3. 47개 unverified AC 중 어떤 것이 이 변경에 영향받는지 알 수 없다.

### 수정 방안

`preChangeCheck`에서 affected 카드의 unverified AC를 atRiskAcceptance에 포함시킨다. 단, verified/unverified 구분을 유지한다:

```typescript
// 현재
atRiskAcceptance: AtRiskAcceptance[];  // 항상 []

// 수정
interface AtRiskAcceptance {
  cardKey: string;
  criterionId: string;
  description: string;
  currentlyVerified: boolean;  // true면 "회귀 위험", false면 "검증 필요"
  reason: string;  // "직접 링크된 파일 변경" | "전이적 의존성 변경"
}
```

로직: affected 카드의 모든 AC를 반환하되, `currentlyVerified`로 구분한다. 에이전트는 `currentlyVerified: true`인 항목은 회귀 테스트가 필요하고, `currentlyVerified: false`인 항목은 이 변경으로 충족 가능한지 확인해야 한다.

수정 대상 파일: `src/ops/impact.ts` (preChangeCheck 함수)

---

## 4. `check_interactions` — sharedSymbols가 항상 빈 배열

### 현상

`check_interactions`는 카드 간 공유 심볼을 보고해야 하지만, codeLinks에 등록된 심볼만 비교한다. 실제 코드에서 카드 A의 파일이 카드 B의 심볼을 import하는 경우를 탐지하지 못한다.

### 재현 시나리오

**시나리오 5: 다중 카드 변경**

1. `check_interactions({ cards: ["card-crud", "card-sync", "persistence"] })`를 실행한다.
2. `card-crud`의 `createCard` 함수는 `persistence`의 `DrizzleCardRepository`를 직접 import하고, `card-sync`의 `syncCardFromFile`을 내부에서 호출한다.
3. 결과: `sharedSymbols: []` — codeLinks에 등록된 심볼 기준으로만 비교하므로, 각 카드가 서로 다른 심볼을 등록했으면 교집합이 없다.

실제 코드 의존성:
- `src/ops/create.ts` → `import { DrizzleCardRepository } from '../db/card-repo'` (persistence 카드 영역)
- `src/ops/delete.ts` → `import { syncCardFromFile } from './sync'` (card-sync 카드 영역)

이 import 관계가 check_interactions에서 보이지 않는다.

### 수정 방안

두 단계로 접근한다:

**단기 (codeLinks 기반 개선)**: 현재 로직에서 심볼 이름만 비교하는 게 아니라, **파일 수준** 겹침도 보고한다. 카드 A의 codeLinks가 가리키는 파일 중, 카드 B의 codeLinks가 가리키는 파일과 겹치는 것이 있으면 `sharedFiles`로 보고한다.

```typescript
interface InteractionResult {
  pair: [string, string];
  sharedSymbols: SharedSymbol[];  // 기존: 동일 심볼 등록
  sharedFiles: string[];  // 추가: 양쪽 카드가 같은 파일에 링크
  relationType: string | null;
  potentialConflicts: string[];
}
```

**장기 (gildash import graph)**: gildash의 dependency graph API를 활용하여, 카드 A의 파일들이 카드 B의 파일들을 import하는지 분석한다. 이는 gildash에 `getDependencies(filePath)` 또는 `getImporters(filePath)` API가 필요하다.

수정 대상 파일: `src/ops/context.ts` (checkInteractions 함수)

---

## 5. `update_card` — 잘못된 파라미터 silent fail

### 현상

MCP 도구 `update_card`에 존재하지 않는 필드명으로 값을 전달하면, 에러 없이 무시된다. 예를 들어 `{ key: "card-model", fields: { body: "..." } }`처럼 `fields` wrapper로 감싸서 보내면, `body`가 업데이트되지 않지만 에러도 반환되지 않는다.

### 재현 시나리오

**시나리오 3: 기존 코드 카드화**

1. 에이전트가 `card-model` 카드의 body를 실제 스펙 내용으로 업데이트하려고 한다.
2. `update_card({ key: "card-model", fields: { body: "## Invariants\n..." } })`를 호출한다.
3. 응답에 에러가 없다. 에이전트는 성공으로 판단한다.
4. `get_card({ key: "card-model" })`로 확인하면 body가 변경되지 않았다.

이 문제는 실제 테스트 중 발생했다. 올바른 호출은 `update_card({ key: "card-model", body: "## Invariants\n..." })`이다 (flat parameter).

### 수정 방안

MCP 도구 등록 시 Zod 스키마에 `.strict()`를 적용하여 unknown key를 거부한다:

```typescript
// src/mcp/tools.ts 내 update_card 도구 등록 부분
// 현재: z.object({ key: z.string(), body: z.string().optional(), ... })
// 수정: z.object({ key: z.string(), body: z.string().optional(), ... }).strict()
```

`.strict()`를 적용하면 `fields`같은 미정의 키가 들어올 때 Zod validation error가 반환된다.

수정 대상 파일: `src/mcp/tools.ts` (emberdeck_update_card 도구의 Zod 스키마)

---

## 6. `validate_code_links`와 `syncSpecAnnotations`의 reindex 불일치

### 현상

`syncSpecAnnotations`는 실행 시 `ctx.gildash.reindex()`를 호출하여 최신 파일 상태를 반영하지만, `validateCodeLinks`와 `resolveCardCodeLinks` 등 다른 gildash 의존 함수들은 reindex를 호출하지 않는다. 코드 변경 직후 `validate_code_links`를 실행하면 gildash가 구 인덱스를 참조하여 정상 심볼을 broken으로 판정할 수 있다.

### 재현 시나리오

**시나리오 1: 새 기능 개발**

1. 에이전트가 새 파일 `src/ws/ws-server.ts`를 작성한다.
2. `validate_code_links({ key: "ws-notifications" })`를 실행한다.
3. gildash가 새 파일을 아직 인덱싱하지 않아, `WsServer` 심볼을 찾지 못하고 broken으로 보고한다.
4. 에이전트는 코드에 문제가 있다고 판단하지만, 실제로는 인덱스가 stale한 것이다.

### 수정 방안

gildash를 사용하는 모든 ops 함수에서 reindex를 호출한다. 단, 매번 full reindex는 비효율적이므로 `setupEmberdeck`에서 gildash를 watch 모드로 초기화하거나, ops 레이어에 공통 reindex 가드를 추가한다:

```typescript
// src/ops/link.ts 상단에 추가
async function ensureReindexed(ctx: EmberdeckContext): Promise<void> {
  if (ctx.gildash && typeof ctx.gildash.reindex === 'function') {
    await ctx.gildash.reindex();
  }
}
```

모든 gildash 의존 함수(`resolveCardCodeLinks`, `validateCodeLinks`, `findCardsBySymbol`, `findAffectedCards`, `getLinkCoverage`)의 시작 부분에서 `await ensureReindexed(ctx)`를 호출한다.

이로 인해 해당 함수들이 `async`로 변경되어야 하며, MCP 도구 핸들러와 테스트도 `await`를 추가해야 한다.

수정 대상 파일: `src/ops/link.ts`, `src/ops/spec-sync.ts`, `src/mcp/tools.ts`, 관련 테스트 파일

---

## 7. 계획 링크(planned link) vs 실제 링크(resolved link) 구분 없음

### 현상

에이전트가 draft 카드를 생성하면서 아직 존재하지 않는 파일/심볼에 codeLinks를 등록할 수 있다. 이 "계획된 링크"와 실제 코드에 존재하는 "실제 링크"를 시스템이 구분하지 않는다. `validate_code_links`는 계획 링크를 broken으로 보고한다.

### 재현 시나리오

**시나리오 1: 새 기능 개발**

1. 에이전트가 `ws-notifications` 카드(status: draft)를 생성하면서 `{ kind: "class", file: "src/ws/ws-server.ts", symbol: "WsServer" }`를 등록한다.
2. 아직 코드를 작성하지 않은 상태에서 `validate_code_links`를 실행하면 broken 1건으로 보고된다.
3. `check_drift`에서도 brokenLinks가 1로 잡혀 drift score가 올라간다.

### 수정 방안

카드의 `status`를 고려하여 검증 동작을 분기한다:

- `draft` 또는 `accepted` 상태의 카드: `validate_code_links`에서 broken 링크를 `planned`로 분류한다. drift score 계산에서 제외한다.
- `implementing` 이상의 카드: 기존처럼 broken을 에러로 취급한다.

```typescript
interface ValidateResult {
  declared: number;
  valid: number;
  broken: BrokenLink[];
  planned: PlannedLink[];  // draft/accepted 카드에서 아직 resolve 안 되는 링크
}
```

수정 대상 파일: `src/ops/link.ts` (validateCodeLinks), `src/ops/context.ts` (checkDrift)

---

## 8. batch API 부재

### 현상

`validate_code_links`, `get_card`, `verify_acceptance` 등 대부분의 도구가 단일 카드 키를 받는다. 다중 카드 변경 시 에이전트가 카드 수만큼 반복 호출해야 한다.

### 재현 시나리오

**시나리오 5: 다중 카드 변경 ("archived" 상태 추가)**

1. `pre_change_check`에서 5개 카드가 affected로 반환된다.
2. 에이전트가 각 카드의 codeLinks를 검증하려면 `validate_code_links`를 5번 호출해야 한다.
3. AC를 검증하려면 `verify_acceptance`를 5번 호출해야 한다.
4. 총 10+번의 도구 호출이 필요하다.

### 수정 방안

기존 도구에 batch 변형을 추가한다:

```
emberdeck_validate_code_links  → key 파라미터를 optional로 변경. 생략 시 모든 카드 검증.
emberdeck_verify_acceptance    → key를 배열로 받을 수 있게 확장.
```

또는 `pre_change_check`의 응답에 영향받는 카드별 링크 상태와 AC 상태를 포함시켜, 별도 검증 호출을 줄인다:

```typescript
interface PreChangeResult {
  affectedCards: Array<{
    key: string;
    linkType: 'direct' | 'transitive';
    affectedLinks: number;
    linkStatus: { valid: number; broken: number };  // 추가
    atRiskAcceptance: AtRiskAcceptance[];  // 카드별로 이동
  }>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  suggestedActions: string[];
}
```

수정 대상 파일: `src/ops/link.ts`, `src/ops/impact.ts`, `src/mcp/tools.ts`

---

## 우선순위

| 순위 | 항목 | 이유 |
|------|------|------|
| 1 | syncSpecAnnotations 양방향 보고 | 5개 시나리오 중 3개에서 마찰 발생. @spec의 존재 의미를 결정하는 핵심 |
| 2 | validate_code_links 반환 타입 + reindex | 모든 시나리오에서 사용되며, 현재 반환값이 모호. reindex 누락은 잠재적 오탐 |
| 3 | pre_change_check atRiskAcceptance | 버그 수정, 다중 변경 시나리오에서 핵심 정보 누락 |
| 4 | update_card strict 검증 | 실제 사용 중 발생한 문제. 수정 범위 작음 (Zod `.strict()` 한 줄) |
| 5 | 계획 링크 vs 실제 링크 | 새 기능 시나리오에서만 발생. status 기반 분기로 해결 |
| 6 | check_interactions 파일 수준 분석 | 다중 카드 시나리오에서만 의미. 단기적으로 sharedFiles 추가 |
| 7 | batch API | 편의성 개선. 기능 결함은 아님 |
