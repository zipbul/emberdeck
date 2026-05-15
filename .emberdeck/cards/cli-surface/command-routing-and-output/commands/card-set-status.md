---
key: cli-surface/command-routing-and-output/commands/card-set-status
summary: >-
  Per-command CLI-shape spec for 'ed card set-status'; declares
  oldStatus/newStatus shape (POST-001) and 0/2/3 exit policy (POST-002).
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
        // stdout shape for `ed card set-status <key> <status> [--reason TEXT]`
        { key, oldStatus, newStatus }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): 상태 전이 성공.

        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND);
        ActivationGuardError → 2 (EXIT.VALIDATION_FAILURE).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 'draft → active 전이가 activation guard 위반 (예: 자식 카드 부재 / broken link).'
      behavior: >-
        stderr `{level:'error', code:'activation-guard-failed', message,
        details?}` + exit 2.
    - violation: key 에 해당하는 카드 미존재
      behavior: CardNotFoundError → stderr {code:'card-not-found'} + exit 3.
---
