---
key: cli-surface/command-routing-and-output/commands/check-drift
summary: >-
  Per-command CLI-shape spec for 'ed check drift'; declares health + per-card
  driftType breakdown shape (POST-001) and read-only exit 0 policy (POST-002).
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
        // stdout shape for `ed check drift [key]`
        {
          health: { total, active, drifted, draft },
          cards: { key, summary, status, driftType?, driftTypes?, brokenLinks, totalLinks }[]
          // 총 drift 카드 수는 `cards.filter(c => c.driftType).length` 로 derive
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): drift report 항상 (read-only; drift 발견은 실패 아님).
        - thrown 매핑: 없음 (read-only).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 주어진 [key] 가 존재하지 않음 (옵션 인자).
      behavior: stderr `{level:'error', code:'card-not-found', message}` + exit 3.
---
