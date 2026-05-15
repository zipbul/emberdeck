---
key: cli-surface/command-routing-and-output/commands/check-coverage
summary: >-
  Per-command CLI-shape spec for 'ed check coverage' (3 modes: card / uncovered
  / suggest); declares mode-specific shapes (POST-001a/b/c) and 0/3 exit policy
  (POST-002).
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        runner 가 빌드된 CliRuntime + commander 검증 통과 인자로 이 명령 action 을 호출. 모드는 인자에
        따라 결정: <key> 위치 인자 → 'card'; --uncovered → 'uncovered'; --suggest →
        'suggest'.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001a
      guarantee: >-
        mode='card' (`ed check coverage <key>`): 성공 시 `data` 는 다음 shape:

        ```jsonc

        // 현재 op `getLinkCoverage` 가 만드는 link-coverage shape.

        // unreferencedSymbols 는 전체 array (CLI 의 slice(0, 100) 제거 — caller 가 jq
        로 자름).

        { key, declared, resolved, broken, coverageRatio: number,
          unreferencedSymbols: { file, symbol, kind }[],    // 전체
          unreferencedTotal: number }                        // === unreferencedSymbols.length
        ```

        의미 전환 (link-coverage → symbol-coverage) 은 §6 분리된 결정. 카드 본문에는 위 shape
        하나만.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001b
      guarantee: >-
        mode='uncovered' (`ed check coverage --uncovered`): 성공 시 `data` 는 다음
        shape:

        ```jsonc

        // uncovered 전체 array (CLI 의 slice(0, 100) 제거).

        { totalSymbols, coveredSymbols, coverageRatio: number|null,
          uncovered: { file, symbol, kind }[],    // 전체
          uncoveredTotal: number }                 // === uncovered.length
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-001c
      guarantee: |-
        mode='suggest' (`ed check coverage --suggest`): 성공 시 `data` 는 다음 shape:
        ```jsonc
        {
          suggestions: {
            key,                                           // op 의 suggestedKey
            type: 'domain'|'brief'|'spec',
            parent?: string,
            files: string[],                               // op 의 array 그대로 (count 변환 X)
            symbols: { file, symbol, kind }[],             // op 의 array 그대로
            reason: string,
            suggestedGlossary?: string[]
          }[],
          total
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): 세 모드 모두 성공 시 (coverage 결과 또는 빈 array 포함 정상 emit).

        - thrown 매핑 (mode='card' 만): CardNotFoundError → 3 (EXIT.NOT_FOUND).
        mode='uncovered'/'suggest' 는 thrown 매핑 없음.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: mode='card' 에서 주어진 key 가 DB 에 없음.
      behavior: stderr `{level:'error', code:'card-not-found', message}` + exit 3.
---
