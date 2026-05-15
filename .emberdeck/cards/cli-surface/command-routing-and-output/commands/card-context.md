---
key: cli-surface/command-routing-and-output/commands/card-context
summary: >-
  Per-command CLI-shape spec for 'ed card context'; declares flat frontmatter +
  upstream/downstream/parentChain/codeLinks shape (POST-001) and 0/3 exit policy
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
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
      guarantee: |-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:
        ```jsonc
        // stdout shape for `ed card context <key> [--depth N]`
        {
          key,
          // card.frontmatter 의 핵심 필드 (card get 과 동일 layout 으로 root flat):
          summary, status, type, parent: string|null,
          glossary: string[], relations?: string[], tags?: string[],
          principle?, domain?, brief?, spec?,
          upstream:   CardSummary[],
          downstream: CardSummary[],
          parentChain: CardSummary[],           // root → 현 카드 직전 (op 가 직접 반환, OP-12)
          related?: { card: CardSummary, depth: number, direction: 'forward'|'backward' }[],   // depth>1 시 BFS
          truncated?: boolean,
          codeLinks: { resolved: number, total: number }
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): context 조회 성공.
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
