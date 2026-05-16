---
key: cli-surface/command-routing-and-output/commands/check-regression
summary: >-
  Per-command CLI-shape spec for 'ed check regression'; declares pass/fail +
  driftedRatio shape (POST-001) and 0/2 exit policy (POST-002).
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
        // stdout shape for `ed check regression <files...>`
        {
          passOrFail: 'pass'|'fail',
          driftedRatio: number,
          threshold: number,
          affected: { key, status, driftType? }[]
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): passOrFail === 'pass' (driftedRatio <= threshold).

        - 2 (EXIT.VALIDATION_FAILURE): passOrFail === 'fail' (driftedRatio >
        threshold; data 정상 emit, exit 만 2).

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
    - violation: driftedRatio 가 threshold 초과.
      behavior: stdout 정상 data emit (passOrFail:'fail') + exit 2.
---
