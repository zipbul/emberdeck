# Emberdeck Roadmap

> Emberdeck은 바이브코딩 시대의 "프로젝트 기억"이다.
> 에이전트가 세션이 바뀌어도 프로젝트의 의도, 구조, 결정 이력을 잃지 않도록
> 구조적 지식 그래프를 제공하는 스펙 관리 인프라이다.

---

## 1. 배경: 바이브코딩의 구조적 한계

### 1.1 데이터가 말하는 현실

| 지표 | 수치 | 출처 |
|------|------|------|
| AI 코드의 보안 취약점 (인간 대비) | 2.74x | CodeRabbit 2025.12 |
| "거의 맞지만 미묘하게 틀린 코드" 경험률 | 66% | Stack Overflow |
| 숙련 개발자의 실제 속도 변화 (AI 사용 시) | -19% | 2025.7 학술연구 |
| 컨텍스트 열화 시점 | ~10 프롬프트 | 커뮤니티 합의 |
| 바이브코딩 프로젝트 "벽" 도달 | ~3개월 | 다수 보고 |

### 1.2 근본 원인 5가지

1. **컨텍스트 유실** — 세션이 바뀌면 프로젝트의 멘탈 모델이 사라짐.
   CLAUDE.md, .cursorrules 같은 수동 우회책은 200줄 한계와 구조 부재로 불충분.

2. **시스템 멘탈 모델 부재** — AI가 한 프롬프트씩 기능을 생성하므로 전체 시스템을
   조감하지 못함. 개별 기능은 작동하지만 기능 간 상호작용이 깨짐.

3. **스펙-코드 단절** — "무엇을 만들어야 하는지"와 "실제로 만들어진 것" 사이의
   추적이 불가능. 의도가 유실되고 기술 부채가 보이지 않게 쌓임.

4. **두더지 잡기(Whack-a-Mole)** — 한 곳을 고치면 다른 곳이 깨지는 반복.
   변경의 영향 범위를 파악할 구조적 수단이 없음.

5. **사후 디버깅 편향** — "먼저 만들고, 나중에 고치자"는 패턴이 3개월 뒤
   유지보수 불가능한 코드베이스를 만듦.

### 1.3 Emberdeck이 해결하는 것

| 근본 원인 | Emberdeck의 해법 |
|-----------|-----------------|
| 컨텍스트 유실 | 스펙 카드 + 관계 그래프 + 코드 링크가 "프로젝트의 외부 기억" 역할 |
| 멘탈 모델 부재 | 카드 관계 그래프가 시스템 전체의 의존성/상호작용을 구조화 |
| 스펙-코드 단절 | Gildash 연동으로 카드 ↔ 코드 심볼 양방향 추적 |
| 두더지 잡기 | 변경 전 영향 분석(impact check)으로 파급 범위 사전 파악 |
| 사후 디버깅 편향 | acceptance 기준 + Pyreez 사전 심의로 "처음부터 제대로" |

---

## 2. 생태계에서의 위치

### 2.1 프로젝트 관계도

```
┌─────────────────────────────────────────────────────────────────┐
│                      Zipbul Framework                           │
│              (다중 프로토콜, DI, AOT 빌드)                        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    바이브코딩 지원 도구      프레임워크 런타임        코드 품질 도구
         │                    │                    │
    ┌────┴─────┐         ┌────┴────┐          ┌────┴────┐
    │ Emberdeck│         │ Baker   │          │ Firebat │
    │ (스펙관리) │         │ (DTO)   │          │ (스캐너) │
    └────┬─────┘         └─────────┘          └────┬────┘
         │                                         │
    ┌────┴─────┐                              ┌────┴────┐
    │ Pyreez   │                              │ Gildash │
    │ (AI라우팅) │                              │ (인덱싱) │
    └──────────┘                              └─────────┘
                                                   ▲
         Emberdeck ─── 코드 링크 조회 ──────────────┘
         Firebat  ─── 의존성 그래프/품질 분석 ────────┘
```

### 2.2 각 프로젝트의 역할과 독립성 원칙

모든 프로젝트는 **단독으로도 완전하게 동작**해야 한다.
통합은 선택적 확장이지 필수 전제가 아니다.

#### Gildash — 코드 인텔리전스 엔진

**핵심 역할**: TypeScript 코드베이스를 인덱싱하여 심볼, 의존성, 구조 정보를 제공.

| 독립 사용 시 | Emberdeck 연동 시 |
|-------------|------------------|
| 코드 검색, 심볼 탐색 | 카드 ↔ 코드 심볼 매핑의 백엔드 |
| 의존성 그래프 분석 | 코드 변경 → 영향받는 카드 탐지 |
| 순환 의존성 탐지 | 심볼 리네임 감지 → 코드 링크 자동 갱신 |
| AST 패턴 매칭 | `@spec` 주석 파싱 → 자동 코드 링크 생성 |

**Emberdeck이 사용하는 Gildash API** (현재 실제 사용 중인 메서드):

```typescript
// Gildash 클래스에서 Emberdeck이 호출하는 메서드
class Gildash {
  searchSymbols(query: SymbolSearchQuery): SymbolSearchResult[]
  // 현재 Emberdeck은 이 메서드만 사용 (resolveCardCodeLinks, validateCodeLinks)
  // query: { text: string, exact: boolean, filePath: string }

  // 향후 Phase 2~3에서 추가 사용 예정:
  getSymbolsByFile(filePath: string, project?: string): SymbolSearchResult[]
  getDependents(filePath: string, project?: string, limit?: number): string[]
  findPattern(pattern: string, opts?: { filePaths?: string[] }): Promise<PatternMatch[]>
  diffSymbols(before: SymbolSearchResult[], after: SymbolSearchResult[]): SymbolDiff
  onFileChanged(callback: (event: FileChangeEvent) => void): () => void
}
```

Gildash는 **hard dependency** (`dependencies`에 `@zipbul/gildash`)이지만,
초기화 실패 시 **graceful degradation**으로 동작한다.
Gildash 초기화가 실패해도 카드 CRUD, 관계 그래프, FTS 검색은 모두 동작.
코드 링크 해석(`resolveCardCodeLinks`, `validateCodeLinks`)만 Gildash가 필요.

#### Firebat — 코드 품질 스캐너

**핵심 역할**: 28개 디텍터로 코드 품질 이슈 탐지 (데드코드, 중복, 순환 의존성 등).

| 독립 사용 시 | Emberdeck 연동 시 |
|-------------|------------------|
| CI/pre-commit 품질 게이트 | acceptance 기준 자동 검증 |
| 에이전트가 MCP로 품질 스캔 | 카드 상태 → implemented 전 품질 체크 |
| 기술 부채 정량화 | drift score 계산에 품질 메트릭 반영 |

**Firebat → Emberdeck 통합 방향**:
Firebat은 Emberdeck을 알 필요 없음.
Emberdeck이 Firebat의 스캔 결과를 **소비**하는 방향.

```
Firebat --[스캔결과]--> Emberdeck (카드의 acceptance 기준과 대조)
```

#### Pyreez — 멀티 모델 심의 인프라

**핵심 역할**: 태스크 분류 → 21차원 능력 프로파일링 → 최적 모델 선택 → 멀티 모델 합의.

| 독립 사용 시 | Emberdeck 연동 시 |
|-------------|------------------|
| 어떤 에이전트 환경에서든 모델 라우팅 | 아키텍처/보안 결정의 합의 기반 검증 |
| 단일 API로 21개 모델 접근 | 스펙 컨텍스트 기반 태스크 심의 |
| BT 평점 기반 모델 추천 | 카드의 complexity에 따른 자동 라우팅 |

**Pyreez → Emberdeck 통합 방향**:
둘 사이에 직접 의존성은 없음.
호스트 에이전트가 양쪽 MCP를 **조합**하여 사용.

```
Host Agent
  ├── emberdeck_get_card_context(key) → 스펙 + 컨텍스트
  ├── pyreez_deliberate(task + context) → 멀티 모델 합의 결과
  └── 합의 결과를 기반으로 구현
```

Emberdeck 코어에 Pyreez 의존성을 추가하지 않는다.
에이전트가 양쪽 MCP를 조합하여 사용하는 것이 통합 방식.

#### Baker — DTO 검증/변환

**핵심 역할**: 데코레이터 기반 validate + transform, AOT급 성능.

| 독립 사용 시 | Emberdeck 연동 시 |
|-------------|------------------|
| DTO 검증/직렬화 | 카드 입력 검증에 Baker 스키마 활용 가능 |
| Zipbul 파이프라인 통합 | acceptance 기준을 Baker 규칙으로 표현 가능 |

Baker와 Emberdeck의 직접 통합은 로드맵 범위 밖.
둘 다 Zipbul 프레임워크의 사용자 도구로서 독립적으로 기능.

### 2.3 통합 설계 원칙

```
원칙 1: 의존 방향은 단방향
  Emberdeck → Gildash (코드 링크 조회)
  Emberdeck은 Firebat, Pyreez를 직접 의존하지 않음

원칙 2: 통합은 인터페이스를 통해서만
  각 프로젝트는 안정된 public API만 노출
  내부 구현 변경이 다른 프로젝트에 영향을 주지 않음

원칙 3: Graceful degradation
  Gildash는 hard dependency이지만 초기화 실패 시 graceful degradation
  코드 링크 기능만 Gildash 필요, 나머지는 독립 동작

원칙 4: MCP가 조합의 수단
  프로젝트 간 런타임 통합이 아닌, 에이전트가 MCP 도구를 조합
  각 프로젝트는 자신의 MCP 서버를 독립적으로 제공

원칙 5: 공유 타입은 @zipbul/result만
  Result<T, E> 타입만 공유, 나머지 타입은 각 프로젝트가 소유
  주의: 현재 프로젝트 간 @zipbul/result 버전이 다름 (0.0.x vs 0.1.x)
  Phase 1 착수 전 버전 통일 필요
```

---

## 3. 현재 상태 (v0.2.0)

### 3.1 구현 완료

- 카드 CRUD (create, get, update, delete, rename)
- 5단계 상태 생명주기 (draft → accepted → implementing → implemented → deprecated)
- 카드 간 관계 (depends-on, references, related, extends, conflicts + 커스텀 타입)
- 양방향 관계 자동 미러링
- 코드 링크 (수동 선언, Gildash 연동 해석)
- FTS5 전문 검색 (summary + body)
- BFS 관계 그래프 탐색
- 파일 ↔ DB 동기화 (단일/벌크)
- MCP 서버 (19개 도구)
- 동시성 제어 (per-card lock, 트랜잭션, 보상 롤백)

### 3.2 현재 한계

| 영역 | 한계 |
|------|------|
| 코드 링크 | 수동 선언만 가능. 심볼 리네임 시 링크 깨짐. 자동 감지/갱신 없음 |
| 스펙 구조 | 자유 마크다운. acceptance 기준, 우선순위, 타입 등 구조적 필드 없음 |
| 상태 전이 | 상태 전이가 정보성. acceptance 기반 자동 전이 없음 |
| 변경 추적 | 카드 변경 이력(changelog) 없음 |
| 영향 분석 | 파일 기반만 가능. 심볼 수준 세밀한 분석 없음 |
| 컨텍스트 생성 | 에이전트를 위한 통합 컨텍스트 팩 기능 없음 |
| 상호작용 분석 | 기능 간 상호작용/충돌 탐지 없음 |
| 신선도 관리 | 카드-코드 간 drift 감지 없음 |

---

## 4. 로드맵

### Phase 1: 구조적 스펙 카드 (v0.3.0)

> **목표**: 카드가 "문서"에서 "검증 가능한 스펙"으로 진화.

#### 1.1 Acceptance 기준 필드

카드 프론트매터에 구조적 acceptance 기준 추가.

```yaml
---
key: auth-token
summary: JWT 토큰 관리 및 검증
status: draft
type: feature                # feature | bug | refactor | spike
priority: high               # critical | high | medium | low
acceptance:
  - id: ac-1
    description: "토큰 만료 시 자동 갱신"
    verified: false
  - id: ac-2
    description: "갱신 실패 시 로그아웃 처리"
    verified: false
  - id: ac-3
    description: "블랙리스트 토큰 즉시 거부"
    verified: false
---
```

**설계 원칙**:
- `acceptance`는 optional 필드. 기존 카드와 하위 호환.
- `verified` 플래그는 수동 또는 자동(향후 테스트 연동)으로 변경.
- 각 기준은 `id`로 식별. 다른 카드나 테스트에서 참조 가능.

**MCP 도구 추가**:
- `emberdeck_verify_acceptance` — 특정 acceptance 기준의 verified 상태 변경
- `emberdeck_list_unverified` — 미검증 기준이 있는 카드 목록 조회

#### 1.2 카드 타입과 우선순위

```yaml
type: feature    # feature | bug | refactor | spike | decision
priority: high   # critical | high | medium | low
```

- `type`은 카드의 성격을 명시. 에이전트가 구현 전략을 결정하는 데 사용.
- `priority`는 에이전트가 작업 순서를 결정하는 데 사용.
- `decision` 타입은 ADR(Architecture Decision Record) 용도.

#### 1.3 카드 변경 이력 (Changelog)

```
card_changelog 테이블:
  id         INTEGER PK
  card_key   TEXT FK → card.key
  field      TEXT        -- 변경된 필드 (status, summary, body, ...)
  old_value  TEXT        -- 변경 전 값 (null 허용)
  new_value  TEXT        -- 변경 후 값
  changed_at TEXT        -- ISO 8601 타임스탬프
  changed_by TEXT        -- "user" | "agent" | "sync"
```

- 모든 updateCard, updateCardStatus 호출 시 자동 기록.
- `emberdeck_get_card_history` MCP 도구로 조회.
- 에이전트가 "이 스펙이 왜 이렇게 바뀌었는지" 추적 가능.
- 새 테이블이므로 drizzle-kit 마이그레이션으로 추가. 기존 카드에 대한 이력은 소급 생성하지 않음.

#### 1.4 에러 처리 원칙

모든 신규 MCP 도구는 기존 패턴과 동일하게 처리:
- 내부에서 `try/catch` 래핑
- 성공 시 `{ isError: false, content: [...] }`
- 실패 시 `{ isError: true, content: [{ type: "text", text: 에러메시지 }] }`

#### 1.5 AX (Agent Experience) 설계 원칙

모든 Phase에 걸쳐 적용되는 에이전트 경험 원칙.

**도구 description 원칙**:
모든 MCP 도구의 description은 "무엇을 하는지(what)"뿐 아니라 **"언제 사용해야 하는지(when)"**를 명시한다.
에이전트가 도구 목록을 스캔할 때, 현재 상황에 맞는 도구를 자연스럽게 선택할 수 있어야 한다.

```
나쁜 예: "카드를 텍스트 검색한다"
좋은 예: "기능 구현이나 버그 수정 전에 관련 스펙이 있는지 먼저 확인한다"

나쁜 예: "변경 영향을 분석한다"
좋은 예: "코드 수정 전에 호출하여 영향받는 스펙과 리스크를 파악한다"
```

**도구 역할 분리 원칙**:
유사해 보이는 도구는 **무게(가벼움/무거움)**와 **용도(조회/분석)**로 명확히 구분한다.

| 가벼운 조회 | 무거운 분석 |
|------------|-----------|
| `get_card_context` — 단일 카드 빠른 조회 | `generate_context` — 멀티 카드 컨텍스트 팩 |
| `find_affected_cards` — 영향 카드 목록 | `pre_change_check` — 리스크 분석 리포트 |

에이전트가 빠른 확인이 필요하면 가벼운 도구를, 의사결정이 필요하면 무거운 도구를 선택한다.

**외부 입력 관용 원칙**:
다른 MCP 도구의 출력을 입력으로 받는 경우(예: `regression_guard`의 `firebatReport`),
에이전트에게 형식 변환을 요구하지 않는다. 외부 출력을 `unknown`으로 받고 내부에서 파싱한다.

---

### Phase 2: 코드 링크 자동화 (v0.4.0)

> **목표**: 수동 코드 링크의 한계를 극복하여 스펙-코드 추적 정확도를 높임.

#### 2.1 `@spec` 주석 자동 감지

코드에 `@spec` 주석이 있으면 Gildash가 파싱하여 Emberdeck 코드 링크를 자동 생성.

```typescript
// @spec auth-token
export function generateToken(payload: TokenPayload): string {
  // ...
}
```

**구현 방향**:
- Gildash의 심볼 추출 시 주석도 함께 파싱 (comment-parser 이미 의존성에 있음).
- `@spec <card-key>` 패턴 매칭.
- Emberdeck의 bulkSync 시 Gildash 인덱스에서 `@spec` 주석을 조회하여 코드 링크 자동 생성.

**설계 원칙**:
- 수동 선언과 자동 감지가 공존. 자동 감지된 링크는 `source: "annotation"` 메타데이터 부착.
- 수동 선언 링크는 자동 감지로 덮어쓰지 않음.

#### 2.2 심볼 리네임 감지 및 동기화

Gildash가 심볼 변경을 감지하면 Emberdeck 코드 링크를 자동 갱신.

```
Gildash file watcher:
  oldIndex: { file: "src/auth/token.ts", symbol: "generateToken" }
  newIndex: { file: "src/auth/token.ts", symbol: "createToken" }
  → diff: symbol renamed

Emberdeck:
  code_link UPDATE SET symbol = "createToken"
    WHERE file = "src/auth/token.ts" AND symbol = "generateToken"
```

**설계 원칙**:
- 리네임 감지는 Gildash의 책임. Emberdeck은 결과만 소비.
- Gildash가 제공해야 할 인터페이스:
  ```typescript
  interface SymbolChange {
    type: 'renamed' | 'moved' | 'deleted'
    oldFile: string
    oldSymbol: string
    newFile?: string
    newSymbol?: string
  }
  ```
- Emberdeck은 이 변경 이벤트를 받아 코드 링크를 일괄 갱신.
- 삭제된 심볼은 코드 링크를 `broken` 상태로 마킹 (자동 삭제하지 않음).

#### 2.3 코드 링크 커버리지

```
emberdeck_get_link_coverage(key: "auth-token")
→ {
    declared: 5,        // 선언된 코드 링크 수
    resolved: 4,        // Gildash에서 확인된 심볼 수
    broken: 1,          // 깨진 링크 수
    coverage: 0.80,     // resolved / declared
    unreferenced: [     // 카드에 링크되지 않은 관련 심볼
      { file: "src/auth/refresh.ts", symbol: "refreshToken" }
    ]
  }
```

- `unreferenced`는 Gildash에서 같은 파일/디렉터리의 심볼 중 아직 코드 링크가 없는 것.
- 에이전트가 "이 스펙에 아직 연결 안 된 관련 코드가 있다"는 것을 파악 가능.

---

### Phase 3: 컨텍스트 엔진 (v0.5.0)

> **목표**: 에이전트의 "컨텍스트 유실" 문제를 구조적으로 해결.

#### 3.1 컨텍스트 팩 생성

```
emberdeck_generate_context(
  key: "auth-token",            // 시작 카드 키 (필수)
  maxCards?: 20,                // 최대 카드 수 (토큰 예산 관리)
  maxDepth?: 3                  // 관계 그래프 최대 깊이 (기본값 3)
)
→ {
    cards: [                      // 시작 카드 + 관계 그래프로 연결된 카드 요약
      { key, summary, status, type, priority }
    ],
    relationGraph: [              // 의존성 흐름
      { from, to, type, direction }
    ],
    acceptanceCriteria: [         // 달성해야 할 기준
      { cardKey, id, description, verified }
    ],
    codeLinks: [                  // 연결된 코드 심볼
      { cardKey, kind, file, symbol, resolved }
    ],
    recentChanges: [              // 최근 카드 변경 이력
      { cardKey, field, oldValue, newValue, changedAt }
    ],
    constraints: {                // 제약 조건 통합
      [cardKey]: { ... }
    }
  }
```

**이것이 핵심 기능.** 에이전트가 새 세션을 시작하거나 컨텍스트가 열화될 때
이 도구 하나로 프로젝트의 관련 맥락을 즉시 복구.

**설계 원칙**:
- `key` 파라미터로 시작 카드를 지정하면, BFS로 관계 그래프를 탐색하여 연결된 카드를 자동 포함.
  별도의 scope/와일드카드 파라미터는 두지 않는다. 관계 그래프가 범위를 결정한다.
- 넓은 범위가 필요하면 `maxDepth`를 키우고, 여러 무관한 영역은 `search_cards` → 개별 `generate_context` 호출로 해결.
- 출력 크기 제어: `maxCards`, `maxDepth` 파라미터로 토큰 예산 관리.
- 정보는 요약 수준. 전체 body를 포함하지 않음 (필요 시 `getCard`으로 개별 조회).

**`get_card_context`(v0.2.0)와의 관계**:
- `get_card_context` — 단일 카드의 관계와 코드 링크를 빠르게 조회. 가벼운 조회용.
- `generate_context` — 관계 그래프 기반 멀티 카드 컨텍스트 팩. 맥락 복구용.
- 둘은 용도가 다르므로 공존한다.

#### 3.2 Drift 감지 (컨텍스트 신선도)

```
emberdeck_check_drift(
  key?: "auth-token",           // 시작 카드 (미지정 시 전체 카드)
  maxDepth?: 3                  // 관계 그래프 탐색 깊이 (기본값 3)
)
→ {
    driftScore: 0.73,           // 0=완전동기화, 1=완전불일치
    staleCards: [
      {
        key: "auth-token",
        lastCardUpdate: "2025-02-10",
        codeChangesAfter: 12,   // 카드 업데이트 후 관련 코드 변경 횟수
        brokenLinks: 1,
        unverifiedAcceptance: 2
      }
    ],
    summary: "auth 영역의 3개 카드 중 2개가 코드와 동기화 필요"
  }
```

- `key` 지정 시 해당 카드 + BFS 관계 그래프 범위에서 drift 계산.
- `key` 미지정 시 전체 카드에 대해 drift 계산.

**drift score 계산** (가중합, 범위 0~1):
```
driftScore =
  brokenLinkRatio     * 0.3 +  // 깨진 코드 링크 수 / 전체 코드 링크 수
  staleCardRatio      * 0.3 +  // 미갱신 카드 수 / 전체 카드 수
  unverifiedRatio     * 0.2 +  // 미검증 acceptance 수 / 전체 acceptance 수
  missingLinkRatio    * 0.2    // 미연결 심볼 수 / (미연결 + 연결) 심볼 수

각 ratio는 0~1로 정규화. 해당 데이터가 없는 ratio는 0으로 처리.
```

- `staleCardRatio` 판정: 카드의 `updated_at`과 코드 링크 파일의 `mtime`을 비교.
  Gildash의 `getFileInfo()` (이미 사용 가능)로 파일 정보 조회.
- Phase 2의 `@spec` 자동 감지가 없으면 `missingLinkRatio`는 0으로 처리 (graceful degradation).

#### 3.3 상호작용 분석 (Interaction Check)

```
emberdeck_check_interactions(cards: ["auth-token", "session", "rate-limiting"])
→ {
    interactions: [
      {
        pair: ["auth-token", "session"],
        sharedSymbols: [
          { file: "src/auth/context.ts", symbol: "UserContext" }
        ],
        relationType: "depends-on",
        potentialConflicts: []
      },
      {
        pair: ["auth-token", "rate-limiting"],
        sharedSymbols: [],
        relationType: null,        // 관계 미정의
        potentialConflicts: [
          "rate limit 초과 시 토큰 갱신 차단 가능성 (공유 심볼 없으나 동일 엔드포인트)"
        ]
      }
    ],
    undefinedRelations: [
      { pair: ["session", "rate-limiting"], suggestion: "related" }
    ]
  }
```

**구현 방향**:
- `sharedSymbols`: 양쪽 카드의 코드 링크가 같은 파일/심볼을 참조하는지 확인.
- `undefinedRelations`: 코드 링크가 겹치지만 카드 간 관계가 정의되지 않은 쌍.
- `potentialConflicts`: 초기 구현은 **규칙 기반 휴리스틱**으로 탐지.
  (예: 관계 미정의인데 같은 파일을 참조하는 카드 쌍 → "상호작용 미정의" 경고).
  자연어 수준의 충돌 분석은 향후 LLM 연동 시 확장 가능.

---

### Phase 4: 영향 분석 강화 (v0.6.0)

> **목표**: "두더지 잡기" 문제를 방지하는 사전 영향 분석.

#### 4.1 Pre-change Impact Check

```
emberdeck_pre_change_check(
  files: ["src/auth/token.ts"],
  symbols?: ["generateToken"]
)
→ {
    affectedCards: [
      { key: "auth-token", linkType: "direct", affectedLinks: 2 },
      { key: "api/protected-routes", linkType: "transitive", via: "auth-token" }
    ],
    atRiskAcceptance: [
      {
        cardKey: "auth-token",
        criterionId: "ac-3",
        description: "블랙리스트 토큰 즉시 거부",
        relatedSymbol: "generateToken"
      }
    ],
    riskLevel: "high",          // low | medium | high | critical
    suggestedActions: [
      "auth-token 카드의 ac-3 기준 재검증 필요",
      "api/protected-routes 카드의 의존성 확인 권장"
    ]
  }
```

**riskLevel 계산**:
```
critical: 영향받는 카드 중 priority=critical이 있음
high:     직접 영향 카드 3개 이상 또는 atRiskAcceptance 있음
medium:   직접 영향 카드 1~2개
low:      전이적 영향만 존재
```

**전이적 영향 탐색**: 직접 영향 카드에서 BFS로 관계 그래프를 역방향 탐색하여
해당 카드에 의존하는 카드를 전이적 영향으로 식별. 기본 maxDepth는 3.

#### 4.2 Regression Guard (Firebat 연동)

```
emberdeck_regression_guard(
  changedFiles: ["src/auth/token.ts"],
  firebatReport?: unknown              // optional: Firebat 스캔 결과 (그대로 전달)
)
→ {
    qualityGate: "pass" | "warn" | "fail",
    newIssues: [...],                   // Firebat이 탐지한 새 이슈
    affectedAcceptance: [...],          // 영향받는 acceptance 기준
    recommendation: "..."
  }
```

**설계 원칙**:
- Firebat 결과는 **외부 입력**으로 받음. Emberdeck이 Firebat에 의존하지 않음.
- `firebatReport`는 `unknown` 타입으로 받고 Emberdeck 내부에서 파싱한다.
  에이전트는 Firebat MCP 출력을 형식 변환 없이 그대로 전달하면 된다.
- 에이전트가 `firebat_scan` → `emberdeck_regression_guard` 순서로 호출.
- Emberdeck은 Firebat 결과와 자체 카드 데이터를 교차 분석만 수행.

---

## 5. 프로젝트 간 통합 아키텍처

### 5.1 의존성 계층

```
Layer 0 (기반)
  @zipbul/result        Result<T, E> 타입

Layer 1 (코어 엔진)
  Gildash               코드 인텔리전스 (독립)
  Pyreez                멀티 모델 심의 (독립)

Layer 2 (도구)
  Firebat               품질 스캐너 (Gildash 의존)
  Emberdeck             스펙 관리 (Gildash 의존, graceful degradation)
  Baker                 DTO 검증 (독립)

Layer 3 (프레임워크)
  Zipbul                웹 프레임워크 (Baker, Toolkit 의존)

Layer 4 (통합 — 코드가 아닌 에이전트 워크플로우)
  에이전트가 MCP를 통해 Layer 1~3의 도구를 조합
```

### 5.2 MCP 도구 조합 패턴

에이전트가 도구들을 조합하는 표준 패턴:

```
패턴 1: 컨텍스트 기반 구현

  emberdeck_generate_context → 맥락 수집
  emberdeck_pre_change_check → 영향 분석
  (구현)
  emberdeck_verify_acceptance → 검증
  emberdeck_update_card_status → 상태 갱신

패턴 2: 심의 기반 설계

  emberdeck_get_card_context → 스펙 + 관계 조회
  pyreez_deliberate(스펙 기반 태스크) → 멀티 모델 합의
  emberdeck_create_card (결과 반영) → 결정 기록

패턴 3: 품질 게이트

  firebat_scan → 코드 품질 스캔
  emberdeck_regression_guard(firebat 결과) → 스펙 기반 교차 검증
  emberdeck_check_drift → 스펙-코드 동기화 확인

```

### 5.3 Gildash에 필요한 확장

Emberdeck Phase 2~3을 위해 Gildash가 제공해야 할 기능:

| 기능 | Phase | Gildash API |
|------|-------|-------------|
| `@spec` 주석 파싱 | 2.1 | `findSpecAnnotations(filePath): SpecAnnotation[]` |
| 심볼 변경 감지 | 2.2 | `getSymbolChanges(since: timestamp): SymbolChange[]` |
| 파일별 변경 횟수 | 3.2 | `getFileChangeCount(filePath, since): number` |
| 심볼 존재 확인 | 현재 | `searchSymbols(query: SymbolSearchQuery)` (이미 사용 중) |

**중요**: 이 확장은 Gildash 자체의 로드맵에 포함되어야 하며,
Emberdeck 팀이 Gildash의 내부 구현에 관여하지 않는다.
인터페이스 계약만 합의.

---

## 6. 기존 SDD 도구와의 차별점

| | 마크다운 파일 (PRD.md, SPEC.md) | GitHub Spec Kit | Emberdeck |
|---|---|---|---|
| **저장** | 평면 파일 | GitHub Issues | SQLite + 파일 (이중 소스) |
| **검색** | grep | GitHub 검색 | FTS5 전문 검색 |
| **관계** | 수동 링크 | Issue 참조 | 구조적 관계 그래프 (BFS) |
| **코드 연결** | 없음 | 없음 | Gildash 연동 심볼 매핑 |
| **에이전트 접근** | 파일 읽기 | GitHub API | MCP 도구 (19개 + 확장 예정) |
| **영향 분석** | 불가능 | 불가능 | 코드 변경 → 스펙 영향 탐지 |
| **컨텍스트 복구** | 전체 파일 재읽기 | 불가능 | generate_context (요약 팩) |
| **drift 감지** | 불가능 | 불가능 | 자동 drift score 계산 |
| **멀티 모델** | 불가능 | 불가능 | Pyreez 연동 심의 |

---

## 7. 릴리스 계획 요약

| Phase | 버전 | 핵심 기능 | Gildash 필요 확장 |
|-------|------|----------|------------------|
| 1 | v0.3.0 | acceptance 기준, 카드 타입/우선순위, 변경 이력 | 없음 |
| 2 | v0.4.0 | @spec 자동 감지, 심볼 리네임 동기화, 커버리지 | 주석 파싱, 변경 감지 |
| 3 | v0.5.0 | 컨텍스트 팩, drift 감지, 상호작용 분석 | 파일 변경 횟수 |
| 4 | v0.6.0 | pre-change impact, regression guard | 없음 (Firebat 결과 소비) |

Emberdeck의 범위는 **기억과 추적**이다. 스펙 분해, 구현 계획, 워크플로우 오케스트레이션은
에이전트의 판단 영역이며 Emberdeck이 관여하지 않는다.
에이전트는 관계 그래프(`get_relation_graph`)와 컨텍스트 팩(`generate_context`)을 통해
스스로 구현 순서를 결정할 수 있다.

각 Phase는 독립적으로 가치를 제공하되, 이전 Phase가 완료되면 더 풍부한 기능을 사용 가능.
Phase 1만으로도 기존 카드 시스템을 개선하며,
Phase 3이 완성되면 바이브코딩의 핵심 문제(컨텍스트 유실)를 직접 해결.

**Phase 간 의존성 참고**: Phase 3 이후의 일부 기능은 이전 Phase의 데이터를 활용함.
예: `generate_context`의 `acceptanceCriteria`는 Phase 1의 acceptance 필드가 필요.
해당 데이터가 없을 때는 해당 섹션을 생략하여 부분적 가치를 제공.

---

## 부록 A: 전체 MCP 도구 목록 (Phase 4 완료 시)

### 기존 (v0.2.0, 19개)

| 도구 | 카테고리 |
|------|---------|
| `emberdeck_create_card` | CRUD |
| `emberdeck_get_card` | CRUD |
| `emberdeck_update_card` | CRUD |
| `emberdeck_update_card_status` | CRUD |
| `emberdeck_delete_card` | CRUD |
| `emberdeck_rename_card` | CRUD |
| `emberdeck_list_cards` | 쿼리 |
| `emberdeck_search_cards` | 쿼리 |
| `emberdeck_get_card_context` | 쿼리 |
| `emberdeck_get_relation_graph` | 쿼리 |
| `emberdeck_list_card_relations` | 쿼리 |
| `emberdeck_sync_card_from_file` | 동기화 |
| `emberdeck_bulk_sync_cards` | 동기화 |
| `emberdeck_validate_cards` | 동기화 |
| `emberdeck_export_card_to_file` | 동기화 |
| `emberdeck_resolve_code_links` | 코드 링크 |
| `emberdeck_find_cards_by_symbol` | 코드 링크 |
| `emberdeck_find_affected_cards` | 코드 링크 |
| `emberdeck_validate_code_links` | 코드 링크 |

### 신규 (Phase 1~4, 8개)

| 도구 | Phase | 카테고리 |
|------|-------|---------|
| `emberdeck_verify_acceptance` | 1 | 검증 |
| `emberdeck_list_unverified` | 1 | 쿼리 |
| `emberdeck_get_card_history` | 1 | 쿼리 |
| `emberdeck_get_link_coverage` | 2 | 코드 링크 |
| `emberdeck_generate_context` | 3 | 컨텍스트 |
| `emberdeck_check_drift` | 3 | 컨텍스트 |
| `emberdeck_check_interactions` | 3 | 분석 |
| `emberdeck_pre_change_check` | 4 | 분석 |
| `emberdeck_regression_guard` | 4 | 분석 |
