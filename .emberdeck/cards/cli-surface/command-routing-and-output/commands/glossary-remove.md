---
key: cli-surface/command-routing-and-output/commands/glossary-remove
summary: >-
  Per-command CLI-shape spec for 'ed glossary remove'; declares word +
  affectedCardKeys shape (POST-001) and 0/2/3 exit policy (POST-002).
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
        // stdout shape for `ed glossary remove <word>`
        { word: string, affectedCardKeys: string[] }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: >-
        - 0 (EXIT.OK): 단어 제거 성공.

        - thrown 매핑: GlossaryNotFoundError → 3 (EXIT.NOT_FOUND) (word missing —
        errors.ts 의 분리 매핑); GlossaryValidationError → 2
        (EXIT.VALIDATION_FAILURE) (기타 검증).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: word 가 glossary.yaml 에 없음.
      behavior: stderr `{level:'error', code:'glossary-not-found', message}` + exit 3.
---
