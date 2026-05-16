---
key: cli-surface/command-routing-and-output/commands/card-update
summary: >-
  Per-command CLI-shape spec for 'ed card update'; declares updated card shape
  with validationNotes (POST-001) and 0/2/3 exit policy (POST-002).
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

        // stdout shape for `ed card update <key> [--field, --patch, --glossary,
        --tag]`

        { key, filePath, status,
          validationNotes: string[] }   // 비-치명 field warnings (예: 'status changed to draft because type changed')
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): 패치 적용 + DB / 파일 write 성공 (validationNotes 가 있어도 0).

        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND); CardValidationError
        / ParentValidationError → 2 (EXIT.VALIDATION_FAILURE).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 주어진 key 의 카드가 없음.
      behavior: stderr `{level:'error', code:'card-not-found', message}` + exit 3.
    - violation: '패치 본문이 카드 schema 와 충돌 (예: 잘못된 type, 잘못된 namespace body).'
      behavior: >-
        stderr `{level:'error', code:'validation-error', message, details?}` +
        exit 2.
    - violation: status 를 active 로 변경 시 활성화 가드 미달
      behavior: >-
        ActivationGuardError → stderr {code:'activation-guard-failed',
        details:{unmetConditions}} + exit 2.
    - violation: parent 변경 시 4-tier 위반 / parent 미존재
      behavior: >-
        ParentValidationError → stderr {code:'parent-validation-error'} + exit
        2.
---
