---
key: cli-surface/command-routing-and-output/commands/glossary-rename
summary: >-
  Per-command CLI-shape spec for 'ed glossary rename'; declares oldWord/newWord
  + affectedCardKeys + failedFileWrites shape (POST-001) and 0/2/3/4 exit policy
  (POST-002).
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
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed glossary rename <old> <new> [--def TEXT]`
        { oldWord, newWord, affectedCardKeys: string[],
          failedFileWrites?: string[] }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): rename 성공 + 모든 affected card 파일 write 통과
        (failedFileWrites 미존재 또는 빈 배열).

        - 2 (EXIT.VALIDATION_FAILURE): failedFileWrites.length > 0 (data 정상
        emit, exit 만 2).

        - thrown 매핑: GlossaryNotFoundError → 3 (EXIT.NOT_FOUND) (oldWord
        missing); GlossaryValidationError → 2 (EXIT.VALIDATION_FAILURE; 코드 매핑
        정합).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: newWord 가 이미 glossary 에 존재.
      behavior: >-
        stderr `{level:'error', code:'glossary-validation-error', message}` +
        exit 2.
    - violation: affected 카드 파일 일부 write 실패.
      behavior: failedFileWrites 채워짐 + stdout 정상 emit + exit 2.
    - violation: oldWord 가 glossary 에 미존재
      behavior: GlossaryNotFoundError → stderr {code:'glossary-not-found'} + exit 3.
---
