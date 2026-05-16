---
key: cli-surface/command-routing-and-output/commands/card-tree
summary: >-
  Per-command CLI-shape spec for 'ed card tree'; declares root TreeNode shape
  (POST-001) and 0/3 exit policy (POST-002).
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
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:

        ```jsonc

        // stdout shape for `ed card tree <key> [--depth N]`

        TreeNode  // root 그대로

        // TreeNode = { key, type, status, summary, depth: number, truncated?:
        boolean, children: TreeNode[] }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): tree walk 성공 (maxDepth 도달 시 truncated:true).
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
    - violation: root key 가 DB 에 없음.
      behavior: stderr `{level:'error', code:'card-not-found', message}` + exit 3.
---
