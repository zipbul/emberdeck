---
key: cli-surface/command-routing-and-output/commands/runner-commander-fallback
summary: >-
  Per-command CLI-shape spec for the commander error fallback (not a
  subcommand); failure-only path with stderr JSON-line and 0/2 exit policy
  (POST-002).
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        commander.parseAsync 가 commander.help/commander.version 외 CommanderError
        를 던졌고 어떤 subcommand action 도 dispatch 안 됨; CliRuntime 없음.
      derives: cli-surface/command-routing-and-output#G-004
  postconditions:
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: >-
        - 0 (EXIT.OK): commander.help / commander.version (정상 도움말/버전 출력 경로;
        stdout 은 commander 의 도움말 텍스트, 본 카드는 stderr 무출력).

        - 2 (EXIT.VALIDATION_FAILURE): 그 외 모든 CommanderError
        (InvalidArgumentError / 누락 positional / 알 수 없는 옵션).

        - stdout: 본 fallback 경로에서 data shape 없음 (실패 경로 — stdout 무출력).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: >-
        commander.help / commander.version 외의 CommanderError
        (InvalidArgumentError / 누락 positional / 알 수 없는 옵션).
      behavior: >-
        stderr 에 한 줄 `{level:'error', code:'cli-usage-error', message:<commander
        msg>}` JSON-line + exit 2 (VALIDATION_FAILURE). stdout 무출력.
---
