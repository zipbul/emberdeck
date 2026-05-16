---
key: cli-surface/command-routing-and-output/commands/reset
summary: >-
  Per-command CLI-shape spec for 'ed reset --yes'; declares cardsDeleted +
  glossaryCleared shape (POST-001) and 0/2 exit policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        runner 가 빌드된 CliRuntime + commander 검증 통과 인자로 이 명령 action 을 호출. --yes
        미지정 시 commander 가 사전 거부.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:

        ```jsonc

        // stdout shape for `ed reset --yes`

        { cardsDeleted: number, glossaryCleared: boolean, failedFileDeletes:
        string[] }
                // failedFileDeletes 는 best-effort file unlink 실패한 카드 파일 경로. 비어있으면 reset 완전 성공.
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): 모든 카드 삭제 + glossary clear 성공 (failedFileDeletes 빈 배열).

                - 2 (EXIT.VALIDATION_FAILURE): DB 는 정합 (cards/glossary 모두 cleared) 이지만 일부 .md 파일 unlink 실패 (failedFileDeletes 채워짐 — 후속 수동 정리 필요).
        - thrown 매핑: 없음 (IO 실패는 부모 runner 의 일반 매핑 → exit 5).
        - --yes 누락 시 commander 거부 → exit 2 (runner-commander-fallback).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: '--yes 플래그 누락.'
      behavior: >-
        commander 가 사전 거부 → runner-commander-fallback 경로 stderr `{level:'error',
        code:'cli-usage-error', ...}` + exit 2.
---
