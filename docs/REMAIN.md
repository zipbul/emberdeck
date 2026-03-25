# Remaining Work

Phase 1-7 재설계 완료. 30개 MCP 도구 구현, 830 테스트 통과, 카드 7개 생성 (커버리지 100%).
아래는 미구현 항목.

---

## 1. codeLinks → 소스 코드 @spec 주석 자동 생성

### 현상

카드 생성 시 codeLinks로 코드 심볼을 참조하지만, 소스 코드에는 역방향 링크(@spec 주석)가 없다.
에이전트가 코드를 읽을 때 해당 심볼이 어떤 카드에 연결되어 있는지 알 수 없고, `find_cards_by_symbol`을 별도 호출해야 한다.

### 기대 효과

```typescript
/**
 * @spec ops-layer
 * @spec card-domain
 */
export function createCard(ctx: EmberdeckContext, input: CreateCardInput) { ... }
```

- 에이전트가 코드를 읽는 단계에서 바로 관련 카드를 인지 — MCP 호출 감소
- `find_cards_by_symbol` 호출을 잊거나 건너뛰어도 스펙 연결을 놓치지 않음
- `syncSpecAnnotations`로 양방향 정합성 검증 가능 (markerMissing 감지)

### 구현 방향

하나의 심볼이 여러 카드에 참조될 수 있으므로 `@spec`은 복수 허용.

**선택지 A: 새 MCP 도구** — `emberdeck_write_spec_annotations`
- 모든 카드의 codeLinks를 순회, 각 심볼의 JSDoc에 `@spec card-key` 삽입
- 이미 존재하는 @spec은 건너뜀
- 카드가 삭제되면 해당 @spec 제거

**선택지 B: SKILL.md 워크플로우에 에이전트 직접 수정 지시**
- 카드 생성/삭제 시 에이전트가 codeLinks의 각 심볼에 @spec 주석을 직접 추가/제거
- 도구 추가 없이 워크플로우만 변경

**선택지 C: 하이브리드**
- `write_spec_annotations` 도구로 일괄 생성 (온보딩)
- 개별 카드 생성/삭제 시에는 에이전트가 직접 수정 (워크플로우)

### 관련 기존 도구

- `syncSpecAnnotations`: 코드의 @spec → codeLinks (코드→카드 방향, 이미 구현)
- `validateCodeLinks`: codeLinks 유효성 검증 (이미 구현)
- `markerMissing` 필드: codeLink는 있지만 @spec이 없는 경우 감지 (이미 구현)

---

## 2. ignorePatterns에서 gildashIgnore 통합 여부

### 현상

현재 `ignorePatterns`와 `gildashIgnore` 두 개의 설정이 존재.
`ignorePatterns`는 커버리지 + gildash 인덱싱 양쪽에 적용되고, `gildashIgnore`는 gildash 전용 추가 패턴.

### 판단 필요

`gildashIgnore`를 제거하고 `ignorePatterns`로 통합할지, 용도가 다른 경우를 위해 유지할지.

---

## 3. delete_card — 파일 없을 때 DB 정리 실패

### 현상

카드 파일이 외부에서 삭제된 상태에서 `delete_card`를 호출하면 "Card not found" 에러.
DB에 레코드가 남아있지만 파일이 없어서 삭제가 안 됨.

### 수정 방향

`deleteCard`에서 파일 존재 여부와 무관하게 DB 레코드를 삭제할 수 있어야 함.
`validateCards`의 staleDbRows 감지 후 정리하는 `purgeStaleRows` 도구 추가 검토.
