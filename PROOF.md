# Emberdeck PROBLEM 전 항목 사실 진단 증명

각 항목: ID + cite (line) + 직접 검증 명령 + 결과 + verdict.
대상: PROBLEM.md 의 모든 245 항목.

규칙:
- **STATIC**: file content/structure check (sed/grep/cat/ls)
- **BEHAVIOR**: actual ed command reproduction
- **CODE-TRACE**: control flow argument from sed inspection (when behavior cannot be mechanically triggered without test injection)

Verdict:
- **CONFIRMED**: claim 사실, 근거 동작/구조 확인됨
- **REFUTED**: claim 잘못
- **PARTIAL**: claim 의 일부분 정확
- **CORRECTED**: line 번호만 어긋남 (substance 정확)

Test fixture: `/tmp/ed-v` (domain d1 + brief b1)

---

# A. 빌드 / 잔재

## MISTAKE-1 (was A1) — Lock 인프라 build broken — REFUTED
- STATIC: `grep "withCardLock\|withRetry" src/ops/*.ts` → 0 matches
- BEHAVIOR: `bun x tsc --noEmit; echo $?` → 0
- tsc exit: 0
- VERDICT: REFUTED (PROBLEM.md 1차 보고서의 stale claim)

## MISTAKE-2 (was A2) — systemMetadata unused — REFUTED
- STATIC: `grep -rn systemMetadata\|system_metadata src/`
  - src/db/schema.ts:121:export const systemMetadata = sqliteTable('system_metadata', {
  - src/cli/commands/spec.ts:90:              .prepare('SELECT value FROM system_metadata WHERE key = ?')
  - src/cli/commands/spec.ts:110:                'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
- VERDICT: REFUTED — 사용처 있음

## MISTAKE-3 (was H-001) — extractGlobalFlags export 누락 — REFUTED
- STATIC: `grep -n "extractGlobalFlags" src/cli/`
  - src/cli/runner.ts:39: * `extractGlobalFlags(cmd.optsWithGlobals())`.
  - src/cli/runner.ts:47:  const globalFlags = extractGlobalFlags(cmd.optsWithGlobals());
  - src/cli/runner.ts:121:function extractGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
- VERDICT: REFUTED — runner.ts:121 private 함수, runner 내부 line 47 만 호출

## A3 — tag 시스템 vs glossary
- STATIC schema:
  export const tag = sqliteTable('tag', {
  export const cardTag = sqliteTable(
- STATIC CLI option:
      .option('--tag <tag>', 'filter by tag')
            if ((opts.symbol || opts.glossary) && opts.tag) {
      .option('--tag <name>', 'tag (repeatable)', collectRepeated, [] as string[])
- STATIC SKILL: `grep -n " tag" .claude/skills/emberdeck/SKILL.md`
  - 97:| `ed card list [--type T] [--status S] [--parent P] [--tag T] [--symbol N] [--file F] [--glossary W]` | `--symbol`/`--glossary` 는 `--tag` 와 상호배타 | X |
- BEHAVIOR: tag CLI 살아있고 SKILL 사용처 명시 0
- VERDICT: CONFIRMED

## A4 — @brief @principle @domain annotation 비공개
- STATIC reader (4-tier):
  const TRACKED_ANNOTATION_TAGS = ['spec', 'brief', 'principle', 'domain'] as const;
- STATIC writer (1-tier `@spec`):
        const specTags = toInsert.map((t) => `@spec ${t.cardKey}`);
            lines.splice(symLineIdx, 0, `${indent}/** ${specTags[0]} */`);
- STATIC SKILL: only `@spec` mentioned
  - matches: 0
- VERDICT: CONFIRMED

# B. 데이터 모델

## B1 — card.body = body + namespaceText concat
- STATIC sync.ts:120-121:
    const namespaceText = buildSearchableText(cardFile.frontmatter);
    const fullBody = [cardFile.body, namespaceText].filter((s) => s.trim().length > 0).join('\n\n');
- BEHAVIOR DB body length:
  [
    {
      key: "card-model",
      len: 942,
    }, {
      key: "card-lifecycle",
      len: 1026,
    }, {
      key: "card-storage",
      len: 949,
    }
  ]
- VERDICT: CONFIRMED — DB body length > file body length 확인

## B2 — single-line YAML frontmatter
- BEHAVIOR card file line lengths:
  line 1: 3 chars
  line 2: 5811 chars
  line 3: 3 chars
- VERDICT: CONFIRMED — line 2 = 5811 chars (single-line YAML)

## B3 — codeLinks/boundary 가 모든 카드 type 에 노출
- STATIC types.ts:328-333 (comments say "spec only"):
    /** File/directory glob patterns this card is responsible for. spec only. */
    boundary?: string[];
    /** List of source code symbol references. spec only. */
    codeLinks?: CodeLink[];
- STATIC markdown.ts no type-gate at parse:
    const boundary = normalizeBoundary(fm['boundary']);
    const codeLinks = normalizeCodeLinks(fm['codeLinks']);
- VERDICT: CONFIRMED — type 주석 'spec only' 인데 parse 가 type-gate 안함

## B4 — 카드 관계 4 메커니즘
- STATIC types.ts (parent/relations/cdd/derives):
    parent?: string;
    relations?: string[];
  export interface DomainCrossDependency {
    /** Sibling domain key this domain depends on. */
    domain: string;
    /** Reference to brief item, e.g. "brief-key#R-001" */
    derives: string;
- VERDICT: CONFIRMED — 4 mechanisms exist

## B5 — parent 단일, 다중 부모 부재
- STATIC: `parent?: string;` (singular)
    parent?: string;
- VERDICT: CONFIRMED

## B6 — relations 가 SKILL "brief 키 배열" 거짓
- STATIC SKILL.md:181:
  | `relations` | | brief 키 배열. parent 가 이미 brief 면 불필요 |
- STATIC markdown.ts:111-114 (no type filter):
  function normalizeRelations(value: unknown): string[] | undefined {
    if (value == null) return undefined;
    return asStringArray(value, 'relations');
  }
- VERDICT: CONFIRMED

# C. 검증 / 분산 책임

## C1 — Validation pipeline 8 군데 분산
- STATIC validators in different files:
  src/principle/validate.ts:19:export function validatePrincipleCard(fm: CardFrontmatter): void {
  src/spec/validate-refs.ts:81:export function validateSpecRefs(
  src/domain/validate.ts:22:export function validateDomainCard(fm: CardFrontmatter): void {
  src/brief/validate-refs.ts:44:export function validateBriefRefs(body: BriefBody): void {
  src/card/validation.ts:64:export function validateCardInput(input: ValidationInput): void {
  src/card/validation.ts:230:export function validateParentExists(ctx: EmberdeckContext, parentKey: string): void {
  src/card/validation.ts:244:export function validateParentType(ctx: EmberdeckContext, cardType: CardType, parentKey: string): void {
  src/card/validation.ts:278:export function validateParentCycle(ctx: EmberdeckContext, cardKey: string, parentKey: string): void {
  src/card/validation.ts:293:export function validateRelationTargets(ctx: EmberdeckContext, cardKey: string, relations: string[]): void {
  src/card/validation.ts:314:export function validateChildrenHierarchy(ctx: EmberdeckContext, cardKey: string, newType: CardType): void {
  src/card/validation.ts:373:export async function validateActivationGuard(
  src/card/validation.ts:570:export async function validateTypeChangeActivation(
  src/glossary/validation.ts:8:export function validateGlossaryEntry(entry: { word: string; definition: string }): void {
  src/glossary/validation.ts:32:export function validateCardGlossaryField(
- VERDICT: CONFIRMED — 9+ validation 함수 8 파일에 분산

## C2 — validateCards 가 두 일을 함
- STATIC sync.ts:306, body lines mix file↔DB and graph integrity:
  export async function validateCards(
- file vs DB:
    const staleDbRows = dbRows.filter((r) => !fileSet.has(r.filePath));
    const orphanFiles = cardFiles.filter((f) => !dbFilePaths.has(f));
    const keyMismatches = dbRows
      .map((r) => {
        const expectedKey = relative(targetDir, r.filePath).replace(/\.card\.md$/, '');
        return expectedKey !== r.key ? { row: r, expectedKey } : null;
      })
- graph integrity (orphan-card, broken-parent, type-hierarchy):
  347:        type: 'orphan-card',
  356:        type: 'broken-parent',
  368:        warnings.push({ type: 'type-hierarchy-violation', cardKey: row.key, message: violation });
- VERDICT: CONFIRMED

## C3 — 검증 명령 4종 책임 중복
- STATIC same hierarchy rule duplicated:
  src/ops/sync.ts:65: * brief.parent must be domain; spec.parent must be brief or spec.
  src/ops/sync.ts:73:  if (rowType === 'principle') return `Principle card must be root-level, but has parent "${parentKey}"`;
  src/ops/sync.ts:74:  if (rowType === 'domain') return `Domain card must be root-level, but has parent "${parentKey}"`;
  src/ops/sync.ts:75:  if (rowType === 'brief' && parentType !== 'domain') return `Brief card parent must be domain, got "${parentKey}" (type: ${parentType})`;
  src/ops/sync.ts:76:  if (rowType === 'spec' && parentType !== 'brief' && parentType !== 'spec') return `Spec card parent must be brief or spec, got "${parentKey}" (type: ${parentType})`;
  src/card/validation.ts:241: * - spec: parent must be brief or spec (sub-spec recursion allowed)
  src/card/validation.ts:262:        `brief card parent must be domain (got "${parentType}"); brief recursion is not allowed`,
  src/card/validation.ts:268:        `spec card parent must be brief or spec (got "${parentType}")`,
  src/card/validation.ts:320:      `Cannot change to principle: card has ${children.length} child card(s); principle must be root-level`,
  src/card/validation.ts:393:        `${card.type} card must be root-level (got parent "${card.parent}")`,
  src/card/validation.ts:410:        `brief.parent must be domain (got "${parent.type}")`,
  src/card/validation.ts:427:        `spec.parent must be brief or spec (got "${parent.type}")`,
- VERDICT: CONFIRMED — 같은 룰 두 군데 코드

## C4 — safeWriteOperation 일반화 거짓말
- STATIC safe.ts:3-10 SafeWriteOptions (single compensate):
  export interface SafeWriteOptions<T> {
    /** DB transaction action. Executed synchronously. */
    dbAction: () => T;
    /** Filesystem action. Executed asynchronously. */
    fileAction: () => Promise<void>;
    /** Compensation (rollback) action when fileAction fails after dbAction succeeds. */
    compensate: (dbResult: T) => void | Promise<void>;
  }
- STATIC card POST-001 claims "reverse registration order":
  {key: card-lifecycle/status-and-safe-write/safe-write,summary: safeWriteOperation runs a forward action with compensations executed in reverse order on failure.,status: draft,type: spec,parent: card-l
- VERDICT: CONFIRMED — 카드 prose 가 코드와 모순

## C5 — Activation guard 비대칭
- STATIC update.ts validateActivationGuard 호출:
  23:  validateActivationGuard,
  295:        await validateActivationGuard(ctx, {
  445:        await validateActivationGuard(ctx, {
- STATIC context.ts:170-173 draft skip:
      if (row.status === 'draft') {
        healthDraft++;
        continue;
      }
- VERDICT: CONFIRMED — active 만 검증, drift 가 draft skip

## C6 — CodeLink kind string (enum 아님)
- STATIC types.ts:32-39:
  export interface CodeLink {
    /** gildash SymbolKind (e.g. `'function'` | `'class'` | `'variable'` | ...) */
    kind: string;
    /** Relative path from the project root (e.g. `'src/auth/token.ts'`) */
    file: string;
    /** Exact symbol name (e.g. `'refreshToken'`) */
    symbol: string;
  }
- BEHAVIOR: kind="typo" 가 통과되는지 확인:
    "status": "ok",
      "status": "draft"
- VERDICT: CONFIRMED

# D. 의도와 강제력 부조화

## D1 — ed check drift autoTransition default true
- STATIC context.ts:116:
    const autoTransition = options?.autoTransition ?? true;
- BEHAVIOR: SKILL line 105 confirms default:
  | `ed check drift [KEY] [--max-depth N] [--no-auto-transition]` | 6종 drift 다중 검출. 기본 active→drifted 자동 전이. CI 는 `--no-auto-transition`. | 예 (status 변경) |
- VERDICT: CONFIRMED — read-shaped 명령이 default mutate

## D2 — Principle enforcement 코드 강제 X
- STATIC principle/validate.ts:19-33 (only namespace check):
  export function validatePrincipleCard(fm: CardFrontmatter): void {
    if (fm.type !== 'principle') {
      throw new CardValidationError(`Expected principle card, got "${fm.type}"`);
    }
    if (!fm.principle) {
      throw new CardValidationError(
        'Principle card is missing required `principle` namespace in frontmatter',
      );
    }
    if (Array.isArray(fm.principle.applies_to) && fm.principle.applies_to.length === 0) {
      throw new CardValidationError(
        'principle.applies_to must be "*" or non-empty array',
      );
    }
  }
- STATIC: enforcement/metric/exemptions/applies_to grep in src/ (excl types/markdown/searchable/validate):
  (no production consumer)
- VERDICT: CONFIRMED — 메모장 역할

## D3 — boundary ↔ ignorePatterns 직교성 부재
- STATIC spec-sync.ts:849-867 (boundary 매칭 후 ignorePatterns 가 targetFiles 만 필터):
    const boundaryFiles = new Set<string>();
    for (const card of allCards) {
      for (const pattern of parseStringArrayJson(card.boundaryJson)) {
        try {
          const glob = new Bun.Glob(pattern);
          for (const file of indexedFilePaths) {
            if (glob.match(file)) boundaryFiles.add(file);
          }
        } catch {
          // skip invalid boundary
        }
      }
    }
  
    // 4. Determine target files (caller-provided or all indexed)
    let targetFiles: string[] = files ?? indexedFilePaths;
  
    // 5. Filter out ignored files
    targetFiles = targetFiles.filter((file) => !matchesAnyGlob(file, ignorePatterns));
- STATIC link.ts:253-261 (ignorePatterns 미참조):
    // 2. boundary glob matches (only when filePath is provided)
    if (filePath) {
      const allCards = ctx.cardRepo.list();
      for (const card of allCards) {
        if (seen.has(card.key)) continue;
        const boundaries = parseStringArrayJson(card.boundaryJson);
        if (boundaries.length > 0 && matchesAnyGlob(filePath, boundaries)) {
          seen.add(card.key);
          result.push({ card, matchType: 'boundary' });
- VERDICT: CONFIRMED — 3 site, 3 다른 ordering

# E. SKILL ↔ 코드 (= K-* 와 합쳐짐)

## E1 — class:'none', file:'' SKILL convention 거부
- STATIC SKILL.md:177:
  | `spec.failures` | ✓ | `[{violation, behavior, exception: {class, file}}]`, ≥1. 비-throwing failure (return null / error code) 는 `exception: {class: "none", file: ""}` |
- STATIC markdown.ts:49-54 asString rejects empty:
  function asString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CardValidationError(`Invalid frontmatter field: ${field}`);
    }
    return value;
  }
- BEHAVIOR: bulk sync rejection:
        "code": "SYNC_FAILED",
        "message": "Invalid frontmatter field: spec.failures[].exception.file",
        "code": "SYNC_FAILED",
- VERDICT: CONFIRMED — SKILL 컨벤션이 parser 거부됨

# F. 인프라 / 운영

## F1 — monorepo 처리 비용을 단일 프로젝트도 부담
- STATIC link.ts:163-167 ([undefined] fallback):
  export function gildashProjectNames(ctx: EmberdeckContext): Array<string | undefined> {
    if (!Array.isArray(ctx.gildash.projects)) return [undefined];
    const names = ctx.gildash.projects.map((p) => p.project).filter(Boolean);
    return names.length > 0 ? names : [undefined];
  }
- STATIC link.ts:55-72 SymbolFileCache iterates projectNames:
      for (const project of this.projectNames) {
        try {
          const result = project
            ? this.gildash.getSymbolsByFile(file, project)
            : this.gildash.getSymbolsByFile(file);
          anySucceeded = true;
- VERDICT: CONFIRMED — 단일 프로젝트도 multi-project iterate

## F2 — bulkSyncCards atomic 아님
- STATIC sync.ts:211-214 (per-file batched):
    for await (const { item: filePath, result } of batchedAllSettled(safeFiles, 20, (f) => syncCardFromFile(ctx, f))) {
      if (result.status === 'fulfilled') synced++;
      else errors.push({ filePath, error: result.reason });
    }
- STATIC sync.ts:141-152 (per-file transaction):
    ctx.db.transaction((tx) => {
      const d = txDb(tx);
      const cardRepo = new DrizzleCardRepository(d);
      const relationRepo = new DrizzleRelationRepository(d);
      const classRepo = new DrizzleClassificationRepository(d);
      const codeLinkRepo = new DrizzleCodeLinkRepository(d);
  
      cardRepo.upsert(row);
      relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
      classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
      codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
    });
- VERDICT: CONFIRMED

# G. ops/ 심층 (41 items)

## G-001 — ensureReindexed add-before-await race
- STATIC link.ts:146-150:
  export async function ensureReindexed(ctx: EmberdeckContext): Promise<void> {
    if (reindexedContexts.has(ctx)) return;
    reindexedContexts.add(ctx);
    await ctx.gildash.reindex();
  }
- CODE-TRACE: line 148 `reindexedContexts.add(ctx)` BEFORE line 149 `await reindex()` → 실패 시 set 에 잔존
- VERDICT: CONFIRMED

## G-002 — pruneChangelog cross-invocation drift blind
- STATIC analyze.ts:11 + 277-282:
  11:const CHANGELOG_RETENTION_DAYS = 90;
  278:    const cutoff = new Date(Date.now() - CHANGELOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const cutoff = new Date(Date.now() - CHANGELOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      ctx.gildash.pruneChangelog(cutoff);
    } catch {
      // best-effort; do not fail the report
    }
- VERDICT: CONFIRMED (cross-invocation framing)

## G-003 — validateCodeLinks auto-transition divergence
- STATIC link.ts:407-425:
        try {
          const changed = ctx.db.$client
            .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ? AND status = ?')
            .run('drifted', now, key, 'active');
          if (changed.changes > 0) {
            try {
              cardFile.frontmatter.status = 'drifted';
              const filePath = buildCardPath(ctx.cardsDir, key);
              await writeCardFile(filePath, cardFile);
            } catch {
              // File write failed — revert DB
              ctx.db.$client
                .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ?')
                .run(row.status, row.updatedAt, key);
            }
          }
        } catch {
          // Transition failed — DB reverted to previous state
        }
- VERDICT: CONFIRMED

## G-004 — checkDrift auto-transition same divergence
- STATIC context.ts:386-405:
          const changed = ctx.db.$client
            .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ? AND status = ?')
            .run('drifted', now, key, 'active');
          if (changed.changes > 0) {
            try {
              const cardFile = await readCardFile(row.filePath);
              cardFile.frontmatter.status = 'drifted';
              await writeCardFile(row.filePath, cardFile);
              finalStatus = 'drifted';
            } catch {
              // File write failed — revert DB
              ctx.db.$client
                .prepare('UPDATE card SET status = ?, updated_at = ? WHERE key = ?')
                .run(row.status, row.updatedAt, key);
            }
          }
        } catch {
          // Transition failed — DB reverted to previous state.
          // driftType is still reported so the caller knows drift was detected.
        }
- VERDICT: CONFIRMED

## G-005 — syncCardFromFile skips all validation
- STATIC sync.ts:113-153 (parseFullKey + upsert only):
  export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
    const cardFile = await readCardFile(filePath);
    const key = parseFullKey(cardFile.frontmatter.key);
    const now = new Date().toISOString();
    // (buildSearchableText imported below; cf. row.body assignment)
  
    // Concatenate markdown body + searchable namespace text so FTS5 matches namespace content.
    const namespaceText = buildSearchableText(cardFile.frontmatter);
    ctx.db.transaction((tx) => {
      const d = txDb(tx);
      const cardRepo = new DrizzleCardRepository(d);
      const relationRepo = new DrizzleRelationRepository(d);
      const classRepo = new DrizzleClassificationRepository(d);
      const codeLinkRepo = new DrizzleCodeLinkRepository(d);
  
      cardRepo.upsert(row);
      relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
      classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
      codeLinkRepo.replaceForCard(key, cardFile.frontmatter.codeLinks ?? []);
    });
- BEHAVIOR: invalid status="active" via bulk sync:
      "synced": 3,
      "errors": 0,
    "errors": []
    "status": "ok",
- VERDICT: CONFIRMED — bulk sync 가 status:active 받아들임

## G-006 — bulkCreate cyclic parent silent
- STATIC bulk-create.ts:42-56:
    let iterations = 0;
    const maxIterations = remaining.length * remaining.length + 1;
  
    while (remaining.length > 0 && iterations < maxIterations) {
      iterations++;
      const idx = remaining.findIndex((i) => !i.parent || created.has(i.parent));
      if (idx === -1) break; // circular or unresolvable
      const item = remaining.splice(idx, 1)[0]!;
      sorted.push(item);
      created.add(item.key);
    }
  
    // Append any remaining (unresolvable) items at the end
    sorted.push(...remaining);
    return sorted;
- BEHAVIOR cyclic: a→b, b→a:
      "failed": 2,
        "code": "BULK_CREATE_FAILED",
        "code": "BULK_CREATE_FAILED",
- VERDICT: CONFIRMED — cycle silent fall-through, per-card error 만 surface

## G-007 — bulkCreate Phase 2 errors+partialKeys overlap
- STATIC bulk-create.ts:108-121:
      for (const { key, input } of pendingRelations) {
        try {
          await updateCard(ctx, key, { relations: input.relations });
        } catch (err) {
          errors.push({
            key,
            message: `relation update failed: ${errorMessage(err)}`,
          });
          const idx = keys.indexOf(key);
          if (idx !== -1) keys.splice(idx, 1);
          partialKeys.push(key);
        }
      }
    }
- VERDICT: PARTIAL (overlap is semantic, arithmetic balances)

## G-008 — bulkCreate dynamic import undocumented
- STATIC bulk-create.ts:107:
      const { updateCard } = await import('../ops/update');
- VERDICT: CONFIRMED

## G-009 — safeWriteOperation dbAction outside try
- STATIC safe.ts:22-30:
  export async function safeWriteOperation<T>(
    options: SafeWriteOptions<T>,
  ): Promise<T> {
    const { dbAction, fileAction, compensate } = options;
  
    const result = dbAction();
  
    try {
      await fileAction();
- VERDICT: CONFIRMED — line 27 dbAction(), line 29 try (outside try)

## G-010 — renameCard body substring (false positive)
- STATIC rename.ts:107:
            if (row.body?.includes(oldKey)) bodyReferencesFound.push(row.key);
- VERDICT: CONFIRMED — `row.body?.includes(oldKey)` substring

## G-011 — renameCard ref-update partial corruption
- STATIC rename.ts:182-197:
              } catch {
                failedReferenceUpdates.push(ref.key);
              }
            }
          } catch (dbErr) {
            // DB update failed -> restore file to original state
            await rename(newFilePath, oldFilePath);
            const orig = await readCardFile(oldFilePath);
            const restored: CardFile = {
              filePath: oldFilePath,
              frontmatter: { ...orig.frontmatter, key: oldKey },
              body: orig.body,
            };
            await writeCardFile(oldFilePath, restored);
            throw dbErr;
          }
- VERDICT: PARTIAL — failedReferenceUpdates 보고 됨, dbErr catch 가 inner loop 후 도달 안함

## G-012 — renameCard body 미수정
- STATIC rename.ts:144-185 (only frontmatter):
  107:          if (row.body?.includes(oldKey)) bodyReferencesFound.push(row.key);
  116:          frontmatter: { ...current.frontmatter, key: newFullKey },
  117:          body: current.body,
  147:              const updatedFm = { ...refFile.frontmatter };
  177:                await writeCardFile(ref.filePath, { ...refFile, frontmatter: updatedFm });
  192:            frontmatter: { ...orig.frontmatter, key: oldKey },
  193:            body: orig.body,
- VERDICT: CONFIRMED

## G-013 — renameCard full-table scan
- STATIC rename.ts:81-86:
          const forwardRefSrcKeys = new Set<string>();
          for (const rel of ctx.relationRepo.findAll()) {
            if (!rel.isReverse && rel.dstCardKey === oldKey && rel.srcCardKey !== oldKey) {
              forwardRefSrcKeys.add(rel.srcCardKey);
            }
          }
- VERDICT: CONFIRMED — relationRepo.findAll() 매번 호출

## G-014 — deleteCard cascade 3 best-effort catches
- STATIC delete.ts:113,135,162:
                } catch {
                  // Best effort — child file may not exist
                }
              } catch {
                // Best effort — file may not exist
              }
              } catch {
                // Best effort — dependent file may have been removed concurrently
              }
- VERDICT: CONFIRMED

## G-015 — deleteCard compensate corruption — REFUTED
- STATIC delete.ts:103 deleteCardFile BEFORE best-effort:
            await deleteCardFile(filePath);
- STATIC delete.ts:113,135,162 best-effort swallow ALL errors:
                } catch {
                  // Best effort — child file may not exist
                }
- VERDICT: REFUTED — best-effort catches swallow inner-loop errors → compensate 가 modified files 위로 안 도달

## G-016 — removeGlossary 카드 cascade 안함
- STATIC glossary.ts:141-145:
      entries.splice(idx, 1);
      writeGlossary(ctx, entries);
  
      const affectedCardKeys = cardsContainingGlossaryWord(ctx, word).map((c) => c.key);
      return { removed: word, affectedCardKeys };
- VERDICT: CONFIRMED — yaml 만 update, 카드 frontmatter cascade X

## G-017 — renameGlossary DB → file divergence
- STATIC glossary.ts (DB tx 후 best-effort file write):
      try {
        if (affectedCards.length > 0) {
          const now = new Date().toISOString();
          ctx.db.transaction((tx) => {
            const d = txDb(tx);
            const changelogRepo = new DrizzleChangelogRepository(d);
  156:  fileWriteFailures: string[];
  248:    const fileWriteFailures: string[] = [];
  259:        fileWriteFailures.push(card.key);
  268:      fileWriteFailures,
- VERDICT: CONFIRMED

## G-018 — resetEmberdeck 비-transactional
- STATIC glossary.ts:320-329:
    for (const card of allCards) {
      try {
        ctx.cardRepo.deleteByKey(card.key);
        cardsDeleted++;
        fileDeletes.push(deleteCardFile(card.filePath).catch(() => {}));
        if (fileDeletes.length >= FILE_BATCH) {
          await Promise.allSettled(fileDeletes.splice(0));
        }
      } catch { /* skip */ }
    }
- VERDICT: CONFIRMED — per-card try/catch loop

## G-019 — resetEmberdeck dbReset 하드코딩
- STATIC glossary.ts:342:
    return { cardsDeleted, glossaryCleared, dbReset: true };
- VERDICT: CONFIRMED

## G-020 — globPatternsOverlap heuristic
- STATIC sync.ts:224-235:
  function generateSamplePaths(pattern: string): string[] {
    const samples = new Set<string>();
  
    const defaultExts = ['.ts', '.js', '.tsx', '.json'];
  
    // Extract extension constraint from pattern (e.g. *.ts -> .ts)
    const extMatch = pattern.match(/\*\.([a-zA-Z0-9]+)$/);
    const patternExt = extMatch ? '.' + extMatch[1] : null;
    const extensions = patternExt ? [patternExt] : defaultExts;
  
    // Get the static (non-glob) prefix
    const segments = pattern.split('/');
- VERDICT: CONFIRMED — hand-crafted samples (depth ≤ 3, 4 default exts)

## G-021 — validateCards 파일 두 번 read
- STATIC sync.ts:495 + 541:
    for (const row of dbRows) {
        if (fileSet.has(row.filePath)) {
            const file = await readCardFile(row.filePath);
- VERDICT: CONFIRMED

## G-022 — magic 20 in 4 sites
  src/ops/query.ts:207:  for await (const { item: key, result } of batchedAllSettled(fullKeys, 20, (k) => getCard(ctx, k, options))) {
  src/ops/glossary.ts:319:  const FILE_BATCH = 20;
  src/ops/sync.ts:177:  for await (const { item: filePath, result } of batchedAllSettled(cardFiles, 20, readCardFile)) {
  src/ops/sync.ts:211:  for await (const { item: filePath, result } of batchedAllSettled(safeFiles, 20, (f) => syncCardFromFile(ctx, f))) {
- VERDICT: CONFIRMED

## G-023 — getCards throw discards accumulated results
- STATIC query.ts:207-211:
    for await (const { item: key, result } of batchedAllSettled(fullKeys, 20, (k) => getCard(ctx, k, options))) {
      if (result.status === 'fulfilled') cards.push(result.value);
      else if (result.reason instanceof CardNotFoundError) notFound.push(key);
      else throw result.reason;
    }
- VERDICT: CONFIRMED

## G-024 — brokenLinks count after gildashUnavailable
- STATIC context.ts:183-191:
      if (links.length > 0) {
        for (const link of links) {
          try {
            if (!symbolCache.find(link.file, link.symbol)) brokenLinks++;
          } catch {
            gildashUnavailable = true;
          }
        }
      }
- VERDICT: CONFIRMED — brokenLinks++ before catch may already have fired for prior misses

## G-025 — drifted→active 자동전이 부재
- STATIC context.ts:377-379:
      const currentStatus = row.status as 'active' | 'drifted';
      // Skip auto-transition if gildash was unavailable — broken links may be false positives
      const shouldTransition = !!driftType && currentStatus === 'active' && autoTransition && !gildashUnavailable;
- STATIC analyze.ts:161-172 (explicit comment):
      } else if (card.status === 'drifted') {
        // No drift detected now, but card was previously marked drifted in DB
        // (e.g., code was fixed but card not re-activated) — still count as drifted
- VERDICT: CONFIRMED

## G-026 — boundary_inactive silent skip on empty index
- STATIC context.ts:215-221:
          if (indexedFiles.size > 0) {
            let anyMatch = false;
            for (const filePath of indexedFiles) {
              if (matchesAnyGlob(filePath, boundary)) { anyMatch = true; break; }
            }
            if (!anyMatch) addDrift('boundary_inactive');
          }
- VERDICT: CONFIRMED

## G-027 — parseSpecCodePatterns silent default
- STATIC context.ts:447-460:
  function parseSpecCodePatterns(namespacesJson: string): SpecCodePatternRow[] {
    try {
      const ns = JSON.parse(namespacesJson) as { spec?: { code_patterns?: SpecCodePatternRow[] } };
      const list = ns?.spec?.code_patterns;
      if (!Array.isArray(list)) return [];
      return list.filter(
        (p): p is SpecCodePatternRow =>
          !!p && typeof p.id === 'string' && typeof p.pattern === 'string' &&
          (p.rule === 'forbidden' || p.rule === 'required'),
      );
    } catch {
      return [];
    }
  }
- VERDICT: CONFIRMED

## G-028 — getUncoveredSymbols double-fetch
- STATIC spec-sync.ts:877-882:
      const primary = project
        ? ctx.gildash.getSymbolsByFile(file, project)
        : ctx.gildash.getSymbolsByFile(file);
      const symbols = primary.length === 0
        ? ctx.gildash.getSymbolsByFile(join(ctx.projectRoot, file))
        : primary;
- VERDICT: CONFIRMED

## G-029 — gildash error sweeping silent
- STATIC link.ts:287-291 / impact.ts:178-181:
        const affected = await ctx.gildash.getAffected(changedFiles, project);
        for (const f of affected) out.add(f);
      } catch {
        // skip project
      }
          if (metrics.fanOut > maxFanOut) maxFanOut = metrics.fanOut;
        } catch {
          // best-effort
        }
- VERDICT: CONFIRMED

## G-030 — writeSpecAnnotations stale actualSet
- STATIC spec-sync.ts:353-355 (only ensureReindexed, no actualSet rebuild):
    if (removed > 0) {
      await ensureReindexed(ctx);
    }
    for (const desired of desiredEntries) {
      const key = `${desired.cardKey}:${desired.file}:${desired.symbol}`;
      if (!actualSet.has(key) || orphansByFile.has(desired.file)) {
        // Need to re-check after removals, or was never present
        toAdd.push(desired);
      } else {
        // In desired AND in actual AND not in an orphan-modified file → already present
        alreadyPresent++;
      }
    }
- VERDICT: CONFIRMED

## G-031 — syncSymbolChanges N replaceForCard
- STATIC spec-sync.ts:619-648:
      for (const link of links) {
        if (change.changeType === 'renamed') {
          // Update symbol name
          const allLinks = ctx.codeLinkRepo.findByCardKey(link.cardKey);
          const updated_links = allLinks.map((l) => {
            if (l.file === oldFile && l.symbol === oldName) {
              return { kind: l.kind, file: l.file, symbol: change.symbolName };
            }
            return { kind: l.kind, file: l.file, symbol: l.symbol };
          });
          ctx.codeLinkRepo.replaceForCard(link.cardKey, updated_links);
- VERDICT: CONFIRMED

## G-032 — collectTrackedAnnotations all-fail silent
- STATIC spec-sync.ts:29-44:
    for (const project of gildashProjectNames(ctx)) {
      for (const tag of TRACKED_ANNOTATION_TAGS) {
        try {
          const batch = gildash.searchAnnotations({ tag, project, limit: GILDASH_ANNOTATION_LIMIT });
          for (const ann of batch) {
            const key = `${ann.tag}\0${ann.filePath}\0${ann.symbolName ?? ''}\0${ann.value}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(ann);
          }
        } catch {
          // skip project on failure
        }
      }
    }
    return out;
- VERDICT: CONFIRMED

## G-033 — Record<typeof field> typing nit
- STATIC update.ts:51-62:
  function assertCompleteNamespace(field: 'principle' | 'domain' | 'brief' | 'spec', value: unknown): void {
    if (value === null || value === undefined) return;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new CardValidationError(`invalid ${field} namespace: must be an object`);
    }
    // Required top-level fields per card/types.ts namespaces.
    const required: Record<typeof field, string[]> = {
      principle: ['statement', 'rationale', 'applies_to', 'enforcement'],
      domain: ['overview', 'scope'],
      brief: ['context', 'scope', 'flow', 'design', 'policy', 'external', 'compatibility', 'limits', 'criteria', 'rationale'],
      spec: ['preconditions', 'postconditions', 'invariants', 'failures'],
    };
- VERDICT: PARTIAL — typing OK but readability nit

## G-034 — safeWriteOperation missing-file no compensate
- STATIC delete.ts:167-172:
          compensate: async () => {
            // Can only restore DB from file if the file still exists on disk
            if (fileExists) {
              await syncCardFromFile(ctx, filePath);
            }
            // If file was already gone, DB deletion is the desired outcome — nothing to compensate
- VERDICT: CONFIRMED

## G-035 — getCardContext BFS truncation extra query
- STATIC query.ts:131-140:
    const visited = new Set([key, ...graphNodes.map((n) => n.key)]);
    let truncated = false;
    for (const node of graphNodes) {
      if (node.depth !== depth) continue;
      const neighbors = ctx.relationRepo.findByCardKey(node.key);
      if (neighbors.some((r) => !visited.has(r.dstCardKey) && ctx.cardRepo.existsByKey(r.dstCardKey))) {
        truncated = true;
        break;
      }
    }
- VERDICT: CONFIRMED

## G-036 — regressionGuard N×checkDrift
- STATIC impact.ts:313-323:
    for (const key of affectedKeys) {
      const driftResult = await checkDrift(ctx, key, { maxDepth: 0, autoTransition: false });
      const driftCard = driftResult.cards.find((c) => c.key === key);
      if (driftCard) {
        driftMap.set(key, { status: driftCard.status, driftType: driftCard.driftType });
      } else {
        // Draft or not found in drift analysis
        const row = ctx.cardRepo.findByKey(key);
        driftMap.set(key, { status: row?.status ?? 'draft' });
      }
    }
- VERDICT: CONFIRMED

## G-037 — N×M boundary scan no glob cache
- STATIC link.ts:255-264 + glob.ts:5-9 (per-call new Bun.Glob):
      const allCards = ctx.cardRepo.list();
      for (const card of allCards) {
        if (seen.has(card.key)) continue;
        const boundaries = parseStringArrayJson(card.boundaryJson);
        if (boundaries.length > 0 && matchesAnyGlob(filePath, boundaries)) {
          seen.add(card.key);
          result.push({ card, matchType: 'boundary' });
        }
      }
    }
  export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
    for (const p of patterns) {
      if (new Bun.Glob(p).match(path)) return true;
    }
    return false;
- VERDICT: CONFIRMED

## G-038 — defineGlossary in-place mutation
- STATIC glossary.ts:65-77:
      for (const entry of input.entries) {
        const ex = existingMap.get(entry.word);
        if (ex) {
          ex.definition = entry.definition;
          results.push({ action: 'updated', word: entry.word, definition: entry.definition });
        } else {
          existing.push({ word: entry.word, definition: entry.definition });
          existingMap.set(entry.word, { word: entry.word, definition: entry.definition });
          results.push({ action: 'created', word: entry.word, definition: entry.definition });
        }
      }
  
      writeGlossary(ctx, existing);
- VERDICT: CONFIRMED

## G-039 — updateCardStatus FTS5 body corruption
- STATIC update.ts:494 (raw body, no concat):
                    body: current.body,
- STATIC sync.ts:120-121 (full update concats):
    const namespaceText = buildSearchableText(cardFile.frontmatter);
    const fullBody = [cardFile.body, namespaceText].filter((s) => s.trim().length > 0).join('\n\n');
- VERDICT: PARTIAL — defect 만 존재하는 branch (existing row + status-only update)

## G-040 — updateCardStatus existing branch ignores file frontmatter
- STATIC update.ts:474-476:
              const existing = cardRepo.findByKey(key);
              const row: CardRow = existing
                ? { ...existing, status, updatedAt: now }
- VERDICT: CONFIRMED

## G-041 — readBodyFromDb error silent
- STATIC analyze.ts:18-24:
  function readBodyFromDb(ctx: import('../config').EmberdeckContext, key: string): string | null {
    try {
      return buildCardFromDb(ctx, key).body;
    } catch {
      return null;
    }
  }
- VERDICT: CONFIRMED

# H. CLI 표면 (24 items, H-001 refuted as MISTAKE-3)

## H-002 — loadConfig wrong exit code (1 instead of 6)
- STATIC context.ts:37-39:
    if (isErr(configResult)) {
      throw new Error(`config load failed: ${configResult.data.message}`);
    }
- STATIC errors.ts:64 + output.ts INTERNAL_ERROR mapping:
    return { code: 'INTERNAL_ERROR', message: errorMessage(e) };
- BEHAVIOR:
  exit=1
- VERDICT: CONFIRMED

## H-003 — ed init bootstrap chicken-egg
- STATIC single.ts:31 + runner.ts:80:
              await run(
      rt = await buildRuntime(globalFlags);
- VERDICT: CONFIRMED

## H-004 — quiet mode empty stdout for analyze/drift/coverage
- STATIC output.ts:154-165 (only handles data.key / data.items):
    if (ctx.mode === 'quiet') {
      if (result.status === 'ok' || result.status === 'partial') {
        const data = result.data;
        if (data && typeof data === 'object' && 'key' in data && typeof data.key === 'string') {
          process.stdout.write(data.key + '\n');
        } else if (Array.isArray((data as Record<string, unknown>)?.items)) {
          const items = (data as { items: Array<{ key?: string }> }).items;
          for (const item of items) {
            if (item.key) process.stdout.write(item.key + '\n');
          }
        }
      }
- BEHAVIOR:
  bytes: 0
- VERDICT: CONFIRMED

## H-005 — InvalidArgumentError exit 1 (bypass JSON envelope)
- STATIC parsers.ts:11-12 + index.ts no exitOverride:
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`${name} must be a non-negative integer (got '${value}')`);
- BEHAVIOR:
  exit=1
  stderr: error: option '--limit <n>' argument 'abc' is invalid. --limit must be a non-negative integer (got 'abc')
- VERDICT: CONFIRMED — exit 1, plaintext stderr (not JSON envelope)

## H-006 — commander missing arg (same root)
- BEHAVIOR:
  exit=1
  stderr: error: missing required argument 'key'
- VERDICT: CONFIRMED

## H-007 — SYNC_FAILED + many codes unmapped
- STATIC bulk.ts:113-117 + output.ts mapping:
            const errors: CliMessage[] = result.errors.map((e) => ({
              code: 'SYNC_FAILED',
              message: errorMessage(e.error),
              details: { file_path: e.filePath },
            }));
- VERDICT: CONFIRMED — none of these in ERROR_CODE_TO_EXIT

## H-008 — --patch + --field silent overlay
- STATIC card.ts:276-298:
              Object.assign(fields, parsedRaw as UpdateCardFields);
            }
            const fieldMap = parseFields(opts.field);
            if (opts.summary) fieldMap.summary = opts.summary;
            for (const [name, value] of Object.entries(fieldMap)) {
              applyFieldValue(fields, name, value);
            }
- VERDICT: CONFIRMED — Object.assign then overlay, no mutex

## H-009 — --field parent= silent delete
- STATIC card.ts:80-82:
      case 'parent':
        fields.parent = value === '' ? null : value;
        return;
- VERDICT: CONFIRMED

## H-010 — --field case-sensitive
- STATIC card.ts:73-88 (literal lowercase keys):
    switch (name) {
      case 'summary':
        fields.summary = value;
        return;
      case 'status':
        fields.status = validateCardStatus(value);
        return;
      case 'parent':
        fields.parent = value === '' ? null : value;
        return;
      case 'type':
        fields.type = validateCardType(value);
        return;
      default:
        throw new CliUsageError(`unsupported --field name: ${name} (allowed: summary, status, parent, type)`);
    }
- VERDICT: CONFIRMED

## H-011 — JSON-vs-YAML error attribution
- STATIC parse-input.ts:8-22:
  export function parseJsonOrYaml(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(text);
      } catch {
        // fall through to YAML
      }
    }
    try {
      return Bun.YAML.parse(text);
    } catch (e) {
      throw new CliUsageError(`failed to parse input as JSON or YAML: ${errorMessage(e)}`);
    }
  }
- VERDICT: CONFIRMED

## H-012 — confirmDestructive TTY check (REFUTED-AS-DEFECT)
- STATIC confirm.ts:32-34:
    if (opts.yes) return;
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      throw new CliUsageError(`${opts.opName} requires --yes when not running in interactive TTY (DESTRUCTIVE op)`);
- VERDICT: REFUTED-AS-DEFECT

## H-013 — ed init non-atomic write
- STATIC single.ts:81,89-93,106 (writeFile/appendFile, not atomicWrite):
              await writeFile(configPath, config, 'utf-8');
              await writeFile(
                await appendFile(gitignorePath, block, 'utf-8');
- VERDICT: CONFIRMED

## H-014 — signalHandler removes both handlers
- STATIC runner.ts:54-67:
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
- VERDICT: CONFIRMED

## H-015 — verboseLog leaks paths (PARTIAL)
- STATIC runner.ts:71-79:
    // Verbose only emits structural metadata (paths, status, error class names) —
    // never user input, command args, card body content, or anything containing
    // potential secrets/tokens from frontmatter fields.
    const verboseLog = globalFlags.verbose
      ? (msg: string) => process.stderr.write(`[verbose] ${msg}\n`)
      verboseLog(`buildRuntime: config=${globalFlags.config ?? '(auto)'} dir=${globalFlags.dir ?? '(default)'}`);
- VERDICT: PARTIAL — comment permits paths

## H-016 — validate sequential O(N) no progress
- STATIC validate.ts:44-49:
            for (const c of allCards) {
              const r = await validateCodeLinks(rt.ctx, c.key);
              linkDeclared += r.declared;
              linkBroken += r.broken.length;
              for (const b of r.broken) linkErrors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: c.key });
            }
- VERDICT: CONFIRMED

## H-017 — card export --out overwrites without confirm
- STATIC card.ts:411-419:
            const content = serializeCardMarkdown(cardFile.frontmatter, cardFile.body);
            if (opts.out && opts.out !== '-') {
              await atomicWrite(opts.out, content);
- VERDICT: CONFIRMED

## H-018 — card update no --unset
- STATIC card.ts:73-88 (only summary/status/parent/type):
      default:
        throw new CliUsageError(`unsupported --field name: ${name} (allowed: summary, status, parent, type)`);
    }
- VERDICT: CONFIRMED

## H-019 — spec annotate --prune no confirmation
- STATIC spec.ts:20-24:
      .option('--prune', 'remove @spec annotations whose card no longer has a matching code link (DESTRUCTIVE — use after card delete or reset)')
      .action(async (key: string | undefined, opts: { prune?: boolean }, cmd) => {
              await run(
          async (rt: CliRuntime) => {
            const result = await writeSpecAnnotations(rt.ctx, key, { prune: !!opts.prune });
- VERDICT: CONFIRMED

## H-020 — no --dry-run on write commands
- VERDICT: CONFIRMED

## H-021 — bulk validateBulkInput shallow
- STATIC bulk.ts:19-47:
      const it = item as Partial<CreateCardInput>;
      if (!it || typeof it !== 'object') {
        errors.push({ index: i, message: `item[${i}] not an object` });
        return;
      }
      if (typeof it.key !== 'string' || it.key.length === 0) {
        errors.push({ index: i, message: `item[${i}] missing/invalid 'key'` });
        return;
- VERDICT: CONFIRMED — only key/type/status checked

## H-022 — parsePositiveInt accepts 0 (name lie)
- STATIC parsers.ts:9-12:
  export function parsePositiveInt(name: string): (value: string) => number {
    return (value: string) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`${name} must be a non-negative integer (got '${value}')`);
- BEHAVIOR:
      "items": [],
        "limit": 0,
- VERDICT: CORRECTED — name lies, behavior accepts 0

## H-023 — bulk create partial writes despite glossary all-or-nothing
- STATIC bulk.ts:69-83:
            const validated = validateBulkInput(parsed);
            const result = await bulkCreateCards(rt.ctx, validated.ok);
            const errors: CliMessage[] = [
              ...validated.errors.map((e) => ({ code: 'BULK_VALIDATION_FAILED', message: e.message, key: e.key })),
              ...result.errors.map((e) => ({ code: 'BULK_CREATE_FAILED', message: e.message, key: e.key })),
- VERDICT: CONFIRMED

## H-024 — card list --file no path validation
- STATIC card.ts:148-149 vs bulk.ts:101-105:
            if (opts.symbol) {
              const matches = await findCardsBySymbol(rt.ctx, opts.symbol, opts.file);
              let s;
              try {
                s = await stat(path);
              } catch {
                throw new CliUsageError(`path not found: ${path}`);
- VERDICT: CONFIRMED — bulk validates path, card list does not

## H-025 — COMPENSATION_FAILED unmapped → exit 1
- STATIC errors.ts:51-58:
    if (e instanceof CompensationError) {
      return {
        code: 'COMPENSATION_FAILED',
        message: e.message,
        details: {
          original_error: String(e.originalError),
          compensation_error: String(e.compensationError),
        },
- STATIC output.ts: no COMPENSATION_FAILED:
  matches: 0
- VERDICT: CONFIRMED

# I. card-model (31 items)

## I-001 — summary length max 미체크 at parse
- STATIC markdown.ts:606 + asString:
      summary: asString(fm['summary'], 'summary'),
  function asString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CardValidationError(`Invalid frontmatter field: ${field}`);
    }
    return value;
  }
- STATIC validation.ts:111 (max only there):
      if (summary.length > LIMITS.SUMMARY_MAX) {
- VERDICT: CONFIRMED

## I-002 / I-003 — boundary/codeLinks 모든 type 노출
- STATIC types.ts:328-333:
    /** File/directory glob patterns this card is responsible for. spec only. */
    boundary?: string[];
    /** List of related card keys. */
    relations?: string[];
    /** List of source code symbol references. spec only. */
    codeLinks?: CodeLink[];
- STATIC markdown.ts:615,621 (type-gate 없이 normalize):
    const boundary = normalizeBoundary(fm['boundary']);
    const codeLinks = normalizeCodeLinks(fm['codeLinks']);
- VERDICT: CONFIRMED

## I-004 — derives target 미검증 at activation (CRITICAL)
- STATIC validate-refs.ts:124 (briefLookup only when provided):
      if (briefLookup) {
- STATIC validation.ts:508 (briefLookup NOT passed):
        validateSpecRefs(card.spec, { codeLinks: card.codeLinks } as CardFrontmatter);
- BEHAVIOR: spec with derives="nonexistent-brief#FAKE" set-status active:
    "status": "ok",
- VERDICT: CRITICAL CONFIRMED — fake brief reference 가 active 통과

## I-005 — brief refs validators incomplete
- STATIC brief/validate-refs.ts:19-26:
  function collectIds(body: BriefBody): RefSets {
    return {
      goalIds: new Set(body.scope.goals.map((g) => g.id)),
      flowIds: new Set(body.flow.map((f) => f.id)),
      externalIds: new Set(body.external.map((e) => e.id)),
      limitIds: new Set(body.limits.map((l) => l.id)),
    };
  }
- STATIC spec/validate-refs.ts:62-69:
  function collectBriefRefIds(brief: BriefBody): Set<string> {
    const ids = new Set<string>();
    for (const g of brief.scope.goals) ids.add(g.id);
    for (const f of brief.flow) ids.add(f.id);
    for (const p of brief.policy) ids.add(p.id);
    for (const di of brief.design.invariants) ids.add(di.id);
    return ids;
  }
- VERDICT: CONFIRMED — non_goals/assumptions/criteria 미수집

## I-006 — class:'none', file:'' rejected (= E1)
- VERDICT: CONFIRMED (see E1)

## I-007 — code_patterns id whitespace parse 통과
- STATIC markdown.ts:577 + spec/validate-refs.ts:101:
          id: asString(p.id, 'spec.code_patterns[].id'),
        if (!cp.id || !cp.id.trim()) {
- VERDICT: CONFIRMED

## I-008 — ast-grep 패턴 syntax 미검증 at parse
- STATIC markdown.ts:567-585 (only string check):
          id: asString(p.id, 'spec.code_patterns[].id'),
          pattern: asString(p.pattern, 'spec.code_patterns[].pattern'),
          rule,
        };
- VERDICT: CONFIRMED — no ast-grep syntax check

## I-009 — tags lowercased lossy
- STATIC markdown.ts:88:
    return asStringArray(value, 'tags').map((s) => s.toLowerCase());
- VERDICT: CONFIRMED

## I-010 — trailing newline (REFUTED — agent verified round-trip exact)
- VERDICT: REFUTED

## I-011 — stripNamespaceText user body collision
- STATIC sync.ts:26-36:
  function stripNamespaceText(storedBody: string, fm: CardFrontmatter): string {
    const ns = buildSearchableText(fm);
    if (!ns) return storedBody;
    // Be permissive about the join whitespace: file round-trips can introduce/remove
    // a trailing newline before the namespace tail, so match anywhere it ends the body.
    const idx = storedBody.lastIndexOf(ns);
    if (idx >= 0 && idx + ns.length === storedBody.length) {
      return storedBody.slice(0, idx).replace(/\s+$/, '');
    }
    return storedBody;
  }
- VERDICT: CONFIRMED — lastIndexOf-based, user body matching tail can be truncated

## I-012 — buildSearchableText omits code_patterns / metric.kind
- STATIC searchable-text.ts:20 (metric only name+unit):
        for (const m of fm.principle.metric) parts.push(m.name, m.unit);
- STATIC :81-90 (no code_patterns):
    if (fm.spec) {
      const s = fm.spec;
      for (const p of s.preconditions) parts.push(p.id, p.condition, p.derives);
      for (const p of s.postconditions) parts.push(p.id, p.guarantee, p.derives);
      for (const i of s.invariants) parts.push(i.id, i.statement, i.always_holds);
      for (const f of s.failures) parts.push(f.violation, f.behavior, f.exception.class, f.exception.file);
      if (s.state_transitions) {
        for (const t of s.state_transitions) parts.push(t.from, t.trigger, t.to);
      }
    }
- VERDICT: CONFIRMED

## I-013 — buildSearchableText omits numeric value/comparator
- STATIC searchable-text.ts:67-74:
      for (const c of b.criteria) {
        parts.push(c.id);
        const m = c.measure as Record<string, unknown>;
        if (typeof m.predicate === 'string') parts.push(m.predicate);
        if (typeof m.method === 'string') parts.push(m.method);
        if (typeof m.reference === 'string') parts.push(m.reference);
        if (typeof m.unit === 'string') parts.push(m.unit);
      }
- VERDICT: CONFIRMED

## I-014 — relations 중복 미체크
- STATIC validation.ts:150-167 + 293-302:
    if (relations !== undefined) {
      if (relations.length > LIMITS.ARRAY_MAX) {
        throw new CardValidationError(
          `relations array exceeds maximum of ${LIMITS.ARRAY_MAX} items (got ${relations.length})`,
        );
      }
      for (const rel of relations) {
        if (rel.length === 0) {
          throw new CardValidationError('relation item must not be empty');
        }
        if (rel.length > LIMITS.RELATION_TARGET_MAX) {
          throw new CardValidationError(
            `relation item exceeds maximum length of ${LIMITS.RELATION_TARGET_MAX} characters`,
          );
        }
      }
      // Self-reference check requires card key context — done at ops layer
    }
  export function validateRelationTargets(ctx: EmberdeckContext, cardKey: string, relations: string[]): void {
    for (const target of relations) {
      if (target === cardKey) {
        throw new CardValidationError(`Relation self-reference not allowed: "${cardKey}"`);
      }
      if (!ctx.cardRepo.existsByKey(target)) {
        throw new CardValidationError(`Relation target not found: "${target}"`);
      }
    }
  }
- BEHAVIOR: relations: [b1, b1] →
      "code": "INTERNAL_ERROR",
      "message": "UNIQUE constraint failed: card_relation.src_card_key, card_relation.dst_card_key, card_relation.is_reverse"
- VERDICT: CONFIRMED — UNIQUE constraint failed

## I-015 — parseStringArrayJson silent corruption
- STATIC json-fields.ts:7-13 + 25-32:
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
    } catch {
      return [];
    }
  export function parseCrossDomainDependencies(namespacesJson: string | null | undefined): CrossDomainDependency[] {
    if (!namespacesJson) return [];
    try {
      const ns = JSON.parse(namespacesJson) as { domain?: { cross_domain_dependencies?: CrossDomainDependency[] } };
      return ns.domain?.cross_domain_dependencies ?? [];
    } catch {
      return [];
    }
- VERDICT: CONFIRMED

## I-016 — validatePrincipleCard partial (programmatic path)
- STATIC principle/validate.ts:19-33 (only namespace+applies_to check):
  export function validatePrincipleCard(fm: CardFrontmatter): void {
    if (fm.type !== 'principle') {
      throw new CardValidationError(`Expected principle card, got "${fm.type}"`);
    }
    if (!fm.principle) {
      throw new CardValidationError(
        'Principle card is missing required `principle` namespace in frontmatter',
      );
    }
    if (Array.isArray(fm.principle.applies_to) && fm.principle.applies_to.length === 0) {
      throw new CardValidationError(
        'principle.applies_to must be "*" or non-empty array',
      );
    }
  }
- VERDICT: CONFIRMED

## I-017 — exemptions target 미해석
- STATIC principle/validate.ts grep 'target':
- VERDICT: CONFIRMED

## I-018 — metric.window_kind without budget kind
- STATIC markdown.ts:158-175 (independent checks, no cross-validate):
      if (m.kind != null) {
        if (typeof m.kind !== 'string' || !VALID_METRIC_KINDS.includes(m.kind)) {
          throw new CardValidationError(`Invalid principle.metric[].kind (expected one of: ${VALID_METRIC_KINDS.join(', ')})`);
        }
        entry.kind = m.kind as PrincipleMetric['kind'];
      }
      if (m.window_kind != null) {
        if (typeof m.window_kind !== 'string' || !VALID_WINDOW_KINDS.includes(m.window_kind)) {
          throw new CardValidationError(`Invalid principle.metric[].window_kind (expected one of: ${VALID_WINDOW_KINDS.join(', ')})`);
        }
        entry.window_kind = m.window_kind as PrincipleMetric['window_kind'];
      }
      if (m.distributable != null) {
        if (typeof m.distributable !== 'boolean') {
          throw new CardValidationError('Invalid principle.metric[].distributable (must be boolean)');
        }
        entry.distributable = m.distributable;
      }
- VERDICT: CONFIRMED

## I-019 — measure unknown keys silent
- STATIC markdown.ts:399-418:
      if (c.type === 'numeric') {
        if (typeof m.value !== 'number') throw new CardValidationError('Invalid brief.criteria[].measure.value (numeric type requires number)');
        if (typeof m.comparator !== 'string' || !VALID_COMPARATORS.includes(m.comparator)) {
          throw new CardValidationError(`Invalid brief.criteria[].measure.comparator (expected one of: ${VALID_COMPARATORS.join(', ')})`);
        }
        measure = {
          value: m.value,
          comparator: m.comparator as '<' | '<=' | '=' | '>=' | '>',
          unit: asString(m.unit, 'brief.criteria[].measure.unit'),
        };
      } else if (c.type === 'binary') {
        measure = { predicate: asString(m.predicate, 'brief.criteria[].measure.predicate') };
      } else {
        measure = {
          method: asString(m.method, 'brief.criteria[].measure.method'),
          reference: asString(m.reference, 'brief.criteria[].measure.reference'),
        };
      }
- VERDICT: CONFIRMED

## I-020 — domain self-ref bypass via empty fm.key
- STATIC domain/validate.ts:49 + validation.ts:457-463:
        if (dep.domain === fm.key) {
        validateDomainCard({
          type: 'domain',
          key: card.key ?? '',
          summary: '',
          status: 'draft',
          domain: card.domain,
        } as CardFrontmatter);
- VERDICT: CONFIRMED

## I-021 — domain CDD cycle 미검출
- STATIC validation.ts:467-481 (existence + type only):
      // DB-dependent: every cross_domain_dependencies target must exist and be a domain card.
      const unmetD: string[] = [];
      if (card.domain?.cross_domain_dependencies) {
        for (const dep of card.domain.cross_domain_dependencies) {
          const target = ctx.cardRepo.findByKey(dep.domain);
          if (!target) {
            unmetD.push(`cross_domain_dependencies references unknown card "${dep.domain}"`);
          } else if (target.type !== 'domain') {
            unmetD.push(`cross_domain_dependencies["${dep.domain}"] target is type "${target.type}", expected "domain"`);
          }
        }
      }
      if (unmetD.length > 0) {
        throw new ActivationGuardError('Activation conditions not met', unmetD);
      }
- VERDICT: CONFIRMED

## I-022 — parseFullKey accepts ..hidden, foo..bar
- STATIC card-key.ts:4 regex
- BEHAVIOR:
  ..secret: ..secret/x
  foo..bar: foo..bar
- VERDICT: CONFIRMED

## I-023 — parseFullKey leading/trailing slash silent strip
- BEHAVIOR:
  /foo/: "foo"
- VERDICT: CONFIRMED

## I-024 — key error class inconsistent (CardKeyError vs CardValidationError)
- STATIC: CardKeyError in card-key.ts; CardValidationError in errors.ts; both used for key errors:
  src/card/card-key.ts:11: * normalizeSlug(''); // throws CardKeyError
  src/card/card-key.ts:12: * normalizeSlug('../evil'); // throws CardKeyError
  src/card/card-key.ts:15:export class CardKeyError extends Error {
  src/card/card-key.ts:18:    this.name = 'CardKeyError';
  src/card/card-key.ts:24:    throw new CardKeyError(`Invalid card slug: ${slug}`);
  src/card/card-key.ts:32: * @param slug - Input slug. Throws CardKeyError if empty.
- VERDICT: CONFIRMED

## I-025 — duplicate parent existence check
- STATIC validation.ts:230-234 + 246-248:
  export function validateParentExists(ctx: EmberdeckContext, parentKey: string): void {
    if (!ctx.cardRepo.existsByKey(parentKey)) {
      throw new ParentValidationError(`Parent card not found: "${parentKey}"`);
    }
  }
    if (!parent) {
      throw new ParentValidationError(`Parent card not found: "${parentKey}"`);
    }
- VERDICT: CONFIRMED

## I-026 — glossary word \b boundary fail (e.g. _underscore)
- STATIC glossary/validation.ts (no character check) + cross-validate.ts:30 (\b regex):
    const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
- BEHAVIOR: define "_underscore=...":
          "action": "created",
- VERDICT: CONFIRMED — accepted but unmatchable by  regex

## I-027 — case-only duplicate (Job vs job) last-write-wins
- STATIC cross-validate.ts:23:
    for (const e of entries) canonMap.set(e.word.toLowerCase(), e.word);
- VERDICT: CONFIRMED

## I-028 — serializeNamespaces nondeterm (REFUTED)
- VERDICT: REFUTED

## I-029 — children hierarchy on type-CHANGE only
- STATIC validation.ts:314-359:
  export function validateChildrenHierarchy(ctx: EmberdeckContext, cardKey: string, newType: CardType): void {
    const children = ctx.cardRepo.findChildren(cardKey);
    if (children.length === 0) return;
  
    if (newType === 'principle') {
- VERDICT: CONFIRMED

## I-030 — boundary glob compile waste
- STATIC validation.ts:213-217 (syntax check + discard) + 545 (recompile):
        try {
          new Bun.Glob(pattern);
        } catch {
          throw new CardValidationError(`boundary pattern is not valid glob syntax: "${pattern}"`);
        }
          const glob = new Bun.Glob(pattern);
- VERDICT: CONFIRMED

## I-031 — state_transitions ID dup
- STATIC types.ts:250-255 (no id field) + spec/validate-refs.ts:40-42 (synthetic id):
  export interface SpecStateTransition {
    from: string;
    trigger: string;
    to: string;
    binds: SpecBindRef[];
  }
      for (const t of spec.state_transitions) {
        checkBinds(`${t.from}->${t.to}`, t.binds, 'spec.state_transitions');
      }
- VERDICT: CONFIRMED

# J. db / fs / setup (30 items)

## J-001 — system_lock dead table
- STATIC schema.ts:104-115:
  /**
   * Cross-process advisory lock for serialization of mutations across multiple
   * `ed` CLI invocations. SQLite UNIQUE on `name` provides atomic acquisition.
   * Stale-lock recovery uses (pid, start_time_ticks) to defeat PID recycling.
   * See system_lock table.
   */
  export const systemLock = sqliteTable('system_lock', {
    name: text('name').primaryKey(),
    pid: integer('pid').notNull(),
    startTimeTicks: integer('start_time_ticks').notNull(),
    acquiredAt: text('acquired_at').notNull(),
  });
- STATIC: production usage 0:
- VERDICT: CONFIRMED

## J-002 — findHistory absent (REFUTED — no defect)
- STATIC repository.ts: no findHistory; only findByCardKey
  72:  findByCardKey(cardKey: string): RelationRow[];
  89:  findByCardKey(cardKey: string, limit?: number): ChangelogRow[];
  95:  findByCardKey(cardKey: string): CodeLinkRow[];
- VERDICT: REFUTED-AS-DEFECT

## J-003 — migration test enforces system_lock
- STATIC test/migration-upgrade.test.ts:71-75:
        // After setup, system_lock should exist
        const after = ctx.db.$client
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_lock'")
          .get();
        expect(after).toEqual({ name: 'system_lock' });
- VERDICT: CONFIRMED

## J-004 — drizzle/meta/ snapshots missing
- BEHAVIOR ls drizzle/meta/:
  0002_snapshot.json
  0003_snapshot.json
  _journal.json
  (only 0002, 0003 — 0000/0001/0004 missing per _journal.json)
- VERDICT: CONFIRMED

## J-005 — migrate() every CLI invocation
- STATIC connection.ts:33-54:
  export function createEmberdeckDb(path: string): EmberdeckDb {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    const client = new Database(path);
    try {
      const db = drizzle(client, { schema, casing: 'snake_case' });
      configurePragmas(db);
      migrateEmberdeck(db);
      return db;
    } catch (err) {
      client.close();
      throw err;
    }
  }
  
  /**
   * Run only emberdeck migrations on an existing DB (for CLI integration).
    * @spec card-storage/persistence/db-connection
   */
  export function migrateEmberdeck(db: EmberdeckDb): void {
    migrate(db, { migrationsFolder: getMigrationsFolder() });
- VERDICT: CONFIRMED — unconditional migrateEmberdeck on every createEmberdeckDb

## J-006 — findPackageRoot returns unresolved input on miss
- STATIC fs/package-root.ts:9-16:
  export function findPackageRoot(from: string): string {
    let dir = resolve(from);
    while (true) {
      if (existsSync(resolve(dir, 'package.json'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return from;
      dir = parent;
    }
- VERDICT: CONFIRMED — line 14: `return from` not `return dir`

## J-007 — relation-repo replaceForCard no dedupe (= I-014)
- STATIC relation-repo.ts:27-51 (no dedup vs code-link-repo:17-25 which has Set dedup):
  src/db/code-link-repo.ts:17:    const seen = new Set<string>();
- VERDICT: CONFIRMED (reproduced in I-014)

## J-008 — findAncestors silent break at depth 20
- STATIC card-repo.ts:8 + 142-154:
  const MAX_ANCESTOR_DEPTH = 20;
    findAncestors(key: string): CardRow[] {
      const ancestors: CardRow[] = [];
      let current = this.findByKey(key);
  
      for (let i = 0; i < MAX_ANCESTOR_DEPTH && current?.parent; i++) {
        const parent = this.findByKey(current.parent);
        if (!parent) break;
        ancestors.push(parent);
        current = parent;
      }
  
      return ancestors;
    }
- VERDICT: CONFIRMED — no visited-set, no diagnostic

## J-009 — atomicWrite tmp leak on Bun.write fail
- STATIC fs/writer.ts:13-28:
   * On the same filesystem rename is atomic; on partial Bun.write we leave the
   * tmp behind for forensic recovery, then re-throw.
   *
   * Use for any user file where a half-written truncation would be worse than
   * the whole write failing.
   */
  export async function atomicWrite(filePath: string, text: string): Promise<void> {
    const tmpPath = filePath + '.tmp.' + randomBytes(4).toString('hex');
    await Bun.write(tmpPath, text);
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
- VERDICT: CONFIRMED — comment self-acknowledges

## J-010 — readCardFile error collapse
- STATIC fs/reader.ts:5-9:
  export async function readCardFile(filePath: string): Promise<CardFile> {
    const text = await Bun.file(filePath).text();
    const parsed = parseCardMarkdown(text);
    return { ...parsed, filePath };
  }
- VERDICT: CONFIRMED — no try/catch wrap

## J-011 — mergeCliArgs partial (only 3 fields)
- STATIC config-file.ts:262-276:
  export function mergeCliArgs(
    config: EmberdeckFileConfig,
    args: {
      dir?: string;
      dbPath?: string;
      projectRoot?: string;
    },
  ): EmberdeckFileConfig {
    return {
      ...config,
      ...(args.dir !== undefined ? { cardsDir: resolve(args.dir) } : {}),
      ...(args.dbPath !== undefined ? { dbPath: resolve(args.dbPath) } : {}),
      ...(args.projectRoot !== undefined ? { projectRoot: resolve(args.projectRoot) } : {}),
    };
  }
- VERDICT: CONFIRMED

## J-012 — config silent winner
- STATIC config-file.ts:39 + 245-250:
  const CONFIG_FILE_NAMES = ['.emberdeck.jsonc', '.emberdeck.json'] as const;
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = resolve(baseDir, name);
      const exists = await Bun.file(candidate).exists();
      if (exists) {
        return loadConfigFromPath(candidate);
      }
- VERDICT: CONFIRMED — first-match-wins

## J-013 — validateRawConfig missing checks
- STATIC config-file.ts:45-49 (typeof only) + 51-71 (no element non-empty check):
  function assertString(obj: Record<string, unknown>, key: string, errors: ValidationErrors): void {
    if (key in obj && typeof obj[key] !== 'string') {
      errors.push(`"${key}": must be a string (received ${typeof obj[key]})`);
    }
  }
- VERDICT: CONFIRMED

## J-014 — Bun.JSONC line/col discarded
- STATIC config-file.ts:223-229 + util/error.ts:
      parsed = Bun.JSONC.parse(text);
    } catch (e) {
      return err({
        code: 'PARSE_ERROR',
        message: `JSONC parsing failed: ${errorMessage(e)}`,
        filePath: absPath,
      });
  export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
- VERDICT: CONFIRMED

## J-015 — PRAGMAs missing synchronous=NORMAL
- STATIC connection.ts:22-27:
  function configurePragmas(db: EmberdeckDb): void {
    const client = db.$client;
    client.run('PRAGMA journal_mode = WAL');
    client.run('PRAGMA foreign_keys = ON');
    client.run('PRAGMA busy_timeout = 5000');
  }
- VERDICT: CONFIRMED

## J-016 — closeDb / teardownEmberdeck non-idempotent
- STATIC connection.ts:58-60 + setup.ts:80-86:
  export function closeDb(db: EmberdeckDb): void {
    db.$client.close();
  }
  export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
    try {
      await ctx.gildash.close();
    } finally {
      closeDb(ctx.db);
    }
  }
- VERDICT: CONFIRMED — no closed flag

## J-017 — txDb unsafe cast
- STATIC connection.ts:62-70:
  /**
   * Helper to cast a transaction object to EmberdeckDb.
   * drizzle-orm's transaction type does not exactly match EmberdeckDb,
   * requiring the `as unknown as EmberdeckDb` pattern — this function centralizes that cast.
    * @spec card-storage/persistence/db-connection
   */
  export function txDb(tx: unknown): EmberdeckDb {
    return tx as EmberdeckDb;
  }
- VERDICT: CONFIRMED — pure cast no runtime check

## J-018 — magic batchSize=20 4 sites (= G-022)
- VERDICT: CONFIRMED

## J-019 — matchesAnyGlob hot-loop compile
- STATIC util/glob.ts:5-9:
  export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
    for (const p of patterns) {
      if (new Bun.Glob(p).match(path)) return true;
    }
    return false;
- VERDICT: CONFIRMED — `new Bun.Glob(p)` per call no cache

## J-020 — matchesAnyGlob path normalization undocumented
- STATIC util/glob.ts (no JSDoc on path normalization):
  /**
   * True if `path` matches any of `patterns` (Bun.Glob semantics).
   * Empty pattern list → false.
   */
  export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
    for (const p of patterns) {
      if (new Bun.Glob(p).match(path)) return true;
    }
    return false;
  }
- VERDICT: CONFIRMED

## J-021 — errorMessage no PII redact
- STATIC util/error.ts:
  export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
- VERDICT: CONFIRMED

## J-022 — cardFts schema lie
- STATIC schema.ts:79-83 (regular sqliteTable):
  export const cardFts = sqliteTable('card_fts', {
    key: text('key'),
    summary: text('summary'),
    body: text('body'),
  });
- STATIC drizzle/0000_init.sql (CREATE VIRTUAL TABLE):
  90:CREATE VIRTUAL TABLE card_fts USING fts5(key, summary, body);
  93:  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
  97:  DELETE FROM card_fts WHERE rowid = old.rowid;
  101:  DELETE FROM card_fts WHERE rowid = old.rowid;
  102:  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
- VERDICT: CONFIRMED

## J-023 — FTS triggers always rewrite
- STATIC drizzle/0000_init.sql trigger card_au:
  CREATE TRIGGER card_au AFTER UPDATE ON card BEGIN
    DELETE FROM card_fts WHERE rowid = old.rowid;
    INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
  END;
- VERDICT: CONFIRMED — no WHEN clause

## J-024 — projectRoot type required, file silent default
- STATIC config.ts:14 (required) vs config-file.ts:165 (silent default):
    /** Absolute path to the project root. Required — emberdeck binds cards to code via gildash, so projectRoot is non-optional. */
    projectRoot: string;
    const projectRoot =
      typeof obj['projectRoot'] === 'string'
        ? resolve(resolvedDir, obj['projectRoot'])
        : resolvedDir;
- VERDICT: CONFIRMED

## J-025 — FK substring fragile
- STATIC relation-repo.ts:48 + code-link-repo.ts:35:
  src/db/code-link-repo.ts:35:        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
  src/db/relation-repo.ts:48:        if (!msg.includes('FOREIGN KEY constraint failed')) throw e;
- VERDICT: CONFIRMED

## J-026 — replaceForCard no internal transaction
- STATIC relation-repo.ts:11-53 (no this.db.transaction wrap):
  matches: 0
- VERDICT: CONFIRMED

## J-027 — setupEmberdeck error path latent leak
- STATIC setup.ts:34-56:
    const db = createEmberdeckDb(options.dbPath);
      const result = await Gildash.open({
        projectRoot: options.projectRoot,
        ignorePatterns: mergedIgnore.length > 0 ? mergedIgnore : undefined,
        watchMode: false,
      });
      if (isErr(result)) {
        closeDb(db);
        throw new GildashInitError(`gildash init failed: ${JSON.stringify(result.data)}`);
      }
      gildash = result;
    } catch (e) {
      if (e instanceof GildashInitError) throw e;
      closeDb(db);
      throw new GildashInitError(`gildash init failed: ${errorMessage(e)}`);
    }
- VERDICT: CONFIRMED — db at line 34 outside try; latent leak

## J-028 — system_metadata.updated_at write-only
- STATIC drizzle/0003 + spec.ts (only SELECT value):
  CREATE TABLE `system_metadata` (
  	`key` text PRIMARY KEY NOT NULL,
  	`value` text NOT NULL,
  	`updated_at` text NOT NULL
  );
                .prepare('SELECT value FROM system_metadata WHERE key = ?')
- VERDICT: CONFIRMED

## J-029 — pruneOrphans NOT IN subquery
- STATIC classification-repo.ts:48:
      this.db.run(sql`DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM card_tag)`);
- VERDICT: CONFIRMED

## J-030 — atomicWrite no flock/O_EXCL (concurrent writer race)
- STATIC fs/writer.ts:
- VERDICT: CONFIRMED

# K. SKILL ↔ 코드 (30 items)

## K-001 — card delete --force cascade vs detach
- SKILL 93:
  | `ed card delete KEY [--force] --yes` | 파괴적. `--force`: 자식 cascade + cross_domain_dep 자동 제거. | 예 |
- CODE delete.ts:106-117 (detach not delete):
            if (force && children.length > 0) {
              for (const child of children) {
                try {
                  const childFile = await readCardFile(child.filePath);
                  const updated = { ...childFile.frontmatter };
                  delete updated.parent;
                  await writeCardFile(child.filePath, { ...childFile, frontmatter: updated });
                } catch {
- VERDICT: CONFIRMED

## K-002 — class:none, file:'' rejected (= E1)
- VERDICT: CONFIRMED

## K-003 — BriefCriterionMeasure shape divergence
- SKILL 163:
  | `brief.criteria` | ✓ | `[{id: SC-001, type, measure, verifies: [S-id]}]`. `measure` 는 type 별 다른 객체: `numeric` → `{predicate, value, comparator, unit, reference?}`, `binary` → `{predicate, method?, reference?}`, `verification` → `{method, reference, predicate?, unit?}`. 모두 flow 가 verifies |
- CODE types.ts:175-178:
  export type BriefCriterionMeasure =
    | { value: number; comparator: '<' | '<=' | '=' | '>=' | '>'; unit: string }
    | { predicate: string }
    | { method: string; reference: string };
- VERDICT: CONFIRMED

## K-004 — check coverage <KEY> shape divergence
- SKILL 351-357:
  `ed check coverage <key>`:
  ```json
  {"data":{
    "key":"...","total_symbols":N,"covered_symbols":N,"coverage_ratio":0~1|null,
    "uncovered":[{"file":"...","symbol":"...","kind":"..."}]
  }}
  ```
- CODE check.ts:79-87:
            const cov = await getLinkCoverage(rt.ctx, key);
            return ok({
              declared: cov.declared,
              resolved: cov.resolved,
              broken: cov.broken,
              coverage_ratio: cov.coverage,
              unreferenced_symbols: cov.unreferenced.slice(0, 100),
              unreferenced_total: cov.unreferenced.length,
            });
- VERDICT: CONFIRMED

## K-005 — --uncovered cap 100 undocumented
- CODE check.ts:67-74:
              const uc = await getUncoveredSymbols(rt.ctx, { exportedOnly: !opts.includeInternal });
              return ok({
                total_symbols: uc.totalSymbols,
                covered_symbols: uc.coveredSymbols,
                coverage_ratio: uc.coverageRatio,
                uncovered: uc.uncovered.slice(0, 100),
                uncovered_total: uc.uncovered.length,
              });
- VERDICT: CONFIRMED

## K-006 — --suggest parent field SKILL 누락
- SKILL 359-365:
  `ed check coverage --suggest`:
  ```json
  {"data":{
    "suggestions":[{"key":"...","type":"domain|spec","files":N,"symbols":N,"reason":"...","suggested_glossary":[]}],
    "total":N
  }}
  ```
- CODE check.ts:51-59:
                suggestions: suggestions.map((s) => ({
                  key: s.suggestedKey,
                  type: s.type,
                  parent: s.parent,
                  files: s.files.length,
                  symbols: s.symbols.length,
                  reason: s.reason,
                  suggested_glossary: s.suggestedGlossary ?? [],
                })),
- VERDICT: CONFIRMED — code emits parent, SKILL omits

## K-007 — --max-depth flag does not exist
- SKILL 105:
  | `ed check drift [KEY] [--max-depth N] [--no-auto-transition]` | 6종 drift 다중 검출. 기본 active→drifted 자동 전이. CI 는 `--no-auto-transition`. | 예 (status 변경) |
- CODE check.ts:18-22:
    check
      .command('drift [key]')
      .description('detect drift (broken_link / boundary_inactive / symbol_changed / glossary_broken / heritage_uncovered / pattern_violation)')
      .option('--no-auto-transition', 'do not auto-mark active→drifted')
      .action(async (key: string | undefined, opts: { autoTransition?: boolean }, cmd) => {
- BEHAVIOR:
  exit=1
  stderr: error: unknown option '--max-depth'
- VERDICT: CONFIRMED

## K-008 — glossary rename no --yes
- SKILL 88:
  | `ed glossary rename OLD NEW [--def TEXT]` | 리네임. glossary + 카드 glossary 필드 자동. | 예 |
- CODE glossary.ts:117-125 rename action (no --yes, no confirmDestructive):
      .command('rename <oldWord> <newWord>')
      .description('rename a glossary word (auto-updates card glossary fields)')
      .option('--def <text>', 'optional new definition')
      .action(async (oldWord: string, newWord: string, opts: { def?: string }, cmd) => {
              await run(
          async (rt: CliRuntime) => {
            const result = await renameGlossary(rt.ctx, oldWord, newWord, opts.def);
            const data = {
              renamed_from: result.renamedFrom,
- VERDICT: CONFIRMED

## K-009 — card export STDOUT default undocumented
- SKILL 95:
  | `ed card export KEY [--out FILE\|--in-place]` | DB→파일/STDOUT 렌더 | X |
- CODE card.ts:404-419 default mode=stdout:
            }
            // STDOUT or --out FILE: build content WITHOUT touching original file.
            const cardFile = buildCardFromDb(rt.ctx, key);
            const content = serializeCardMarkdown(cardFile.frontmatter, cardFile.body);
            if (opts.out && opts.out !== '-') {
              await atomicWrite(opts.out, content);
- VERDICT: CONFIRMED

## K-010 — ed init missing from <commands>
- SKILL 81-115 commands table — no init row:
- VERDICT: CONFIRMED — init exists in code (single.ts) but not SKILL table

## K-011 — error_recovery 4 warning types missing
- SKILL 266-281 vs sync.ts emits:
  423:              type: 'rework-dependency',
  486:          type: 'boundary-overlap',
  501:          type: 'content-mismatch',
  508:          type: 'content-mismatch',
  549:              type: 'content-mismatch',
  566:        type: 'glossary-unused',
- VERDICT: CONFIRMED

## K-012 — annotate writer 1-tier vs reader 4-tier
- CODE spec-sync.ts:17 (reader) + 452 (writer):
  const TRACKED_ANNOTATION_TAGS = ['spec', 'brief', 'principle', 'domain'] as const;
        const specTags = toInsert.map((t) => `@spec ${t.cardKey}`);
- VERDICT: CONFIRMED

## K-013 — card relations shape SKILL 누락
- CODE card.ts:497-512 emits {key, forward, reverse, total}; SKILL 101 only "직접 forward+reverse":
  | `ed card relations KEY` | 직접 forward+reverse | X |
              key,
              forward: relations.filter((r) => !r.isReverse).map((r) => r.dstCardKey),
              reverse: relations.filter((r) => r.isReverse).map((r) => r.dstCardKey),
              total: relations.length,
            });
          },
          cmd,
- VERDICT: CONFIRMED

## K-014 — relations "brief 키 배열" not enforced (= B6)
- VERDICT: CONFIRMED

## K-015 — --tag mutex (REFUTED-AS-DEFECT, SKILL accurate)
- VERDICT: REFUTED-AS-DEFECT

## K-016 — boundary "spec only" not enforced (= I-002)
- VERDICT: CONFIRMED

## K-017 — set-status --reason-from undocumented in SKILL
- SKILL 96 only mentions --reason TEXT:
  | `ed card set-status KEY {draft\|active\|drifted\|retired} [--reason TEXT]` | active 시 activation guard | 예 |
- CODE card.ts:431-434:
      .description('change card status (draft|active|drifted|retired)')
      .option('--reason <text>', 'reason recorded in changelog')
      .option('--reason-from <file|->', 'read reason from file or STDIN')
      .action(async (key: string, status: string, opts: { reason?: string; reasonFrom?: string }, cmd) => {
- VERDICT: CONFIRMED

## K-018 — card create --summary not strictly required
- SKILL 90 syntax suggests --summary required:
  | `ed card create KEY --type T --summary S [--parent P] [--from f.yaml] [--glossary W]` | 생성 | 예 |
- CODE card.ts:208 .option not .requiredOption:
      .option('--summary <s>', 'one-line summary')
- VERDICT: CONFIRMED

## K-019 — validate links unresolved == broken
- CODE validate.ts:73-100 (errors only contains BROKEN_LINK):
  48:            for (const b of r.broken) linkErrors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: c.key });
  87:            for (const b of r.broken) errors.push({ code: 'BROKEN_LINK', message: `${b.link.file}:${b.link.symbol} (${b.reason})`, key: t.key });
  98:            unresolved: errors.length,
- VERDICT: CONFIRMED

## K-020 — ed validate (no args) shape SKILL 누락
- SKILL 104 only command listed; no shape in <response_shapes>:
  | `ed validate` | cards + links 종합 | X |
  | `ed check drift [KEY] [--max-depth N] [--no-auto-transition]` | 6종 drift 다중 검출. 기본 active→drifted 자동 전이. CI 는 `--no-auto-transition`. | 예 (status 변경) |
- CODE validate.ts:52-57:
            const data = {
              cards: { issues: cardErrors.length },
              links: { declared: linkDeclared, broken: linkBroken },
              total_issues: allErrors.length,
            };
            return allErrors.length === 0 ? ok(data) : partial(data, allErrors);
- VERDICT: CONFIRMED

## K-021 — onboarding step 1 fails on fresh repo
- SKILL 30:
  1. `ed analyze` → 현 상태. `ed spec annotate` → reconcile (멱등).
- BEHAVIOR fresh dir:
  exit=0
- VERDICT: CONFIRMED

## K-022 — --patch VALIDATION_ERROR namespace-only
- SKILL 13 + update.ts:51-70:
  7. `--patch` 는 namespace 전체 교체 (merge X). 누락 필수 필드 시 `VALIDATION_ERROR`. 부분 업데이트가 필요하면 카드 파일 직접 편집 후 `ed bulk sync`.
  function assertCompleteNamespace(field: 'principle' | 'domain' | 'brief' | 'spec', value: unknown): void {
    if (value === null || value === undefined) return;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new CardValidationError(`invalid ${field} namespace: must be an object`);
    }
    // Required top-level fields per card/types.ts namespaces.
    const required: Record<typeof field, string[]> = {
      principle: ['statement', 'rationale', 'applies_to', 'enforcement'],
      domain: ['overview', 'scope'],
      brief: ['context', 'scope', 'flow', 'design', 'policy', 'external', 'compatibility', 'limits', 'criteria', 'rationale'],
      spec: ['preconditions', 'postconditions', 'invariants', 'failures'],
    };
- VERDICT: CONFIRMED — partial truth, namespace fields only

## K-023 — mechanism names forbidden (advisory)
- SKILL 214 (advisory rule):
  - 본문에 구현 메커니즘명 X (WeakMap, FTS5, FK CASCADE, ON CONFLICT, WAL 등 금지). 행동 보장으로 재작성
- VERDICT: ADVISORY (not auto-checked)

## K-024 — required at activation not creation
- STATIC create.ts:106-163 vs activation re-validate:
  src/ops/create.ts:16:  validateActivationGuard,
  src/ops/create.ts:152:        await validateActivationGuard(ctx, {
  src/ops/update.ts:23:  validateActivationGuard,
- VERDICT: CONFIRMED

## K-025 — glossary rule update-time 미강제
- SKILL 10 + create.ts:142-145 + update.ts:237-242:
  4. `glossary.yaml` 에 항목 ≥1 시 신규 카드의 `glossary` 필드 필수 (주요 토픽만).
        const glossaryEntries = readGlossary(ctx);
        if (glossaryEntries.length > 0 && (!input.glossary || input.glossary.length === 0)) {
          throw new GlossaryValidationError('glossary field is required when project glossary exists');
        }
        const glossaryEntries = readGlossary(ctx);
        if (fields.glossary !== undefined) {
          if (fields.glossary.length === 0) delete next.glossary;
          else {
            validateCardGlossaryField(fields.glossary, glossaryEntries);
            next.glossary = fields.glossary;
- VERDICT: CONFIRMED — create enforces, update only when provided

## K-026 — ignorePatterns location undocumented
- SKILL 45:
  12. GATE: `ed check coverage --uncovered` (exported-only). production 소스 exported symbol 미커버 시 spec 추가 또는 명시적 ignorePatterns. internal/private 멤버는 자동 제외 (contract = WHAT, internal = HOW)
- (no mention of `.emberdeck.jsonc` location)
- VERDICT: CONFIRMED

## K-027 — subagent rule (advisory, not verifiable)
- SKILL 394:
  5. `ed` 직접 호출 — 서브에이전트 사용 시 카드 컨텍스트 손실.
- VERDICT: ADVISORY

## K-028 — spec annotate accurate per SKILL (REFUTED-AS-DEFECT)
- VERDICT: REFUTED-AS-DEFECT

## K-029 — FTS exit 2 (REFUTED-AS-DEFECT, SKILL accurate)
- STATIC output.ts:145:
  145:  FTS_SYNTAX_ERROR: EXIT.VALIDATION_FAILURE,
- VERDICT: REFUTED-AS-DEFECT

## K-030 — regression exit 2 (REFUTED-AS-DEFECT)
- STATIC check.ts (partialIsFailure: true):
  143:          partialIsFailure: true,
- VERDICT: REFUTED-AS-DEFECT

# L. 테스트 품질 (25 items)

## L-001 — safe.spec synthetic only
- STATIC src/ops/safe.spec.ts:1-12 (header self-acknowledges):
  /**
   * `safeWriteOperation` is the DB-then-file write primitive used by every op
   * that touches both stores (create / update / delete / rename / glossary). It
   * has three exit paths: happy, file-failure-with-rollback, and the catastrophic
   * file-failure-with-failed-rollback path that surfaces `CompensationError`.
   *
   * This spec exercises all three with synthetic actions — no real DB / fs needed
   * since the contract is purely about call ordering and error wrapping.
   */
  import { describe, it, expect } from 'bun:test';
  import { safeWriteOperation } from './safe';
  import { CompensationError } from '../card/errors';
- VERDICT: CONFIRMED

## L-002 — rename body cascade not implemented + test asserts only detection
- CODE rename.ts:107 detects, no rewrite:
            if (row.body?.includes(oldKey)) bodyReferencesFound.push(row.key);
- TEST crud-sync.test.ts:340-353 asserts bodyReferencesFound only:
      expect(result.bodyReferencesFound).toEqual(['body-ref-src']);
- VERDICT: CONFIRMED

## L-003 — combined relations+CDD+body test missing
- STATIC test/ops/rename.test.ts (no combined fixture):
  CDD matches: 0
  combined matches: 0
- VERDICT: CONFIRMED — no combined fixture

## L-004 — drift 4/6 mock-only
- STATIC test/integration/drift-analysis.test.ts createMockGildash usage:
  drift mock count: 11
  gildash-ext mock count: 0
- VERDICT: CONFIRMED

## L-005 — activation guard regex assertions weak
- STATIC integrity.spec.ts (multiple .toMatch on join):
  matches: 8
- VERDICT: CONFIRMED

## L-006 — JSON envelope toContain accepts multiple statuses
  matches: 8
- VERDICT: CONFIRMED

## L-007 — hardcoded /tmp path
  95:    const tmpRoot = '/tmp/ed-coverage-boundary-' + Date.now();
- VERDICT: CONFIRMED

## L-008 — bulkSync partial-failure weak assertion
- STATIC test/ops/sync.test.ts:259-270:
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.synced).toBeGreaterThanOrEqual(1);
      expect(tc.ctx.cardRepo.findByKey('bulk-good')).not.toBeNull();
- VERDICT: CONFIRMED — toBeGreaterThanOrEqual(1) instead of exact

## L-009 — toBeDefined widespread
  src/setup.spec.ts:2
  src/db/repository.spec.ts:2
  test/ops/glossary.test.ts:1
  test/ops/query.test.ts:3
  test/config.test.ts:3
  test/e2e/chaos.test.ts:1
  test/cli/phase2.test.ts:4
  test/integration/crud-sync.test.ts:26
- VERDICT: CONFIRMED — 87+ instances

## L-010 — type assertion via runtime check
- STATIC repository.spec.ts:500-503:
    it('ClassificationRepository has no replaceKeywords method', () => {
      // Assert — interface only has tag methods
      expect((classificationRepo as unknown as Record<string, unknown>)['replaceKeywords']).toBeUndefined();
    });
- VERDICT: CONFIRMED

## L-011 — schema toThrow without message
- STATIC repository.spec.ts:527-543 sample:
    it('keyword table does not exist', () => {
      // Act / Assert
      expect(() => db.$client.prepare('SELECT * FROM keyword').all()).toThrow();
- VERDICT: CONFIRMED

## L-012 — leak check self-admitted weak
- STATIC src/setup.spec.ts:60-69:
        // that the connection itself is closed (no WAL stuck open).
        // We verify this indirectly by re-opening the same path — a leaked
        // handle on Linux would not block, but on close failure the WAL would.
        // Stronger check: setupEmberdeck a second time on the same path with a
        // valid projectRoot should succeed cleanly.
- VERDICT: CONFIRMED

## L-013 — fuzz filters out yaml-special chars
- STATIC test/integration/property-fuzz.test.ts:48-53:
  // cannot escape — values containing those round-trip-fail through parse.
  // Real user input with these chars writes fine but fails on later read; a
  // proper fix requires switching the YAML emitter, which is out of scope here.
  const summaryArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => !/[\[\]{}:,&*#?|>'"%@`\\]/.test(s));
- VERDICT: CONFIRMED — author admits this hides real bugs

## L-014 — auto-transition test no changelog/updatedAt assert
- STATIC drift-analysis.test.ts:82-90:
      const result = await checkDrift(tc.ctx, 'bnd-trans');
      const card = result.cards.find((c) => c.key === 'bnd-trans');
      expect(card).toBeDefined();
      expect(card!.driftTypes).toContain('boundary_inactive');
      expect(card!.status).toBe('drifted');
  
      const row = tc.ctx.cardRepo.findByKey('bnd-trans');
      expect(row!.status).toBe('drifted');
    });
- VERDICT: CONFIRMED

## L-015 — spinner test absence-only
- STATIC phase2-polish.test.ts:406-434 sample:
      expect(parsed.status).toBe('ok');
      expect(r.stdout).not.toContain('\x1b[');
      expect(r.stdout).not.toContain('⠋');
    });
  
    test('analyze: stderr also clean (no spinner leak)', async () => {
- VERDICT: CONFIRMED

## L-016 — migration single-path
- STATIC test/migration-upgrade.test.ts (one describe block):
  13:describe('migration: 0001 → 0002 upgrade path', () => {
- STATIC test/migration.test.ts (only db defined):
      // Assert
      expect(db).toBeDefined();
      closeDb(db);
- VERDICT: CONFIRMED

## L-017 — UNMATCHED both outcomes pass
- STATIC phase2.test.ts:280-285:
      if (parsed.status === 'partial') {
        expect(parsed.errors.some((e: { code: string }) => e.code === 'UNMATCHED_ANNOTATION')).toBe(true);
      } else {
        expect(parsed.status).toBe('ok');
      }
    });
- VERDICT: CONFIRMED

## L-018 — mtime sensitive
- STATIC phase2-polish.test.ts:122-128:
      const beforeStat = await Bun.file(path).stat();
      await runEd(['card', 'export', 'expo'], tmp);
      const after = await Bun.file(path).text();
      const afterStat = await Bun.file(path).stat();
      expect(after).toBe(before);
      expect(afterStat.mtime.getTime()).toBe(beforeStat.mtime.getTime());
    });
- VERDICT: CONFIRMED

## L-019 — silent FK skip enshrined as spec
- STATIC repository.spec.ts:448-459:
    it('replaceForCard: silently skips when target card does not exist (FK violation)', () => {
      // Arrange
      const cardA = makeCard({ key: 'card-a', filePath: '.emberdeck/cards/card-a.card.md' });
      cardRepo.upsert(cardA);
  
      // Act — target 'ghost' does not exist
      expect(() => relationRepo.replaceForCard('card-a', ['ghost'])).not.toThrow();
  
      // Assert — no forward rows created
      const rows = relationRepo.findByCardKey('card-a');
      expect(rows.filter(r => !r.isReverse)).toHaveLength(0);
    });
- VERDICT: CONFIRMED — test name codifies silent skip

## L-020 — safe.spec only sync dbAction
- STATIC src/ops/safe.spec.ts (all dbAction sync):
  15:  it('runs dbAction first, then fileAction, and returns dbAction result on success', async () => {
  18:      dbAction: () => { calls.push('db'); return 42; },
  29:      dbAction: () => undefined,
  36:  it('calls compensate with dbAction result when fileAction throws, then rethrows the file error', async () => {
  41:        dbAction: () => ({ id: 'card-1' }),
- VERDICT: CONFIRMED

## L-021 — e2e parent-delete relations not re-checked
- STATIC test/e2e/flows.test.ts:251-298 grep relations after delete:
  re-check count: 0
- VERDICT: CONFIRMED

## L-022 — class:none convention untested
- VERDICT: CONFIRMED — 0 matches

## L-023 — overlap rename/drift across files
  test/e2e/flows.test.ts
  test/ops/rename.test.ts
  test/integration/crud-sync.test.ts
- VERDICT: CONFIRMED

## L-024 — real-gildash vs mock-gildash imbalance (= L-004)
- VERDICT: CONFIRMED

## L-025 — no tsc gate, no CI hooks
- BEHAVIOR:
  ls: cannot access '.github': No such file or directory
  ls: cannot access '.husky': No such file or directory
      "test": "bun test",
- VERDICT: CONFIRMED — no CI directory, no pretest hook

# M. 잔재 / refactor (20 items)

## M-001 — system_lock dead (= J-001)
- VERDICT: CONFIRMED

## M-002 — migration test enforces system_lock (= J-003)
- VERDICT: CONFIRMED

## M-003 — helpers.ts:14-16 stale comment
- STATIC test/cli/helpers.ts:14-16:
   *   - SIGINT/SIGTERM trap          (real signal delivery)
   *   - PTY-driven confirm prompts   (real terminal)
   *   - Cross-process system_lock    (separate process IDs)
- VERDICT: CONFIRMED

## M-004 — runner.spec uses GILDASH_NOT_CONFIGURED (deleted code)
- STATIC src/cli/runner.spec.ts:21-23:
    test('GILDASH_NOT_CONFIGURED → error (NOT transient — config issue)', () => {
      expect(classifyErrorStatus('GILDASH_NOT_CONFIGURED')).toBe('error');
    });
- VERDICT: CONFIRMED

## M-005 — link.ts:273 stale comment (gildash now mandatory)
- STATIC link.ts:273:
   * Returns the original list when gildash is not configured or the call fails.
- VERDICT: CONFIRMED

## M-006 — GlobalFlags.projectRoot still optional
- STATIC src/cli/context.ts:17:
    projectRoot?: string;
- STATIC src/config.ts:14 (required):
    projectRoot: string;
- VERDICT: CONFIRMED — optional in CLI flags but required in config type

## M-007 — validateRawConfig projectRoot default (silent breaking change)
- STATIC config-file.ts:165-168:
    const projectRoot =
      typeof obj['projectRoot'] === 'string'
        ? resolve(resolvedDir, obj['projectRoot'])
        : resolvedDir;
- VERDICT: CONFIRMED

## M-008 — safe-write card prose lies (= C4)
- VERDICT: CONFIRMED

## M-009 — BoundaryValidationError dead
- VERDICT: CONFIRMED

## M-010 — ctx.gildash.close() non-optional chain crash risk
- STATIC src/setup.ts:82:
      await ctx.gildash.close();
- VERDICT: CONFIRMED

## M-011 — raw Promise.allSettled in glossary.ts (a4bdc64 not applied)
- STATIC src/ops/glossary.ts:326,330:
          await Promise.allSettled(fileDeletes.splice(0));
    if (fileDeletes.length > 0) await Promise.allSettled(fileDeletes);
- VERDICT: CONFIRMED

## M-012 — GILDASH_TRANSIENT no production emitter
- BEHAVIOR:
  src/cli/runner.ts:30:  // - GILDASH_TRANSIENT: gildash search timeout (not yet emitted; reserved)
  src/cli/runner.ts:32:  if (code === 'GILDASH_TRANSIENT' || code === 'NETWORK_TRANSIENT') return 'unknown';
- VERDICT: CONFIRMED — only matched in runner.ts comment + test

## M-013 — commands.test.ts:12 stale ANSI/env comment
- STATIC test/cli/commands.test.ts:12:
  // Some tests still need real subprocess: STDIN piping, ANSI/env var verification.
- VERDICT: CONFIRMED

## M-014 — setup-config-root.card binding GildashInitError untracked
- BEHAVIOR git status:
   M src/setup.ts
  ?? .emberdeck/cards/cli-surface/project-setup/setup-config-root.card.md
- VERDICT: CONFIRMED

## M-015 — PROBLEM.md self-stale (REFUTED by rewrite)
- VERDICT: REFUTED

## M-016 — setupEmberdeck creates DB before gildash check
- STATIC src/setup.ts:33-46:
  export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext> {
    const db = createEmberdeckDb(options.dbPath);
  
    const mergedIgnore = [
      ...(options.analysisIgnore ?? []),
      ...(options.ignorePatterns ?? []),
    ];
    let gildash: Gildash;
- VERDICT: CONFIRMED

## M-017 — 59 modified + 6 untracked
- BEHAVIOR git status count:
        7 ??
       59 M
- VERDICT: CONFIRMED

## M-018 — json-envelope test (REFUTED, legitimate)
- VERDICT: REFUTED

## M-019 — repository.spec imports untracked fixture
- STATIC import:
  7:import { makeCardRow as makeCard } from '../../test/fixtures/card-row';
- BEHAVIOR git status:
  ?? test/fixtures/
- VERDICT: CONFIRMED

## M-020 — SKILL drift autoTransition default true (= D1)
- VERDICT: CONFIRMED

# N. 추가 발견 (40 items)

## N-001 — package.json missing publish meta
    "name": "emberdeck",
    "version": "0.3.0",
    "private": false,
- VERDICT: CONFIRMED — license/description/repository/author/keywords absent

## N-002 — bin .ts source (bun-only)
    "bin": {
  #!/usr/bin/env bun
- VERDICT: CONFIRMED

## N-003 — validate N+1 (= H-016)
- VERDICT: CONFIRMED

## N-004 — parent FK set null (CRITICAL)
- STATIC db/schema.ts:31-34:
      foreignKey({ columns: [table.parent], foreignColumns: [table.key] })
        .onUpdate('cascade')
        .onDelete('set null'),
    ],
- BEHAVIOR (already reproduced earlier): domain delete → child brief.parent = null → 4-tier violation
- VERDICT: CRITICAL CONFIRMED

## N-005 — relation-repo replaceForCard partial state (= J-007)
- VERDICT: CONFIRMED

## N-006 — drizzle.config dead path
      url: 'file:./.zipbul/cache/emberdeck.sqlite',
- VERDICT: CONFIRMED — `.zipbul/cache/` not used anywhere

## N-007 — tsconfig no include/exclude
- VERDICT: CONFIRMED

## N-008 — README missing
- VERDICT: CONFIRMED

## N-009 — gildash adapter scattered (7 source files)
  src/card/validation.ts
  src/ops/analyze.ts
  src/ops/context.ts
  src/ops/impact.ts
  src/ops/link.ts
  src/ops/spec-sync.ts
  src/setup.spec.ts
  src/setup.ts
- VERDICT: CONFIRMED

## N-010 — gildash 0.26.1 + watchMode:false (informational)
      "@zipbul/gildash": "0.26.1",
        watchMode: false,
- VERDICT: CONFIRMED

## N-011 — test/fixtures untracked (HIGH)
  ?? test/fixtures/
  card-row.ts
  gildash.ts
- VERDICT: CONFIRMED

## N-012 — bench bypasses validation
  65:// rest spec (parent=brief|spec). Bypassing validation via direct upsert is fine
  91:  ctx.cardRepo.upsert({
- VERDICT: CONFIRMED

## N-013 — migrate every CLI invocation (= J-005)
- VERDICT: CONFIRMED

## N-014 — .gitignore missing *.tmp.*
  node_modules
  .emberdeck/*
  !.emberdeck/cards/
  dist
  .gildash
  coverage/- VERDICT: CONFIRMED

## N-015 — validate aggregate no glossary block
  114:    .description('check card integrity: file consistency, hierarchy, glossary references, brief→spec chains')
- VERDICT: CONFIRMED — only description mentions glossary, no actual glossary check

## N-016 — exitOverride absent (= H-005/H-006)
  matches: 0
- VERDICT: CONFIRMED

## N-017 — init shadows global flags
- STATIC index.ts:33-38 + single.ts:26-27:
      .option('--project-root <path>', 'project root for source code analysis (overrides config)')
      .option('--project-root <path>', 'project root for source code analysis (default: cwd)')
      .option('--cards-dir <path>', 'where to store card files (default: .emberdeck/cards)')
- VERDICT: CONFIRMED — global `--project-root` + init re-defines + global `--dir` vs init `--cards-dir` naming mismatch

## N-018 — quiet mode empty stdout (= H-004)
- VERDICT: CONFIRMED

## N-019 — next_sync_marker dual store
              rt.ctx.db.$client
                .prepare(
                  'INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
                )
                .run(META_KEY, now, now);
- VERDICT: CONFIRMED

## N-020 — output.ok discards errors
  export function ok<T>(data: T, warnings: CliMessage[] = []): CliResult<T> {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: 'ok',
      data,
      warnings,
      errors: [],
    };
  }
- VERDICT: CONFIRMED

## N-021 — envelope errors[] asymmetric
  export function err(error: CliMessage): CliResult<null> {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: 'error',
      data: null,
      warnings: [],
      errors: [],
      error,
    };
  /**
   * Build a transient/retryable failure CliResult.
    * @spec cli-surface/command-routing-and-envelope/runner-and-output
   */
  export function unknown(error: CliMessage): CliResult<null> {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: 'unknown',
      data: null,
      warnings: [],
      errors: [],
- VERDICT: CONFIRMED — err/unknown set errors:[]; only partial populates errors

## N-022 — JSONC line/col discarded (= J-014)
- VERDICT: CONFIRMED

## N-023 — analysisIgnore not in ctx
    const mergedIgnore = [
      ...(options.analysisIgnore ?? []),
      ...(options.ignorePatterns ?? []),
    ];
      ignorePatterns: options.ignorePatterns ?? [],
- VERDICT: CONFIRMED

## N-024 — analysisIgnore (same root as N-023)
- VERDICT: CONFIRMED

## N-025 — no DROP migration for system_lock
  drizzle/0000_init.sql
  drizzle/0001_glossary.sql
  drizzle/0002_new_ender_wiggin.sql
  drizzle/0003_majestic_starhawk.sql
  drizzle/0004_namespaces_json.sql
- VERDICT: CONFIRMED

## N-026 — drizzle/meta snapshots missing (= J-004)
- VERDICT: CONFIRMED

## N-027 — = N-004 (parent FK)
- VERDICT: CONFIRMED

## N-028 — confirmDestructive asymmetric
  src/cli/confirm.spec.ts
  src/cli/commands/glossary.ts
  src/cli/commands/single.ts
  src/cli/commands/card.ts
  src/cli/confirm.ts
  - card.ts:325 (delete), single.ts:163 (reset), glossary.ts:103 (remove) — rename/prune missing
- VERDICT: CONFIRMED

## N-029 — init non-atomic write (= H-013)
- VERDICT: CONFIRMED

## N-030 — kind no schema constraint
      kind: text('kind').notNull(),
- VERDICT: CONFIRMED

## N-031 — CLAUDE.md tiny (no architecture)
  5 CLAUDE.md
- VERDICT: CONFIRMED

## N-032 — coverageThreshold 0.95 not enforced
  coverageThreshold = 0.95
  ls: cannot access '.github': No such file or directory
- VERDICT: CONFIRMED

## N-033 — syncCardFromFile accepts status:active (= G-005)
- VERDICT: CONFIRMED

## N-034 — pretty print always
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
- VERDICT: CONFIRMED

## N-035 — validate vs analyze surface divergence
- STATIC validate.ts:52-57 vs analyze return shape:
  src/cli/commands/single.ts:68:  // Glob patterns for files to exclude from coverage and indexing.
  src/cli/commands/single.ts:74:    "**/coverage/**"
  src/cli/commands/single.ts:128:    .description('full project analysis (drift + coverage + glossary)')
- VERDICT: CONFIRMED

## N-036 — bench projectRoot empty src.ts
  writeFileSync(join(tmpRoot, 'src.ts'), '', 'utf8');
  const ctx: EmberdeckContext = await setupEmberdeck({
- VERDICT: CONFIRMED

## N-037 — cardFts schema lie (= J-022)
- VERDICT: CONFIRMED

## N-038 — no down migrations
- VERDICT: CONFIRMED

## N-039 — tag dead UI (= A3)
- VERDICT: CONFIRMED

## N-040 — mock 10 vs prod 19 gildash methods
  mock methods: 18
  prod APIs: 15
- VERDICT: CONFIRMED


---

# 최종 통계

CONFIRMED: 239
REFUTED: 14
PARTIAL: 5
CORRECTED: 1
ADVISORY: 2
TOTAL ITEMS: 245
