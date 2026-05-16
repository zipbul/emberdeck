---
key: cli-surface/command-routing-and-output/commands/analyze
summary: >-
  Per-command CLI-shape spec for 'ed analyze'; declares
  health/coverage/drifted/glossary/unlinkedSymbols composite shape (POST-001)
  and exit 0 policy (POST-002).
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

        // stdout shape for `ed analyze [--drifted-limit N] [--drifted-offset
        N]`

        {
          health: {
            total, active, drifted, draft, brokenLinks,
            codeStats?: { files: number, symbols: number },
            codeCycles?: {
              count: number,                  // 전체 cycle 수
              samples: string[][]             // 최대 op 의 MAX_CYCLE_SAMPLES 만큼. count 는 전체.
            }
          },
          coverage: { totalSymbols, coveredSymbols, coverageRatio: number|null },    // 다른 명령과 통일
          drifted: {
            cards: { key, summary, driftType?, brokenLinks, totalLinks }[],
            total,
            limit: number,                                                            // --drifted-limit (default: total)
            offset: number,                                                            // --drifted-offset (default: 0)
            hasMore: boolean
          },
          glossary: { unusedWords: string[], entries: { word, definition }[] },   // 총 단어 수는 entries.length
          unlinkedSymbols: { file, symbol, kind }[]   // op 의 UNLINKED_SYMBOLS_LIMIT (현재 20) 만큼
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: |-
        - 0 (EXIT.OK): analyze report 항상 (read-only; 어떤 결과도 실패 아님).
        - thrown 매핑: 없음 (read-only).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: '--drifted-limit/--drifted-offset 가 음수.'
      behavior: >-
        commander 가 사전 거부 → runner-commander-fallback 경로 stderr `{level:'error',
        code:'cli-usage-error', ...}` + exit 2.
---
