# Envelope-Removal Redesign — Executable Plan v3

> **Status**: Phase 1.1 ✅ + Phase 1.2 ✅ (commits `072d2c7`, `f96a50d`). Phase 1.2.5 / 1.3 / 1.4 / 2 / 3 / 4 pending.
> **Principle**: §1.7 의 per-command shape 이 SoT. 코드는 §1.7 에 맞춘다. 각 명령은 자기 기능 카테고리에 자연스러운 shape 을 가진다.

---

## 0. 목적

emberdeck CLI 의 v1 envelope `{schemaVersion, status, data, warnings, errors, error?}` 제거. 각 명령은 자신의 자연 JSON shape 을 stdout 에 emit, stderr 는 JSON-lines 진단, exit code 는 per-command policy.

요구: **모든 CLI 기능에 각자 최적화된 스키마를 노출** (= 카드 SSOT 로 명시).

---

## 1. 최종 설계

### 1.1 채널 책임

| 채널 | 내용 | 형식 |
|---|---|---|
| **stdout** (성공 / data 동반 policy-failure) | 명령의 자연 data shape | JSON 단일 값 |
| **stdout** (thrown 실패) | 비어 있음 | n/a |
| **stderr** (상시) | 진단 | JSON-lines, 한 줄 한 객체 |
| **exit code** | 명령별 policy + runner 매핑 | `EXIT` enum |

**stderr JSON-line schema** (모든 stderr emit 의 단일 형식):
```
{"level": "error" | "warning" | "verbose", "code": string, "message": string, "details"?: Record<string, unknown>}
```

stderr free-text 금지. 소비자는 줄 단위 `JSON.parse`. 형식 위반 = 버그.

### 1.2 제거 대상 (`src/cli/output.ts`, `src/cli/runner.ts`)

- Types: `CliResult`, `CliMessage`, `CliError`
- Constants: `SCHEMA_VERSION`, `ERROR_CODE_TO_EXIT` (errors.ts 로 이동)
- Functions: `ok()`, `partial()`, `err()`, `unknown()`, `render()`, `statusToExitCode()`, `resolveOutputMode()`, `mergeCardSyncWarnings()`, `classifyErrorStatus()`
- Envelope 키: `schemaVersion`, `status`, `data` 래퍼, top-level `warnings`, top-level `errors`, `error?`

### 1.3 새 `output.ts`

```ts
import { EXIT, type ExitCode } from './exit-codes';

export interface OutputContext { quiet: boolean }
export function buildOutputContext(flags: { quiet?: boolean }): OutputContext {
  return { quiet: !!flags.quiet };
}

/** stdout 에 data 1회 emit. quiet 면 compact, 아니면 2-space pretty.
 *  write callback drain 까지 await — `process.exit` 가 큰 payload 잘리는 것 방지.
 *  EPIPE 는 UNIX 관례대로 무시. 그 외 IO 에러 / encode 에러 → runner 가 stderr 한 줄 + exit. */
export async function emitResult(data: unknown, ctx: OutputContext): Promise<void> {
  const payload = JSON.stringify(data, null, ctx.quiet ? undefined : 2) + '\n';
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (err) => {
      if (!err) return resolve();
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return resolve();
      reject(err);
    });
  });
}

export function emitWarning(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'warning', ...obj });
}
export function emitError(obj: { code: string; message: string; details?: Record<string, unknown> }): void {
  emitLine({ level: 'error', ...obj });
}
export function emitVerbose(message: string, details?: Record<string, unknown>): void {
  emitLine({ level: 'verbose', code: 'RUNTIME', message, ...(details ? { details } : {}) });
}

function emitLine(obj: { level: 'error' | 'warning' | 'verbose'; code: string; message: string; details?: Record<string, unknown> }): void {
  try { process.stderr.write(JSON.stringify(obj) + '\n'); }
  catch { /* stderr EPIPE — silent */ }
}
```

`JSON.stringify` 가 실패하면 (BigInt / circular) 던진 예외가 runner 의 try/catch 로 올라가서 `OUTPUT_ENCODE_FAILED` JSON-line + exit 1 매핑. stdout write 의 비-EPIPE IO 에러도 동일 경로로 `STDOUT_WRITE_FAILED` + exit 5.

### 1.4 Command-runner 계약

```ts
export type CommandReturn = { data?: unknown; exitCode?: number } | undefined;
```

- `{ data: D }` → runner 가 `D` 를 stdout emit, exit `EXIT.OK` (0).
- `{ data: D, exitCode: 2 }` → `D` emit + exit 2 (policy 실패 + data).
- `undefined` 또는 `{ data: undefined }` → stdout 무 출력, exit `EXIT.OK`. (v2 의 모든 명령은 `{data}` 반환 권장 — `{}` 라도.)
- throw → runner 가 catch, `toCliError` → stderr `level:'error'` JSON-line + 매핑 exit code.
- 명령은 `process.exit` 호출 금지. runner 가 lifecycle (cleanup, SIGINT, exit) 소유.

각 명령의 CLI-shape spec 카드가 해당 명령이 반환할 수 있는 *policy* exit code 를 나열. 전역 thrown→exit 매핑은 상속.

### 1.5 EXIT enum

```ts
export const EXIT = {
  OK: 0,
  GENERIC_ERROR: 1,
  VALIDATION_FAILURE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  PERMISSION_OR_IO: 5,
  CONFIG_MISSING: 6,
  TRANSIENT: 7,
  SIGINT: 130,
};
```

### 1.6 Per-command CLI-shape spec 카드 (신규 32개)

신규 spec 카드 family `cli-surface/command-routing-and-output/commands/<key>`, parent = `cli-surface/command-routing-and-output` (1.2 에서 갱신된 brief).

| spec 카드 키 | 명령 | 소스 파일 |
|---|---|---|
| `.../commands/card-get` | `ed card get` | `src/cli/commands/card.ts` |
| `.../commands/card-list` | `ed card list` | `src/cli/commands/card.ts` |
| `.../commands/card-create` | `ed card create` | `src/cli/commands/card.ts` |
| `.../commands/card-update` | `ed card update` | `src/cli/commands/card.ts` |
| `.../commands/card-delete` | `ed card delete` | `src/cli/commands/card.ts` |
| `.../commands/card-rename` | `ed card rename` | `src/cli/commands/card.ts` |
| `.../commands/card-search` | `ed card search` | `src/cli/commands/card.ts` |
| `.../commands/card-export` | `ed card export` | `src/cli/commands/card.ts` |
| `.../commands/card-set-status` | `ed card set-status` | `src/cli/commands/card.ts` |
| `.../commands/card-tree` | `ed card tree` | `src/cli/commands/card.ts` |
| `.../commands/card-context` | `ed card context` | `src/cli/commands/card.ts` |
| `.../commands/card-relations` | `ed card relations` | `src/cli/commands/card.ts` |
| `.../commands/validate-cards` | `ed validate cards` | `src/cli/commands/validate.ts` |
| `.../commands/validate-links` | `ed validate links` | `src/cli/commands/validate.ts` |
| `.../commands/validate-aggregate` | `ed validate` | `src/cli/commands/validate.ts` |
| `.../commands/check-drift` | `ed check drift` | `src/cli/commands/check.ts` |
| `.../commands/check-coverage` | `ed check coverage` (+--uncovered/--suggest) | `src/cli/commands/check.ts` |
| `.../commands/check-impact` | `ed check impact` | `src/cli/commands/check.ts` |
| `.../commands/check-regression` | `ed check regression` | `src/cli/commands/check.ts` |
| `.../commands/check-interactions` | `ed check interactions` | `src/cli/commands/check.ts` |
| `.../commands/spec-sync` | `ed spec sync` | `src/cli/commands/spec.ts` |
| `.../commands/spec-sync-symbols` | `ed spec sync-symbols` | `src/cli/commands/spec.ts` |
| `.../commands/bulk-create` | `ed bulk create --from FILE` | `src/cli/commands/bulk.ts` |
| `.../commands/bulk-sync` | `ed bulk sync` | `src/cli/commands/bulk.ts` |
| `.../commands/glossary-define` | `ed glossary define` | `src/cli/commands/glossary.ts` |
| `.../commands/glossary-lookup` | `ed glossary lookup` | `src/cli/commands/glossary.ts` |
| `.../commands/glossary-remove` | `ed glossary remove` | `src/cli/commands/glossary.ts` |
| `.../commands/glossary-rename` | `ed glossary rename` | `src/cli/commands/glossary.ts` |
| `.../commands/init` | `ed init` | `src/cli/commands/single.ts` |
| `.../commands/analyze` | `ed analyze` | `src/cli/commands/single.ts` |
| `.../commands/reset` | `ed reset` | `src/cli/commands/single.ts` |
| `.../commands/runner-commander-fallback` | commander 에러 폴백 (subcommand 아님) | `cli.ts` + `src/cli/index.ts` |

### 1.7 Per-command shapes (final, 카드 POST-001 에 들어갈 내용)

각 shape 은 그 명령 카드의 POST-001 `guarantee:` 본문에 fenced JSON 블록으로 들어감. 공통 invariant (stdout JSON 1회 / stderr JSON-line / --quiet 동작 / failure 시 stdout 없음) 은 부모 spec `runner-and-output` 에 한 번만 선언, 32 카드 복붙 X (§3 Phase 1.3 참조).

**네이밍 규약**: 모든 JSON 프로퍼티 (top-level 및 `details` bag 등 nested 모두) camelCase. 자세한 규약 표는 §2 D9.

**공통 inline 타입** (한 번 정의, 여러 shape 에서 참조):

```
CardRow = {
  key, summary, status: 'draft'|'active'|'drifted'|'retired',
  type: 'principle'|'domain'|'brief'|'spec', parent: string|null,
  namespacesJson: string|null, body: string|null,
  glossaryJson: string,  // JSON-encoded string[]
  filePath, updatedAt    // ISO8601
}

CardSummary = {  // lightweight CardRow (relations/context 노출용)
  key, summary, type, status, parent: string|null
}

TreeNode = {
  key, type, status, summary, depth: number,
  truncated?: boolean,        // maxDepth 에 걸려 자식 잘림
  children: TreeNode[]
}
```

**`CardFile` 명칭은 §1.7 안에서 사용하지 않는다** — 코드 (`src/card/types.ts:318`) 의 `CardFile = {frontmatter, filePath?}` wrapper 와 의미 충돌하기 때문. 명령 출력 shape 으로 frontmatter 가 flat 노출되는 곳 (`card get`, `card context`) 은 그 명령 정의에서 필드를 직접 나열한다.

shape 정의:

```
ed card get <key>
  // CardFrontmatter 의 필드들이 root 에 flat (no `frontmatter` 래퍼) + sync 메타.
  {
    key, summary, status, type, parent: string|null,
    glossary: string[],
    relations?: string[],
    tags?: string[],
    principle?, domain?, brief?, spec?,   // type 별 namespace body (CardFrontmatter 와 동일)
    filePath, updatedAt,                  // sync 메타 (CardRow 에서)
    history?: {
      // op `getCard` 의 changelog rows (ChangelogRow). field 는 변경된 frontmatter 키.
      entries: {
        field: string,         // 'summary' | 'type' | 'status' | 'parent' | 'relations' | 'tags' | 'glossary' | namespace body 등
        oldValue: string|null, // 이전 값 (직렬화; 배열은 JSON 문자열)
        newValue: string|null, // 새 값
        changedAt: string,     // ISO8601
        changedBy: string      // 'agent' 등
      }[]
    }
  }
  exit: 0; thrown→3 (CardNotFoundError).

ed card list [filters] [--limit N] [--offset N]
  // op `listCards` 는 이미 `CardSummaryRow[]` (body 제거) 반환. CLI 가 추가로 lightweight 사영.
  { items: CardSummary[], total, limit, offset, hasMore }
  exit: 0.

ed card create <key> --type T [...]
  { key, filePath, status, type, parent: string|null }
  exit: 0; thrown→4 (CardAlreadyExistsError).

ed card update <key> [--field, --patch, --glossary, --tag]
  { key, filePath, status,
    validationNotes: string[] }      // 비-치명 field warnings (예: 'status changed to draft because type changed')
  exit: 0; thrown→3, 2.

ed card delete <key> [--force] [--yes]
  {
    key, filePath,
    detachedChildren: string[],          // --force 시 parent=null 로 변경된 자식 키. force=false 면 [] (자식 없을 때만 성공)
    removedCrossDomainRefs: string[]     // --force 시 cross_domain_dependencies 에서 이 키 참조가 제거된 도메인 카드 키. force=false 면 []
  }
  exit: 0; thrown→3, 4.

ed card rename <old> <new>
  // failedReferenceUpdates 의 reason 은 op 보강 (OP-11) — 현재 op 의 catch block 이 error 메시지 버림.
  {
    oldKey, newKey, oldPath, newPath,
    failedReferenceUpdates: { cardKey: string, reason: string }[]
  }
  exit: 0 if no failures; 2 if any failedReferenceUpdates; thrown→3, 4.

ed card search <query>
  // op `searchCards` 가 FTS5 매칭. OP-10 가 snippet/rank 항상 반환 (모든 매치에).
  {
    items: {
      ...CardSummary,           // key, summary, type, status, parent
      snippet: string,           // FTS5 snippet (매치 위치 짧은 발췌)
      rank: number               // BM25 score (낮을수록 강함)
    }[],
    total
  }
  exit: 0; thrown→2 (FtsSyntaxError).

ed card export <key> [--out FILE | --in-place]
  // OP-15 가 exportCardToFile 을 `{filePath, bytes}` 반환으로 변경, 모든 모드 bytes 일관.
  { key, mode: 'in-place'|'file'|'stdout',
    filePath?: string,    // mode='file'|'in-place'
    bytes: number,         // 모든 모드 (직렬화된 content 의 byte 길이)
    content?: string }     // mode='stdout' 만 (jq 친화)
  exit: 0; thrown→3.

ed card set-status <key> <status> [--reason TEXT]
  { key, oldStatus, newStatus }
  exit: 0; thrown→3, 2 (activation guard).

ed card tree <key> [--depth N]
  TreeNode  // root 그대로
  exit: 0; thrown→3.

ed card context <key> [--depth N]
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
  exit: 0; thrown→3.

ed card relations <key>
  // 관계 그래프 lightweight. op `listCardRelations` 가 직접 `CardSummary[]` 반환 (OP-13).
  {
    key,
    forward: CardSummary[],     // 이 카드 → 다른 카드
    reverse: CardSummary[],     // 다른 카드 → 이 카드
    total: number
  }
  exit: 0; thrown→3.

ed validate cards
  {
    summary: { total: number, byCode: Record<string, number> },   // 키는 kebab 에러 코드 값
    // summary.byCode 는 items[].issues + fileLevelIssues 모두 합산
    // summary.total === sum(items[i].issues.length) + fileLevelIssues.length
    items: {
      key,
      filePath?,
      issues: {
        // op `sync.ts:validateCards` 가 만드는 ValidationWarning.type 그대로 (이미 kebab).
        code: 'orphan-card'           // parent 가 존재하지 않음
            | 'broken-parent'         // parent 키가 DB 에 없음 (orphan 의 변종)
            | 'type-hierarchy-violation' // 4-tier 규칙 위반 (예: spec 의 parent 가 principle)
            | 'broken-cross-domain-dep'  // cross_domain_dependencies 가 가리키는 카드 없음/타입 mismatch
            | 'broken-relation'       // relations 배열 안 dead 키
            | 'rework-dependency'     // drifted 부모/관계 카드에 의존 — 재작업 트리거
            | 'empty-tree'            // domain/brief 인데 자식 카드 0
            | 'content-mismatch'      // DB row 와 파일 frontmatter 가 다름 (auto-sync 누락)
            | 'glossary-broken'       // 카드의 glossary 단어가 glossary.yaml 에 없음
            | 'glossary-unused'       // glossary 에 있는 단어 중 어느 카드도 안 씀
            | 'broken-chain',         // spec 의 brief 체인이 끊김
        message: string,
        details?: Record<string, unknown>   // 안 키는 camelCase
      }[]
    }[],
    fileLevelIssues: {
      code: 'orphan-file'      // DB row 없는 파일 (key 없음)
          | 'stale-db-row'     // 파일 사라진 DB row (context 용 key 있음)
          | 'key-mismatch',    // frontmatter key != 경로 슬러그 (둘 다 담음, key? 옵셔널)
      message: string,
      filePath: string,
      key?: string
    }[]
  }
  exit: 0 if summary.total===0; else 2.

ed validate links [key]
  {
    summary: { total, ok, broken, skipped, ioFailed },
    items: {
      key, declared, resolved,
      brokenLinks?:  { file, symbol, reason: 'gildash-unavailable'|'symbol-not-found' }[],
      plannedLinks?: { file, symbol, reason: 'gildash-unavailable'|'symbol-not-found' }[],  // draft 카드의 broken — broken 으로 카운트 X
      skipped?: { reason: 'key-mismatch' },
      ioError?: { message }
    }[]
  }
  exit: 0 if summary.broken===0 && summary.ioFailed===0; else 2.   // plannedLinks 는 exit 에 영향 X (draft 의 의도된 미완성)

ed validate
  { cards: <validate cards shape>, links: <validate links shape> }
  exit: 0 if 두 sub 가 0; else 2.

ed check drift [key] [--max-depth N]
  {
    health: { total, active, drifted, draft },
    cards: { key, summary, status, driftType?, driftTypes?, brokenLinks, totalLinks }[]
    // 총 drift 카드 수는 `cards.filter(c => c.driftType).length` 로 derive
  }
  exit: 0 (read-only).

ed check coverage <key>            // mode='card'
ed check coverage --uncovered      // mode='uncovered'
ed check coverage --suggest        // mode='suggest'
  (3 모드 — 카드의 POST-001 을 POST-001a/b/c 로 분할, 각자 shape 선언)

  POST-001a (mode='card'):
    // 현재 op `getLinkCoverage` 가 만드는 link-coverage shape.
    // unreferencedSymbols 는 전체 array (CLI 의 slice(0, 100) 제거 — caller 가 jq 로 자름).
    { key, declared, resolved, broken, coverageRatio: number,
      unreferencedSymbols: { file, symbol, kind }[],    // 전체
      unreferencedTotal: number }                        // === unreferencedSymbols.length
    exit: 0; thrown→3 (CardNotFoundError).
    // 의미 전환 (link-coverage → symbol-coverage) 은 §6 분리된 결정. 카드 본문에는 위 shape 하나만.

  POST-001b (mode='uncovered'):
    // uncovered 전체 array (CLI 의 slice(0, 100) 제거).
    { totalSymbols, coveredSymbols, coverageRatio: number|null,
      uncovered: { file, symbol, kind }[],    // 전체
      uncoveredTotal: number }                 // === uncovered.length
    exit: 0.

  POST-001c (mode='suggest'):
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
    exit: 0.

ed check impact <files...> [--symbol N...]
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
  exit: 0.

ed check regression <files...>
  {
    passOrFail: 'pass'|'fail',
    driftedRatio: number,
    threshold: number,
    affected: { key, status, driftType? }[]
  }
  exit: 0 if 'pass'; else 2.

ed check interactions <keys...>
  {
    interactions: {
      pair: [string, string],
      sharedSymbols: { file, symbol }[],
      sharedFiles: string[],
      importDependencies: { from, to, file }[],
      hasRelation: boolean,
      potentialConflicts: string[]
    }[],
    undefinedRelations: { pair: [string, string], suggestion: string }[]
    // op 가 reason 안 만들기 때문에 §1.7 에 없음
  }
  exit: 0.

ed spec sync
  {
    alreadyLinked: number,                                    // 기존 link 와 매칭되어 skip 된 annotation 수
    linkMissing:   { cardKey, file, symbol }[],               // 새로 생성된 code link (= 옛 `created` 의 array form; op 의 `created: number` 와 동일 정보라 1개만 노출)
    unmatched:     { cardKey, file, symbol }[],               // 카드 못 찾은 annotation
    markerMissing: { cardKey, file, symbol }[]                // code link 있는데 source 의 @spec annotation 없음
  }
  exit: 0  // sync 는 fact-recording; unmatched/markerMissing 은 진단이지 실패 아님.

ed spec sync-symbols [--since TS]
  {
    applied: { cardKey, oldSymbol, newSymbol, file, changeType: 'renamed'|'moved' }[],
    skipped: {
      // 4개 reason 의 canonical 정의는 여기 (§1.7). op 의 SymbolSyncResult.skipped 는 처음 3개만 만듦; CLI 가 `metadata-write-failed` 추가 (op 의 metadata upsert 실패 시).
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
  exit: 0.

ed bulk create --from FILE
  {
    created: { inputIndex, key, filePath }[],
    failed:  { inputIndex, key?, error }[],
    total: number   // 입력 개수
  }
  exit: 0 if failed.length===0; else 2.

ed bulk sync [PATH]
  {
    synced: number,
    mode: 'file'|'directory',
    path: string,
    failed: { filePath: string, error: string }[]   // 성공 시 빈 배열. CLI 가 op 의 `error: unknown` 을 `errorMessage(e)` 로 string 변환.
  }
  exit: 0 if failed.length===0; else 2.

ed glossary define [pairs...] [--from f.yaml]
  { defined: { word, definition, action: 'created'|'updated' }[],
    failed:  { inputIndex, reason }[],
    total: number }
  exit: 0 if failed.length===0; else 2.
  // CLI 가 op 의 `validateGlossaryEntry` (src/ops/glossary.ts:48 의 함수) 를 재사용해서 per-entry 사전 검증.
  // 통과한 entry 만 일괄 `defineGlossary` 호출, 실패는 `failed[]` 누적. op 는 all-or-nothing throw 그대로.

ed glossary lookup [word]
  { entries: { word, definition }[], total: number }
  // word 인자: 0 또는 1 element. 무인자: 전체.
  exit: 0.

ed glossary remove <word>
  { word: string, affectedCardKeys: string[] }
  exit: 0; thrown→3 (GlossaryNotFoundError when word missing — errors.ts 의 분리 매핑); 2 (GlossaryValidationError 기타 검증).

ed glossary rename <old> <new> [--def TEXT]
  { oldWord, newWord, affectedCardKeys: string[],
    failedFileWrites?: string[] }
  exit: 0 if no failures; 2 if any failedFileWrites; thrown→3 (GlossaryNotFoundError when oldWord missing); 2 (GlossaryValidationError when newWord conflicts; 코드 매핑 §4 표 일치. 의미적 conflict 분리는 별도 `GlossaryConflictError` 도입 후 exit 4 로 변경 가능 — 별도 PR).

ed init [--project-root] [--cards-dir] [--no-gitignore] [--force]
  {
    projectRoot: string,      // 절대 경로
    cardsDir:    string,      // 절대 경로
    configPath:  string,      // 절대 경로
    glossaryPath:string,      // 절대 경로
    created: string[],        // cwd 기준 상대 경로 (사람이 읽기 친화)
    skipped: string[],        // cwd 기준 상대 경로 (이미 존재해서 건너뜀)
    gitignoreUpdated: boolean
  }
  exit: 0.

ed analyze [--drifted-limit N] [--drifted-offset N]
  {
    health: {
      total, active, drifted, draft, brokenLinks,
      codeStats?: { files: number, symbols: number },
      codeCycles?: {
        count: number,                  // 전체 cycle 수
        samples: string[][]             // 최대 op 의 MAX_CYCLE_SAMPLES 만큼 (현재 20). count 는 전체.
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
    unlinkedSymbols: { file, symbol, kind }[]   // op 의 UNLINKED_SYMBOLS_LIMIT (현재 20) 만큼 — agent context 부담 방지. 전체 count 는 `check coverage --uncovered` 로 별도 조회.
  }
  exit: 0.

ed reset --yes
  { cardsDeleted: number, glossaryCleared: boolean }
  // op 의 `dbReset: true` 는 항상 true 상수 (정보 0) — 제거.
  exit: 0.

runner-commander-fallback   // subcommand 아님; commander 에러 폴백
  data shape: 없음 (실패 경로 — stdout 무출력)
  stderr: 한 줄 `{level:'error', code:'cli-usage-error', message:<commander msg>}`
  exit: 0 for commander.help / commander.version; 2 (VALIDATION_FAILURE) 그 외 commander 에러
       (InvalidArgumentError / 누락 positional / 알 수 없는 옵션).
```

### 1.8 `--quiet`

`--quiet` 는 per-command JSON shape 을 바꾸지 않는다.
1. stdout: 동일 shape 의 compact JSON (single-line `JSON.stringify(data)`, no indent).
2. stderr: `level: 'warning'` / `level: 'verbose'` 라인 suppress.
3. stderr: `level: 'error'` 라인은 그대로 emit (실패는 항상 관측 가능해야 함). exit code 도 그대로.

소비자는 항상 stdout 을 카드의 declared shape 으로 parse. quiet 는 *포맷* 만 바꾼다.

---

## 2. Decisions (최종, revision history 없음)

**D1 — 카드 위치**: per-command shape 은 신규 카드 family `cli-surface/command-routing-and-output/commands/<key>` 의 POST-001 fenced JSON. op 카드는 unchanged.

**D2 — runner 계약**: 명령은 `{ data?, exitCode? }` 반환. runner 가 emit + cleanup + exit. `process.exit` 명령 호출 금지.

**D3 — stderr 형식**: 단일 JSON-line schema `{level, code, message, details?}`. free-text 금지.

**D4 — `card export --out -` (stdout 모드)**: `{key, mode:'stdout', bytes, content}` 로 JSON 안에 담음. 소비자 `JSON.parse(stdout).content`.

**D5 — quiet 동작**: §1.8 (compact JSON + warning/verbose suppress).

**D6 — 카드 POST 본문**: fenced JSON 블록. 프론트매터에 `response_shape` 같은 별도 필드 추가 X.

**D7 — JSON 항상**: `--json` 같은 플래그 추가 X. JSON 이 기본.

**D8 — exit code 매핑**: §1.5 EXIT enum + `ERROR_CODE_TO_EXIT` (errors.ts) 로 단일화.

**D9 — 네이밍 규약** (전 영역 일관 적용):

| 영역 | 규칙 | 예 |
|---|---|---|
| JSON 프로퍼티 이름 (stdout / stderr / details bag) | camelCase | `affectedCards`, `cardKey`, `filePath` |
| enum 값 (문자열 리터럴 union) | kebab-case (lowercase) | `'in-place'`, `'symbol-removed-manual-review-required'` |
| TS enum 멤버 이름 (key) | PascalCase | `enum Direction { Forward, Backward }` |
| 상수 (객체 키, `EXIT.OK` 등) | UPPER_SNAKE | `EXIT.OK`, `EXIT.VALIDATION_FAILURE` |
| 에러 코드 *값* | kebab-case | `'card-not-found'`, `'fts-syntax-error'` |
| 파일명 | kebab-case | `bulk-create.ts`, `card-routing.md` |
| DB 컬럼명 | snake_case lower | `glossary_json`, `updated_at` |
| DB → 코드 매핑 (ORM 후) | camelCase | `glossaryJson`, `updatedAt` |
| TS class 이름 | PascalCase | `CardNotFoundError`, `OutputEncodeError` |
| TS interface / type 이름 | PascalCase | `CardRow`, `BulkCreateResult` |
| TS 함수 이름 | camelCase | `emitResult`, `getLinkCoverage` |
| CLI 명령 / 플래그 | kebab-case | `ed card set-status`, `--max-depth` |

스킬 (`details` bag 안 키도 camelCase) — 더 이상의 혼용 없음.

**D10 — 0-based indexing**: `failed[].inputIndex` 등 모든 위치 인덱스는 0-based. 이름이 `lineNumber` 같으면 1-based.

**D11 — 인라인 타입**: §1.7 의 공통 inline 타입 (CardRow / CardSummary / TreeNode) 은 카드 작성 시 그대로 사용. 별도 도메인 카드에 정의돼 있으면 그곳에서 참조 (Phase 1.3 시 카드 시스템 grep 으로 확인). 코드의 `CardFile` (`{frontmatter, filePath?}` wrapper) 와 이름 충돌 회피 — `CardFile` 명칭은 §1.7 안에서 안 쓴다.

**D12 — `key-mismatch` 위치**: `fileLevelIssues[]` 에. 카드 키 자체가 결함이므로 "그 키로 식별되는 카드의 issues[]" 와 모순. 단일 canonical bucket.

**D13 — `bulk create` inputIndex**: `topologicalSort` 가 입력 순서를 재배열하므로 `created[]` 와 `failed[]` 양쪽에 inputIndex 필수. 중복 키 입력 시 별개 inputIndex 두 entry 가 나옴.

**D14 — SIGINT 중 stdout 잘림**: `process.stdout.write` 는 PIPE_BUF (Linux 64KB) 초과 write 가 atomic 아님. 소비자는 `exitCode === 130` 확인 후 stdout 파싱 시도. 문서화된 한계 (mitigation 안 함).

**D15 — 명령 영역 분리**: 명령은 stdout 에 직접 write 금지. runner 만 `emitResult` 호출. 명령이 `undefined` 반환 시 runner 는 stdout 무 emit (JSON `null` 출력하려면 `{ data: null }` 명시).

**D16 — Phase 2 atomic commit**: §3 Phase 2 sub-step 들은 하나의 git commit. sub-step 사이 commit 금지 (interrupt 시 `git stash`).

**D17 — Phase 2.3a 분리 결정**: OP-3 (`getCardSymbolCoverage`) 는 *envelope 제거가 아니라 의미 재정의*. 본 plan 의 envelope 제거 commit 에서 **분리**. `check coverage <key>` 의 카드는 일단 현 op (link-coverage) shape 으로 작성, 의미 변경은 별도 PR 결정.

**D18 — Phase 1.3 카드 공통부 hoisting**: stdout 1회 JSON / stderr JSON-line / `--quiet` 동작 / failure 시 stdout 무출력 같은 *모든 명령 공통 invariant* 는 부모 spec `runner-and-output` 에 한 번만 선언. 32 명령 카드는 자기 *고유* POST-001 (shape) + 고유 exit code policy + 고유 failure 만 가짐. 32 카드에 동일 POST-002/003/004 복붙 금지.

**D18.1 — `cli-usage-error` 의 failures entry placeholder 예외**: SKILL.md card_fields 가 `spec.failures ≥1` 강제. *read-only 명령으로 op-throw 없음* 인 카드 (예: `card-list`, `analyze`, `check-impact`, `check-interactions`, `glossary-lookup`, `reset`, `spec-sync-symbols`) 는 *명령-specific* failure mode 0 — schema 통과를 위해 *commander 거부* (cli-usage-error) entry 를 *예외적으로* 유지 가능. cli-usage-error 가 *유일한 entry* 인 경우만 허용; *명령-specific failure 가 있는 카드* 는 cli-usage-error entry 제거 (부모 anchor 처리). 향후 schema 가 `failures ≥0` 허용 시 7 카드의 placeholder 도 제거.

---

## 3. Phase 단계

### Phase 1.1 ✅ (`072d2c7`) — brief 이름 변경

### Phase 1.2 ✅ (`f96a50d`) — brief + runner-and-output spec + sync 카드 v2 wording

### Phase 1.2.5 — Phase 1.2 카드 wording 을 §1.1 / §1.8 / D5 / D9 / D15 에 정렬 ⏳

Phase 1.2 카드 검증 결과 (이번 turn 코드 직접 읽음) 다음 wording 이 plan 의 final 결정과 모순. `ed card update` 로 정정:

**brief `cli-surface/command-routing-and-output.md`**:
- G-003 (line 50-55): "verbose / user-facing error messages — go to stderr ... verbose / error messages are **free-form text**" → D5 위반. 정정: "stderr 는 단일 JSON-line schema `{level, code, message, details?}`. free-form text 금지."
- G-004 (line 56-60): "stderr **carries a human-readable message**" → D5 위반. 정정: "stderr 는 단일 `level:'error'` JSON-line."
- G-005 (line 61-65): "**--quiet collapses the natural stdout shape to its core payload (e.g. a card key, a count)**" → D19 위반. 정정: "--quiet 는 same shape 의 compact JSON + warning/verbose suppress."
- R-004 (line 213-220): `'CARD_SYNC_FAILED'` UPPER_SNAKE → D9 위반. 정정: `'card-sync-failed'` kebab.

**spec `runner-and-output.md`**:
- POST-002 (line 28-30): "writes a **human-readable line** to stderr" → D5 위반. 정정: "writes single `level:'error'` JSON-line."
- POST-004 (line 41-46): `'CARD_SYNC_FAILED'` UPPER_SNAKE → D9 위반. 정정: kebab.
- POST-005 (line 49-53): "collapses ... to its core payload (per command's spec-declared quiet form)" → D19 위반. 정정: §1.8 wording.
- failures #3 (line 91-): "CommandFn returns undefined → runner **writes `null` to stdout and exits 0**" → D15 위반 (D15 = "undefined → stdout 무 emit"). 정정: "undefined → stdout 무 emit (JSON null 출력하려면 `{ data: null }` 명시)."
- failures #1: `code='INTERNAL_ERROR'` UPPER_SNAKE → kebab `'internal-error'`.
- INV-001/POST-003 의 에러 코드 *값* 형식 — `'card-not-found'` 같은 kebab 으로 통일 (현 spec 은 클래스명만 명시; 매핑 표는 §4 참조 라 OK 지만 보완 권장).

**위 spec 에 §1.8 의 공통 invariant 4개 (D18) 가 POST/INV 로 선언** — Phase 1.3 의 32 카드 derives anchor:
1. stdout 은 명령 declared shape 의 JSON 1회 (이미 POST-001)
2. stderr 는 JSON-line schema `{level, code, message, details?}` (INV-001/INV-003 정정 + 신규)
3. --quiet 는 compact JSON + warning/verbose suppress (POST-005 정정)
4. failure 시 stdout 무 emit (POST-002 정정)

**Workflow**: emberdeck skill 게이트 (HC-1~4). `<card_analysis>` 표 → 사용자 confirm → `ed card update KEY --patch f.yaml` 두 카드 → `<self_review>` → `ed validate cards` GATE.

### Phase 1.3 — 32 per-command CLI-shape spec 카드 생성 ⏳

§1.6 표 의 32 카드 신규 생성. 각 카드:

```yaml
key: cli-surface/command-routing-and-output/commands/<command-key>
type: spec
parent: cli-surface/command-routing-and-output
status: draft
summary: "<명령 요지 한 줄 + 이 카드가 stdout shape + 명령별 exit policy 를 선언함>"
glossary: []
spec:
  preconditions:
    - id: PRE-001
      condition: "runner 가 빌드된 CliRuntime + commander 검증 통과 인자로 이 명령 action 을 호출."
      derives: "cli-surface/command-routing-and-output#G-001"
  postconditions:
    - id: POST-001
      keyword: MUST
      derives: "cli-surface/command-routing-and-output#G-001"
      guarantee: |
        성공 시 명령은 `{ data, exitCode? }` 를 반환하며 `data` 는 아래 shape:
        ```jsonc
        // stdout shape for `<command full invocation>`
        <§1.7 의 해당 shape 그대로 붙여넣기>
        ```
    - id: POST-002       # 명령 고유 exit code policy
      keyword: MUST
      derives: "cli-surface/command-routing-and-output#G-002"
      guarantee: |
        - 0 (EXIT.OK): <성공 조건>
        - <명령별 policy 코드 + 조건>
        - thrown 매핑: <이 명령이 던지는 에러 클래스 → exit code>
  invariants: []   # 비워두기 — 공통 invariant 는 부모 runner-and-output 에서 derives
  failures:
    - violation: "<명령 고유 실패 모드 1>"
      behavior: "<runner 가 emit 하는 stderr JSON-line + exit code>"
```

**카드 공통부 (stdout 1회 / stderr JSON-line / --quiet 동작 / failure 시 stdout 무출력)** 는 부모 `runner-and-output` 의 invariant/postcondition 으로 이미 선언돼 있어야 함 (Phase 1.2.5 에서 보장). 명령 카드는 그것들을 *반복* 선언하지 않고 `derives:` 로 가리킴.

**다중 모드 명령** (`ed check coverage`): POST-001 을 POST-001a/b/c 로 분할, 각자 mode + shape 선언. POST-002 (exit) 와 failures 는 단일.

**실패만 있는 카드** (`runner-commander-fallback`): POST-001 없음. PRE-001 재작성: "commander.parseAsync 가 `commander.help`/`commander.version` 외 CommanderError 를 던졌고 어떤 subcommand action 도 dispatch 안 됨; CliRuntime 없음." POST-002 가 exit 표를 담음. failures 가 stderr JSON-line emission 을 담음.

**Workflow**: emberdeck skill 게이트. 32 카드 한 번에 `<card_analysis>` 표 → 사용자 confirm → `ed card create KEY --type spec --parent ... --from f.yaml` 반복 → `ed validate cards` GATE.

### Phase 1.4 — `.claude/skills/emberdeck/SKILL.md` 업데이트

- envelope 언급 paragraph (line 116 부근) 을 §1.1 / §1.8 으로 교체
- `<response_shapes>` 섹션 (line 306–380) 을 *예시 1–2개* + "전체는 per-command 카드 POST-001 참조" 로 축소
- `<error_recovery>` 의 envelope `errors[]` / `warnings[]` 표를 stderr JSON-line code 표로 교체 (level / code / 의미 / 해결)

GATE: 수동 검토.

### Phase 2 — 코드 (단일 git commit)

`git diff` clean 에서 시작.

#### 2.0 — action handler 함수 추출 (gildash `@spec` 인식 활성화)

**왜**: Phase 1.3 에서 31 명령의 `@spec cli-surface/command-routing-and-output/commands/<key>` JSDoc annotation 을 `src/cli/commands/*.ts` 에 추가했으나, annotation 이 commander chain expression statement (`.command(...).action(async (...) => {...})`) 직전에 위치 → gildash 가 *function declaration* 위 JSDoc 만 인덱싱하므로 annotation 이 어느 symbol 에도 attach 안 됨 → `ed spec sync` 가 새 link 0 생성, `ed validate links` 통과해도 *카드 active 전환 시* activation guard 가 "no source bindings" 로 거부.

**작업**: 각 명령의 inline arrow action callback 을 *export 된 named async function* 으로 추출. JSDoc annotation 을 함수 declaration 위에 둠.

**Before** (`src/cli/commands/card.ts` 예):
```ts
/** @spec cli-surface/command-routing-and-output/commands/card-get */
card
  .command('get <key>')
  .description('read a card from file')
  .option('--history', 'include changelog history')
  .action(async (key: string, opts: { history?: boolean }, cmd) => {
    await run(async (rt: CliRuntime) => { ... }, cmd);
  });
```

**After**:
```ts
/** @spec cli-surface/command-routing-and-output/commands/card-get */
export async function cardGetAction(
  key: string,
  opts: { history?: boolean },
  cmd: Command,
): Promise<void> {
  await run(async (rt: CliRuntime) => { ... }, cmd);
}

card
  .command('get <key>')
  .description('read a card from file')
  .option('--history', 'include changelog history')
  .action(cardGetAction);
```

**대상**: 31 명령 — card (12), validate (3), check (5), spec (2), bulk (2), glossary (4), single (3). `runner-commander-fallback` 은 Phase 2.7 의 commander `main()` catch 블록이 anchor (별도 함수 추출 불필요).

**GATE**: 2.0 완료 후 `ed spec sync` → `linkMissing` 가 31개 신규 link 보고. `ed validate links` broken=0. 한 카드 `ed card set-status <key> active` 시도 → activation guard 통과 (`code_links_total > 0`).

#### 2.1 — `src/cli/output.ts` 전면 교체 (§1.3 코드)

#### 2.2 — `src/cli/runner.ts` 전면 교체

```ts
import type { Command } from 'commander';
import { buildRuntime, type GlobalFlags, type CliRuntime } from './context';
import { emitResult, emitError, emitVerbose, emitWarning, buildOutputContext } from './output';
import { toCliError, ERROR_CODE_TO_EXIT } from './errors';
import { EXIT, type ExitCode } from './exit-codes';
import { ensureCardsSynced } from '../ops/sync';

export type CommandReturn = { data?: unknown; exitCode?: ExitCode } | undefined;
export type CommandFn = (rt: CliRuntime) => Promise<CommandReturn>;

export async function run(fn: CommandFn, cmd: Command): Promise<void> {
  const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
  const outCtx = buildOutputContext(globalFlags);
  let rt: CliRuntime | undefined;
  let inSignal = false;
  const onSig = async (sig: string): Promise<void> => {
    if (inSignal) process.exit(EXIT.SIGINT);
    inSignal = true;
    try { await rt?.cleanup(); } catch {}
    emitError({ code: 'SIGINT', message: `${sig} received, exiting` });
    process.exit(EXIT.SIGINT);
  };
  const onSigint = (): void => { void onSig('SIGINT'); };
  const onSigterm = (): void => { void onSig('SIGTERM'); };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const verbose = globalFlags.verbose
    ? (m: string, d?: Record<string, unknown>) => emitVerbose(m, d)
    : (_: string) => {};

  let exitCode: ExitCode = EXIT.OK;
  try {
    verbose('buildRuntime', { config: globalFlags.config, dir: globalFlags.dir });
    rt = await buildRuntime(globalFlags);
    const syncFailures = await ensureCardsSynced(rt.ctx);
    if (!outCtx.quiet) {
      for (const f of syncFailures) {
        emitWarning({ code: 'card-sync-failed', message: `${f.filePath}: ${f.error}`,
                      details: { filePath: f.filePath } });
      }
    }
    const ret = await fn(rt);
    if (ret && ret.data !== undefined) await emitResult(ret.data, outCtx);   // D14: drain await
    exitCode = ret?.exitCode ?? EXIT.OK;
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException)?.code;
    if (e instanceof Error && e.message.startsWith('Output encode failed')) {
      emitError({ code: 'OUTPUT_ENCODE_FAILED', message: e.message });
      exitCode = EXIT.GENERIC_ERROR;
    } else if (errno && errno !== 'EPIPE' && (e as Error).message?.includes('stdout')) {
      emitError({ code: 'STDOUT_WRITE_FAILED', message: (e as Error).message });
      exitCode = EXIT.PERMISSION_OR_IO;
    } else {
      const cliErr = toCliError(e);
      emitError({ code: cliErr.code, message: cliErr.message,
                  ...(cliErr.details ? { details: cliErr.details } : {}) });
      exitCode = (ERROR_CODE_TO_EXIT[cliErr.code] ?? EXIT.GENERIC_ERROR) as ExitCode;
    }
  }
  try { await rt?.cleanup(); } catch {}
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  process.exit(exitCode);
}

function extractGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
  return {
    config: opts.config as string | undefined,
    dir: opts.dir as string | undefined,
    dbPath: opts.dbPath as string | undefined,
    projectRoot: opts.projectRoot as string | undefined,
    quiet: opts.quiet as boolean | undefined,
    verbose: opts.verbose as boolean | undefined,
  };
}
```

`classifyErrorStatus` 제거 (`GILDASH_TRANSIENT` 던지는 코드 없음).

#### 2.3 — 명령 파일 재작성 (`src/cli/commands/*.ts` 7개)

1. `import { ok, partial, ... } from '../output'` 제거.
2. `return ok(D)` → `return { data: D }`. `D` 가 §1.7 shape 과 일치하면 그대로, 다르면 restructure (아래 표).
3. `partial(D, errors)` 사용 명령 → §1.7 shape 으로 빌드 후 `return { data, exitCode: 2 }`.
4. `validate.ts` 의 BROKEN_LINK 수집기는 structured `{file, symbol, reason}` 직접 사용 (op 가 이미 structured 반환). 메시지 문자열 조립 X.
5. `--quiet` 별도 처리 X (D5).

**non-mechanical 재구조 (각 1–2시간 작업)**:

| 명령 | 변경 |
|---|---|
| `ed card get` | frontmatter unwrap → root flat. history.entries[] 를 op 의 `ChangelogRow` 그대로 통과 (`{field, oldValue, newValue, changedAt, changedBy}`). 기존 `{ts, action, fields}` 추측 shape 폐기 |
| `ed card list` | `page.{limit,offset,has_more}` → root flat 으로 (`hasMore`). `items` 를 `CardSummary` 로 사영 (op 가 이미 `CardSummaryRow[]` 반환 — `namespacesJson/glossaryJson/updatedAt` 제외하고 `{key,summary,type,status,parent}` 만) |
| `ed card search` | `items` 를 `{...CardSummary, snippet?, rank?}` 로. OP-10 가 snippet/rank 제공하면 노출, 미제공이면 그 필드 생략 |
| `ed card rename` | `failedReferenceUpdates` 를 `{cardKey, reason}[]` 으로 (OP-11 제공). partial → exitCode 2 |
| `ed card update` | `warnings: string[]` → `validationNotes: string[]` (CLI 의 `'UPDATE_WARNING'` 단일-code 래핑 제거; op `warnings` 그대로 통과) |
| `ed card delete` | OP-4 반환 사용. `cascaded` 필드 제거 → `detachedChildren: string[]` + `removedCrossDomainRefs: string[]` (always-array, force=false 도 빈 배열) |
| `ed card rename` | partial → `exitCode: 2` 분기 추가 (`failedReferenceUpdates.length > 0` 시) |
| `ed card set-status` | OP-7 결과 사용 (`oldStatus` op 가 직접 반환). CLI 사전 read 폐기 |
| `ed card tree` | `TreeNode` 에 `depth`, `truncated?` 노출 (op 이미 반환) |
| `ed card context` | OP-12 결과 사용 (`parentChain` op 가 직접 반환). op 의 모든 필드를 §1.7 shape 대로 노출 |
| `ed card relations` | OP-13 결과 그대로 통과 (`{forward, reverse}` CardSummary[]). CLI join 폐기 |
| `ed validate cards` | flat counter → `summary` + `items[].issues[]` + `fileLevelIssues[]`. issues[].code 는 op 의 ValidationWarning.type 그대로 통과 (이미 kebab — `'orphan-card'|'broken-parent'|'type-hierarchy-violation'|'broken-cross-domain-dep'|'broken-relation'|'rework-dependency'|'empty-tree'|'content-mismatch'|'glossary-broken'|'glossary-unused'|'broken-chain'`). CLI 의 옛 UPPER_SNAKE 변환 (`ORPHAN_CARD` 등) 폐기 |
| `ed validate links` | flat counter → `summary` + `items[]` per target card. op `ValidateCodeLinksResult.broken` → `brokenLinks?`, `planned` → `plannedLinks?` (draft 카드의 broken — exit 영향 X), `skipped/ioError` |
| `ed card export` | OP-15 결과 (`{filePath, bytes}`) 사용. 모든 모드 (in-place / file / stdout) 에 bytes 일관. mode='stdout' 만 content 포함 |
| `ed glossary define` | op `DefineGlossaryResult.results[].action` 그대로 통과 (`defined: [{word, definition, action: 'created'\|'updated'}]`). per-entry validation 실패는 CLI helper 가 사전 분리 → `failed[]` |
| `ed validate` (aggregate) | 위 두 결과를 `{cards, links}` 로 결합 |
| `ed check drift` | `totalDrifted` 추가하지 않음 (derive 가능). `cards` array 만 |
| `ed check coverage <key>` | link-coverage shape (`{key, declared, resolved, broken, coverageRatio, unreferencedSymbols, unreferencedTotal}`). CLI 의 `unreferenced.slice(0, 100)` 제거 — 전체 array 노출. symbol-coverage 의미 전환은 §6 분리 |
| `ed check coverage --uncovered` | CLI 의 `uncovered.slice(0, 100)` 제거 — 전체 array. `uncoveredTotal = uncovered.length` |
| `ed check coverage --suggest` | op `CardSuggestion` 의 `files`/`symbols` array 를 그대로 통과 (현 CLI 의 `.length` count 변환 제거) |
| `ed check impact` | op 의 `maxFanOut?`/`directDependents?` 노출. `linkStatus?` optional. `affectedCount` 추가 안 함 (derive 가능). `glossary` 제외 (전역 echo) |
| `ed check interactions` | op `CardInteraction` 그대로 통과 (`pair`, `hasRelation`, `potentialConflicts` 포함). `undefinedRelations[]` 도 op 그대로 (`reason` 안 만들기 때문에 없음) |
| `ed bulk create` | OP-1 결과 사용. counter → `{created: [{inputIndex, key, filePath}], failed: [{inputIndex, key?, error}], total}` |
| `ed bulk sync` | 두 모드 통일, `failed: [{filePath, error}]` 항상 포함 |
| `ed glossary define` | per-entry validation 실패를 throw 대신 `failed[]` 에 누적 (CLI helper 가 사전 분리). counter → arrays |
| `ed glossary lookup` | word/no-word 통합 → `{entries, total}` |
| `ed glossary remove` | `removed: boolean` 제거. `{word, affectedCardKeys}` 만. not-found 는 신규 `GlossaryNotFoundError` → exit 3 |
| `ed glossary rename` | OP-9 결과 사용. 필드명 변경: `renamed_from→oldWord`, `renamed_to→newWord`, `cards_updated→affectedCardKeys`, `file_write_failures→failedFileWrites?`, `definition` 드롭. not-found 는 `GlossaryNotFoundError` → exit 3, conflict 는 `GlossaryValidationError` → exit 2 (코드 매핑 §4 일치) |
| `ed spec sync` | op 의 `unmatched`/`markerMissing`/`linkMissing` array + `alreadyLinked` 카운터 그대로 통과. op 의 `created: number` 는 응답에서 제거 (linkMissing.length 와 동일 정보). `UNMATCHED_ANNOTATION` CliMessage 제거 |
| `ed spec sync-symbols` | OP-2 결과 사용. `changes[]` → `applied[]` + `skipped[]`. `metadata-write-failed` 경고 → `skipped[]` 엔트리. enum 값 kebab |
| `ed check regression` | `partial()` 제거, `{data, exitCode: passOrFail==='fail' ? 2 : 0}` |
| `ed reset` | `dbReset` 필드 제거 (op 가 항상 true 반환, 정보 0) |
| `ed init` | 필드명 snake → camel 정리 (mechanical) |
| `ed analyze` | (a) OP-14 결과 사용 (`AnalyzeCoverage` 의 `coveredSymbols`/`coverageRatio`). (b) op 의 `driftedCards`/`driftedCardsTotal` 를 `drifted: {cards, total, limit, offset, hasMore}` 로 재조립 (limit/offset 은 CLI 입력 echo, hasMore = `offset + cards.length < total` derive). (c) `glossary.totalWords` 제거. (d) 필드명 snake → camel |

#### 2.3a — op-layer 사전 작업 (OP-3 제외; OP-3 = check coverage 의미 전환, §6 분리)

**OP-1 `BulkCreateResult`** (`src/ops/bulk-create.ts`):
```ts
export interface BulkCreateResult {
  created: Array<{ inputIndex: number; key: string; filePath: string }>;
  partialKeys: string[];
  errors: Array<{ inputIndex: number; key?: string; filePath?: string; message: string }>;
}
```
- numeric `created`/`failed` 카운터 제거.
- `topologicalSort` 가 입력 순서를 재배열하므로 `bulkCreateCards` 진입 시 `inputs.map((it, i) => ({ ...it, __inputIndex: i }))` 로 inputIndex 동행. 중복 키 입력 시 두 entry 가 별개 inputIndex 로 보고됨 (D13).
- 호출자 grep: `BulkCreateResult|bulkCreateCards` (src/, test/).

**OP-2 `SymbolSyncResult`** (`src/ops/spec-sync.ts`):
```ts
export interface SymbolSyncResult {
  applied: Array<{ cardKey: string; oldSymbol: string; newSymbol: string;
                   file: string; changeType: 'renamed'|'moved' }>;
  skipped: Array<{ reason: 'no-links-referencing-old-symbol'
                         | 'symbol-removed-manual-review-required'
                         | 'card-not-found';
                   symbol?: string; file?: string;
                   details?: Record<string, unknown> }>;
}
// `metadata-write-failed` 는 CLI 가 op 호출 후 추가 (op 자체는 emit X).
```
- `syncSymbolChanges` 안:
  1. `links.length===0` 의 `continue` → `skipped.push({reason:'no-links-referencing-old-symbol', symbol:oldName, file:oldFile})`
  2. `removed` 브랜치 `broken++` → `skipped.push({reason:'symbol-removed-manual-review-required', symbol, file, details:{cardKey}})`
  3. `renamed`/`moved` `details.push` → `applied.push({cardKey, oldSymbol, newSymbol, file, changeType})`
  4. per-link 루프 진입 직전 `findByKey` 가드: 없으면 `skipped.push({reason:'card-not-found', ...})`
- `updated`/`broken` 카운터 제거 (derivable).

**OP-4 `deleteCard` return shape** (`src/ops/delete.ts:35-39`):

```ts
// Before:
async function deleteCard(...): Promise<{ filePath: string }>

// After:
async function deleteCard(...): Promise<{
  filePath: string;
  detachedChildren: string[];          // force=true 일 때 parent=null 로 변경된 자식 키
  removedCrossDomainRefs: string[];    // force=true 일 때 cross_domain_dependencies 에서 이 키 참조가 제거된 도메인 카드 키
}>
```
- 변수가 이미 op 안에 있음: `children` (line 54), `crossDomainDependents` (line 74-80). 키 매핑만 추가.
- 비-force 경로 (자식 없음, cross-dep 없음) 는 두 배열 모두 빈 배열로 반환.

**OP-7 `updateCardStatus` return shape** (`src/ops/update.ts:362-442`):

```ts
// Before:
async function updateCardStatus(...): Promise<UpdateCardResult>   // {filePath, card, warnings?}

// After:
async function updateCardStatus(...): Promise<UpdateCardResult & { oldStatus: CardStatus }>
```
op 안에서 line 387 `oldStatus = current.frontmatter.status` 가 이미 캡처돼 있음. 반환 객체에 추가만 (1줄). CLI 의 사전 DB read 회피책 폐기.

**OP-12 `getCardContext.parentChain`** (`src/ops/query.ts:76-143`):

```ts
export interface CardContext {
  card: CardFile;
  codeLinks: ResolvedCodeLink[];
  upstreamCards: CardRow[];
  downstreamCards: CardRow[];
  parentChain: CardRow[];      // NEW: root → 현 카드 직전. 빈 배열 if parent 없음
  related?: RelatedCard[];
  truncated?: boolean;
}
```
op 안에서 `card.frontmatter.parent` 따라 `cardRepo.findByKey` 반복으로 만들어 반환. CLI 후처리 derive 폐기 — getCardContext 가 종합 응답의 owner.

**OP-13 `listCardRelations` CardSummary[]** (`src/ops/query.ts:269-272`):

```ts
// Before:
function listCardRelations(ctx, fullKey): RelationRow[]

// After:
export interface CardRelations {
  forward: CardSummary[];   // 이 카드 → 다른 카드
  reverse: CardSummary[];   // 다른 카드 → 이 카드
}
function listCardRelations(ctx, fullKey): CardRelations
```
op 안에서 `relationRepo.findByCardKey` + `cardRepo.findByKey` join. CLI 의 join 코드 폐기.

**OP-15 `exportCardToFile` return shape** (`src/ops/sync.ts:694`):

```ts
// Before:
async function exportCardToFile(...): Promise<string>   // filePath 만

// After:
async function exportCardToFile(...): Promise<{ filePath: string; bytes: number }>
```
op 안에서 serialized content 의 length 를 atomicWrite 직전에 캡처해서 반환. CLI 의 mode='in-place' / mode='file' / mode='stdout' 모두 bytes 일관 노출 가능.

**OP-14 `AnalyzeCoverage` 필드명 정렬** (`src/ops/analyze.ts:42-50`):

```ts
// Before:
export interface AnalyzeCoverage { totalSymbols: number; covered: number; ratio: number | null }

// After (UncoveredResult 와 일관):
export interface AnalyzeCoverage { totalSymbols: number; coveredSymbols: number; coverageRatio: number | null }
```
같은 의미 다른 이름은 op 명명 결함. CLI 매핑은 우회 — op 정정. `analyze.ts:160` 의 빌드 코드도 필드명 정렬.

**`GlossaryNotFoundError` 분리** (`src/card/errors.ts` + `src/cli/errors.ts`):

기존 `GlossaryValidationError` 가 *missing word* / *invalid input* / *duplicate* 세 경우 모두 던짐. v2: `GlossaryNotFoundError` 신규 (missing word 한정), errors.ts 매핑 → exit 3. 다른 두 경우는 `GlossaryValidationError` 그대로 exit 2. ops/glossary.ts 의 `findIndex === -1` 분기 (line 137-139, 195-196) 가 새 클래스 던지도록 변경.

**OP-10 `searchCards` snippet/rank** (`src/ops/query.ts:244-258`):

FTS5 의 매치 정보 노출. 현 op 는 `CardSummaryRow[]` (snippet/rank 없음). 변경:

```ts
export interface SearchCardMatch extends CardSummaryRow {
  snippet?: string;   // FTS5 `snippet()` 결과 (~80자 발췌)
  rank?: number;      // BM25 score
}
export function searchCards(...): SearchCardMatch[]
```

`cardRepo.search` 도 FTS5 쿼리에 `snippet(card_fts, ...)` / `bm25(card_fts)` 컬럼 select 추가.

**OP-11 `renameCard` failedReferenceUpdates reason** (`src/ops/rename.ts:175-177`):

현재 catch block 이 error 버림. 변경:
```ts
} catch (e) {
  failedReferenceUpdates.push({ cardKey: ref.key, reason: e instanceof Error ? e.message : String(e) });
}
```
TS interface `RenameCardResult.failedReferenceUpdates?: { cardKey: string, reason: string }[]`.

**OP-9 `renameGlossary` return shape** (`src/ops/glossary.ts:263-269`):

```ts
// Before:
return {
  renamedFrom, renamedTo, definition, cardsUpdated: affectedCards.length, fileWriteFailures
};

// After:
return {
  renamedFrom, renamedTo, definition,
  cardsUpdated: affectedCards.length,
  affectedCardKeys: affectedCards.map((c) => c.key),    // NEW (line 203 의 affectedCards 이미 보유)
  fileWriteFailures,
};
```
TS interface `RenameGlossaryResult` 에 `affectedCardKeys: string[]` 필드 추가.

**op-test rewrite 동시 진행** (Phase 2 commit 안):
- `test/ops/bulk-create.test.ts` (~32 라인) — OP-1
- `test/ops/spec-sync.test.ts` (~22 라인) — OP-2
- `test/ops/delete.test.ts` — OP-4
- `test/ops/glossary.test.ts` (rename 섹션) — OP-9
- `test/integration/crud-sync.test.ts` (~6 라인)
- `test/e2e/{chaos,flows}.test.ts` (grep 으로 어느 쪽이 affected ops 를 호출하는지 확인)

기계적 변환 규칙:
- `result.created` (number) → `result.created.length`
- `result.failed` (number) → `result.errors.length`
- `result.keys` → `result.created.map(c => c.key)`
- `result.updated` (SymbolSyncResult, LinkCoverageResult 의 `.broken` 은 무관) → `result.applied.length`
- `result.broken` (SymbolSyncResult) → `result.skipped.filter(s => s.reason === 'symbol-removed-manual-review-required').length`
- `result.changes[i]` → `result.applied[i]` 또는 `result.skipped[i]` (테스트 의도에 따라)
- bulk-create 테스트의 `result.errors[i].input_index` → `result.errors[i].inputIndex` (snake → camel)
- glossary rename 테스트의 `result.cardsUpdated` (number) 와 신규 `result.affectedCardKeys` (array) 둘 다 검증

#### 2.4 — `src/cli/errors.ts`

- `ERROR_CODE_TO_EXIT` 를 `output.ts` 에서 `errors.ts` 로 이동, export.
- `OUTPUT_ENCODE_FAILED: EXIT.GENERIC_ERROR`, `STDOUT_WRITE_FAILED: EXIT.PERMISSION_OR_IO` 매핑 추가.
- `GlossaryNotFoundError` 신규 클래스 추가, `glossary-not-found → 3` 매핑. 기존 `GlossaryValidationError` 의 missing-word 분기는 새 클래스 throw 로 분리 (ops/glossary.ts line 137-139, 195-196).
- 모든 `SIMPLE_ERROR_CODES` 값 (TS 상수 *키* 는 UPPER_SNAKE 유지, 값만) kebab 화.
- `toCliError` 반환 형식 `{ code, message, details? }` 유지.

#### 2.5 — 삭제

- `src/cli/commands/contract.spec.ts` (INV-003 per-file dedup 사라짐)
- `test/cli/json-envelope-schema.test.ts`
- `src/cli/output.spec.ts` (envelope assertions 만 존재)

#### 2.6 — `src/cli/runner.spec.ts`

- `mergeCardSyncWarnings` describe 블록 (7 tests) 삭제.
- `classifyErrorStatus` 참조 (line 17-18) 삭제.

#### 2.7 — commander `exitOverride()` (H-005 / H-006 fix)

`src/cli/index.ts` 의 `buildProgram` 에서 기존 `.showHelpAfterError(...)` 호출 삭제 (free-text stderr 이므로 §1.1 위반). 그 자리에 `program.exitOverride()` 추가.

`main()` 재작성:
```ts
import { emitError } from './output';
import { EXIT } from './exit-codes';

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code: string }).code;
      if (code === 'commander.help' || code === 'commander.version') {
        process.exit(EXIT.OK);
      }
      const msg = e instanceof Error ? e.message : String(e);
      emitError({ code: 'CLI_USAGE_ERROR', message: msg });
      process.exit(EXIT.VALIDATION_FAILURE);
    }
    throw e;
  }
}
```

`cli.ts` 는 그대로 (얇은 shim, `await main()` 만).

**Phase 2 GATE**: `bunx tsc --noEmit` clean (sub-step 중간에는 빨강 가능, 끝에만 초록). `bun test` 의 ops/integration/e2e 테스트는 통과해야 함 (2.3a 가 동시 갱신). CLI 테스트 실패는 예상 — Phase 3 에서 처리. 실패 개수 기록.

### Phase 3 — 테스트

#### 3.0 — `test/cli/helpers.ts` 확장

기존 `runEd(args, cwd)` 가 in-process `buildProgram + parseAsync + exitOverride` 로 `{exitCode, stdout, stderr}` 반환 (검증됨). 추가:

```ts
export function parseJsonLines(stderr: string): Array<{ level: string; code: string; message: string; details?: Record<string, unknown> }> {
  return stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function spawnCli(args: string[], cwd: string): Promise<RunResult> {
  // bun spawn 기반 — signal/EPIPE/실제 subprocess 동작 테스트용
}
```

각 파일 private `Bun.spawn` 를 `spawnCli` import 로 교체:
`test/cli/fs-race.test.ts`, `flag-overrides.test.ts`, `symlink.test.ts`, `db-corruption.test.ts`, `fs-error.test.ts`, `malformed-yaml.test.ts`, `commands.test.ts` (~42 envelope assertion 사이트 포함, in-process 가능한 케이스는 `runEd`).

`signal-handling.test.ts` 의 `spawnEd` 는 SIGINT custom 로직이라 유지 또는 `spawnCli` 에 `signal` 옵션 추가.

#### 3.1 — 테스트 패턴 매핑

```bash
rg -nE 'parsed\.(status|data|warnings|errors|error|schemaVersion)' test/ src/
```
각 라인이 아래 표의 행에 매핑되는지 확인. 매핑 안 되면 STOP, 표에 행 추가 후 진행.

| v1 assertion | v2 replacement |
|---|---|
| `parsed.status === 'ok'` | `exitCode === 0` |
| `parsed.status === 'partial'` | `exitCode === 2` |
| `parsed.status === 'error'` | `exitCode !== 0; stdout === ''` (parse 시도 X) |
| 전체 envelope `toEqual` 매치 | `exitCode === 0; JSON.parse(stdout) toEqual D; parseJsonLines(stderr).filter(l=>l.level!=='verbose') toEqual []` |
| `parsed.data.X` | `parsed.X` |
| `parsed.errors.some(e=>e.code==='BROKEN_LINK')` | `parsed.links.items.some(i=>i.brokenLinks?.length)` |
| `parsed.errors.some(e=>e.code==='CARD_SYNC_FAILED')` | `parseJsonLines(stderr).some(l=>l.code==='card-sync-failed')` |
| `parsed.errors.some(e=>e.code==='ORPHAN_FILE')` | `parsed.cards.fileLevelIssues.some(i=>i.code==='orphan-file')` |
| `parsed.errors.some(e=>e.code==='VALIDATION_FAILED')` | `parsed.links.items.some(i=>i.ioError)` |
| `parsed.errors.some(e=>e.code==='KEY_MISMATCH_SKIPPED')` | `parsed.links.items.some(i=>i.skipped?.reason==='key-mismatch')` |
| `parsed.schemaVersion` | DELETE |
| `parsed.error?.code` | `parseJsonLines(stderr).find(l=>l.level==='error')?.code` (값은 kebab) |
| `parsed.warnings.some(...)` | `parseJsonLines(stderr).some(...)` |
| `parsed.found` / `parsed.entry` (glossary lookup) | `parsed.entries.length === 0\|1; parsed.entries[0]?.word` |
| `parsed.created` (number) (bulk create / spec sync) | `parsed.created.toHaveLength(N)` |
| `parsed.unmatched` (number) (spec sync) | `parsed.unmatched.toHaveLength(N)` |
| `parsed.updated` / `parsed.broken` (spec sync-symbols) | `parsed.applied.toHaveLength(N)` / `parsed.skipped.filter(s=>s.reason==='symbol-removed-manual-review-required').length` |
| `parsed.results` (glossary define) | `parsed.defined` |
| `parsed.renamed_from / renamed_to / cards_updated` (glossary rename) | `parsed.oldWord / newWord / affectedCardKeys` |
| `parsed.declared / unreferenced_*` (check coverage v1 link-cov) | 보존 — 의미 전환은 §6 분리된 결정에서 처리 |
| `parsed.page.{limit, offset, has_more}` (card list v1) | `parsed.{limit, offset, hasMore}` |
| `parsed.frontmatter.X` (card get) | `parsed.X` (flat) |
| `parsed.keys / partial_keys / succeeded / rejected_pre_write` (bulk create) | DELETE, use `parsed.created` / `parsed.failed` arrays |
| `parsed.errors` (number) (bulk sync dir-mode) | `parsed.failed` (array) |
| `parsed.cascaded` (card delete) | `parsed.detachedChildren` / `parsed.removedCrossDomainRefs` |
| `parsed.relations.forward / reverse` (card context as CardRow[]) | `parsed.parentChain / upstream / downstream` (CardSummary[]) |
| `parsed.forward / reverse` (card relations as string[]) | `parsed.forward / reverse` (CardSummary[]) — 키만 있는 v1 비교는 `parsed.forward.map(c=>c.key)` |
| `parsed.removed` (glossary remove, v1 string) | `parsed.word` |
| `parsed.db_reset` (reset) | DELETE — 필드 제거됨 |
| `parsed.codeCycles` 형식 등 모든 envelope-snake 식별자 | camelCase 로 (`brokenLinks`, `codeStats`, `unlinkedSymbols`, `nextSyncMarker`, …) |

#### 3.2 — 신규 테스트

`test/cli/auto-sync-warnings.test.ts`: 망가진 카드 파일 → 어떤 read 명령에서든 stderr 에 `level:warning code:card-sync-failed` JSON-line 정확히 1개. stdout shape 영향 없음. exit 코드는 명령의 자연 코드.

`test/cli/no-direct-process-exit.test.ts` (계약 테스트): `grep "process.exit" src/cli/commands/` 가 0 라인.

#### 3.3 — e2e / integration

`test/e2e/flows.test.ts`, `test/integration/*.test.ts` 에 §3.1 표 적용.

**Phase 3 GATE**: `bun test` 0 실패.

### Phase 4 — 문서 정리

#### 4.1 — PROBLEM.md

envelope 해소 — 다음 항목에 `closed by envelope-removal commit <sha>` 한 줄 추가:
- `L-006`, `N-021`, `N-034`
- `grep -E "envelope|status: 'partial'|errors\[\]" PROBLEM.md` 의 envelope-rooted 항목 (case-by-case 확인. `M-018` 는 refuted, `H-005`/`H-006` 는 commander-rooted 라 제외).

commander 해소 — 다음에 `closed by commander exitOverride() in Phase 2.7 commit <sha>`:
- `H-005` (`--limit abc` 평문 stderr)
- `H-006` (누락 positional 평문 stderr)

#### 4.2 — `dist/` 재빌드 (있을 시)

---

## 4. validate.ts 에러 코드 매핑

| v1 code | v2 위치 |
|---|---|
| `BROKEN_LINK` | stdout `data.links.items[].brokenLinks[]` |
| `VALIDATION_FAILED` | stdout `data.links.items[].ioError?` |
| `KEY_MISMATCH_SKIPPED` | stdout `data.links.items[].skipped?: { reason: 'key-mismatch' }` |
| `STALE_DB_ROW` | stdout `data.cards.fileLevelIssues[].code='stale-db-row'` |
| `ORPHAN_FILE` | stdout `data.cards.fileLevelIssues[].code='orphan-file'` |
| `KEY_MISMATCH` | stdout `data.cards.fileLevelIssues[].code='key-mismatch'` |
| `ORPHAN_CARD`, `BROKEN_PARENT`, `BROKEN_RELATION`, … | stdout `data.cards.items[<card>].issues[]` (code 값 kebab) |
| `CARD_SYNC_FAILED` (runner) | stderr JSON-line `code: 'card-sync-failed'` (명령 무관 항상) |

policy: `validate cards` exit = 0 if `summary.total===0` else 2. `validate links` exit = 0 if `summary.broken===0 && summary.ioFailed===0` else 2. `validate` exit = sub-policy max.

stderr JSON-line code 표 (`src/cli/errors.ts` `SIMPLE_ERROR_CODES` + structured 분기 기반). TS 상수 *키* (`SIMPLE_ERROR_CODES.CARD_NOT_FOUND` 같은 lookup 키) 는 UPPER_SNAKE 유지, *값* 만 kebab:

| code (값, kebab) | level | exit | details |
|---|---|---|---|
| `card-sync-failed` | warning | n/a | `{ filePath }` |
| `cli-usage-error` | error | 2 | `{}` |
| `fts-syntax-error` | error | 2 | `{}` |
| `card-not-found` | error | 3 | `{}` |
| `card-already-exists` | error | 4 | `{}` |
| `invalid-card-key` | error | 2 | `{}` |
| `validation-error` | error | 2 | `{}` |
| `parent-validation-error` | error | 2 | `{}` |
| `gildash-init-failed` | error | 6 | `{}` |
| `rename-same-path` | error | 4 | `{}` |
| `glossary-parse-error` | error | 2 | `{}` |
| `glossary-validation-error` | error | 2 | `{}` |
| `glossary-not-found` | error | 3 | `{}` |
| `activation-guard-failed` | error | 2 | `{ unmetConditions: string[] }` |
| `compensation-failed` | error | 1 | `{ originalError, compensationError }` |
| `internal-error` | error | 1 | `{ class? }` |
| `output-encode-failed` | error | 1 | `{}` |
| `stdout-write-failed` | error | 5 | `{}` |
| `boundary-validation-error` | error | 2 | `{}` |
| `runtime` | verbose | n/a | `{ subsystem?, ... }` |
| `sigint` | error | 130 | `{}` |

레거시 (`not-found`/`conflict`/`permission`/`io-error`/`validation-failure`) 는 ops 가 더 이상 throw 안 할 때까지 매핑 유지. Phase 2.4 에서 grep 으로 audit.

---

## 5. GATEs

| # | 시점 | 기준 | 실패 시 |
|---|---|---|---|
| G1 | Phase 1.2.5 후 | `ed validate cards` → `summary.total === 0`. brief / parent spec 의 wording §1.1 / §1.8 일치 | 카드 정정 |
| G2 | Phase 1.3 후 (32 카드) | `ed validate cards` → `summary.total === 0`. `ed bulk sync` errors 0 | 카드 정정 |
| G3 | Phase 1.4 후 | SKILL.md 수동 검토 | 편집 |
| G4 | Phase 2 끝 | `bunx tsc --noEmit` clean. ops/integration/e2e 테스트 통과. CLI 테스트 실패 개수 기록 (예상) | 타입 정정 |
| G5 | Phase 3.0 후 | `grep "async function runCli\|function runCli" test/` 가 helpers.ts 만 매치 | 잔여 spawner 삭제 |
| G6 | Phase 3 끝 | `bun test` 0 실패 | 반복 |
| G7 | Phase 4 끝 | `ed validate` clean. `ed spec sync` errors `[]` | 정정 |
| G8 | 최종 | `bun cli.ts analyze` 의 stdout 에 v1 키 (`schemaVersion`/`status`/`data`/`errors`/`warnings`) 없음 | trace + 정정 |

---

## 6. 분리된 결정 (이번 plan 밖)

- **OP-3 `getCardSymbolCoverage`** — `ed check coverage <key>` 의 의미를 *link-coverage* (declared codeLinks 의 resolve 율) 에서 *symbol-coverage* (이 카드가 가리키는 파일들의 심볼 중 카드가 참조하는 비율) 로 변경. envelope 제거와 직교 — 의미 재정의. 별도 PR. 본 plan 의 Phase 1.3 카드는 link-coverage shape 의 정직한 spec 만 적음 (TODO 본문 박지 않음).
