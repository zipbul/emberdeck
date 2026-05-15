---
key: cli-surface/command-routing-and-output/commands/card-create
summary: >-
  Per-command CLI-shape spec for 'ed card create'; declares created card stub
  shape (POST-001) and 0/4 exit policy (POST-002).
status: draft
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
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed card create <key> --type T [...]`
        { key, filePath, status, type, parent: string|null }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): card 신규 생성 + 파일 write + DB row insert 성공.
        - thrown 매핑: CardAlreadyExistsError → 4 (EXIT.CONFLICT).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 동일 key 카드가 이미 존재.
      behavior: >-
        stderr `{level:'error', code:'card-already-exists', message, details?}`
        + exit 4.
    - violation: parent 검증 실패 / activation guard 위반 / key 형식 오류.
      behavior: >-
        stderr `{level:'error',
        code:'validation-error'|'parent-validation-error'|'activation-guard-failed',
        message}` + exit 2.
    - violation: commander 가 인자 검증 실패 (typo/누락/알 수 없는 옵션)
      behavior: >-
        runner 가 stderr 에 {level:'error', code:'cli-usage-error', message}
        JSON-line emit 후 exit 2.
---
