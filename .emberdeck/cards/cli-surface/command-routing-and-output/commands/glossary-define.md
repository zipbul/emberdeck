---
key: cli-surface/command-routing-and-output/commands/glossary-define
summary: >-
  Per-command CLI-shape spec for 'ed glossary define'; declares defined[] +
  failed[] + total shape (POST-001) and 0/2 exit policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: runner 가 빌드된 CliRuntime + commander 검증 통과 인자로 이 명령 action 을 호출.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:

        ```jsonc

        // stdout shape for `ed glossary define [pairs...] [--from f.json]`

        { defined: { word, definition, action: 'created'|'updated' }[],
          failed:  { inputIndex, reason }[],
          total: number }
        // CLI 가 op 의 `validateGlossaryEntry` (src/ops/glossary.ts:48) 를 재사용해서
        per-entry 사전 검증.

        // 통과한 entry 만 일괄 `defineGlossary` 호출, 실패는 `failed[]` 누적. op 는
        all-or-nothing throw 그대로.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0 (모든 entry 성공).

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (data 정상 emit, exit 만
        2).

        - thrown 매핑: 없음 (per-entry 실패는 failed[] 에 누적).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: per-entry 검증 실패 (word 형식 / definition 빈값).
      behavior: failed[] 누적 + stdout 정상 emit + exit 2.
---
