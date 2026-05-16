---
key: cli-surface/command-routing-and-output/commands/validate-cards
summary: >-
  Per-command CLI-shape spec for 'ed validate cards'; declares summary +
  items[].issues[] + fileLevelIssues[] shape (POST-001) and 0/2 exit policy
  (POST-002).
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
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed validate cards`
        {
          summary: { total: number, byCode: Record<string, number> },   // 키는 kebab 에러 코드 값
          // summary.byCode 는 items[].issues + fileLevelIssues 모두 합산
          // summary.total === sum(items[i].issues.length) + fileLevelIssues.length
          items: {
            key,
            filePath?,
            issues: {
              code: 'orphan-card'
                  | 'broken-parent'
                  | 'type-hierarchy-violation'
                  | 'broken-cross-domain-dep'
                  | 'broken-relation'
                  | 'rework-dependency'
                  | 'empty-tree'
                  | 'content-mismatch'
                  | 'glossary-broken'
                  | 'glossary-unused'
                  | 'broken-chain',
              message: string,
              details?: Record<string, unknown>   // 안 키는 camelCase
            }[]
          }[],
          fileLevelIssues: {
            code: 'orphan-file'
                | 'stale-db-row'
                | 'key-mismatch',
            message: string,
            filePath: string,
            key?: string
          }[]
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): summary.total === 0 (모든 카드 정합).

        - 2 (EXIT.VALIDATION_FAILURE): summary.total > 0 (위반 1건 이상; data 는 정상
        emit, exit 만 2).

        - thrown 매핑: 없음 (read-only); 빌드/IO 에러는 부모 runner 의 일반 매핑.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 정합 위반 1건 이상 (items[].issues 또는 fileLevelIssues 비어있지 않음).
      behavior: stdout 정상 data emit + exit 2; stderr 무출력 (data 채널이 진단).
---
