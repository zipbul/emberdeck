---
key: cli-surface/command-routing-and-output/commands/card-list
summary: >-
  Per-command CLI-shape spec for 'ed card list'; declares paginated CardSummary
  items shape (POST-001) and exit 0 policy (POST-002).
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
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed card list [filters] [--limit N] [--offset N]`
        { items: CardSummary[], total, limit, offset, hasMore }
        // CardSummary = { key, summary, type, status, parent: string|null }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): filter / pagination 적용 후 결과 반환 (빈 배열도 성공).
        - thrown 매핑: 없음 (read-only). 빌드/IO 에러는 부모 runner 의 일반 매핑.
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: '잘못된 filter 값 (예: status 가 enum 외).'
      behavior: >-
        commander 가 사전 거부 → runner-commander-fallback 경로로 stderr
        `{level:'error', code:'cli-usage-error', ...}` + exit 2.
---
