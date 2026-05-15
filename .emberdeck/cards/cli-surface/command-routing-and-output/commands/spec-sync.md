---
key: cli-surface/command-routing-and-output/commands/spec-sync
summary: >-
  Per-command CLI-shape spec for 'ed spec sync'; declares alreadyLinked +
  linkMissing/unmatched/markerMissing diagnostics shape (POST-001) and exit 0
  policy (POST-002).
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
        // stdout shape for `ed spec sync`
        {
          alreadyLinked: number,                                    // 기존 link 와 매칭되어 skip 된 annotation 수
          linkMissing:   { cardKey, file, symbol }[],               // 새로 생성된 code link (= 옛 `created` 의 array form)
          unmatched:     { cardKey, file, symbol }[],               // 카드 못 찾은 annotation
          markerMissing: { cardKey, file, symbol }[]                // code link 있는데 source 의 @spec annotation 없음
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: >-
        - 0 (EXIT.OK): sync 는 fact-recording; unmatched/markerMissing 은 진단이지 실패
        아님.

        - thrown 매핑: 없음 (sync 자체는 read-write 지만 진단 array 가 비-실패 신호).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: DB write 실패 (transient / IO).
      behavior: >-
        stderr `{level:'error', code:'permission-or-io', message}` + exit 5 (부모
        runner 의 일반 매핑).
---
