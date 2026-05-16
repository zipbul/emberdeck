---
key: cli-surface/command-routing-and-output/commands/card-get
summary: >-
  Per-command CLI-shape spec for 'ed card get <key>'; declares flat frontmatter
  stdout shape (POST-001) and 0/3 exit policy (POST-002).
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
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 CardFrontmatter 필드를 root
        에 flat 화한 다음 shape:

        ```jsonc

        // stdout shape for `ed card get <key>` — CardFrontmatter flat (no
        `frontmatter` wrapper) + sync 메타

        {
          key, summary, status, type, parent: string|null,
          glossary: string[],
          relations?: string[],
          tags?: string[],
          principle?, domain?, brief?, spec?,   // type 별 namespace body (CardFrontmatter 와 동일)
          filePath, updatedAt,                  // sync 메타 (CardRow 에서)
          history?: {
            entries: {
              field: string,         // 'summary'|'type'|'status'|'parent'|'relations'|'tags'|'glossary' 또는 namespace body
              oldValue: string|null,
              newValue: string|null,
              changedAt: string,
              changedBy: string
            }[]
          }
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): card 가 존재하고 frontmatter 조회 성공.
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
    - violation: 주어진 key 가 DB 에 없음.
      behavior: >-
        runner 가 CardNotFoundError 를 toCliError 로 매핑해 stderr 에 `{level:'error',
        code:'card-not-found', message, details?}` JSON-line 1줄 + exit 3.
---
