# Phase 1: 타입 + DB 스키마 + 마크다운 파서 + 설정 + 에러 + 형식 검증

선행: 없음

## 0. 사전 작업

- [ ] `@zipbul/gildash` 0.9.3 → 0.10.0 업그레이드 (`package.json` 갱신 + 설치)

---

## 1. 타입 정의 변경 — `src/card/types.ts`

- [ ] `CardStatus` 변경: `'draft' | 'accepted' | 'implementing' | 'implemented' | 'deprecated'` → `'draft' | 'active' | 'drifted'`
- [ ] `CardType` 변경: `'feature' | 'bug' | 'refactor' | 'spike' | 'decision'` → `'architecture' | 'spec'`
- [ ] `CardPriority` 타입 삭제
- [ ] `AcceptanceCriterion` 인터페이스 삭제
- [ ] `CardRelation` 인터페이스 삭제 (relations는 `string[]`로 대체)
- [ ] `CardFrontmatter.type`을 `type?: CardType` → `type: CardType` (optional → **required**)로 변경
- [ ] `CardFrontmatter`에 `parent?: string` 추가
- [ ] `CardFrontmatter`에 `boundary?: string[]` 추가
- [ ] `CardFrontmatter`에서 `priority?` 제거
- [ ] `CardFrontmatter`에서 `acceptance?` 제거
- [ ] `CardFrontmatter`에서 `constraints?` 제거
- [ ] `CardFrontmatter`에서 `keywords?` 제거
- [ ] `CardFrontmatter.relations` 타입을 `CardRelation[]` → `string[]`로 변경
- [ ] `CodeLink` 인터페이스는 현상유지 (`{kind, file, symbol}`)

---

## 2. DB 스키마 변경 — `src/db/schema.ts`

### card 테이블
- [ ] `parent` 컬럼 추가 (text, nullable, FK → card.key, ON UPDATE CASCADE, ON DELETE SET NULL)
- [ ] `parent`에 인덱스 추가 (`idx_card_parent`)
- [ ] `boundaryJson` 컬럼 추가 (text, nullable, JSON 배열)
- [ ] `acceptanceJson` 컬럼 제거
- [ ] `constraintsJson` 컬럼 제거
- [ ] `priority` 컬럼 제거
- [ ] `idx_card_priority` 인덱스 제거

### card_relation 테이블
- [ ] `type` 컬럼 제거
- [ ] `metaJson` 컬럼 제거
- [ ] unique constraint 변경: `(type, srcCardKey, dstCardKey, isReverse)` → `(srcCardKey, dstCardKey, isReverse)`
- [ ] `idx_card_relation_type` 인덱스 제거

### keyword + cardKeyword 테이블
- [ ] `keyword` 테이블 삭제
- [ ] `cardKeyword` 테이블 삭제

### 유지 확인
- [ ] `tag` + `cardTag` 테이블 유지
- [ ] `codeLink` 테이블 유지
- [ ] `cardChangelog` 테이블 유지
- [ ] `cardFts` FTS5 유지 (key, summary, body)

---

## 3. 마크다운 파서 변경 — `src/card/markdown.ts`

### parseCardMarkdown
- [ ] `parent` 필드 파싱 추가 (string)
- [ ] `boundary` 필드 파싱 추가 (string[])
- [ ] `relations` 파싱을 `{type, target}[]` → `string[]`로 변경
- [ ] `acceptance` 파싱 제거
- [ ] `priority` 파싱 제거
- [ ] `constraints` 파싱 제거
- [ ] `keywords` 파싱 제거

### serializeCardMarkdown
- [ ] `parent` 필드 직렬화 추가
- [ ] `boundary` 필드 직렬화 추가 (YAML 배열)
- [ ] `relations` 직렬화를 `[{type, target}]` → `[string]`으로 변경
- [ ] `acceptance` 직렬화 제거
- [ ] `priority` 직렬화 제거
- [ ] `constraints` 직렬화 제거
- [ ] `keywords` 직렬화 제거

### 내부 헬퍼
- [ ] `normalizeKeywords` 함수 제거
- [ ] `normalizeCardPriority` 함수 제거
- [ ] `normalizeAcceptance` 함수 제거
- [ ] `normalizeRelations` 반환 타입을 `CardRelation[]` → `string[]`로 변경
- [ ] `normalizeCardType` 반환 타입을 새 `CardType` (`'architecture' | 'spec'`)에 맞게 변경
- [ ] `coerceFrontmatter`에서 parent, boundary 처리 추가, 제거 필드 정리

---

## 4. 에러 클래스 — `src/card/errors.ts`

- [ ] `RelationTypeError` 클래스 삭제
- [ ] `ParentValidationError` 클래스 추가 (순환 참조, 타입 계층 위반 등)
- [ ] `ActivationGuardError` 클래스 추가 (unmetConditions 배열 포함)
- [ ] `BoundaryValidationError` 클래스 추가 (유효하지 않은 glob 패턴 등)

---

## 5. 설정 변경

### `src/config.ts`
- [ ] `DEFAULT_RELATION_TYPES` 상수 삭제
- [ ] `DefaultRelationType` 타입 삭제
- [ ] `addRelationType` 함수 삭제
- [ ] `removeRelationType` 함수 삭제
- [ ] `listRelationTypes` 함수 삭제
- [ ] `EmberdeckContext`에서 `allowedRelationTypes` 제거
- [ ] `EmberdeckContext`에 `coverageIgnore: string[]` 추가
- [ ] `EmberdeckContext`에 `regressionThreshold: number` 추가 (기본 0)

### `src/config-file.ts`
- [ ] `import { DEFAULT_RELATION_TYPES } from './config'` 제거 (23행)
- [ ] `allowedRelationTypes` 관련 검증/기본값 로직 제거
- [ ] `EmberdeckFileConfig`에 `coverageIgnore?: string[]` 추가
- [ ] `EmberdeckFileConfig`에 `regressionThreshold?: number` 추가
- [ ] `KNOWN_TOP_KEYS`에 `coverageIgnore`, `regressionThreshold` 추가
- [ ] `validateRawConfig`에서 `coverageIgnore` 검증 (string 배열, glob 패턴)
- [ ] `validateRawConfig`에서 `regressionThreshold` 검증 (0-1 범위)
- [ ] `buildDefaultConfig`에서 `coverageIgnore: []`, `regressionThreshold: 0` 기본값

### `src/config.ts` — `EmberdeckOptions`
- [ ] `EmberdeckOptions`에서 `allowedRelationTypes` 제거
- [ ] `EmberdeckOptions`에 `coverageIgnore?: string[]` 추가
- [ ] `EmberdeckOptions`에 `regressionThreshold?: number` 추가

### `src/setup.ts`
- [ ] `import { DEFAULT_RELATION_TYPES } from './config'` 제거 (9행)
- [ ] `allowedRelationTypes: options.allowedRelationTypes ?? [...]` 제거 (50행)
- [ ] `coverageIgnore: options.coverageIgnore ?? []` 추가
- [ ] `regressionThreshold: options.regressionThreshold ?? 0` 추가

---

## 6. 형식 검증 — `src/card/validation.ts`

**형식 검증만. DB 조회가 필요한 무결성 검증은 Phase 2.**

- [ ] `LIMITS`에 `KEY_MAX: 200` 추가
- [ ] `LIMITS`에 `BOUNDARY_MAX_PATTERNS: 50` 추가
- [ ] `LIMITS`에 `BOUNDARY_PATTERN_MAX: 500` 추가
- [ ] key 길이 검증 추가 (최대 200자)
- [ ] boundary 검증 추가: 빈 문자열 거부, 최대 50개, 패턴당 최대 500자, 유효한 glob 문법
- [ ] tags 저장 시 lowercase 정규화 로직 추가
- [ ] relations 검증 변경: `{type, target}[]` → `string[]`, 빈 문자열 거부 (자기 참조 거부는 key 컨텍스트 필요 → Phase 2 `validateRelationTargets`에서 처리)
- [ ] codeLinks file/symbol 빈 문자열 거부 (기존 확인 후 보강)
- [ ] `normalizeRelations` 반환 타입 `string[]`로 변경
- [ ] `ValidationInput`에서 `keywords?` 제거, `boundary?` 추가

**주의: validation.ts의 normalize 함수들(normalizeCardPriority, normalizeAcceptance, normalizeKeywords, normalizeRelations)은 실제로 `markdown.ts`에 위치. Phase 1 섹션 3에서 처리됨.**

---

## 7. 테스트 갱신

- [ ] `src/card/validation.spec.ts`: acceptance/priority/keywords 관련 테스트 제거, boundary/key 길이/tag lowercase/relations string[] 테스트 추가
- [ ] `src/card/markdown.spec.ts`: parent/boundary 파싱/직렬화 테스트 추가, acceptance/priority/keywords/constraints 테스트 제거, relations string[] 테스트 추가
- [ ] `src/card/errors.spec.ts`: RelationTypeError 테스트 제거, ParentValidationError/ActivationGuardError/BoundaryValidationError 테스트 추가
- [ ] `src/card/card-key.spec.ts`: key 길이 200자 제한 테스트 추가 (해당 로직이 card-key에 있을 경우)

---

## 완료 조건

- [ ] Phase 1 범위 파일(card/, config.ts, config-file.ts, setup.ts)의 **내부 일관성** 확인
- [ ] **`tsc --noEmit`은 Phase 3 완료 전까지 통과하지 않음** — Phase 1에서 타입을 변경하면 ops/, mcp/, db/ 파일이 깨짐. 이는 예상된 동작이며 Phase 2-3에서 해결
- [ ] Phase 1 범위의 단위 테스트 통과 (card-key.spec, validation.spec, markdown.spec, errors.spec)
- [ ] 제거 대상 타입/필드가 Phase 1 범위 파일에 남아있지 않음
