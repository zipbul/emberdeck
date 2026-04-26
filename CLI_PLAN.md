# Emberdeck CLI 전환 계획 v2

작성일: 2026-04-27
상태: Draft v2 (서브에이전트 adversarial review 1회 반영)
범위: MCP 폐기 → CLI-only 전환

## 1. 배경 및 결정

### 1.1 현황 (검증 완료)

- emberdeck = MCP 서버로 노출 (`src/mcp/tools.ts`, **41 tools** — `grep -cE "server\.registerTool\(" src/mcp/tools.ts`로 확인)
- AI agent (Claude Code 등)가 MCP 프로토콜로 호출
- bin: `package.json:7-9` `emberdeck → ./cli.ts`
- 현재 cli.ts에는 `mcp` subcommand만 존재
- MCP SDK는 `peerDependencies`(optional) + `devDependencies` 양쪽에 존재 (`package.json:30, 35`)

### 1.2 실사용 데이터 (재검증 — v1 데이터는 잘못됨, 폐기)

추출 방법:
```bash
find ~/.claude/projects/-home-revil-projects-zipbul-emberdeck -name "*.jsonl" -exec cat {} \; \
  | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' \
  | grep -E "(^|__)emberdeck_" | sed 's/^mcp__emberdeck__//' | sort | uniq -c | sort -rn
```

**실제 결과 (총 282 tool_use 호출, 139 jsonl 파일):**

| Rank | Tool | Calls | % |
|-----:|------|------:|------:|
| 1 | update_card | 90 | 32% |
| 2 | get_card | 44 | 16% |
| 3 | validate_cards | 26 | 9% |
| 4 | get_link_coverage | 15 | 5% |
| 5 | validate_brief | 14 | 5% |
| 6 | write_spec_annotations | 12 | 4% |
| 7 | get_cards | 11 | 4% |
| 8 | reset | 10 | 4% |
| 9 | analyze | 10 | 4% |
| 10 | bulk_create_cards | 9 | 3% |
| 11 | validate_code_links | 8 | 3% |
| 12 | bulk_sync_cards | 7 | 2% |
| 13 | list_cards | 6 | 2% |
| 14 | lookup_glossary | 5 | 2% |
| 15 | define_glossary | 5 | 2% |
| 16 | pre_change_check | 3 | 1% |
| 17-20 | get_uncovered_symbols, delete_card, create_card, onboarding_summary | 2/2/2/1 | <1% |

**Top 5 = 66% / Top 10 = 85% / Top 16 = 99% 사용량.**

**21 도구 0회 호출 (실측):**
check_drift, check_interactions, export_card_to_file, find_cards_by_glossary_word, find_cards_by_symbol, get_card_context, get_card_tree, get_relation_graph, list_card_relations, migrate_card_to_namespace, regression_guard, remove_glossary, rename_card, rename_glossary, resolve_code_links, search_cards, suggest_card_scope, sync_card_from_file, sync_spec_annotations, sync_symbol_changes, update_card_status

→ **41 도구 중 절반(21) 미사용.** Top 5에 80%+ 집중.

### 1.3 산업 동향 (2026 Q1-Q2)

CLI vs MCP for AI agents 트렌드:
- 토큰 비용: CLI ~200/명령, MCP는 schema 로드로 4-32배 더 (벤치마크 출처는 marketing blog, 정밀 측정 아님 — 트렌드 시그널로만 활용)
- LLM 친숙도: pretrain에 CLI 풍부, MCP 신생 프로토콜 (객관 사실)
- emberdeck 특성: **로컬 단일 사용자 도구 → MCP의 governance/auth/멀티유저 우위 무관**

### 1.4 결정

**MCP 폐기, CLI-first 전환.**

근거: (a) 토큰 효율 (b) LLM 친숙도 (c) emberdeck은 MCP-only feature 사용 안 함 (모든 도구 deterministic JSON 출력)

## 2. 설계 원칙

### 2.1 명령 구조

**노미컨벤션 — 정직한 사실:**
- 산업 표준 단일 패턴 **없음**:
  - **kubectl: verb-noun** (`kubectl get pods`)
  - **cargo: verb-only** (`cargo build`)
  - **gh: noun-verb** (`gh pr create`)
  - **docker: 둘 다** (legacy `docker run` + modern `docker container ls`)
- emberdeck 선택: **noun-verb** (`ed <noun> <verb>`)
- 근거: gh/Docker(modern) 전례 + 여러 동작이 같은 객체에 가해지는 도메인이라 객체 그룹화 유리 (글로사리에 5 동작, 카드에 12 동작)

### 2.2 출력 형식 ([clig.dev](https://clig.dev/) 기준)

- **기본**: TTY 감지 시 human-readable, pipe 감지 시 자동 JSON
- **`--output={human,json,quiet}`**: 명시적 override
- **`--no-color`**: 색상 비활성

### 2.3 종료 코드

| Code | 의미 |
|-----:|------|
| 0 | success |
| 1 | generic error |
| 2 | validation failure (gate 실패) |
| 3 | not found |
| 4 | conflict (이미 존재 등) |
| 5 | permission/IO |
| 6 | configuration missing (gildash 미설정 등) |
| 7 | transient/retryable failure (gildash timeout 등 — `status: unknown`) |
| 130 | SIGINT |

### 2.4 STDIN/STDOUT/STDERR

- **STDOUT**: 결과 (machine-parseable)
- **STDERR**: 진행 상태, warning, error 메시지
- **STDIN**: `--from -` 또는 `--body -` 형태 모든 입력 명령에서 지원

예시:
```bash
cat brief.yaml | ed card create order-payment --type brief --from -
cat reason.txt | ed card set-status order-payment draft --reason-from -
```

### 2.5 Help/자동완성

- `-h`, `--help`, `ed help`, `ed help <noun>` 모두 지원
- `ed completion {bash|zsh|fish}` (Phase 5)

### 2.6 색상/Verbosity

- `--verbose` (no short flag — `-v`는 `--version` 충돌 방지)
- `--quiet` 짧은 형 `-q`

## 3. 통합 JSON 출력 스키마

**모든 명령 `--output=json` 시 일관된 단일 스키마.** AI 파서가 `status` 단일 enum (4-way)으로 분기.

### 3.1 Status enum (전체 4종)

| status | 의미 | exit code | 키 존재 패턴 |
|--------|------|----------|----------|
| `ok` | 완전 성공 | 0 | `data` 채움, `errors=[]`, `warnings=[]` 또는 채움, `error` 없음 |
| `partial` | 일부 성공 (bulk만 가능) | 0 또는 2 (정책) | `data` 채움, `errors`≥1, `warnings` 가능, `error` 없음 |
| `error` | 전체 실패 (단일 op) | non-zero | `data: null`, `error` 단일 객체, `errors=[]`, `warnings=[]` |
| `unknown` | 일시적 실패 (gildash transient 등 retry-able) | 7 | `data: null`, `error` 단일 객체, retry hint 포함 |

### 3.2 필드 존재 매트릭스 (AI 파서 의존 가능)

| 필드 | ok | partial | error | unknown |
|------|:--:|:-------:|:-----:|:-------:|
| schemaVersion | ✓ | ✓ | ✓ | ✓ |
| status | ✓ | ✓ | ✓ | ✓ |
| data | ✓ (값) | ✓ (값) | null | null |
| warnings | ✓ (≥0 항목) | ✓ (≥0 항목) | `[]` | `[]` |
| errors | `[]` | ✓ (≥1 항목) | `[]` | `[]` |
| error | 없음 (omit) | 없음 | ✓ (단일 객체) | ✓ (단일 객체) |

**모든 키는 `error` 제외 항상 존재.** AI 파서는 `obj.error?` optional chain만 처리하면 됨. 다른 키는 `[]` 또는 null로 항상 채워짐.

### 3.3 예시

**성공 (`status: ok`)** — `ed card get foo`:
```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "status": "ok",
  "data": { "key": "foo", "type": "brief", "summary": "..." },
  "warnings": [],
  "errors": []
}
```

**빈 결과 (`status: ok`, data는 빈 컬렉션)** — `ed card list`:
```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "status": "ok",
  "data": { "items": [], "total": 0, "page": { "limit": 50, "offset": 0, "has_more": false } },
  "warnings": [],
  "errors": []
}
```

**부분 성공 (`status: partial`)** — `ed bulk create --from cards.yaml` (3개 중 1개 실패):
```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "status": "partial",
  "data": { "succeeded": ["card-a", "card-b"], "total": 3 },
  "warnings": [{ "code": "BULK_PARTIAL", "message": "1 of 3 cards failed" }],
  "errors": [{ "code": "VALIDATION_ERROR", "key": "card-c", "message": "Missing required field: parent" }]
}
```

**전체 실패 (`status: error`)** — `ed card get nonexistent`:
```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "status": "error",
  "data": null,
  "warnings": [],
  "errors": [],
  "error": { "code": "CARD_NOT_FOUND", "message": "Card 'nonexistent' not found", "details": { "key": "nonexistent" } }
}
```

**일시적 실패 (`status: unknown`)** — `ed validate links` 중 gildash 일시 실패:
```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "status": "unknown",
  "data": null,
  "warnings": [],
  "errors": [],
  "error": { "code": "GILDASH_TRANSIENT", "message": "gildash search timed out", "details": { "retry_after_ms": 1000 } }
}
```

### 3.4 Edge case 매핑

(§3.6에서 bulk 매핑 재정의됨 — 아래는 single op 위주)

| 시나리오 | status | exit | 비고 |
|---------|--------|------|------|
| 단일 op 성공 + warning | `ok` | 0 | warnings 채움 |
| 단일 op 실패 | `error` | 1~5 | error 객체 |
| 알 수 없는 일시 실패 (gildash transient, network) | `unknown` | 7 | retry hint |
| 설정 누락 (gildash 미설정) | `error` | 6 | error.code = CONFIG_MISSING |

### 3.5 schemaVersion 정책

`schemaVersion` 형식: **`{ "major": int, "minor": int }`** (string `"1"` 폐기 — minor 표현 불가)

```json
"schemaVersion": { "major": 1, "minor": 0 }
```

- **major 증가**: breaking change (필드 제거, status enum 의미 변경, 키 rename)
- **minor 증가**: additive only (새 status enum, 새 옵션 필드, 새 error code)
- AI 파서 contract:
  - `schemaVersion.major === 1` → 안전, 진행
  - `major !== 1` → 호환 불가, exit 또는 fallback
  - 알 수 없는 status enum 또는 새 필드 → minor 차이 가정, 안전 무시

### 3.6 Bulk operation status 매핑 (재정의)

| 시나리오 | status | 비고 |
|---------|--------|------|
| 0 attempted (빈 입력) | `ok` | data: `{succeeded:[], total:0}` |
| N attempted, N succeeded | `ok` | data: `{succeeded:[...], total:N}` |
| N attempted, ≥1 succeeded, ≥1 failed | `partial` | errors[]에 실패 항목 |
| N attempted, 0 succeeded, ≥1 failed | `partial` | data: `{succeeded:[], total:N}`, errors[] 채움 |
| 단일 op 성공 | `ok` | |
| 단일 op 실패 | `error` | |

**핵심**: bulk all-fail은 `partial` (이전 v4 `error`에서 변경) — 0/N도 partial 자격, 실패 항목 추적 가능.

### 3.7 Errors[] 단일 진실 공급원

- `data.failed[]` 필드 **제거** (v4 redundancy 해소)
- 실패 항목 정보는 `errors[]`에서만: `{ code, key, message, details? }`
- `data.succeeded[]`만 유지 (성공 키 목록)
- 클라이언트가 실패 키 추출: `errors.map(e => e.key).filter(k => k)`

### 3.8 status=unknown retry protocol (구체화)

**CLI 자체는 retry 안 함** — 한 번 호출, 한 번 응답. 재시도는 caller (AI agent / shell script) 책임.

`status: unknown` 응답 시:
- `error.details.retry_after_ms`: 첫 재시도 권장 대기 (없으면 1000)
- 재시도 정책 (AI agent 권장):
  - max 3회 시도
  - exponential backoff: 1s → 2s → 4s
  - jitter: ±25% (실제 wait = base × (0.75~1.25))
  - 4회째도 unknown이면 `error`로 escalate

## 4. 명령 카탈로그 (확정 34 subcommand)

### 4.1 `card` — 카드 단위 조작 (13)

```
ed card create KEY [--type T] [--from FILE|-] [--summary S]
ed card update KEY [--patch FILE|- | --field NAME=VALUE...]
ed card delete KEY [--force] [--yes]
ed card rename OLD NEW
ed card get KEY [--history]
ed card list [--type T] [--status S] [--parent P] [--tag T]
                [--symbol N [--file PATH]] [--glossary W]
                [--limit N] [--offset N]                       # 기본 limit 50
ed card search QUERY [--type T] [--status S] [--limit N] [--offset N]
# QUERY = SQLite FTS5 syntax (phrase: "exact phrase", AND/OR/NOT, NEAR(a b 5), prefix*)
ed card export KEY [--out FILE]             # 기본 STDOUT, --out FILE 시 해당 경로에 쓰기 (overwrite)
ed card set-status KEY STATUS [--reason TEXT | --reason-from FILE|-]
ed card tree KEY [--depth N]
ed card context KEY [--depth N] [--direction forward|backward|both]
ed card relations KEY
ed card migrate KEY [--apply]               # legacy markdown→namespace, 기본 dry-run
```

매핑 + 보존된 capability:
- `find_cards_by_symbol(symbolName, filePath)` → `card list --symbol N --file PATH` (filePath 보존)
- `get_relation_graph(direction)` → `card context --direction` (direction 보존)
- `migrate_card_to_namespace` → `card migrate --apply` (현재 dry-run only, `--apply` 명시 추가)
- `get_cards [keys]` → `card get K1 K2 K3 ...` (다수 인자) 또는 `cat keys.txt | ed card get -`

### 4.2 `glossary` — 어휘 사전 (4)

```
ed glossary define WORD=DEF [WORD2=DEF2 ...] [--from FILE|-]
ed glossary lookup [WORD]                    # WORD 없으면 전체 list
ed glossary remove WORD [--yes]
ed glossary rename OLD NEW [--def DEF]
```

**`--from FILE` 형식** (YAML):
```yaml
# glossary.yaml
- word: dual-storage
  definition: "DB와 file을 항상 동기화하는 이중 저장 불변식"
- word: compensation
  definition: "..."
```

매핑:
- `find_cards_by_glossary_word` → `card list --glossary W` (필터 통합)

### 4.3 `validate` — gate (4)

```
ed validate                       # cards + links + brief 모두
ed validate cards
ed validate links                 # validate_code_links + resolve_code_links 흡수
ed validate brief KEY             # 단일 brief
```

`ed validate brief --all` (모든 brief 순회) 옵션 추가.

### 4.4 `check` — state report (5)

```
ed check drift [KEY]
ed check coverage [KEY] [--uncovered] [--suggest]
ed check impact FILE [FILE...]
ed check regression FILE [FILE...]
ed check interactions KEY [KEY...]
```

**`validate links` vs `check coverage` 의미 + 출력 필드 분리:**

| 차원 | `validate links` | `check coverage` |
|------|------------------|------------------|
| 의미 | 카드의 codeLinks 모두 resolve되는가? | 카드 boundary 내 미커버 심볼은? |
| 종류 | gate (pass/fail) | report (descriptive) |
| Exit code | 0 또는 2 | 항상 0 |
| JSON 데이터 키 | `data.links.unresolved[]`, `data.links.declared`, `data.links.resolved` | `data.coverage.uncovered_symbols[]`, `data.coverage.ratio` |

→ 출력 필드 이름 분리로 사용자/AI 혼동 방지.

### 4.5 `spec` — 코드↔카드 동기화 (3)

```
ed spec annotate [KEY]            # write @spec to source
ed spec sync                      # read @spec from source → DB codeLinks
ed spec sync-symbols [--since TIMESTAMP]  # ISO 8601 또는 epoch ms. 생략 시 마지막 sync 이후 자동 (DB의 last_symbol_sync_at)
```

### 4.6 `bulk` — batch (2)

```
ed bulk create --from FILE|-
ed bulk sync [PATH]               # PATH = 디렉토리(재귀) / 단일 파일 (auto-detect 통한 stat)
```

**`bulk create --from FILE` 형식** (YAML 배열):
```yaml
# cards.yaml
- key: receiving
  type: brief
  summary: "..."
  brief:
    context: { problem: "...", impact: [...] }
    # ... 나머지 brief sections
- key: receiving/po-receipt
  type: spec
  parent: receiving
  codeLinks: [{kind: function, file: src/receiving/po-receipt.ts, symbol: receivePO}]
  spec:
    preconditions: [...]
    # ...
```

**`bulk sync [PATH]` 동작:**
- PATH 생략: cardsDir 전체
- PATH가 디렉토리: 재귀 스캔 `**/*.card.md`
- PATH가 파일: 단일 파일 sync
- PATH 존재하지 않음: exit 3, status=error
- PATH가 broken symlink: exit 5, status=error

**Orphan 정책:**
- 파일 있음 / DB row 없음: 자동 INSERT (sync = file → DB)
- DB row 있음 / 파일 없음: **default keep** (DB row 유지, warning만 발생). `--prune` 옵션 시 DB row 삭제
- 키 충돌 (다른 파일이 같은 key): exit 4, status=partial, errors[]에 충돌 항목

**`bulk sync` vs `card migrate`** (서브에이전트 C3 반영):
- `bulk sync`: 파일 → DB 동기화 (구조 변환 없음, 같은 형식)
- `card migrate`: legacy markdown → 신 namespace 구조 변환 (1회성 마이그레이션)
- 의미 다름 명확화

### 4.7 단일 명령 (3)

```
ed analyze [--include-body] [--drifted-limit N] [--drifted-offset N] [--unlinked-limit N]
ed reset [--yes]                  # 확인 강제 (실측 10회 호출, 실수 위험 큼)
ed init [--cards-dir PATH] [--db-path PATH] [--force]
# 기본 idempotent: .emberdeck/ 또는 .emberdeck.jsonc 이미 있으면 status=ok + warning, 변경 없음
# --force: 기존 .emberdeck.jsonc 덮어쓰기 (.emberdeck/cards/는 절대 덮어쓰지 않음)
```

**제거 검토:**
- `onboarding_summary` (실측 1회) → `analyze`로 흡수, 단독 명령 안 만듦

## 5. 미사용 도구 21개 처리

| 도구 (실측 0회) | 처리 |
|---------------|------|
| check_drift | `check drift` 유지 (gate 보조용) |
| check_interactions | `check interactions` 유지 |
| export_card_to_file | `card export` 유지 |
| find_cards_by_glossary_word | `card list --glossary` 통합 |
| find_cards_by_symbol | `card list --symbol [--file]` 통합 (filePath 보존) |
| get_card_context | `card context` 유지 |
| get_card_tree | `card tree` 유지 |
| get_relation_graph | `card context --direction` 통합 |
| list_card_relations | `card relations` 유지 |
| migrate_card_to_namespace | `card migrate [--apply]` 유지 (legacy 지원) |
| regression_guard | `check regression` 유지 |
| remove_glossary | `glossary remove` 유지 |
| rename_card | `card rename` 유지 |
| rename_glossary | `glossary rename` 유지 |
| resolve_code_links | `validate links`에 흡수 |
| search_cards | `card search` 유지 |
| suggest_card_scope | `check coverage --suggest` |
| sync_card_from_file | `bulk sync FILE` (단일 파일도) |
| sync_spec_annotations | `spec sync` 유지 |
| sync_symbol_changes | `spec sync-symbols` 유지 |
| update_card_status | `card set-status` |

총: **41 → 34 subcommand** (7 통합/제거 + 1 신설 init).

## 6. 구현 계획 (단계별)

### Phase 1 — CLI 기반 + dogfood-가능 명령 세트 (8-10일)

**선정 기준**: 실측 top 사용 + dogfood 워크플로 가능 (단순 top 5는 list/create 없어 카드 발견/추가 불가).

작업:
- [ ] `src/cli/` 디렉토리 신설
- [ ] `src/cli/index.ts` — 디스패처
- [ ] `src/cli/output.ts` — TTY 감지 자동 모드, --json/--quiet/--output 일관 처리
- [ ] `src/cli/exit-codes.ts` — enum + 일관 적용
- [ ] **실측 top + dogfood 보완 7 명령 구현**:
  - `ed card update` (실측 90)
  - `ed card get` (실측 44)
  - `ed card list` (dogfood 필수 — 카드 키 발견)
  - `ed card create` (dogfood 필수 — 신규 카드 추가)
  - `ed validate cards` (실측 26)
  - `ed check coverage` (실측 15)
  - `ed validate brief` (실측 14)
- [ ] `cli.ts` 진입점에 dispatcher 연결
- [ ] 단위 테스트: 명령 파싱, 출력 형식 (3 status), exit code, STDIN, schemaVersion

검증 기준:
- 본 emberdeck 자체 dogfood 가능: list로 발견 → get으로 읽기 → update/create로 변경 → validate로 게이트 → check coverage로 분석 — 완전 워크플로 가능

### Phase 2 — 명령 완성 (5-7일)

작업:
- [ ] 나머지 28 subcommand 구현
- [ ] `--from -` STDIN 입력 일관 지원
- [ ] 진행 상태 spinner (long-running: bulk, validate links, analyze)
- [ ] `--verbose` 디버그 출력 (STDERR)
- [ ] integration 테스트 (5 시나리오)

### Phase 3 — MCP 제거 (2-3일)

작업:
- [ ] `src/mcp/tools.ts` 삭제
- [ ] `package.json`:
  - peerDependencies `@modelcontextprotocol/sdk` 제거
  - **devDependencies `@modelcontextprotocol/sdk` 제거** (서브에이전트 A3 반영)
  - peerDependenciesMeta 정리
- [ ] `cli.ts`에서 `mcp` subcommand 제거 (or v0.3에서 deprecation 경고 후 v0.4에서 제거)
- [ ] `test/mcp/` 디렉토리 삭제
- [ ] README/`.mcp.json` 마이그레이션 문서 작성

### Phase 4 — SKILL.md/CLAUDE.md 재작성 (2-3일)

작업:
- [ ] SKILL.md 전면 재작성 — MCP 도구 호출 → CLI 명령으로
- [ ] 4 types (principle/domain/brief/spec) 반영 (별도 작업과 동기화 필요)
- [ ] 워크플로 예시 명령 시퀀스로 업데이트

### Phase 5 — 자동완성 + 문서 (2일)

- [ ] `ed completion {bash|zsh|fish}`
- [ ] `ed help` 종합 안내
- [ ] 각 명령 `--help` 정비 + 예시 ≥1

### Phase 6 — Dogfood + 안정화 (**2주** — 서브에이전트 F#12 반영)

- [ ] 본 emberdeck 자체로 4 types 카드 재추출 (CLI 사용)
- [ ] 발견 이슈 수정
- [ ] v1.0 릴리스

**총 예상: 5-6주** (1인 풀타임, dogfood 2주 포함).

## 7. MCP → CLI Migration

### 7.1 `.mcp.json` 사용자 마이그레이션

`.mcp.json`에 emberdeck MCP 서버 등록한 사용자:
- v0.3 릴리스 노트 + README에 마이그레이션 가이드:
  - `.mcp.json`에서 `emberdeck` 항목 제거
  - `ed` 명령을 직접 호출하는 워크플로로 변경
  - `ed migrate-mcp-config` helper 명령 (자동 변환, 옵션) — Phase 5에 포함 검토

### 7.2 폐기 일정

| 버전 | MCP 상태 | CLI 상태 |
|------|---------|---------|
| v0.3.0 | 유지 + deprecation warning | 추가 (CLI-only feature 등장) |
| v0.4.0 | deprecated, 명시적 opt-in 필요 | 표준 |
| v1.0.0 | **완전 제거** | 표준 |

### 7.3 In-progress 세션

- `mcp` subcommand 호출 시 v0.3+에서 stderr 경고 출력 + 정상 동작 (호환)
- v1.0에서 `mcp` subcommand 호출 시 즉시 실패 + 안내 메시지

## 8. 출력 형식 상세

### 8.1 Human (TTY 자동, `--output=human`)

- 단일 카드: YAML frontmatter + body
- 리스트: 컬럼 정렬 (key / type / status / summary), 터미널 너비 자동 감지 (기본 80, max 120)
- validate: warning 별 색상 (yellow=warning, red=error)
- 진행 상태: STDERR로 spinner

### 8.2 JSON (pipe 자동, `--output=json`)

- §3 통합 스키마 적용
- `--quiet` + JSON: `{ok: true|false}` 만 (data 생략)

### 8.3 Quiet (`-q`/`--quiet`)

- 단일: key만
- 리스트: key 한 줄당 1개 (스크립트 친화)
- validate: 0/non-zero exit + **STDERR에 1줄 요약** ("3 errors, 2 warnings") — exit code만으로는 AI에게 부족 (서브에이전트 C7 반영)

## 9. 부수적 동작 명세 (서브에이전트 D 지적 반영)

### 9.1 잠금/동시성

**검증 결과**: Bun 1.3.x는 `flock(2)`를 stdlib에 노출하지 않음. 추가 dep 없이 cross-process 동기화하려면 기존 인프라 재활용:

| 자원 | 현재 메커니즘 | CLI cross-process 보강 |
|------|------------|------------------|
| **SQLite DB** (cards/relations/codeLinks) | WAL mode + busy_timeout 5000ms (`src/db/connection.ts:24-27`) | OS-level cross-process lock — **추가 작업 불필요** |
| **카드 markdown 파일** (`*.card.md`) | atomic temp-rename (`src/fs/writer.ts`) + per-key in-memory `withCardLock` | DB 트랜잭션을 진실로 사용 — file write 실패 시 compensate. cross-process race는 DB busy timeout으로 처리 |
| **glossary.yaml** | atomic write + 전역 in-memory `withGlossaryLock` | DB에 `system_lock` 테이블 INSERT/DELETE를 advisory mutex로 사용 (cross-process — SQLite UNIQUE 제약으로 atomic) |
| **`.emberdeck/.lock` 파일** | (제거) | **불필요**: SQLite가 이미 cross-process 잠금 제공 |

**테이블 정의** (drizzle workflow):
1. `src/db/schema.ts`에 `systemLock` 테이블 추가:
   ```ts
   export const systemLock = sqliteTable('system_lock', {
     name: text('name').primaryKey(),
     pid: integer('pid').notNull(),
     startTimeTicks: integer('start_time_ticks').notNull(),  // /proc/<pid>/stat field 22
     acquiredAt: text('acquired_at').notNull(),  // ISO 8601
   });
   ```
2. `bun run drizzle:generate` 실행 → `drizzle/0002_system_lock.sql` 자동 생성 (현재 highest는 `0001_glossary.sql`이므로 0002가 다음 번호)
3. 다음 `setupEmberdeck()` 호출 시 자동 적용 (`migrateEmberdeck`)

**Acquire 절차** (CAS-safe):
```
1. SELECT pid, start_time_ticks FROM system_lock WHERE name='glossary'
2. 행 없으면: INSERT 시도 (UNIQUE 충돌 시 4로 점프)
3. 행 있으면 stale 검증:
   a. process.kill(pid, 0) → ESRCH면 dead
   b. /proc/<pid>/stat field 22 읽기 → start_time_ticks 비교
      - 다르면 PID 재사용 → dead로 판정
      - kill 성공 + start_time 일치 → alive (stale 아님)
   c. dead 판정 시: DELETE WHERE name='glossary' AND pid=$old_pid AND start_time_ticks=$old_st
      → CAS: 다른 프로세스가 이미 정리했으면 0 row 영향
   d. INSERT 시도
4. UNIQUE 충돌 시: 50ms 폴링, 5초 동안 재시도. 초과 시 exit 5
   - STDERR에 "lock held by pid=N (alive), retrying..." 1줄 출력
```

**Release** (정상 종료):
```sql
DELETE FROM system_lock WHERE name='glossary' AND pid=$my_pid
```

**SIGKILL 등 비정상 종료**: 다음 호출이 stale 판정 + CAS DELETE로 자동 회복.

**Edge cases:**
- **SIGSTOP** (T-state): kill(pid,0)=alive, lock 유지. 5초 timeout 후 호출자 exit 5. 운영 부담은 사용자 (rare).
- **NFS / 네트워크 FS**: SQLite WAL이 NFS에서 unsafe — `.emberdeck/` 위치 NFS면 잠금 신뢰 불가. **STDERR 경고**: 시작 시 statfs로 fs type 확인하여 NFS면 warning.
- **PID 재사용**: start_time_ticks 비교로 100% 차단.
- **Linux/macOS만 지원**: Windows는 Phase 5+ (별도 메커니즘 — `LockFileEx` via Bun FFI 또는 `proper-lockfile` 추가).

### 9.2 Long-running operations

- spinner: STDERR (TTY 시), JSON 시 무음
- 진행률 가능 시 `{progress: 0.45, current: "...", total: 100}` 라인 출력 (`--output=json --stream` 시)

### 9.3 Atomicity

- `bulk create`: 현재 partial-success (실측 9회 사용). CLI도 partial-success 유지하되 결과에 `errors[]`로 실패 항목 명시
- `bulk sync`: 파일별 독립 트랜잭션 (한 파일 실패가 다른 파일 영향 안 줌)

### 9.4 Watch mode

- 후순위 (Phase 6 이후 검토)
- `ed watch validate` 형태 가능성

### 9.5 Config 발견

**현재 동작 (검증: `src/config-file.ts:236-251` + `src/fs/package-root.ts:8`):**
- `findPackageRoot(cwd)` — CWD에서 상위로 traverse하여 `package.json` 발견 시 그 디렉토리 반환
- 그 디렉토리에서 `.emberdeck.jsonc` 또는 `.emberdeck.json` 검색
- 즉 **이미 hybrid upward search** (package root까지 walk-up + 그 위치에서 config 검색)

**v3 개선 검토 (선택):**
- (옵션) package.json 없는 워크스페이스 지원 — `.emberdeck.jsonc`도 직접 walk-up
- 현재 동작으로도 일반 npm/bun 프로젝트 모두 cover됨 → **변경 불필요**, 현재 유지

### 9.6 gildash 부재 / 일시 실패

| 상황 | exit code | status | 동작 |
|------|----------|--------|------|
| gildash 미설정 (projectRoot null) | 6 | error | code: CONFIG_MISSING |
| gildash 일시 실패 (timeout/disk hiccup) | 7 | unknown | code: GILDASH_TRANSIENT, retry hint |
| gildash 인덱스 깨짐 (영구 실패) | 1 | error | code: GILDASH_INDEX_CORRUPT |
| 그 외 명령 (codeLink 무관) | 정상 | ok | 영향 없음 |

스크립트가 6 vs 7 구분 가능: 6은 사용자 설정 필요, 7은 재시도 권장.

### 9.7 destructive 명령 확인

- `ed reset` (10회 실측 — 실수 위험 큼): `--yes` 없으면 STDIN으로 "yes" 입력 요구, 비TTY 시 즉시 실패
- `ed card delete --force`: 같은 패턴
- `ed bulk sync` (덮어쓰기): `--yes` 옵션, 또는 dry-run 기본 + `--apply`

## 10. 라이브러리 결정

### 10.1 명령 파싱

검증 후보:

| 옵션 | 평가 |
|------|------|
| **Bun parseArgs** | subcommand 미지원, 33 명령 직접 파싱 부담. v0.x 가능하지만 v1.0 유지보수 부담 |
| **Commander.js** | v12+ 안정, 활발히 유지(2026 기준 npm 1.5억+ 다운로드/주), help/subcommand/typescript 지원, 의존성 0 |
| **citty** (UnJS) | 가벼움(~5KB), 2024+, TypeScript-native, 신생이라 ecosystem 작음 |
| **yargs** | 무거움(~100KB+), 다기능, emberdeck 규모 overkill |
| **oclif** | 엔터프라이즈 framework, 무거움, plugin 모델 — emberdeck에 과함 |

**제안: Commander.js v12+**
근거: (a) 33 subcommand 자동 관리, (b) `--help` 자동 생성, (c) 충분히 가벼움(~30KB), (d) TypeScript 지원, (e) 7년+ 안정 이력.
대안 검토 필요시 citty (Phase 1 시작 시 spike 1일).

### 10.2 색상

- **Bun built-in (`Bun.color()`)** + ANSI escape — 의존성 0

## 11. 리스크 / 완화

| 리스크 | 가능성 | 영향 | 완화 |
|--------|------|------|------|
| 사용자(본인) MCP 워크플로 이탈 | 낮음 | 낮음 | v0.3-v1.0 grace period |
| CLI 출력 토큰 폭증 | 중 | 높음 | 모든 명령 `--quiet`/`--json`, TTY 자동 감지 |
| AI agent CLI 발견 실패 | 낮음 | 중 | SKILL.md 명시적 명령 예시 |
| 33 subcommand 너무 많음 | 낮음 (top 10이 85%) | 중 | help + 자동완성 |
| 어색한 이름 | 중 | 중 | dogfood로 검증, v1 전 조정 |
| Phase 일정 초과 | 중 | 중 | Phase 6 dogfood 2주로 조정 (서브에이전트 권고) |

## 12. Open Questions (사용자 결정 필요)

| # | 질문 | 옵션 | 제안 |
|---|------|------|------|
| Q1 | bin alias | (a) `emberdeck`만 (b) `ed` 추가 | (b) — 짧은 명령 |
| Q2 | MCP 폐기 일정 | (a) 즉시 (b) v0.3→v1.0 grace | (b) |
| Q3 | `card migrate` `--apply` 기본값 | dry-run | dry-run 유지 (안전) |
| Q4 | `ed onboarding` 별도 명령 | (a) 유지 (b) 제거 | (b) — analyze로 흡수 |
| Q5 | `init` 명령 동작 | 빈 .emberdeck/ + 기본 jsonc | 그대로 |
| Q6 | watch mode | Phase 6 이후 | 후순위 |
| Q7 | `.mcp.json` 마이그레이션 helper | (a) 자동 명령 (b) 문서만 | (a) — Phase 5 |

## 13. 다음 단계

1. 이 v2 plan 사용자 승인 → Q1~Q7 결정
2. 추가 adversarial review (서브에이전트 라운드 2)
3. v3 plan으로 fix → 승인 시 Phase 1 시작

---

## Changelog

### Phase 1 + Phase 2 구현 완료 (2026-04-27)
**Phase 1 (commits 618e0d1 → 67a9e55):**
- foundation: src/cli/{exit-codes,output,errors,context,runner,index}.ts + Commander v14
- 7 명령 (실측 top + dogfood 보완): card get/list/create/update + validate cards/brief + check coverage
- bin: emberdeck → ed
- system_lock 테이블 (drizzle 0002) + glossary cross-process lock 통합
- macOS support (ps -o lstart= fallback)
- NO_COLOR / CLICOLOR_FORCE 환경변수, --verbose 토큰 누설 방지
- Migration upgrade path 검증 (0001 → 0002)
- 39 테스트 추가 (1064 → 1133)

**Phase 2 (commits b5e9c7e → e0041d4):**
- 25 나머지 명령 (총 31 subcommand 완료):
  - card 8개 (delete/rename/search/export/set-status/tree/context/relations)
  - glossary 4개 (define/lookup/remove/rename)
  - validate 2개 (no-arg, links)
  - check 4개 (drift/impact/regression/interactions)
  - spec 3개 (annotate/sync/sync-symbols)
  - bulk 2개 (create/sync)
  - 단일 2개 (analyze, reset)
- spinner 모듈 (verbose 시 NOOP, JSON/quiet 시 NOOP, try/finally cleanup)
- system_metadata 테이블 (drizzle 0003) — sync-symbols last_symbol_sync_at persistence
- bulk partialIsFailure: 일부 실패 → exit 2 (CI gate signal)
- card export STDOUT 기본 (--out FILE, --in-place 분기), 원본 부작용 차단
- buildCardFromDb 추출 (cli ↔ ops 로직 중복 제거)
- 49 테스트 추가 (1133 → 1182)

### v6 (2026-04-27) — 서브에이전트 round 5 리뷰 반영 (final patches)
- §4.1 `card set-status` 시노시스에 `--reason-from FILE|-` 추가
- §4.1 `card export [--out FILE]` (기본 STDOUT) 명시
- §4.7 `init [--force]` idempotent 동작 + --force 시 jsonc 덮어쓰기, cards/ 보호
- §4.6 `bulk sync` orphan 정책 명시 (`--prune` 옵션, 충돌 시 partial)
- §3.8 "CLI 자체는 retry 안 함" 명시 (caller 책임 명확화)
- §9.1 raw SQL 폐기, drizzle workflow로 변경 (schema.ts → drizzle:generate → 자동 적용), migration 번호 0010 → 0002로 정정
- §6 Phase 1 5-7일 → 8-10일 (현실적 estimate)
- §6 총 4-5주 → 5-6주

### v5 (2026-04-27) — 서브에이전트 round 4 리뷰 반영
- §9.1 SQLite lock — PID + start_time_ticks tuple로 PID 재사용 방어, CAS DELETE로 TOCTOU race 차단, drizzle migration 스키마 명시
- §3.5 schemaVersion `{major, minor}` 객체로 변경 — string `"1"`로는 minor 표현 불가
- §3.6 Bulk status 매핑 재정의 — bulk all-fail = `partial` (이전 `error` 부정합 해소)
- §3.7 errors[] 단일 진실 공급원 — `data.failed[]` 제거 (redundancy 해소)
- §3.8 unknown retry protocol 구체화 (max 3, exp backoff 1/2/4s, ±25% jitter)
- §3 모든 예시 schemaVersion 객체 형식으로 갱신 + pagination 필드 추가
- §4.1 `card list/search` pagination (--limit/--offset, 기본 50)
- §4.7 `analyze` --drifted-limit / --unlinked-limit 분리
- §4.2 glossary YAML 형식 명시
- §4.6 bulk create YAML 형식 명시 + bulk sync PATH non-existence 동작 명시
- §4.5 `--since` 생략 시 last_sync 사용 (omit semantics)
- §2.4 `--reason-from -` 패턴으로 STDIN 일관화 (--status-from은 status가 positional이라 불필요)
- §5 stale "41 → 33" → "41 → 34" 정정

### v4 (2026-04-27) — 서브에이전트 round 3 리뷰 반영
- §3 status enum 4-way 확장 (`ok | partial | error | unknown`) — 일시 실패 별도 카테고리
- §3 필드 존재 매트릭스 추가 — 모든 키 항상 존재 (error만 optional)
- §3 edge case 매핑 명시 (빈 입력 / 모두 실패 / warning 만 있음 / 일시 실패)
- §3 schemaVersion 정책 명시 (major vs minor)
- §2.3 exit code 7 추가 (transient/retryable)
- §9.1 flock(2) 의존 제거 — Bun stdlib 미지원 검증 후 SQLite-based cross-process lock으로 전환 (system_lock 테이블 + PID liveness check)
- §9.6 gildash 시나리오 매트릭스 (config missing vs transient vs corrupt)
- §4 catalog 카운트 정정 (33 → 34, §4.1 12 → 13)
- §2.4 `card status` → `card set-status` 잔존 reference 정정
- §5 stale `card status` 항목 정정

### v3 (2026-04-27) — 서브에이전트 round 2 리뷰 반영
- §1.2 jsonl 파일 수 138 → 139 정정
- §3 JSON 스키마 재설계: `status: ok|partial|error` enum (이전 `ok: bool` + `errors[]`은 partial-success 의미 모순) + `schemaVersion` 필드 추가
- §3 invalid JSON 문법(`true | false`) 제거, 3개 구체 예시
- §4.1 `card status` → `card set-status` (verb 명확화, list --status 충돌 해소)
- §4.4 validate vs check 출력 필드 이름 분리 (`links.unresolved` vs `coverage.uncovered_symbols`)
- §4.5 `SINCE` → `--since TIMESTAMP` (ISO 8601 명시)
- §4.6 `bulk sync [PATH]` (디렉토리/파일 auto-detect 명시)
- §6 Phase 1 명령 7개로 확장 (top 5 + dogfood 필수 list/create) — top 5만으로는 카드 발견/추가 불가
- §9.1 stale-lock 회피: `flock(2)` 명시 (FD close 시 자동 해제, stale lock 발생 불가)
- §9.5 config 발견 — 잘못된 "현재 CWD only" claim 정정 (실제는 findPackageRoot로 이미 walk-up하여 hybrid 동작) + 변경 불필요로 정리
- §9.6 gildash missing → exit 6 (5와 분리: 5=permission/IO, 6=config missing)
- §10.1 Commander.js 채택 근거 보강 (대안과 spec 비교 표)

### v2 (2026-04-27) — 서브에이전트 round 1 리뷰 반영
- §1.2 사용 데이터 전면 재산출 (282 호출, top 5 = 66%, 21 도구 0회 — v1 데이터 fabricated였음)
- §2.1 산업 표준 claim 정정 (kubectl는 verb-noun, cargo는 verb-only)
- §3 JSON 스키마 통합 (success/failure 동일 키셋)
- §4.1 `card list --symbol --file`, `card context --direction`, `card migrate --apply` 보존
- §4.4 `validate links` vs `check coverage` 의미 분리 명시
- §4.6 `bulk sync` vs `card migrate` 의미 분리 명시
- §4.7 `reset --yes` 강제 (실측 10회, 실수 위험)
- §6 Phase 1 명령 실측 top 5로 변경 (update_card / get_card / validate_cards / check coverage / validate_brief)
- §7 `.mcp.json` 마이그레이션 일정 명시
- §8.3 `--quiet validate` STDERR 1줄 요약 추가 (exit code only는 AI에게 부족)
- §9 잠금/atomicity/watch/config 발견/gildash 부재/destructive 확인 명세 추가
- §6 Phase 3 devDep 제거 추가
- 출처 정직성: 토큰 비용 벤치마크는 marketing blog로 표시, 정밀 측정 아님 명시

### v1 (2026-04-27) — 초안 (데이터 오류 포함, 폐기)

---

**참고 출처:**
- [clig.dev — Command Line Interface Guidelines](https://clig.dev/)
- [Why CLI Tools Are Beating MCP for AI Agents](https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/) (마케팅, 정밀 벤치마크 아님)
- [MCP vs CLI for AI Agents 2026 (Firecrawl)](https://www.firecrawl.dev/blog/mcp-vs-cli)
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)
- [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide)
- [Microsoft .NET System.CommandLine Design Guidance](https://learn.microsoft.com/en-us/dotnet/standard/commandline/design-guidance)
