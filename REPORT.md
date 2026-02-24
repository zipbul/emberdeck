# Emberdeck 심층 분석 리포트

> 분석 일자: 2026-02-23
> 분석 범위: 프로젝트 전체 (소스 코드, 테스트, 스키마, 마이그레이션, 설정 파일 전수 검토)

---

## 1. 프로젝트 목표 및 목적

### 1.1 핵심 정체성

Emberdeck는 **마크다운 기반 설계 카드(spec card) 관리 라이브러리**이다.
소프트웨어 프로젝트의 설계 의사결정, 스펙, 컨텍스트를 `.card.md` 파일로 관리하며, SQLite DB로 메타데이터를 인덱싱한다.

### 1.2 핵심 목표

| 목표 | 설명 |
|------|------|
| **파일 기반 설계 카드 관리** | YAML frontmatter + Markdown body 형식의 `.card.md` 파일로 카드를 생성/수정/삭제/이름변경 |
| **DB 인덱싱** | SQLite(drizzle-orm)를 통한 카드 메타데이터, 관계, 분류(keyword/tag), 코드 링크 인덱싱 |
| **양방향 관계 관리** | 카드 간 관계(depends-on, references, related 등)를 자동으로 양방향(forward+reverse) 저장 |
| **코드-설계 연결** | gildash 통합으로 코드 심볼(함수, 클래스 등) ↔ 카드 연결, 깨진 링크 검증, 영향 범위 분석 |
| **파일 워치 동기화** | 외부 편집된 `.card.md` 파일을 DB에 동기화 (CLI watcher 연동) |
| **FTS5 전문 검색** | (미완성) SQLite FTS5를 통한 카드 전문 검색 |

### 1.3 아키텍처 구조

```
index.ts (Public API 진입점)
  └─ src/
     ├─ config.ts       (타입 정의, 기본 설정)
     ├─ setup.ts        (컨텍스트 초기화/해제)
     ├─ card/           (도메인 계층: 키 정규화, 마크다운 파싱, 타입, 에러)
     ├─ db/             (저장소 계층: Repository 인터페이스 + Drizzle 구현)
     ├─ fs/             (파일 I/O 계층: 읽기/쓰기)
     └─ ops/            (유스케이스 계층: CRUD, 이름변경, 동기화, 검색, 링크)
```

---

## 2. 시스템 효율/가치/경쟁력 평가

### 2.1 강점

| 강점 | 평가 |
|------|------|
| **듀얼 소스(파일+DB)** | 사람이 직접 `.md` 파일을 편집할 수 있으면서 DB 쿼리도 가능한 하이브리드 설계. 개발자 친화적이며 Git 버전관리와 자연스럽게 통합됨 |
| **코드-설계 연결(gildash)** | 코드 심볼과 설계 카드를 직접 연결하는 기능은 기존 문서 도구(Notion, Obsidian 등)에 없는 독창적 기능. **핵심 경쟁력** |
| **양방향 관계 자동 관리** | 관계 삽입 시 forward+reverse를 자동 생성하여 양방향 탐색이 가능. 그래프 기반 탐색의 토대 |
| **Bun 네이티브 활용** | Bun.YAML, Bun.file, bun:sqlite, bun:test 등 Bun 생태계 최대 활용 |
| **깔끔한 계층 분리** | card(도메인) → db(저장소) → fs(파일) → ops(유스케이스) 4계층으로 명확한 책임 분리 |
| **Repository 패턴** | 인터페이스 기반 추상화로 테스트/교체 가능성 확보 |
| **FK CASCADE** | 카드 삭제 시 관련 데이터 자동 정리 (relation, keyword mapping, tag mapping, code link) |
| **테스트 커버리지** | 유닛 테스트(*.spec.ts) + 통합 테스트(*.test.ts) 이중 구조로 높은 커버리지 |

### 2.2 경쟁력 평가

| 관점 | 평가 | 등급 |
|------|------|------|
| **고유 가치** | 코드 심볼 ↔ 설계 카드 연결은 기존 도구에 없는 차별화. 대규모 코드베이스에서 "이 함수의 설계 근거가 뭐였지?"를 즉시 추적 가능 | ★★★★★ |
| **아키텍처** | 깔끔한 계층 분리, Repository 패턴, DI 기반 구조. 확장성 높음 | ★★★★☆ |
| **완성도** | FTS5 검색 미구현, codeLink 일부 결함 등 미완성 요소 존재 | ★★★☆☆ |
| **데이터 일관성** | 파일-DB 원자성 부재, 에러 처리 미흡 | ★★★☆☆ |
| **사용성** | 라이브러리 API가 직관적이고 에러 클래스가 명확 | ★★★★☆ |
| **유지보수성** | 일관된 코딩 스타일, 명료한 타입. 일부 패턴 불일치 존재 | ★★★★☆ |

### 2.3 총평

> Emberdeck의 **코드-설계 연결**이라는 핵심 컨셉은 매우 독창적이고 실용적이다.
> 아키텍처 설계도 견고하다. 하지만 **FTS 미구현**, **데이터 일관성 결함**, **rename 시 codeLink 소실** 등
> 핵심 기능의 미완성/결함이 존재하여 프로덕션 수준에는 아직 미달한다.
> 이 결함들이 해결되면 **현재 코드 범위 내에서의 정확성**은 확보되지만,
> 프로덕션 수준의 완성된 시스템이 되려면 기능 확장, 시스템 견고성, API 성숙도, 운영 인프라 등
> 추가 차원의 작업이 필요하다 (→ 섹션 9 참조).

---

## 3. 심층 결함 분석

### 3.1 심각도 정의

| 심각도 | 정의 |
|--------|------|
| 🔴 **CRITICAL** | 기능이 작동하지 않거나 데이터 손실 가능 |
| 🟠 **HIGH** | 설계상 중대한 문제. 특정 조건에서 오작동 또는 데이터 불일치 |
| 🟡 **MEDIUM** | 코드 품질/방어성 부족. 당장 문제는 없지만 장기적 리스크 |
| 🔵 **LOW** | 개선 권장. 일관성/유지보수/확장성 측면 |

---

### 3.2 🔴 CRITICAL 결함

#### BUG-1: `renameCard`에서 codeLinks 미보존

**파일**: `src/ops/rename.ts` (트랜잭션 블록 내부)

**현상**: 카드 이름 변경 시 `relations`, `keywords`, `tags`는 백업 후 새 키에 재연결하지만, **`codeLinks`는 백업/재연결하지 않음**. `cardRepo.deleteByKey(oldKey)`의 CASCADE로 code_link 행이 삭제된 후 복원되지 않아 **codeLinks가 영구 소실**됨.

**영향**: 코드-설계 연결이라는 핵심 기능이 rename 한 번으로 완전히 파괴됨.

**코드 위치**:
```typescript
// rename.ts 트랜잭션 내부
const oldRelations = relationRepo.findByCardKey(oldKey)...
const oldKeywords = classRepo.findKeywordsByCard(oldKey);
const oldTags = classRepo.findTagsByCard(oldKey);
// ❌ codeLinks 백업 없음

cardRepo.deleteByKey(oldKey); // CASCADE → code_link 삭제

cardRepo.upsert(row);
if (oldRelations.length > 0) relationRepo.replaceForCard(newFullKey, oldRelations);
if (oldKeywords.length > 0) classRepo.replaceKeywords(newFullKey, oldKeywords);
if (oldTags.length > 0) classRepo.replaceTags(newFullKey, oldTags);
// ❌ codeLinks 재삽입 없음
```

**수정 방향**: `const oldCodeLinks = codeLinkRepo.findByCardKey(oldKey)` 백업 후 `codeLinkRepo.replaceForCard(newFullKey, oldCodeLinks.map(...))` 재삽입 추가.

---

#### BUG-2: `searchCards` 미구현 (항상 빈 배열 반환)

**파일**: `src/db/card-repo.ts` L59-62

**현상**: `search()` 메서드가 FTS5 쿼리를 수행하지 않고 항상 `[]`를 반환.

```typescript
search(_query: string): CardRow[] {
  // FTS5 MATCH. cardFts 가상 테이블은 수동 마이그레이션 후 사용 가능.
  // 초기 구현: FTS 미설정 시 빈 배열 반환.
  return [];
}
```

**영향**: Public API로 `searchCards`가 export되어 있고 사용자가 호출할 수 있지만, 어떤 입력에도 결과가 없음. 사실상 사문 코드.

---

#### BUG-3: FTS5 content sync 트리거 누락

**파일**: `drizzle/0000_dark_rhodey.sql`

**현상**: FTS5 가상 테이블이 `content=card, content_rowid=rowid`로 생성되었으나, card 테이블의 INSERT/UPDATE/DELETE를 FTS에 반영하는 **trigger가 존재하지 않음**. 또한 card 테이블의 `rowid` 컬럼이 explicit integer로 선언되어 있는데 upsert 시 값이 할당되지 않으므로 **NULL**이 됨. FTS5의 `content_rowid=rowid`가 NULL을 참조하게 되어 매핑이 완전히 깨짐.

**필요한 트리거 (예시)**:
```sql
CREATE TRIGGER card_ai AFTER INSERT ON card BEGIN
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
CREATE TRIGGER card_ad AFTER DELETE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body) VALUES('delete', old.rowid, old.key, old.summary, old.body);
END;
CREATE TRIGGER card_au AFTER UPDATE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body) VALUES('delete', old.rowid, old.key, old.summary, old.body);
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
```

**추가 문제**: schema.ts에서 `rowid: integer('rowid')`는 SQLite 내부 rowid의 alias가 아님 (alias가 되려면 `INTEGER PRIMARY KEY`여야 함). 현재 key가 PRIMARY KEY이므로 rowid 컬럼은 별도 컬럼이 되며, upsert에서 값을 설정하지 않아 항상 NULL.

---

### 3.3 🟠 HIGH 결함

#### DESIGN-1: 파일/DB 원자성 부재 — 데이터 불일치 가능

**파일**: `src/ops/create.ts`, `src/ops/delete.ts`, `src/ops/rename.ts`, `src/ops/update.ts`

**현상**: 모든 ops 함수가 파일 I/O와 DB 작업을 분리 수행. 어느 한쪽이 실패하면 다른 쪽은 이미 완료 상태로 남아 **파일-DB 불일치** 발생.

| 함수 | 순서 | 실패 시나리오 |
|------|------|--------------|
| `createCard` | 파일 생성 → DB 트랜잭션 | DB 실패 시 파일만 존재 (고아 파일) |
| `deleteCard` | 파일 삭제 → DB 삭제 | DB 실패 시 파일 삭제됨 + DB에 유령 row |
| `renameCard` | 파일 rename → 파일 write → DB 트랜잭션 | DB 실패 시 파일은 이동됨 + DB는 old key |
| `updateCard` | 파일 write → DB 트랜잭션 | DB 실패 시 파일만 갱신됨 |

**완화 요소**: `syncCardFromFile`이 파일→DB 동기화를 제공하므로 불일치 복구가 이론적으로 가능. 하지만 자동 복구 메커니즘은 없음.

**권장**: DB 작업 순서를 파일 앞으로 이동하거나, 보상 트랜잭션(compensation) 패턴 적용.

---

#### DESIGN-2: catch 블록이 모든 에러를 삼킴

**파일**: `src/db/relation-repo.ts` L18-39, `src/db/code-link-repo.ts` L13-22

**현상**:
```typescript
try {
  this.db.insert(cardRelation).values({...}).run();
  this.db.insert(cardRelation).values({...}).run(); // reverse
} catch {
  // 대상 카드 미존재 → FK violation → 해당 relation만 스킵 (정상)
}
```

FK violation뿐 아니라 **모든 종류의 에러**(디스크 풀, 커넥션 끊김, 타입 에러 등)가 무시됨. 프로덕션에서 치명적인 에러가 조용히 숨겨질 수 있음.

**수정 방향**: 에러 메시지에서 FK/constraint violation을 판별하여 그것만 스킵하고, 나머지는 re-throw.

---

#### DESIGN-3: `updateCardStatus` — DB row 없으면 파일만 변경

**파일**: `src/ops/update.ts` L110-121

**현상**:
```typescript
const existing = cardRepo.findByKey(key);
if (existing) {
  cardRepo.upsert({ ...existing, status, updatedAt: now });
}
```

`existing`이 null이면 (DB에 카드가 없으면) 파일의 status만 변경되고 DB에는 반영되지 않음. 파일과 DB의 status 불일치가 **의도적으로 허용**됨 (테스트에서 확인). 하지만 이는 데이터 불일치를 더 키우는 설계.

---

#### DESIGN-4: `CreateCardInput`에 `constraints` 필드 누락

**파일**: `src/ops/create.ts` L17-25

**현상**: `CreateCardInput` 인터페이스에 `constraints` 필드가 없어 **카드 생성 시 constraints를 설정할 수 없음**. `updateCard`를 통해서만 나중에 추가 가능.

```typescript
export interface CreateCardInput {
  slug: string;
  summary: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
  relations?: CardRelation[];
  codeLinks?: CodeLink[];
  // ❌ constraints 필드 없음
}
```

DB에서도 `constraintsJson: null`로 하드코딩됨.

---

#### DESIGN-5: `deleteCard`에서 트랜잭션 미사용 + ctx.cardRepo 미사용

**파일**: `src/ops/delete.ts` L22-23

**현상**:
```typescript
const cardRepo = new DrizzleCardRepository(ctx.db); // ctx.cardRepo 미사용
cardRepo.deleteByKey(key); // 트랜잭션 없음
```

1. `ctx.cardRepo`가 제공되어 있는데 새 인스턴스를 생성 — Repository 추상화 무시
2. 트랜잭션 없이 직접 실행 — 다른 ops 함수들(create, rename, update)은 트랜잭션 사용

---

### 3.4 🟡 MEDIUM 결함

#### QUALITY-1: `tx as EmberdeckDb` 타입 단언

**파일**: `src/ops/create.ts`, `src/ops/rename.ts`, `src/ops/sync.ts`, `src/ops/update.ts`

**현상**: 트랜잭션 콜백 내에서 `tx` 객체를 `EmberdeckDb`로 타입 단언하여 Repository 생성에 사용. drizzle-orm의 트랜잭션 객체와 db 객체는 타입이 다를 수 있으며, 타입 안전성이 보장되지 않음.

```typescript
ctx.db.transaction((tx) => {
  const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
  // ...
});
```

실행 시 작동하는 것은 내부 구조가 호환되기 때문이지, 타입 시스템이 보증하는 것은 아님.

---

#### QUALITY-2: `code_link` / `card_relation` UNIQUE 제약 부재

**파일**: `src/db/schema.ts`

**현상**: `code_link` 테이블에 `(card_key, kind, file, symbol)` 조합의 UNIQUE 제약이 없음. `card_relation`에도 `(type, src_card_key, dst_card_key)` UNIQUE 미설정. `replaceForCard` 패턴(삭제 후 재삽입)으로 실질적 중복은 방지되지만, 직접 DB를 조작하거나 코드 경로가 변경되면 중복 삽입 가능.

---

#### QUALITY-3: tag / keyword orphan 레코드 미정리

**파일**: `src/db/schema.ts`, `src/db/classification-repo.ts`

**현상**: card 삭제 시 `card_keyword`/`card_tag` 매핑은 FK CASCADE로 삭제되지만, `keyword`/`tag` 테이블의 레코드 자체는 남음. 사용되지 않는 keyword/tag 행이 무한히 축적됨. GC(Garbage Collection) 메커니즘이 없음.

---

#### QUALITY-4: Node.js / Bun API 혼용 — 일관성 부족

**파일**: 다수

| API | 출처 | 사용 위치 |
|-----|------|----------|
| `mkdir`, `rename` | `node:fs/promises` | create.ts, rename.ts |
| `mkdirSync` | `node:fs` | connection.ts |
| `join`, `dirname`, `resolve` | `node:path` | card-key.ts, connection.ts 등 |
| `Bun.file`, `Bun.write` | Bun native | writer.ts, reader.ts, ops/* |
| `Bun.YAML` | Bun native | markdown.ts |

디렉토리/파일 존재 확인은 `Bun.file().exists()` 사용하면서, 디렉토리 생성은 `node:fs/promises`의 `mkdir` 사용. 기능적으로는 문제없으나, Bun-first 정책과 코드 일관성 면에서 아쉬움.

---

#### QUALITY-5: card 스키마의 `rowid` 컬럼 설계 문제

**파일**: `src/db/schema.ts` L12

**현상**: `rowid: integer('rowid')` 선언은 SQLite 내부 rowid의 alias가 **아님** (alias가 되려면 해당 컬럼이 `INTEGER PRIMARY KEY`여야 함). 현재 `key: text('key').primaryKey()`가 primary key이므로 `rowid`는 **별도의 nullable integer 컬럼**이 됨.

모든 upsert 코드에서 `rowid` 값을 설정하지 않으므로 항상 NULL. FTS5의 `content_rowid=rowid` 설정이 무의미해짐.

---

### 3.5 🔵 LOW 결함 및 개선 권장

#### IMPROVE-1: `deleteCard` 작업 순서

**파일**: `src/ops/delete.ts`

**현상**: 파일 삭제 → DB 삭제 순서. DB 삭제가 실패하면 파일은 이미 삭제됨 + DB에 유령 row 잔존. DB 삭제 → 파일 삭제 순서가 더 안전함 (DB 실패 시 파일과 DB 모두 일관된 상태 유지, 파일만 남으면 sync로 복구 가능).

---

#### IMPROVE-2: 에러 로깅 부재

**파일**: `src/db/relation-repo.ts`, `src/db/code-link-repo.ts`

**현상**: catch 블록에 로깅이 없어 디버깅이 어려움. 최소한 `console.warn` 또는 로거를 통한 기록 권장.

---

#### IMPROVE-3: `constraints` 타입이 `unknown`

**파일**: `src/card/types.ts` L31

**현상**: `constraints?: unknown`으로 선언되어 어떤 값이든 저장 가능. 유연하지만 검증이 전혀 없어 스키마 무결성 미보장. 최소한의 구조 제약(Record<string, unknown> 등) 권장.

---

#### IMPROVE-4: 테스트 import 경로 불일치

**파일**: `test/ops/link.test.ts` vs 나머지 ops 테스트

**현상**: 대부분의 ops 테스트는 `from '../../index'`로 public API를 통해 import하지만, `link.test.ts`는 `from '../../src/ops/link'`로 직접 import. 일관성을 위해 통일 권장.

---

#### IMPROVE-5: `updateCardStatus` — ctx.cardRepo 대신 새 인스턴스 사용

**파일**: `src/ops/update.ts` L109

**현상**: `const cardRepo = new DrizzleCardRepository(ctx.db)` — ctx.cardRepo가 제공되어 있는데 새 인스턴스 생성. 다른 함수(query.ts의 listCards, searchCards)는 `ctx.cardRepo`를 사용. 일관성 부족.

---

#### IMPROVE-6: `setup.ts` — Gildash.open throw 미처리

**파일**: `src/setup.ts` L14-22

**현상**: `Gildash.open`이 reject(throw)하는 경우에 대한 try-catch가 없음. `isErr`로 Err 반환값만 처리하고, Promise rejection은 `setupEmberdeck` 호출자에게 전파됨. 의도적일 수 있으나, Err 반환과 throw를 동시에 방어하는 것이 더 안전함.

---

## 4. 테스트 품질 평가

### 4.1 구조

| 항목 | 평가 |
|------|------|
| 유닛/통합 분리 | `*.spec.ts`(유닛) / `*.test.ts`(통합) 규칙 준수 ✅ |
| bun:test 사용 | 모든 테스트에서 bun:test 사용 ✅ |
| AAA 패턴 | Arrange/Act/Assert 주석으로 명시 ✅ |
| BDD 형식 | `should ... when ...` 형식 대체로 준수 ✅ |
| Mock/Spy 사용 | `spyOn`, `mock`, `mock.module` 적절히 사용 ✅ |
| 정리(cleanup) | `afterEach` + `mockRestore()` / `cleanup()` 패턴 ✅ |

### 4.2 커버리지

| 모듈 | 유닛 테스트 | 통합 테스트 | 미검증 영역 |
|------|------------|------------|------------|
| `card-key.ts` | ✅ 17 tests | - | - |
| `errors.ts` | ✅ 23 tests | - | - |
| `markdown.ts` | ✅ 58 tests | - | - |
| `card-repo.ts` | - | ✅ 19 tests | - |
| `relation-repo.ts` | - | ✅ 14 tests | - |
| `classification-repo.ts` | - | ✅ 14 tests | - |
| `code-link-repo.ts` | - | ✅ 18 tests | - |
| `reader.ts` | - | ✅ 8 tests | - |
| `writer.ts` | - | ✅ 13 tests | - |
| `create.ts` | - | ✅ 20 tests | - |
| `delete.ts` | - | ✅ 10 tests | - |
| `update.ts` | - | ✅ 20 tests | - |
| `rename.ts` | - | ✅ 21 tests | codeLink 보존 미검증 ⚠️ |
| `query.ts` | - | ✅ 18 tests | - |
| `sync.ts` | - | ✅ 12 tests | - |
| `link.ts` | - | ✅ 25 tests | - |
| `connection.ts` | - | ✅ 5 tests | - |
| `setup.ts` | - | ✅ 16 tests | - |
| `config.ts` | 타입/상수만 | - | - |
| `types.ts` | 타입만 | - | - |

### 4.3 테스트 미비 사항

| 미비 사항 | 설명 |
|-----------|------|
| **rename codeLink 보존 테스트 없음** | BUG-1과 직결. rename 후 codeLink가 보존되는지 검증하는 테스트 부재 |
| **FTS 관련 테스트 최소** | searchCards 테스트가 "FTS 미설정이므로 빈 배열" 하나뿐 |
| **파일-DB 불일치 복구 테스트 없음** | DB 실패 시나리오 미검증 |
| **동시 접근 테스트 없음** | 동시에 같은 카드를 수정하는 경우 미검증 |
| **대용량 테스트 없음** | 수백/수천 카드 환경에서의 성능 미검증 |

---

## 5. 흐름(Flow) 분석

### 5.1 카드 생성 흐름

```
createCard(ctx, input)
  1. normalizeSlug(input.slug) → 키 정규화
  2. buildCardPath(cardsDir, slug) → 파일 경로 생성
  3. relation type 검증
  4. Bun.file(filePath).exists() → 중복 확인
  5. frontmatter 구성 (status='draft' 하드코딩)
  6. mkdir + writeCardFile → 파일 생성
  7. DB 트랜잭션: upsert + 관계/분류/코드링크 저장
```

**문제점**: 4번(파일 존재 확인)과 6번(파일 생성) 사이에 race condition 가능 (TOCTOU).

### 5.2 카드 이름변경 흐름

```
renameCard(ctx, fullKey, newSlug)
  1. 키 정규화 (old/new)
  2. 경로 동일 확인 → CardRenameSamePathError
  3. old 파일 존재 확인 / new 파일 비존재 확인
  4. mkdir + fs.rename → 파일 이동
  5. readCardFile(newFilePath) → 내용 읽기
  6. frontmatter.key 갱신 → writeCardFile
  7. DB 트랜잭션:
     a. 기존 relation/keyword/tag 백업
     b. deleteByKey(oldKey) → CASCADE 삭제 (⚠️ codeLink도 삭제됨!)
     c. upsert(newRow)
     d. relation/keyword/tag 복원
     e. ❌ codeLink 복원 누락
```

### 5.3 동기화 흐름

```
syncCardFromFile(ctx, filePath)
  1. readCardFile(filePath) → 파일 파싱
  2. parseFullKey(frontmatter.key) → 키 추출
  3. DB 트랜잭션: upsert + 관계/분류/코드링크 전부 교체
```

**특이점**: sync는 가장 완전한 흐름. 모든 메타데이터를 파일 기준으로 덮어씀.

---

## 6. 모호/모순/애매 사항

### 6.1 fullKey vs slug 네이밍 모호

코드 전반에서 `fullKey`와 `slug`가 사실상 동일한 값을 가리킴 (`fullKey = slug`). `renameCard`에서 `const newFullKey = normalizedNewSlug;` 처럼 직접 대입. 두 개념이 분리되어야 할 이유가 있었다면 현재 구현에서는 구분이 무의미. 코드 가독성을 해침.

### 6.2 card 테이블의 rowid 컬럼의 목적 불명확

FTS5용으로 선언되었으나, 어디서도 값이 설정되지 않아 역할을 수행하지 못함. 제거하거나 올바르게 활용해야 함.

### 6.3 `constraints`의 스키마 불명확

`unknown` 타입 + `JSON.stringify`로 저장. 어떤 구조가 기대되는지 문서화/타입 정의 없음.

### 6.4 `findByFile` vs `findByFilePath` 네이밍 불일치

- `code-link-repo.ts`: `findByFile(filePath: string)`
- `card-repo.ts`: `findByFilePath(filePath: string)`

같은 의미인데 메서드명이 다름.

### 6.5 `@zipbul/gildash`와 `@zipbul/result` 의존성 불명확

`package.json`에 `@zipbul/gildash: ^0.3.1`만 있고 `@zipbul/result`는 명시되지 않음. `@zipbul/result`가 `@zipbul/gildash`의 transitive dependency로 포함되는 것인지 확인 필요. `isErr`, `err` 함수를 `@zipbul/result`에서 직접 import하므로, `@zipbul/result`를 명시적 dependency로 선언하는 것이 안전.

---

## 7. 파일별 요약

| 파일 | 결함 코드 | 비고 |
|------|----------|------|
| `src/ops/rename.ts` | BUG-1, DESIGN-1, QUALITY-1 | codeLink 소실 — 핵심 버그 |
| `src/db/card-repo.ts` | BUG-2 | search 미구현 |
| `drizzle/0000_dark_rhodey.sql` | BUG-3 | FTS trigger 누락, rowid 문제 |
| `src/db/schema.ts` | BUG-3, QUALITY-2, QUALITY-5 | rowid 설계 문제 |
| `src/ops/create.ts` | DESIGN-1, DESIGN-4, QUALITY-1 | constraints 누락 |
| `src/ops/delete.ts` | DESIGN-1, DESIGN-5, IMPROVE-1 | 순서/트랜잭션/추상화 |
| `src/ops/update.ts` | DESIGN-1, DESIGN-3, QUALITY-1, IMPROVE-5 | updateCardStatus 경로 |
| `src/ops/sync.ts` | QUALITY-1 | tx as EmberdeckDb |
| `src/db/relation-repo.ts` | DESIGN-2, IMPROVE-2 | catch 블록 |
| `src/db/code-link-repo.ts` | DESIGN-2, IMPROVE-2 | catch 블록 |
| `src/db/classification-repo.ts` | QUALITY-3 | orphan 미정리 |
| `src/setup.ts` | IMPROVE-6 | throw 미처리 |
| `src/card/types.ts` | IMPROVE-3 | constraints unknown |
| `src/card/card-key.ts` | - | 양호 |
| `src/card/errors.ts` | - | 양호 |
| `src/card/markdown.ts` | - | 양호 |
| `src/fs/reader.ts` | - | 양호 |
| `src/fs/writer.ts` | - | 양호 |
| `src/ops/query.ts` | - | 양호 |
| `src/ops/link.ts` | - | 양호 |
| `src/config.ts` | - | 양호 |
| `index.ts` | - | 양호 (깔끔한 public API) |
| `drizzle.config.ts` | - | 양호 |
| `package.json` | IMPROVE — @zipbul/result 미선언 | 잠재적 |

---

## 8. 우선 수정 권장 순서

| 순서 | 결함 | 예상 난이도 | 이유 |
|------|------|------------|------|
| 1 | BUG-1 (rename codeLink 소실) | 낮음 | 핵심 기능 파괴. 5줄 추가로 수정 가능 |
| 2 | BUG-3 (FTS trigger + rowid) | 중간 | FTS 기반 인프라. 마이그레이션 추가 필요 |
| 3 | BUG-2 (search 구현) | 중간 | BUG-3 종속. FTS 인프라 후 구현 |
| 4 | DESIGN-2 (catch 블록 개선) | 낮음 | 에러 삼킴 방지 |
| 5 | DESIGN-4 (constraints in create) | 낮음 | 인터페이스 1필드 + 로직 수 줄 추가 |
| 6 | DESIGN-1 (원자성 개선) | 높음 | 구조적 변경 필요 |
| 7 | QUALITY-5 (rowid 스키마) | 중간 | BUG-3과 함께 처리 |

---

## 9. 시스템 완성도 갭 분석 (코드 결함 외부)

> REPORT.md 섹션 3~8의 결함을 모두 수정하면 **현재 코드가 의도한 대로 정확히 동작하는 시스템**이 된다.
> 하지만 **프로덕션 수준의 완벽한 시스템**에는 아래 4개 차원의 추가 작업이 필요하다.

### 9.1 기능 완성도

| 부재 항목 | 설명 | 우선도 | 담당 모델 |
|-----------|------|--------|----------|
| **벌크 동기화(bulk sync)** | 현재 `syncCardFromFile`은 단일 파일만 처리. 카드 디렉토리 전체 스캔 → DB 일괄 동기화 기능 없음 | 높음 | Sonnet |
| **역방향 동기화 (DB → 파일)** | 현재 파일→DB 방향만 존재. DB 측 변경을 파일로 내보내는 경로 없음 | 중간 | Sonnet |
| **재귀적 관계 그래프 탐색** | 현재 1-depth 관계만 조회 가능. transitive closure(재귀 탐색) 미지원 | 중간 | Sonnet |
| **카드 파일-DB 일관성 검증(validate)** | 전체 카드의 파일↔DB 불일치를 일괄 검출하는 기능 없음 | 높음 | Sonnet |
| **관계 타입 동적 관리 API** | `allowedRelationTypes`를 런타임에 추가/삭제/조회하는 API 없음 | 낮음 | Sonnet |
| **중복 카드 감지** | 동일/유사 내용의 카드를 감지하는 메커니즘 없음 | 낮음 | Sonnet |
| **변경 이력 추적** | 카드 변경 이력이 코드 내에서 관리되지 않음 (Git에 전적으로 의존) | 낮음 | Sonnet |

### 9.2 시스템 견고성

| 부재 항목 | 설명 | 우선도 | 담당 모델 |
|-----------|------|--------|----------|
| **동시 접근(Concurrency) 대응** | WAL 모드는 설정되어 있지만, 복수 프로세스가 동시에 같은 카드를 수정하는 시나리오에 대한 방어/잠금 로직 없음 | 높음 | Opus |
| **입력 크기 제한/방어** | 매우 큰 body, 수백 개의 relations/codeLinks 등에 대한 validation 제한 없음. OOM 또는 성능 저하 가능 | 중간 | Sonnet |
| **배치 처리 / 성능 최적화** | 배치 insert, lazy loading, 캐싱 등 미적용. 카드 수 증가 시 병목 가능 | 중간 | Sonnet |
| **실패 시 rollback/retry 메커니즘** | 파일-DB 불일치 발생 후 자동 복구(compensation) 로직 없음 | 높음 | Opus |
| **로깅/관측 가능성(Observability)** | 로깅 인프라 전무. 디버깅/모니터링 불가 | 중간 | Opus |

### 9.3 API 성숙도

| 부재 항목 | 설명 | 우선도 | 담당 모델 |
|-----------|------|--------|----------|
| **이벤트 시스템 (Hook/EventEmitter)** | 카드 CRUD 이벤트를 외부에서 구독할 수 없음. 플러그인/확장 불가 | 중간 | Opus |
| **YAML 파싱 에러의 도메인 에러 래핑** | YAML 파싱 실패 시 `Bun.YAML` 네이티브 에러가 그대로 전파. `CardValidationError`로 래핑되지 않음 | 낮음 | Sonnet |
| **확장 포인트 (플러그인 아키텍처)** | 미들웨어/훅 시스템 없음. 커스텀 로직 삽입 불가 | 낮음 | Opus |
| **Public API 안정성** | v0.1.0. Breaking change 가능성 높으며, 변경 영향 추적 체계 없음 | 중간 | Sonnet |

### 9.4 운영 / 배포

| 부재 항목 | 설명 | 우선도 | 담당 모델 |
|-----------|------|--------|----------|
| **API 문서화** | 공개 API에 대한 JSDoc/문서 사이트 없음 | 높음 | Sonnet |
| **사용 가이드 / 예제 코드** | 라이브러리 사용법을 보여주는 가이드/예제 없음 | 중간 | Sonnet |
| **에러 메시지 개선** | 일부 에러 메시지가 기술적이며 사용자 맥락 부족 | 낮음 | Sonnet |

### 9.5 종합 로드맵

```
 Phase 1: 코드 결함 수정 (섹션 3~8)                          [완료]
    └─ 현재 코드의 정확성 확보
    └─ BUG-1 → BUG-3 → DESIGN-2 → DESIGN-4 순서

 Phase 2: 핵심 기능 보완
    └─ bulk sync + validate (파일-DB 일관성의 근본 해결)      [Sonnet]
    └─ FTS5 search 구현 (BUG-2/BUG-3 수정 후)               [완료]
    └─ concurrency 대응 + rollback/retry 메커니즘            [Opus]

 Phase 3: 확장성/성숙도
    └─ 이벤트 시스템 + 관계 그래프 탐색                      [Opus / Sonnet]
    └─ 로깅 인프라                                           [Opus]
    └─ API 문서화 + 가이드                                   [Sonnet]

 Phase 4: 프로덕션 안정화
    └─ 입력 방어 + 성능 최적화                               [Sonnet]
    └─ 플러그인 아키텍처 (이벤트 시스템 완성 후)             [Opus]
    └─ Public API 안정화 (v1.0 준비)                         [Sonnet]
```

> **결론**: 섹션 3~8의 코드 결함 수정은 **Phase 1**에 해당한다.
> 완벽한 시스템이 되려면 Phase 1~4를 순차적으로 진행해야 하며,
> 특히 Phase 2의 bulk sync + validate + concurrency가 프로덕션 배포의 최소 요건이다.
