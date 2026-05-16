# Emberdeck 작업 중 발견 버그

작성: 2026-05-15 (envelope-removal redesign Phase 1.2.5 실행 중)

## 상태 (2026-05-15 fix 완료)

- B-001 ✅ fix 완료 (`src/cli/commands/card.ts:282-291`): `--patch` 최상위 키 whitelist 검증 추가. unknown key 면 `CliUsageError` + 친절한 안내 ("Did you forget to wrap the namespace?").
- B-002 ✅ fix 완료 (`src/card/types.ts:174-177` + `src/card/serialize.ts:382-401`): `BriefCriterionMeasure` 의 3 variant 모두 SKILL.md 정의에 정합 — `numeric` 에 `predicate` + `reference?` 추가, `binary` 에 `method?`/`reference?` 추가, `verification` 에 `predicate?`/`unit?` 추가. `normalizeBriefCriteria` 가 모든 optional 보존.
- B-003 ❌ **non-bug — 잘못된 진단 (reverted)**. `renameGlossary` 의 same-name 거부는 *올바른 동작*. 정의-only 갱신은 `ed glossary define WORD=<def>` 의 upsert 가 정직 경로 (`src/ops/glossary.ts:33-80` 의 `existingMap.has(entry.word)` 분기 = upsert). `rename` 의 시맨틱은 *이름 변경 (+ 선택 정의 갱신)*, `define` 의 시맨틱은 *create-or-update*. 두 명령 책임 분리가 정확. 임시 same-name 분기는 *spec 모호함을 코드 분기로 메우는 워크어라운드* — production 코드에 영구 박는 안티패턴이었음. revert.

## B-001 — `ed card update --patch` 가 잘못된 형식의 patch 를 silently 무시 (status: ok 반환)

**위치**: `src/cli/commands/card.ts:274-282`

**현상**: `--patch <file>` 가 JSON 파일을 받아 `Object.assign(fields, parsedRaw)` 으로 `UpdateCardFields` 에 직접 할당 (line 281). `UpdateCardFields` 는 `{summary?, type?, status?, parent?, tags?, relations?, glossary?, principle?, domain?, brief?, spec?}` — 최상위 키가 *namespace 이름* (`brief` / `spec` / `principle` / `domain`) 또는 *frontmatter 스칼라 필드* 여야 한다. 그러나 patch 가 namespace *내용물* (예: `{preconditions: ..., postconditions: ...}` 직접) 으로 들어오면 `Object.assign` 이 `fields.preconditions = ...` 같은 *unknown* 필드를 만든다. `updateCard` 는 그 unknown 필드를 무시 → 카드 변경 0. 그러나 명령은 `status: ok` 반환 + `result.filePath/status` 정상.

**재현**:
```bash
# 잘못된 형식 (namespace 내용물 직접):
ed card get cli-surface/command-routing-and-output/runner-and-output | \
  jq '.data.frontmatter.spec' > /tmp/spec-bad.json
ed card update cli-surface/command-routing-and-output/runner-and-output --patch /tmp/spec-bad.json
# → status: ok 반환, 그러나 카드 DB/disk 변경 0

# 올바른 형식 (wrapping):
ed card get cli-surface/command-routing-and-output/runner-and-output | \
  jq '{spec: .data.frontmatter.spec}' > /tmp/spec-good.json
ed card update cli-surface/command-routing-and-output/runner-and-output --patch /tmp/spec-good.json
# → 정상 적용
```

**영향**:
- 사용자가 patch 효과 검증 없이 다음 단계 진행 시 silent data loss
- SKILL.md commands 표 line 134 의 `--patch 는 namespace 전체 교체` 설명이 wrapping 형식 명시 안 함 — 사용자 추론을 silent ignore 가 보강 안 함

**권장 fix**: `card.ts:278-281` 의 `Object.assign` 직전에 keys 검증 — `parsedRaw` 의 모든 키가 `UpdateCardFields` 의 알려진 필드 (`brief`/`spec`/`principle`/`domain`/`summary`/`type`/`status`/`parent`/`tags`/`relations`/`glossary`) 가 아니면 `CliUsageError('--patch root keys must be one of: ...')` throw.

추가로 SKILL.md `<commands>` 표의 `card update --patch` 행에 "patch JSON 의 최상위 키는 namespace 이름 (`brief`/`spec`/`principle`/`domain`)" 명시.

---

## B-002 — `ed bulk sync` / `ed card get` 이 `brief.criteria[i].measure.{method, reference}` 같은 nested optional 필드를 보존 못 함

**위치**: `src/ops/sync.ts` (bulk sync 의 frontmatter → DB JSON 직렬화) + `src/db/repository.ts` (CardRow.namespacesJson 의 round-trip)

**현상**:
1. 디스크 `.md` 의 frontmatter 안 `brief.criteria` 항목이 `binary` type 일 때 `measure: {predicate, method?, reference?}` 형태. `.md` 파일에는 `method` / `reference` 가 있어도, `ed bulk sync` 후 `ed card get` 결과의 `frontmatter.brief.criteria[i].measure` 가 `{predicate}` 만 — `method` / `reference` 사라짐.
2. 그 상태로 `ed card export --in-place` 또는 다음 `ed card update` 시 disk 도 `method` / `reference` 없이 재-write → 영구 손실.

**재현**:
```bash
# 1. 현재 brief 카드 disk 의 criteria 확인:
grep -A2 "id: SC-001" .emberdeck/cards/cli-surface/command-routing-and-output.md | head -8
#   measure 안 method/reference 존재 확인

# 2. DB 조회:
ed card get cli-surface/command-routing-and-output | jq '.data.frontmatter.brief.criteria[0].measure'
#   {predicate: "..."} 만 — method/reference 누락

# 3. ed bulk sync 후 다시 조회:
ed bulk sync
ed card get cli-surface/command-routing-and-output | jq '.data.frontmatter.brief.criteria[0].measure'
#   여전히 {predicate} 만 — bulk sync 가 disk → DB 시 method/reference 누락
```

**영향**:
- nested optional 필드를 가진 카드를 `ed card update --patch` 하면 silently 정보 손실
- `ed card export --in-place` 가 정보 손실 amplify
- Phase 1.2.5 의 wording 정정 시도에서 brief 카드 disk 의 method/reference 가 사라지는 부작용 발생 → git checkout 으로 복구

**예상 원인**: namespace JSON 직렬화 (sync.ts 의 namespace stringify / parse) 가 `brief.criteria[i].measure` 의 type-discriminated union 의 optional 필드를 stripped 하는 변환 수행. (확인 필요 — sync.ts 의 `serializeNamespaces` / `parseNamespaces` 같은 함수 검토.)

**권장 fix**:
- DB 쪽 namespacesJson 컬럼은 raw JSON 보존 — 직렬화 시 schema-aware filtering 제거 (`measure` 의 모든 optional 필드 보존)
- 또는 `serializeCard` (`src/card/serialize.ts`) 가 reverse 시 모든 필드 round-trip 검증 테스트 추가

---

## 작업 진행 영향 + 우회

Phase 1.2.5 (brief + spec runner-and-output 카드 wording 정정) 진행 중 두 버그 모두 발견. 진행:

- B-001 우회: patch JSON 을 `{brief: {...}}` / `{spec: {...}}` wrapping 으로 작성 — `UpdateCardFields` 가 namespace 이름 키를 받음
- B-002 우회: patch base 를 `ed card get` (DB) 이 아닌 *disk `.md` 의 frontmatter* 에서 직접 read (HC-1 = Write/Edit 금지지 Read OK) — nested optional 필드 보존

두 버그 모두 별도 PR 로 fix 권장 — 우회 없이 ed CLI 만으로 카드 작업이 안전해지려면 필수.

---

## Follow-up (envelope-removal redesign 영역 외 — 별도 PR)

envelope-removal redesign 진행 중 surfaced 됐으나 *별도 design 결정* 영역. 본 redesign 의 완성도와 무관.

### F-001 — `CardStatus` type 에 `retired` 누락 (SKILL.md vs 코드 drift)

**현황**: `src/card/types.ts:8` `CardStatus = 'draft' | 'active' | 'drifted'`. SKILL.md card_fields 명시: principle/domain = `draft|active|retired`, brief/spec = `draft|active|drifted|retired`. 코드는 retired 누락.

**현재 영향**: 0 — 32 spec 카드 모두 draft, retired 사용 0건. silent drift (validateCardStatus 가 `retired` 입력 시 fail).

**진짜 fix 범위**: retired status 의 *의미* + 영향 (validate / check drift / analyze health / activation guard) design. retired = 카드 lifecycle 종료 = *deprecation 기능 영역*. 별도 PR.

### F-002 — `ed spec sync` markerMissing 자동 cleanup

**현황**: `src/ops/spec-sync.ts:150-158` 가 markerMissing 를 *진단으로 report 만*, DB code_link 자동 삭제 X. Phase 2 의 envelope 함수 삭제 후 9개 stale link 잔존.

**의도된 동작**: plan §1.7 의 spec sync shape 가 markerMissing 을 "진단 (실패 아님)" 명시. 자동 삭제 = silent breakage 위험 (사용자가 source `@spec` 임시 제거 시 link 영구 손실).

**진짜 fix 범위**: 별도 `ed spec sync --prune` flag 또는 `ed spec gc` 명령 — 사용자 명시 의도 확인 후 stale 삭제. 별도 PR.

### F-003 — `CardHasDependentsError` / `GlossaryConflictError` 별도 클래스 분리

**현황**: `src/ops/delete.ts:56,82` 가 children/cross-domain-refs 검증 실패 시 `CardValidationError` throw → exit 2. 의미적으로 *conflict* (다른 리소스와 충돌) 라 exit 4 가 자연 (`CardAlreadyExistsError` 와 일관). 동일 패턴: `src/ops/glossary.ts` `renameGlossary` 의 newWord 충돌 → `GlossaryValidationError` (exit 2) 대신 `GlossaryConflictError` (exit 4).

**진짜 fix 범위**: 두 신규 클래스 추가 + errors.ts 매핑 + ops/* throw 변경 + 카드 wording 회복 (exit 2 → 4) + plan §1.7 + §4 표 정정. 의미 정합 회복 가치 있음. 별도 PR.

### F-004 — `ed check coverage <key>` 의미 전환 (link-coverage → symbol-coverage)

**현황**: plan §6 "분리된 결정" 명시. OP-3 `getCardSymbolCoverage` 신규 op 도입 = `ed check coverage <key>` 의 의미를 *declared codeLinks 의 resolve 율* 에서 *카드가 가리키는 파일들의 심볼 중 카드가 참조하는 비율* 로 변경. envelope 제거와 직교 — 의미 재정의.

**진짜 fix 범위**: 신규 op + check.ts 모드 분기 + 카드 POST-001a 본문 정정 + plan §6 결정 마무리. 별도 PR.
