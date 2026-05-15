---
key: cli-surface/command-routing-and-output/commands/check-impact
summary: >-
  Per-command CLI-shape spec for 'ed check impact'; declares affectedCards +
  risk + dependency shape (POST-001) and exit 0 policy (POST-002).
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
        // stdout shape for `ed check impact <files...> [--symbol N...]`
        {
          riskLevel: 'low'|'medium'|'high'|'critical',
          affectedCards: {
            key, summary,
            linkType: 'direct'|'transitive',
            affectedLinks: number,
            via?: string,                                    // transitive 시 어느 direct 카드 경유
            linkStatus?: { valid: number, broken: number }   // direct 만 채워짐, transitive 는 undefined
          }[],
          newUncoveredFiles: string[],
          suggestedActions: string[],
          maxFanIn?: number,                                 // gildash 가용 시
          maxFanOut?: number,                                // gildash 가용 시
          directDependents?: string[]                        // input 파일들의 직접 importer
        }
        ```
    - id: POST-002
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
      guarantee: |-
        - 0 (EXIT.OK): impact report 항상 (read-only; 높은 riskLevel 도 실패 아님).
        - thrown 매핑: 없음 (read-only).
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: files 인자 0개 (commander 가 사전 거부).
      behavior: >-
        runner-commander-fallback 경로 stderr `{level:'error',
        code:'cli-usage-error', ...}` + exit 2.
---
