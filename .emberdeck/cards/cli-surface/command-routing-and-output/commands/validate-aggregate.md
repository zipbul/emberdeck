---
key: cli-surface/command-routing-and-output/commands/validate-aggregate
summary: >-
  Per-command CLI-shape spec for 'ed validate' (aggregate); declares { cards,
  links } shape (POST-001) and 0/2 exit policy (POST-002).
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
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:

        ```jsonc

        // stdout shape for `ed validate` (aggregate)

        { cards: <validate cards shape>, links: <validate links shape> }

        // 'validate cards' / 'validate links' 의 POST-001 shape 을 그대로 두
        sub-field 로 묶음.

        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: >-
        - 0 (EXIT.OK): cards.summary.total === 0 && links.summary.broken === 0
        && links.summary.ioFailed === 0.

        - 2 (EXIT.VALIDATION_FAILURE): 두 sub 중 하나라도 비-0 위반.

        - thrown 매핑: 없음 (read-only).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: cards 또는 links sub 중 위반 1건 이상.
      behavior: stdout 정상 aggregate data emit + exit 2.
---
