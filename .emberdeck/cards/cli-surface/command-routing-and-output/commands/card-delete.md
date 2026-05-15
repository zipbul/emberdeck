---
key: cli-surface/command-routing-and-output/commands/card-delete
summary: >-
  Per-command CLI-shape spec for 'ed card delete'; declares detached-children +
  removed-refs shape (POST-001) and 0/3/4 exit policy (POST-002).
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
        // stdout shape for `ed card delete <key> [--force] [--yes]`
        {
          key, filePath,
          detachedChildren: string[],          // --force 시 parent=null 로 변경된 자식 키. force=false 면 [] (자식 없을 때만 성공)
          removedCrossDomainRefs: string[]     // --force 시 cross_domain_dependencies 에서 이 키 참조가 제거된 도메인 카드 키. force=false 면 []
        }
        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): 삭제 성공 (파일 unlink + DB row delete + 자식 detach + cross-ref
        정리).

        - thrown 매핑: CardNotFoundError → 3 (EXIT.NOT_FOUND);
        CardHasDependentsError / ConflictError → 4 (EXIT.CONFLICT) (force 없이
        자식/참조 존재 시).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: force=false 인데 자식 카드 또는 cross_domain_dependencies 참조 존재.
      behavior: >-
        stderr `{level:'error', code:'card-has-dependents', message, details?}`
        + exit 4.
    - violation: key 에 해당하는 카드 미존재
      behavior: CardNotFoundError → stderr {code:'card-not-found'} + exit 3.
---
