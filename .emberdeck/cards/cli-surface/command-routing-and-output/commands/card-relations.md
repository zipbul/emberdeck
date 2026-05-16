---
key: cli-surface/command-routing-and-output/commands/card-relations
summary: >-
  Per-command CLI-shape spec for 'ed card relations'; declares forward/reverse
  CardSummary shape (POST-001) and 0/3 exit policy (POST-002).
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
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed card relations <key>`
        // op `listCardRelations` 가 직접 `CardSummary[]` 반환 (OP-13).
        {
          key,
          forward: CardSummary[],     // 이 카드 → 다른 카드
          reverse: CardSummary[],     // 다른 카드 → 이 카드
          total: number
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): relations 조회 성공.
        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND).
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
---
