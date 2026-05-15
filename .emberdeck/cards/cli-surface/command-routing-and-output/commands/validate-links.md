---
key: cli-surface/command-routing-and-output/commands/validate-links
summary: >-
  Per-command CLI-shape spec for 'ed validate links'; declares per-card link
  breakdown shape (POST-001) and 0/2 exit policy (POST-002).
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
        // stdout shape for `ed validate links [key]`
        {
          summary: { total, ok, broken, skipped, ioFailed },
          items: {
            key, declared, resolved,
            brokenLinks?:  { file, symbol, reason: 'gildash-unavailable'|'symbol-not-found' }[],
            plannedLinks?: { file, symbol, reason: 'gildash-unavailable'|'symbol-not-found' }[],  // draft 카드의 broken — broken 으로 카운트 X
            skipped?: { reason: 'key-mismatch' },
            ioError?: { message }
          }[]
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: >-
        - 0 (EXIT.OK): summary.broken === 0 && summary.ioFailed === 0
        (plannedLinks 는 exit 에 영향 X — draft 의 의도된 미완성).

        - 2 (EXIT.VALIDATION_FAILURE): summary.broken > 0 또는 summary.ioFailed >
        0.

        - thrown 매핑: 없음 (read-only).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: active 카드의 코드 링크가 깨짐 (symbol-not-found 또는 gildash-unavailable).
      behavior: stdout 정상 data emit (brokenLinks 채워짐) + exit 2.
---
