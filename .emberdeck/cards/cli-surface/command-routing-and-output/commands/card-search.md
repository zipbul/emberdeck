---
key: cli-surface/command-routing-and-output/commands/card-search
summary: >-
  Per-command CLI-shape spec for 'ed card search'; declares FTS5 items with
  snippet/rank shape (POST-001) and 0/2 exit policy (POST-002).
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
        // stdout shape for `ed card search <query>`
        // op `searchCards` 가 FTS5 매칭. OP-10 가 snippet/rank 항상 반환 (모든 매치에).
        {
          items: {
            ...CardSummary,           // key, summary, type, status, parent
            snippet: string,           // FTS5 snippet (매치 위치 짧은 발췌)
            rank: number               // BM25 score (낮을수록 강함)
          }[],
          total
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): FTS5 쿼리 성공 (빈 결과 포함).
        - thrown 매핑: FtsSyntaxError → 2 (EXIT.VALIDATION_FAILURE).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 'query 가 FTS5 문법 위반 (예: 닫히지 않은 인용부호).'
      behavior: stderr `{level:'error', code:'fts-syntax-error', message}` + exit 2.
---
