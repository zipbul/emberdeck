---
key: cli-surface/command-routing-and-output/commands/bulk-sync
summary: >-
  Per-command CLI-shape spec for 'ed bulk sync'; declares synced + mode +
  failed[] shape (POST-001) and 0/2 exit policy (POST-002).
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
        // stdout shape for `ed bulk sync [PATH]`
        {
          synced: number,
          mode: 'file'|'directory',
          path: string,
          failed: { filePath: string, error: string }[]   // 성공 시 빈 배열. CLI 가 op 의 `error: unknown` 을 `errorMessage(e)` 로 string 변환.
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): failed.length === 0.

        - 2 (EXIT.VALIDATION_FAILURE): failed.length > 0 (data 정상 emit, exit 만
        2).

        - thrown 매핑: `CliUsageError` (PATH 미존재) → 2; per-file 실패는 throw 아님,
        `failed[]` 누적.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: PATH 인자가 존재하지 않는 경로.
      behavior: stderr `{level:'error', code:'cli-usage-error', message}` + exit 2.
    - violation: per-file 파싱/sync 실패.
      behavior: failed[] 에 누적 + stdout 정상 emit + exit 2.
---
