---
key: cli-surface/command-routing-and-output/commands/init
summary: >-
  Per-command CLI-shape spec for 'ed init'; declares scaffold paths +
  created/skipped shape (POST-001) and exit 0 policy (POST-002).
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        runner 가 빌드된 CliRuntime + commander 검증 통과 인자로 이 명령 action 을 호출. (init 은
        emberdeck 프로젝트 미존재 상태에서도 호출 가능 — 부모 runner 가 init 특수경로 처리.)
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 다음 shape:

        ```jsonc

        // stdout shape for `ed init [--project-root] [--cards-dir]
        [--no-gitignore] [--force]`

        {
          projectRoot: string,      // 절대 경로
          cardsDir:    string,      // 절대 경로
          configPath:  string,      // 절대 경로
          glossaryPath:string,      // 절대 경로
          created: string[],        // cwd 기준 상대 경로 (사람이 읽기 친화)
          skipped: string[],        // cwd 기준 상대 경로 (이미 존재해서 건너뜀)
          gitignoreUpdated: boolean
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): scaffold 항상 성공 (idempotent; 이미 존재 → skipped, --force 시
        덮어쓰기).

        - thrown 매핑: 명령 자체는 emberdeck 에러 클래스를 throw 하지 않음. node fs error
        (mkdir/writeFile/readFile/appendFile/stat 의 NodeJS.ErrnoException) 는
        toCliError default branch → `internal-error` exit 1. 별도 IO 에러 클래스 도입 시
        `permission` 또는 `io-error` (exit 5) 매핑 가능 — 별도 PR.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        부모 spec runner-and-output 의 INV-001~005 (stderr JSON-line 스키마 / stdout
        disjoint / 엔벨로프 미사용 / --quiet 동작 / failure 시 stdout 무출력) 를 모두 상속.
      always_holds: per-call
  failures:
    - violation: 디렉터리 write permission 부재 또는 일반 fs IO 실패.
      behavior: >-
        stderr `{level:'error', code:'internal-error', message,
        details:{class}}` + exit 1 (node fs error → toCliError default branch).
        별도 IO 에러 클래스 도입 후에는 `permission`/`io-error` exit 5 로 매핑 가능.
---
