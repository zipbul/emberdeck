# emberdeck CORE — 카드 작업 시 결정 게이트 (UserPromptSubmit hook 주입용)

이 카드 작업이 시작되는 순간 다음을 검증해라. 한 항목이라도 위반 = 멈춤.

## SoT 정체성
- 카드 = `.emberdeck/cards/**/*.md` 의 **YAML frontmatter 본문 자체** 가 SSOT.
- 카드 데이터를 Python / node / ruby / perl / awk / shell loop 로 **생성** 하지 마라. SoT 가 script 가 되어 검토 단위가 무너진다.
- 카드는 **사람이 검토 가능한 yaml 본문** 으로 *명시 작성*. batch 라도 동일. 32 카드면 32 카드 명시 작성.

## 공식 명령 (이것만)
- 단일: `ed card create KEY --type T --summary S [--parent P] [--from f.json]`
- 배치: `ed bulk create --from FILE` (FILE = JSON array, *내가 명시 작성한 staging*)
- 기타 mutation: `ed card update/delete/rename/set-status`, `ed bulk sync`, `ed glossary define/remove/rename`, `ed spec sync`, `ed spec sync-symbols`, `ed reset`
- read-only: `ed card get/list/search/tree/context/relations/export`, `ed validate`, `ed check *`, `ed analyze`, `ed glossary lookup`, `ed init`

## HC 게이트 (모든 카드 mutation 전)
1. **Skill(emberdeck) invoke** (model-invoked, 카드 작업 진입마다)
2. **`<card_analysis>` 표** 한 번에 모든 N 카드 → **사용자 confirm 응답** 받음
3. **`<self_review>`** 항목별 통과 — *execution method 도 검토*: "이 작업을 SKILL `<commands>` 표의 공식 명령으로 하는가? Python / shell loop / Write tool 우회 아닌가?"
4. **marker write**: `touch /tmp/claude-emberdeck-gate-<session_id>`
5. ed mutation 호출. PreToolUse hook (`check-ed-gate.sh`) 이 marker 검증 + script 우회 패턴 (script 가 `.emberdeck/cards` 접근) deny.

## HC-4 (commit 게이트)
카드 commit 전 `ed validate cards` exit 0 (issue 0) 필수. 또한 spec 카드 mutation 이라면 `ed validate links` 도 broken/ioFailed 0 확인. 통과 안 한 채 commit = SSOT 오염 history.

## 안티패턴 (deny 대상)
- Write/Edit/MultiEdit 로 `.emberdeck/cards/**/*.md` 직접 편집 — PreToolUse deny
- marker 없이 ed mutation — PreToolUse deny
- Python / node / deno / bun / ruby / perl / awk / sed 등 스크립트 인터프리터가 `.emberdeck/cards/` 경로 또는 `ed bulk create --from` 파이프 접근 — PreToolUse deny (hook 의 bypass 패턴)
- "32 카드라 효율" 명목으로 script 자동 생성 — self_review 가 catch (execution method 항목)

## 위반 시 결과
SSOT 와 인덱스 불일치 → 다음 `ed validate` 까지 lag → 후속 작업 검증 깨짐. 효율로 보일 뿐 재작업 cost 항상 더 크다.
