---
key: cli-surface/command-routing-and-output/commands/card-rename
summary: >-
  Per-command CLI-shape spec for 'ed card rename'; declares old/new path +
  failedReferenceUpdates shape (POST-001) and 0/2/3/4 exit policy (POST-002).
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

        // stdout shape for `ed card rename <old> <new>`

        {
          oldKey, newKey, oldPath, newPath,
          failedReferenceUpdates: { cardKey: string, reason: string }[]
        }

        // failedReferenceUpdates 의 reason 은 op 보강 (OP-11) — 현재 op 의 catch block
        이 error 메시지를 버리므로 보강 후 채워짐.

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): rename 성공 + 모든 reference 업데이트 통과
        (failedReferenceUpdates.length === 0).

        - 2 (EXIT.VALIDATION_FAILURE): failedReferenceUpdates.length > 0 (data 는
        정상 emit, 부분 실패 신호로 exit 2).

        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND);
        CardAlreadyExistsError → 4 (EXIT.CONFLICT) (newKey 충돌).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 참조 업데이트가 일부 카드에서 실패 (file write 등).
      behavior: >-
        stdout 은 정상 data shape (failedReferenceUpdates 채워짐) + exit 2; stderr 무출력
        (data 채널이 진단을 담음).
    - violation: key 에 해당하는 카드 미존재
      behavior: CardNotFoundError → stderr {code:'card-not-found', message} + exit 3.
    - violation: newKey 가 이미 존재하는 다른 카드 키
      behavior: >-
        CardAlreadyExistsError → stderr {code:'card-already-exists', message} +
        exit 4.
---
