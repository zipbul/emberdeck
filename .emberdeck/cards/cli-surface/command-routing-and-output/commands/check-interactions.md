---
key: cli-surface/command-routing-and-output/commands/check-interactions
summary: >-
  Per-command CLI-shape spec for 'ed check interactions'; declares per-pair
  sharedSymbols/files + relations shape (POST-001) and exit 0 policy (POST-002).
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
        // stdout shape for `ed check interactions <keys...>`
        {
          interactions: {
            pair: [string, string],
            sharedSymbols: { file, symbol }[],
            sharedFiles: string[],
            importDependencies: { from, to, file }[],
            hasRelation: boolean,
            potentialConflicts: string[]
          }[],
          undefinedRelations: { pair: [string, string], suggestion: string }[]
          // op 가 reason 안 만들기 때문에 §1.7 에 없음
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): interactions report 항상 (read-only).
        - thrown 매핑: 없음 (read-only).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: keys 인자 2개 미만 (commander 가 사전 거부).
      behavior: >-
        runner-commander-fallback 경로 stderr `{level:'error',
        code:'cli-usage-error', ...}` + exit 2.
---
