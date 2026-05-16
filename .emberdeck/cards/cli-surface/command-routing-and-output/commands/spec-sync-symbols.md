---
key: cli-surface/command-routing-and-output/commands/spec-sync-symbols
summary: >-
  Per-command CLI-shape spec for 'ed spec sync-symbols'; declares applied /
  skipped (4 reasons) / sinceSource / nextSyncMarker shape (POST-001) and exit 0
  policy (POST-002).
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
        // stdout shape for `ed spec sync-symbols [--since TS]`
        {
          applied: { cardKey, oldSymbol, newSymbol, file, changeType: 'renamed'|'moved' }[],
          skipped: {
            // 4개 reason 의 canonical 정의는 여기 (§1.7). op 의 SymbolSyncResult.skipped 는 처음 3개만 만듦;
            // CLI 가 `metadata-write-failed` 추가 (op 의 metadata upsert 실패 시).
            reason: 'no-links-referencing-old-symbol'
                  | 'symbol-removed-manual-review-required'
                  | 'card-not-found'
                  | 'metadata-write-failed',
            symbol?: string, file?: string,
            details?: Record<string, unknown>    // 모든 키 camelCase (D9)
          }[],
          total: number,            // applied.length + skipped.length
          since: string,            // 사용된 ISO8601 watermark
          sinceSource: 'flag'|'last-sync'|'default-24h',
          nextSyncMarker: string|null   // metadata upsert 실패 시 null
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): sync 항상 (skipped 는 실패 아님; metadata-write-failed 는
        nextSyncMarker:null 로만 표현).

        - thrown 매핑: 없음.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: '--since 가 ISO8601 형식 위반.'
      behavior: >-
        commander 가 사전 거부 → runner-commander-fallback 경로로 stderr
        `{level:'error', code:'cli-usage-error', ...}` + exit 2.
---
