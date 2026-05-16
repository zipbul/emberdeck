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
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): sync 는 fact-recording; unmatched/markerMissing 은 진단이지 실패
        아님.

        - thrown 매핑: op 자체 (syncSpecAnnotations) 는 throw 하지 않음. 단, runner 의
        buildRuntime → setupEmberdeck 단계에서 gildash 초기화 실패 시 GildashInitError → 6
        (EXIT.CONFIG_MISSING). 그 외 DB write/sqlite IO 실패 → toCliError default
        branch → `internal-error` exit 1.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: gildash 초기화 실패 (projectRoot 미존재 / indexable 소스 부재 / gildash open 에러).
      behavior: >-
        GildashInitError → stderr `{level:'error', code:'gildash-init-failed',
        message}` + exit 6 (EXIT.CONFIG_MISSING). runner 의 buildRuntime 단계에서 발생.
    - violation: DB write 또는 sqlite IO 실패 (op-level).
      behavior: >-
        stderr `{level:'error', code:'internal-error', message,
        details:{class}}` + exit 1 (toCliError default branch). 별도 IO 에러 클래스 도입
        후에는 `permission`/`io-error` exit 5 로 매핑 가능.
---
