---
key: cli-surface/command-routing-and-output/commands/card-export
summary: >-
  Per-command CLI-shape spec for 'ed card export'; declares mode +
  filePath/bytes/content shape (POST-001) and 0/3 exit policy (POST-002).
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

        // stdout shape for `ed card export <key> [--out FILE | --in-place]`

        // OP-15 가 exportCardToFile 을 `{filePath, bytes}` 반환으로 변경, 모든 모드 bytes
        일관.

        { key, mode: 'in-place'|'file'|'stdout',
          filePath?: string,    // mode='file'|'in-place'
          bytes: number,         // 모든 모드 (직렬화된 content 의 byte 길이)
          content?: string }     // mode='stdout' 만 (jq 친화)
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): export 성공 (파일 write 또는 stdout content 채움).
        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND).
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
