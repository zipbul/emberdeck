---
key: cli-surface/command-routing-and-output/commands/bulk-create
summary: >-
  Per-command CLI-shape spec for 'ed bulk create --from FILE'; declares
  created[] + failed[] + total shape (POST-001) and 0/2 exit policy (POST-002).
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
        // stdout shape for `ed bulk create --from FILE`
        {
          created: { inputIndex, key, filePath }[],
          failed:  { inputIndex, key?, error }[],
          total: number   // 입력 개수
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0 (모두 성공).

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (data 는 정상 emit, exit 만
        2 — CI 게이트 신호).

        - thrown 매핑: 없음 (per-item 실패는 failed[] 에 누적, throw 아님). 빌드/IO 에러는 부모
        runner 의 일반 매핑.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: per-item 실패 (key 중복 / parent 미존재 / 검증 실패).
      behavior: failed[] 에 누적 + stdout 정상 emit + exit 2 (전체 실패 누적 있을 때).
---
