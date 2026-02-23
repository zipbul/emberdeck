# PLAN: @zipbul/gildash 통합

## 목표

emberdeck(스펙 그래프)과 gildash(코드 그래프)를 연결하여  
`spec ↔ code` 양방향 링크를 심볼 레벨에서 지원한다.

```
Before:  spec ──(depends-on/extends/…)──▶ spec
                  (카드 간 관계만)

After:   spec ──(depends-on/extends/…)──▶ spec
          │
          └──(implements/defines/references-code)──▶ code symbol
                                                        │
                                               gildash가 파일 이동·
                                               rename 후에도 추적
```

---

## 핵심 설계 원칙

1. **gildash는 선택적(optional)** — `projectRoot` 미지정 시 기존 emberdeck 기능 100% 동작
2. **심볼 기반 링크** — 파일 경로 + 심볼 이름으로 링크. gildash가 현재 위치를 실시간 추적
3. **마크다운이 source of truth** — `codeLinks` 필드를 `.card.md` frontmatter에 저장
4. **단방향 참조** — 카드가 코드를 참조. 코드는 카드를 모름 (코드 파일 비침투)
5. **`setupEmberdeck`을 async로 전환** — `Gildash.open()`이 비동기이므로 불가피

---

## 변경 범위

### Phase 1: 타입 확장 (breaking change 없음)

#### `src/card/types.ts`

`CodeLink` 인터페이스 추가, `CardFrontmatter`에 `codeLinks` 옵션 필드 추가.

```typescript
// 추가
export interface CodeLink {
  /** gildash SymbolKind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'property' | 'method' */
  kind: string;
  /** 프로젝트 루트 기준 상대 경로 (e.g. 'src/auth/token.ts') */
  file: string;
  /** 정확한 심볼 이름 (e.g. 'refreshToken') */
  symbol: string;
}

// CardFrontmatter에 추가
export interface CardFrontmatter {
  // ... 기존 필드 유지 ...
  codeLinks?: CodeLink[];   // ← 추가
}
```

**카드 파일 예시:**
```yaml
---
key: auth/token-refresh
summary: JWT 토큰 갱신 메커니즘
status: implementing
codeLinks:
  - kind: function
    file: src/auth/token.ts
    symbol: refreshToken
  - kind: class
    file: src/auth/TokenService.ts
    symbol: TokenService
---
```

#### `src/config.ts`

```typescript
export interface EmberdeckOptions {
  cardsDir: string;
  dbPath: string;
  allowedRelationTypes?: readonly string[];
  /** gildash 활성화. 지정 시 코드 링크 기능 사용 가능. */
  projectRoot?: string;
  /** gildash ignorePatterns 전달용. 기본값: ['node_modules', 'dist', '.zipbul'] */
  gildashIgnore?: string[];
}

export interface EmberdeckContext {
  cardsDir: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  allowedRelationTypes: readonly string[];
  /** gildash 인스턴스. projectRoot 미설정 시 undefined. */
  gildash?: Gildash;
}
```

---

### Phase 2: setup/teardown async 전환

#### `src/setup.ts`

```typescript
// Before
export function setupEmberdeck(options: EmberdeckOptions): EmberdeckContext

// After
export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext>
export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void>
```

- `projectRoot` 있으면 `Gildash.open()` 호출 후 ctx에 주입
- `teardownEmberdeck`에서 `ctx.gildash?.close()` 호출

---

### Phase 3: 마크다운 파서 확장

#### `src/card/markdown.ts`

`parseCardMarkdown` 함수에서 `codeLinks` 파싱 추가.

- `codeLinks`가 배열인지 검증
- 각 항목이 `{ kind: string, file: string, symbol: string }` 구조인지 검증
- 실패 시 `CardValidationError` throw

`serializeCardMarkdown`에서 `codeLinks` 직렬화 추가.

---

### Phase 4: 새 operation — `src/ops/link.ts` (신규 파일)

코드 링크 관련 연산 전담 모듈.

#### 함수 목록

```typescript
/**
 * 카드의 codeLinks를 gildash 심볼 인덱스에서 조회하여 반환.
 * gildash 미설정 시 GildashNotConfiguredError throw.
 */
export async function resolveCardCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<ResolvedCodeLink[]>

/**
 * 심볼 이름(+ 선택적 파일 경로)으로 해당 심볼을 참조하는 카드 목록 반환.
 */
export function findCardsBySymbol(
  ctx: EmberdeckContext,
  symbolName: string,
  filePath?: string,
): CardRow[]

/**
 * 변경된 파일 목록 → 해당 파일의 심볼을 codeLink로 참조하는 카드 목록 반환.
 * CI lint / 에이전트 컨텍스트 수집에 활용.
 */
export async function findAffectedCards(
  ctx: EmberdeckContext,
  changedFiles: string[],
): Promise<CardRow[]>

/**
 * 카드의 모든 codeLink가 현재 심볼 인덱스에 존재하는지 검증.
 * 깨진 링크 목록을 반환. 빈 배열이면 전부 유효.
 */
export async function validateCodeLinks(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<BrokenLink[]>
```

#### 반환 타입

```typescript
export interface ResolvedCodeLink {
  link: CodeLink;
  /** gildash에서 찾은 심볼. null이면 심볼 없음 (깨진 링크). */
  symbol: SymbolSearchResult | null;
}

export interface BrokenLink {
  link: CodeLink;
  reason: 'symbol-not-found' | 'file-not-indexed';
}
```

#### 에러 타입 (`src/card/errors.ts`에 추가)

```typescript
export class GildashNotConfiguredError extends Error {
  constructor() {
    super('gildash is not configured: set projectRoot in EmberdeckOptions');
  }
}
```

---

### Phase 5: query.ts 확장

기존 `src/ops/query.ts`에 코드 링크 연계 쿼리 추가.

```typescript
/**
 * 카드 key → 연관된 모든 코드 심볼 (codeLinks 해석 + gildash 조회).
 * 에이전트가 "이 스펙과 관련된 코드는?" 을 묻는 엔트리포인트.
 */
export async function getCardContext(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<CardContext>

export interface CardContext {
  card: CardFile;
  /** codeLinks → 현재 심볼 정보 */
  codeLinks: ResolvedCodeLink[];
  /** 이 카드가 depends-on/extends 하는 상위 스펙 카드 */
  upstreamCards: CardRow[];
  /** 이 카드에 depends-on/extends 되는 하위 스펙 카드 */
  downstreamCards: CardRow[];
}
```

---

### Phase 6: sync.ts 확장

`syncCardFromFile`에서 `codeLinks`를 DB에 persit.

현재 DB 스키마에 `code_link` 테이블 추가 (Drizzle 마이그레이션 포함).

```sql
-- 새 테이블
CREATE TABLE code_link (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key  TEXT NOT NULL REFERENCES card(key) ON DELETE CASCADE ON UPDATE CASCADE,
  kind      TEXT NOT NULL,
  file      TEXT NOT NULL,
  symbol    TEXT NOT NULL
);
CREATE INDEX idx_code_link_card ON code_link(card_key);
CREATE INDEX idx_code_link_symbol ON code_link(symbol);
CREATE INDEX idx_code_link_file ON code_link(file);
```

목적: gildash 없이도 "어떤 카드가 이 파일을 참조하는가?" 를 SQL로 빠르게 조회.

---

### Phase 7: public API export

`index.ts`에 추가:

```typescript
export type { CodeLink, CardContext, ResolvedCodeLink, BrokenLink } from './src/...';
export {
  resolveCardCodeLinks,
  findCardsBySymbol,
  findAffectedCards,
  validateCodeLinks,
  getCardContext,
} from './src/ops/...';
export { GildashNotConfiguredError } from './src/card/errors';
```

---

## 테스트 계획

### 새 unit spec 파일

| 파일 | SUT |
|------|-----|
| `src/card/markdown.spec.ts` | `codeLinks` 파싱/직렬화 케이스 추가 |
| `src/card/errors.spec.ts` | `GildashNotConfiguredError` 케이스 추가 |

### 새 integration test 파일

| 파일 | SUT |
|------|-----|
| `test/ops/link.test.ts` | `resolveCardCodeLinks`, `findCardsBySymbol`, `findAffectedCards`, `validateCodeLinks` |
| `test/ops/query.test.ts` | `getCardContext` 케이스 추가 |
| `test/ops/sync.test.ts` | `codeLinks` DB persist 케이스 추가 |
| `test/migration.test.ts` | `code_link` 테이블 마이그레이션 검증 |

### 테스트 더블 전략

- `gildash` 인스턴스는 `mock()`/`spyOn()`으로 대체 — 실제 파일 인덱싱 불필요
- `ctx.gildash`가 `undefined`인 케이스 (gildash 미설정) 반드시 포함

---

## 구현 순서 (의존성 순)

```
1. src/card/types.ts          — CodeLink 타입 추가
2. src/card/errors.ts         — GildashNotConfiguredError 추가
3. src/card/markdown.ts       — codeLinks 파싱/직렬화
4. src/db/schema.ts           — code_link 테이블 추가
5. drizzle migration          — bun run drizzle:generate && drizzle:migrate
6. src/db/repository.ts       — CodeLinkRepository 인터페이스
7. src/db/code-link-repo.ts   — DrizzleCodeLinkRepository 구현
8. src/config.ts              — Options/Context 타입 확장
9. src/setup.ts               — async 전환 + gildash 초기화
10. src/ops/link.ts           — 코드 링크 연산
11. src/ops/query.ts          — getCardContext 추가
12. src/ops/sync.ts           — codeLinks persist
13. src/ops/create.ts         — codeLinks 생성 시 처리
14. src/ops/update.ts         — codeLinks 수정 시 처리
15. index.ts                  — public API export 추가
```

---

## 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|------|------|------|
| `setupEmberdeck` async 전환으로 기존 CLI 코드 깨짐 | 높음 | PLAN 공개 후 CLI 팀에 사전 고지. 마이너 버전 bump |
| gildash open 실패 시 emberdeck 전체가 실패 | 중간 | gildash 오류는 catch 후 `ctx.gildash = undefined`로 graceful degradation |
| code_link DB 마이그레이션 — 기존 DB 있는 사용자 | 낮음 | Drizzle migrate가 자동 처리. ':memory:' 는 매번 새로 생성 |
| gildash가 아직 안정 버전이 아닐 경우 (v0.3.x) | 낮음 | 같은 조직 패키지. 핀 버전 고정 |

---

## 완료 조건

- [ ] 모든 기존 테스트 GREEN 유지
- [ ] 새 테스트 GREEN
- [ ] `gildash` 미설정 시 기존 API 동작 100% 동일
- [ ] `setupEmberdeck` async 전환 후 index.ts exports 타입 오류 없음
- [ ] `code_link` 테이블 마이그레이션 파일 생성 및 검증 통과
