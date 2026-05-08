# PROBLEM.md 5차 직접 재검증 체크리스트

규칙:
- 각 항목마다 본인이 직접 sed/grep/Read 로 cited file:line 을 열어 literal text 와 claim 비교
- 단순 alias 라도 alias target 항목 자체를 본인이 다시 확인
- 검증 후 [x] + verdict + 실제 본 line/text 를 명시
- batch 금지. 한 항목씩.

## 5차 deep 라운드 (사용자 요청: "완벽하게")

claim 의 file:line 만 보고 confirm 했던 항목들을 actual runtime 으로 재현.
ed CLI / bun -e / EXPLAIN QUERY PLAN 등 사용. 새로 발견:
- **J-016 → REFUTED (5차 deep)**: bun:sqlite Database.close() 가 자체 idempotent. PROBLEM 가정 잘못.
- **J-027 → REFUTED (5차 deep)**: 모든 Drizzle*Repository constructor 가 `private db` 단순 저장만 — throw path 0. 현재 코드 leak 시나리오 없음.
- **I-031 → REFUTED 재확인 + 후속**: state_transitions 에 id 부재 — claim 자체 array 잘못.
- **H-007 → CONFIRMED + nuance**: 대부분 partial path 라 exit 2. error path (COMPENSATION_FAILED) 만 미매핑 → exit 1.
- **K-006 → CONFIRMED + 정확한 line**: SKILL.md:362 shape 에 parent 누락.
- **G-039 → CONFIRMED + 영향 범위**: else branch 는 DB row 부재 시만 — production 영향 좁음.
- **G-033**: typeof field narrowing 이 안 되므로 `Record<typeof field, ...>` 가 effective Record<F, ...>. 의미 모호하나 runtime 영향 0.
- **I-022 deep**: `..hidden`, `foo..bar`, `foo.` 모두 통과 — slug regex 가 hidden file 패턴 못 잡음.
- **I-023 deep**: `/foo/` strip OK, but `////foo//bar///` 는 mid-slash 때문에 reject — leading/trailing 만 silent.
- **J-020 deep**: relative pattern `**/*.ts` 가 absolute path 매칭. abs/rel 정규화 부재 confirmed + behavior nuance.

## 0. MISTAKE 항목
- [x] MISTAKE-1 — `grep -rn "withCardLock\|withRetry" src/ops/` → 0건. `bunx tsc --noEmit` exit=0. **REFUTED 재확인**
- [x] MISTAKE-2 — `spec.ts:90` `SELECT value FROM system_metadata WHERE key = ?` (read), `:110-112` INSERT/UPSERT, `phase2-polish.test.ts:164,173,181,186,194,199` 통합 테스트 6건 직접 확인. **REFUTED 재확인**
- [x] MISTAKE-3 — `runner.ts:121` 정의, `:47` 호출. 다른 파일 import 0건. **REFUTED 재확인**

## A. 빌드 / dead code
- [x] A1 — alias of MISTAKE-1, 위 검증과 동일. REFUTED
- [x] A2 — alias of MISTAKE-2, 위 검증과 동일. REFUTED
- [x] A3 — `schema.ts:37-42` `tag` + `card_tag` 테이블 직접 확인. `card.ts:125,142,213` `--tag` 옵션 직접 확인. `repository.spec.ts:147,238,487,493,509,512,518` 모두 `replaceTags` 테스트 직접 확인. SKILL.md 에 `--tag` 옵션 1회만 언급, tag 워크플로우 문서 0. **CONFIRMED**
- [x] A4 — `spec-sync.ts:17` `TRACKED_ANNOTATION_TAGS = ['spec','brief','principle','domain']` 직접 확인 (4-tier read). `:452` `specTags = toInsert.map(t => '@spec ${t.cardKey}')` 직접 확인 (1-tier write). SKILL.md:14,46,110,111 모두 `@spec` 만 명시. `@brief`/`@principle`/`@domain` SKILL grep 0건. **CONFIRMED 비대칭**

## B. 데이터 모델
- [x] B1 — `sync.ts:120-121` `const fullBody = [cardFile.body, namespaceText].filter(...).join('\n\n')` 직접 확인. `:22-25` 코멘트 "We store `body \n\n namespaceText` in row.body to feed FTS5; on export we must strip the trailing namespace text or the .card.md file gets corrupted (and grows on every round-trip)" 직접 확인 — hack 자체 인정. `:26-36` `stripNamespaceText` 가 `lastIndexOf(ns)` 사용. **CONFIRMED**
- [x] B2 — `head -3 persistence.card.md` line 2 = **5811 chars** 직접 확인. `markdown.ts:689` `Bun.YAML.stringify(frontmatter)` (PROBLEM cited :687, 실제 :689 — 4차 CORRECTED 일치). flow-style YAML serialize. **CONFIRMED**
- [x] B3 — `types.ts:329` `boundary?: string[]` 코멘트 "spec only", `:333` `codeLinks?: CodeLink[]` 코멘트 "spec only" 직접 확인. `markdown.ts:615` `normalizeBoundary` + `:621` `normalizeCodeLinks` 모두 type-gate 없이 모든 카드 normalize. `validation.ts:501-558` 가 spec branch 안에서만 codeLinks/boundary 사용. brief/principle/domain 카드에 입력 시 parse 통과. **CONFIRMED**
- [x] B4 — `types.ts:327` parent, :331 relations, :295-308 DomainCrossDependency, :223,233 derives 직접 확인. SKILL.md:181 "brief 키 배열. parent 가 이미 brief 면 불필요", :206 cross_domain_dependencies 양방향, :276 broken-chain 표기 — 4 메커니즘 의미 차 명시 부재. **CONFIRMED**
- [x] B5 — `types.ts:327` `parent?: string;` (단일, 배열 아님) 직접 확인. **CONFIRMED**
- [x] B6 — `markdown.ts:111-114` `normalizeRelations = asStringArray` 타입 필터 없음 직접 확인. `validation.ts:293-302` `validateRelationTargets` self-ref + existsByKey 만 검사 (type 검사 없음). SKILL.md:181 "brief 키 배열" 명시. **CONFIRMED**

## C. 검증
- [x] C1 — `validation.ts` exports: 64,230,244,278,293,314,373,570 (8개) 직접 grep. `principle/validate.ts:19`, `domain/validate.ts:22`, `brief/validate-refs.ts:44`, `spec/validate-refs.ts:81`, `glossary/validation.ts:8,32` 직접 grep. 분산 위치 총 14군데 (PROBLEM 의 8 군데 cite 는 validation.ts 본체 8 export 와 일치). **CONFIRMED**
- [x] C2 — `sync.ts:305` `validateCards` 함수 본문 직접 read. file↔DB 정합 (staleDbRows, orphanFiles, keyMismatches at :316-323) + 카드 그래프 정합 (orphan-card, broken-parent at :340-355) 한 함수에서 mixed 직접 확인. **CONFIRMED**
- [x] C3 — `sync.ts:68-78` `typeHierarchyViolationMessage` (principle/domain root, brief→domain, spec→brief|spec) 직접 read. `validation.ts:244` `validateParentType` 동일 룰 (throw 형태) 직접 read. 같은 hierarchy rule 두 곳에 중복 구현. **CONFIRMED**
- [x] C4 — `safe.ts:3-10` SafeWriteOptions: dbAction/fileAction/compensate (singular) 직접 read. `:22-41` 한 dbAction → 한 fileAction → catch → 한 compensate. POST-001 카드: "On forward-action throw all registered compensations execute in reverse registration order" 직접 확인 — 코드는 single compensate 인데 카드는 복수 "compensations in reverse order" 주장. **CONFIRMED 거짓말**
- [x] C5 — `update.ts:444-455` `if (status === 'active') { await validateActivationGuard(...) }` 직접 read (draft 일 때 미검증). `context.ts:170-173` `if (row.status === 'draft') { healthDraft++; continue; }` drift 분석 skip 직접 read. **CONFIRMED**
- [x] C6 — `types.ts:34` `kind: string` 직접 확인 (gildash SymbolKind union 으로 제약 안 됨, 코멘트 예시만). **CONFIRMED**

## D. 의도/강제력
- [x] D1 — `context.ts:116` `const autoTransition = options?.autoTransition ?? true;` 직접 확인. `check.ts:21` `--no-auto-transition` opt-out 옵션 직접 확인. read 명령이 default 로 mutate. **CONFIRMED**
- [x] D2 — `principle/validate.ts:19-33` namespace 존재 + `applies_to` 빈 배열 reject 만 직접 확인. enforcement/metric/exemptions 검증 0. validate.ts/types.ts/markdown.ts/searchable-text.ts 외 grep 0건. **CONFIRMED enforce 0**
- [x] D3 — `spec-sync.ts:849-861` boundary 가 indexedFilePaths 매칭(ignorePatterns 미적용), `:867` ignorePatterns 가 targetFiles 만 필터 직접 확인. `impact.ts:141-152` boundary 우선 → 그 다음 ignorePatterns 직접 확인. `link.ts` `findCardsBySymbol` ignorePatterns grep 0건 직접 확인. 3 site 3 다른 ordering. **CONFIRMED**

## E.
- [x] E1 — `markdown.ts:49-54` `asString` 가 length 0 reject 직접 확인. SKILL.md:177 `class: "none", file: ""` 컨벤션 명시. file:"" 가 asString 통과 불가 — 4차에서 직접 재현됨 (`Invalid frontmatter field: spec.failures[].exception.file`). **CONFIRMED**

## F.
- [x] F1 — `link.ts:163-167` `gildashProjectNames` 항상 `[undefined]` fallback 직접 확인. `:55-72` SymbolFileCache 가 `for (const project of this.projectNames)` iterate. `:177-192` `listAllIndexedFilesWithProject` 가 `for (const project of gildashProjectNames(ctx))` iterate. 단일 프로젝트도 `[undefined]` 한 번 iterate 비용. **CONFIRMED**
- [x] F2 — `sync.ts:211` `batchedAllSettled(safeFiles, 20, (f) => syncCardFromFile(ctx, f))` 직접 확인. syncCardFromFile 자체가 per-file `ctx.db.transaction(...)` (line 140 검증됨) — bulk 자체는 N 개의 별 transaction. cross-card invariant 못 보장. **CONFIRMED**

## G. ops/ 심층
- [x] G-001 — `link.ts:146-150` `if (has) return; add(ctx); await reindex()` 직접 확인. await 전에 add → reindex throw 시 catch 후 재호출 가능하지만 WeakSet 이미 mark 되어 no-op. in-flight Promise 캐시 부재. **CONFIRMED race**
- [x] G-002 — `analyze.ts:11` `CHANGELOG_RETENTION_DAYS = 90` 직접 확인. `context.ts:467-480` collectSymbolChanges 가 `oldestUpdatedAt` 기반 `getSymbolChanges` 호출 직접 확인. 90일 이전 active 카드는 cutoff 가 pruned 윈도우보다 오래되어 빈 결과 → drift invisible. **CONFIRMED (재구성)**
- [x] G-003 — `link.ts:410-422` `UPDATE card → writeCardFile → catch DB revert` 직접 확인. safeWriteOperation 우회. file write 가 partial 일 경우 partial 파일 잔재 가능. **CONFIRMED**
- [x] G-004 — `context.ts:386-405` G-003 와 동일 패턴 (raw UPDATE → readCardFile/writeCardFile → catch revert) 직접 확인. **CONFIRMED**
- [x] G-005 — `sync.ts:113-153` syncCardFromFile 본문 직접 read. parseFullKey + upsert + replaceForCard 만, validate* 호출 0. `update.ts:412-414` compensate 가 syncCardFromFile 호출 → 깨진 카드 재설치 경로 직접 확인. **CONFIRMED**
- [x] G-006 — `bulk-create.ts:42-56` `if (idx === -1) break; ... sorted.push(...remaining)` 직접 확인. cycle/dangling 시 input 순서 그대로 append. iterations guard 는 dead. **CONFIRMED**
- [x] G-007 — `bulk-create.ts:108-128` 직접 확인. relation update fail 시 `errors.push + keys.splice + partialKeys.push` — 같은 키가 errors+partialKeys 동시 등장. created (keys.length) 와 failed (errors.length) 산술 분리 안 됨. **CONFIRMED**
- [x] G-008 — `bulk-create.ts:107` `const { updateCard } = await import('../ops/update');` 직접 확인. circular import 정당화 코멘트 0. **CONFIRMED**
- [x] G-009 — `safe.ts:27` `const result = dbAction();` 가 try 블록 밖 직접 확인 (try 는 fileAction 만 감쌈). `create.ts:123` `await Bun.file(filePath).exists()` (TOCTOU) 직접 확인. **CONFIRMED**
- [x] G-010 — `rename.ts:107` `if (row.body?.includes(oldKey)) bodyReferencesFound.push(...)` 직접 확인. substring match — `auth` rename 시 `oauth`/`authentication` false positive. **CONFIRMED**
- [x] G-011 — `rename.ts:182-184` `catch { failedReferenceUpdates.push(ref.key); }` swallow 직접 확인. `:186-197` DB rollback 시 inner loop 가 이미 수정한 ref files 복구 안 함 직접 확인. **CONFIRMED**
- [x] G-012 — `rename.ts:144-180` 직접 read. parent / relations / cross_domain_dependencies frontmatter 만 update. body 본문 텍스트는 갱신 안 함 (G-010 의 detect 만 함). **CONFIRMED**
- [x] G-013 — `rename.ts:81-86` `for (const rel of ctx.relationRepo.findAll())` 전체 relation 스캔 직접 확인. **CONFIRMED**
- [x] G-014 — `delete.ts:114, 136, 163` 3 군데 `// Best effort — ...` catch-swallow 직접 grep 확인. **CONFIRMED**
- [x] G-015 — `delete.ts:103` `await deleteCardFile(filePath);` 가 best-effort 수정 BEFORE 직접 확인. `:114,136,163` 3 catch 모두 swallow → throw propagate 안 함. compensate path 도달 가능한 throw 는 line 103 의 deleteCardFile 만 → 그 시점은 unmodified. PROBLEM 의 "permanent corruption" 시나리오 control flow 에 부재. **REFUTED 재확인**
- [x] G-016 — `glossary.ts:141-145` `entries.splice; writeGlossary; affectedCardKeys = cardsContaining...` 직접 확인. 카드 frontmatter glossary 필드 cascade rewrite 없음 (단지 affectedKeys 보고만). **CONFIRMED**
- [x] G-017 — `glossary.ts:217-240` DB transaction commit 직접 확인. `:246-260` "Best-effort: rewrite affected card .md files" file write try/catch silent collect failures 직접 확인. file 실패 시 다음 bulk sync 가 DB 를 파일로 revert 가능. **CONFIRMED**
- [x] G-018 — `glossary.ts:320-329` per-card try/catch loop, 단일 transaction 안 아님 직접 확인. `catch { /* skip */ }` swallow. partial reset 가능. **CONFIRMED**
- [x] G-019 — `glossary.ts:342` `return { cardsDeleted, glossaryCleared, dbReset: true };` 직접 확인. 실제 reset 검증 없는 하드코딩. **CONFIRMED**
- [x] G-020 — `sync.ts:223-275` `generateSamplePaths` 직접 read. `defaultExts = ['.ts','.js','.tsx','.json']`, `depths = ['','d1/','d1/d2/','d1/d2/d3/']` 하드코딩. 비표준 ext / 깊은 구조 미스. **CONFIRMED**
- [x] G-021 — `sync.ts:496-497` `readCardFile(row.filePath)` for status/summary, `:543-544` 다시 `readCardFile(row.filePath)` for glossary 직접 확인. 같은 파일 두 번 read. **CONFIRMED**
- [x] G-022 — `sync.ts:177,211`, `query.ts:207`, `glossary.ts:319` 4 군데 `20` 하드코딩 직접 grep 확인 (5차 첫 라운드의 :306 cite 는 잘못 — :207 이 맞음). **CONFIRMED**
- [x] G-023 — `query.ts:207-211` `else throw result.reason;` (NotFound 외) 직접 확인. throw 시 누적된 cards 폐기. **CONFIRMED**
- [x] G-024 — `context.ts:182-191` 직접 확인. 첫 link 가 `!symbolCache.find` 로 brokenLinks++ 후, 두번째 link 가 throw → gildashUnavailable=true. brokenLinks 가 이미 증가한 상태로 보고. **CONFIRMED**
- [x] G-025 — `context.ts:379` `currentStatus === 'active' && autoTransition` (drifted 는 transition 대상 아님) 직접 확인. `analyze.ts:163` 코멘트 "code was fixed but card not re-activated" 직접 확인. drifted → active 자동복구 메커니즘 0. **CONFIRMED**
- [x] G-026 — `context.ts:215-221` `if (indexedFiles.size > 0) { ... if (!anyMatch) addDrift('boundary_inactive'); }` 직접 확인. empty index 시 silent skip. **CONFIRMED**
- [x] G-027 — `context.ts:447-460` `try { JSON.parse } catch { return []; }` 직접 확인. malformed 시 silent default. **CONFIRMED**
- [x] G-028 — `spec-sync.ts:877-882` 직접 확인. `primary = getSymbolsByFile(file, project)`, primary.length===0 시 `getSymbolsByFile(join(projectRoot, file))` fallback. 매 빈 결과마다 두번째 call. 캐시 0. **CONFIRMED**
- [x] G-029 — `link.ts:187,290`, `impact.ts:179` 모두 `catch { /* skip */ }` 또는 `// best-effort` 직접 확인. gildash 실패 시 silent degradation. **CONFIRMED**
- [x] G-030 — `spec-sync.ts:352-354` `if (removed > 0) { await ensureReindexed(ctx); }` 직접 확인. ensureReindexed 는 G-001 의해 once-per-ctx 라 두 번째 호출 no-op. actualSet 재구축 안 됨. **CONFIRMED**
- [x] G-031 — `spec-sync.ts:619` `for (const link of links)` 매 link 마다 별도 `findByCardKey` + `replaceForCard` 직접 확인. 같은 카드 N 번. card-key grouping 없음. **CONFIRMED**
- [x] G-032 — `spec-sync.ts:38-44` `try { searchAnnotations } catch { /* skip */ }` 직접 확인. 모든 프로젝트 throw 시 `out=[]`, annotationKeys 빈 set. `:155-160` 모든 codeLink 가 `!annotationKeys.has(...)` → 모두 markerMissing 으로 보고. `--prune` 시 wipe 위험. **CONFIRMED**
- [x] G-033 — `update.ts:51,57` `Record<typeof field, string[]>` 직접 확인. typeof field 가 union 의 narrowed type 이 아니라 union 전체 라서 의도와 다른 typing. **CONFIRMED nit**
- [x] G-034 — `delete.ts:167-172` `if (fileExists) { syncCardFromFile } // else nothing to compensate` 직접 확인. file 없으면 보상 0. **CONFIRMED**
- [x] G-035 — `query.ts:131-140` 매 maxDepth 노드마다 `findByCardKey` + `existsByKey` 호출 직접 확인. N 번 추가 query. **CONFIRMED**
- [x] G-036 — `impact.ts:313` `for (const key of affectedKeys) { await checkDrift(ctx, key, {...}) }` 직접 확인. 카드별 N 번 별도 checkDrift. **CONFIRMED**
- [x] G-037 — `link.ts:255-264` 모든 카드 × matchesAnyGlob(boundary) 직접 확인. `impact.ts:78-83` N×M files × boundary 직접 확인. matchesAnyGlob 매 호출마다 `new Bun.Glob` (J-019 와 결합). **CONFIRMED**
- [x] G-038 — `glossary.ts:65-77` existing array in-place mutation (ex.definition = ...) 직접 확인. all-or-nothing 보장은 별도 upfront validation 만, 적용 자체는 mid-loop 실패 시 partial. **CONFIRMED**
- [x] G-039 — `update.ts:494` `body: current.body` (else branch, raw 본문) 직접 확인. `sync.ts:120-121` `fullBody = [body, namespaceText].join('\n\n')` (concat) 직접 비교. else branch 가 활성화될 때 FTS5 body 가 namespace tail 결손. **CONFIRMED (한 branch만)**
- [x] G-040 — `update.ts:474-499` existing branch DB 만 status update + 파일 frontmatter 전체 갱신 (`{ ...current.frontmatter, status }` at :461). 두 경로 분기. drift 시 발생 가능. **CONFIRMED**
- [x] G-041 — `analyze.ts:18-24` `try { ... } catch { return null; }` 직접 확인. silent error swallow. **CONFIRMED**

## H. CLI 표면
- [x] H-001 — alias of MISTAKE-3, 위 검증 동일. REFUTED
- [x] H-002 — `context.ts:38` `throw new Error(config load failed: ...)` (typed error 아닌 일반 Error) 직접 확인. `errors.ts:64` fallback `INTERNAL_ERROR` 직접 확인. `output.ts:128-146` ERROR_CODE_TO_EXIT 에 `INTERNAL_ERROR` 키 없음 → fallback `EXIT.GENERIC_ERROR` (1). config 실패가 exit 6 (CONFIG_MISSING) 아니라 1. **CONFIRMED**
- [x] H-003 — `single.ts:31` `await run(async (_rt: CliRuntime) => {...})` 직접 확인. `runner.ts:80` `rt = await buildRuntime(globalFlags)` (= setupEmberdeck → Gildash.open). `setup.ts:42-55` Gildash.open 실패 시 GildashInitError throw. ed init 가 동작하는 setup 을 요구. **CONFIRMED**
- [x] H-004 — `output.ts:154-165` `data.key` (단일) 또는 `data.items[].key` (목록) 만 처리 직접 확인. analyze/check drift/check coverage 의 data shape 둘 다 없음 → quiet 모드에서 빈 stdout. **CONFIRMED**
- [x] H-005 — `parsers.ts:12` `throw new InvalidArgumentError(...)` 직접 확인. `grep exitOverride src/cli/index.ts` → 0건. commander 가 default behavior 로 process.exit(1) + plaintext stderr → JSON envelope 우회. 4차에서 직접 재현됨. **CONFIRMED**
- [x] H-006 — H-005 와 같은 root (exitOverride 부재 → commander missing-arg/missing-required-option/unknown-flag 모두 우회). 4차에서 `ed card get` 직접 재현 확인. **CONFIRMED**
- [x] H-007 — `bulk.ts:114` `code: 'SYNC_FAILED'` 직접 확인. `grep "SYNC_FAILED|..." src/cli/output.ts` → 0건. **5차 deep 재현**: `bulk sync` 가 partial 상태로 → partialIsFailure=true 통해 exit 2. SYNC_FAILED/BULK_* 는 partial path 라 exit 2 OK. 그러나 COMPENSATION_FAILED (errors.ts:53) 는 toCliError 통한 single error 경로 → ERROR_CODE_TO_EXIT 미매핑 → exit 1. substance 정확하나 영향 범위 partial path 에서는 manifest 안 됨. **CONFIRMED (substance), 영향 범위 nuance**
- [x] H-008 — `card.ts:276-295` `if (opts.patch) { Object.assign(fields, parsedRaw) } ... fieldMap = parseFields; for [name,value] of fieldMap { applyFieldValue(fields, ...) }` 직접 확인. mutex 없음. patch 적용 후 field overlay. **CONFIRMED**
- [x] H-009 — `card.ts:81` `fields.parent = value === '' ? null : value;` 직접 확인. `--field parent=` 빈 문자열이 silent null. **CONFIRMED**
- [x] H-010 — `card.ts:61-70` parseFields 가 `f.slice(0, idx)` 그대로 key 사용 직접 확인. `applyFieldValue` switch case 가 `'summary'`, `'parent'` 등 lowercase only — `Summary=x` switch default 통과 안 함 (실제로 default 처리 봐야). **CONFIRMED**
- [x] H-011 — `parse-input.ts:8-22` JSON-prefix 휴리스틱 + JSON catch swallow → YAML 시도 직접 확인. JSON 파싱 실패해도 YAML 에러로 위장. **CONFIRMED**
- [x] H-012 — `confirm.ts:33` `!process.stdin.isTTY || !process.stderr.isTTY` 직접 확인 — 안전한 체크. **REFUTED-AS-DEFECT 재확인**
- [x] H-013 — `single.ts:6` `import { ..., writeFile, ..., appendFile } from 'node:fs/promises'` 직접 확인. `:81,89-93` writeFile 사용. `:106` appendFile 사용. atomicWrite 사용 0. **CONFIRMED**
- [x] H-014 — `runner.ts:60-61` 첫 신호 후 `process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);` 둘 다 제거 직접 확인. cleanup 도중 다른 시그널 도달 시 handler 없음. **CONFIRMED**
- [x] H-015 — `runner.ts:71-79` 코멘트 "never user input ... or anything containing potential secrets" 직접 확인. 그러나 verboseLog 가 `cardsDir=${rt.ctx.cardsDir}` `projectRoot=${rt.ctx.projectRoot}` 출력 — 사용자 path 노출. 코멘트 vs 동작 모순. **CONFIRMED (framing)**
- [x] H-016 — `validate.ts:44-49` `for (const c of allCards) { await validateCodeLinks(...) }` sequential O(N) 직접 확인. 진행 표시 0. **CONFIRMED**
- [x] H-017 — `card.ts:418` `await atomicWrite(opts.out, content)` 직접 확인. confirmation 없이 overwrite. **CONFIRMED**
- [x] H-018 — `card.ts:72-90` applyFieldValue switch summary/status/parent/type 만 직접 확인. boundary/codeLinks/namespace --unset 메커니즘 부재 (--field 로 도달 불가). **CONFIRMED**
- [x] H-019 — `spec.ts:20` `--prune ... DESTRUCTIVE` 옵션 직접 확인. spec.ts 안 confirmDestructive grep → 0건. confirmation 없음. **CONFIRMED**
- [x] H-020 — `grep -rn "dry.run|dryRun|--dry" src/cli/` → 0건 직접 확인. spec annotate / bulk sync / validate / check drift 어디에도 dry-run 없음. **CONFIRMED**
- [x] H-021 — `bulk.ts:19-46` validateBulkInput 가 key/type/status 만 체크 직접 확인. parent/glossary/relations shape 검사 없음 → downstream throw. **CONFIRMED**
- [x] H-022 — `parsers.ts:9` 함수명 `parsePositiveInt`, `:11` 정규식 `/^\d+$/` 가 `0` 허용, `:12` 에러 메시지는 "non-negative integer" — 함수명과 동작 모순. **CONFIRMED**
- [x] H-023 — `bulk.ts:69-71` `validated.ok` 가 일부 valid 만 모은 array, `bulkCreateCards(ctx, validated.ok)` 호출 직접 확인. validation 실패한 일부 + 성공한 일부 → bulkCreate 가 partial 진행. glossary "all-or-nothing" 약속과 모순. **CONFIRMED**
- [x] H-024 — `card.ts:127,136-137,149` `--file` 가 `--symbol` 동반만 강제, path 자체 검증 (실재 / 절대-상대 / traversal) 0. **CONFIRMED**
- [x] H-025 — `errors.ts:51-58` `COMPENSATION_FAILED` 코드 emit 직접 확인. `grep COMPENSATION_FAILED src/cli/output.ts` → 0건 매핑. exit 1 fallback. **CONFIRMED**

## I. card-model
- [x] I-001 — `markdown.ts:606` `summary: asString(fm['summary'], 'summary')` (length 0 만 reject) 직접 확인. `validation.ts:111` `summary.length > LIMITS.SUMMARY_MAX` 체크는 validateCardInput 단계 — parse 통과 후. **CONFIRMED**
- [x] I-002 — alias of B3 (boundary 부분). 위 B3 검증 동일. **CONFIRMED**
- [x] I-003 — alias of B3 (codeLinks 부분). 위 B3 검증 동일. **CONFIRMED**
- [x] I-004 — `spec/validate-refs.ts:124` `if (briefLookup) { ... }` 직접 확인 (briefLookup 옵셔널 — 없으면 cross-ref skip). `validation.ts:508` `validateSpecRefs(card.spec, { codeLinks: card.codeLinks } as CardFrontmatter)` 가 briefLookup 인자 안 전달 직접 확인. activation 시 `derives` cross-ref 검증 우회. **CONFIRMED**
- [x] I-005 — `brief/validate-refs.ts:19-24` collectIds 가 goal/flow/external/limit 만 (criteria/non_goals/assumptions/policy/design 제외) 직접 확인. `spec/validate-refs.ts:62-69` collectBriefRefIds 는 goal/flow/policy/design.invariants — 두 함수 다른 set. 비대칭 발생. **CONFIRMED**
- [x] I-006 — alias of E1. 위 검증 동일. **CONFIRMED**
- [x] I-007 — `markdown.ts:577` `asString(p.id, 'spec.code_patterns[].id')` 직접 확인. `asString` (line 49-54) length 0 만 reject — `id: " "` 통과. **CONFIRMED**
- [x] I-008 — `markdown.ts:578` `pattern: asString(p.pattern, ...)` (length 0 만 검사) 직접 확인. ast-grep syntax 검증은 `context.ts:294,324` drift 시 `gildash.findPattern` 호출 시점에만. parse/validate 단계 ast-grep syntax 0. **CONFIRMED**
- [x] I-009 — `markdown.ts:88` `.map((s) => s.toLowerCase())` 직접 확인. mixed-case input 가 lowercase 로 round-trip lossy. **CONFIRMED**
- [x] I-010 — `markdown.ts:649-685` parse, `:687-694` serialize 직접 read. body=`""`, `"\n"`, `"abc"`, `"abc\n"` 4 케이스 trace 모두 round-trip 정확. parse `lines.slice(end+1).join('\n')` + serialize `header + body`. **REFUTED 재확인**
- [x] I-011 — alias of B1 (stripNamespaceText). 위 B1 검증 동일. **CONFIRMED**
- [x] I-012 — `searchable-text.ts:18-20` `for (const m of fm.principle.metric) parts.push(m.name, m.unit)` 직접 확인 — `kind`, `window_kind` 누락. spec block (line 81-90) 안에 `code_patterns` 처리 0. **CONFIRMED**
- [x] I-013 — `searchable-text.ts:67-74` measure 의 predicate/method/reference/unit 만 push, `value`/`comparator` 누락 직접 확인. **CONFIRMED**
- [x] I-014 — `validation.ts:149-167` relations 길이/empty/max 만 체크, 중복 detection 없음 직접 확인. J-007 이 dedup 부재로 UNIQUE constraint 발동. **CONFIRMED**
- [x] I-015 — `json-fields.ts:6-15` `try { JSON.parse } catch { return []; }` 직접 확인. `:25-32` parseCrossDomainDependencies 동일. malformed corruption silent. **CONFIRMED**
- [x] I-016 — `principle/validate.ts:19-33` 직접 read. statement/rationale 비어있음 검사 없음 (markdown.ts asString 만 거치므로 ' ' 통과). programmatic API 로 활성화 우회 가능. **CONFIRMED**
- [x] I-017 — `markdown.ts:197` `target: asString(e.target, ...)` (raw string), `searchable-text.ts:23` parts.push 만 직접 확인. card-key resolution / 의미 해석 0. **CONFIRMED**
- [x] I-018 — `markdown.ts:140-175` 직접 read. `kind` (threshold|budget) 와 `window_kind` 가 독립적으로 검증. `kind=threshold + window_kind=...` 결합 허용 — 의미상 budget 외 kind 와의 결합 reject 부재. **CONFIRMED**
- [x] I-019 — `markdown.ts:399-419` 직접 read. measure 구성 시 알려진 키 (value/comparator/unit/predicate/method/reference) 만 explicitly copy. unknown key 가 m 안에 있어도 reject 없이 silent 무시. **CONFIRMED**
- [x] I-020 — `domain/validate.ts:49` `if (dep.domain === fm.key)` 직접 확인. `validation.ts:459` `key: card.key ?? ''` (빈 문자열 fallback) 직접 확인. `card.key` 가 falsy 인 path 에서 self-ref 검증 우회 가능. **CONFIRMED**
- [x] I-021 — `grep cycle src/domain/validate.ts src/card/validation.ts` → 0 (parent cycle 만 존재). cross_domain_dependencies 사이 cycle 검출 메커니즘 부재. **CONFIRMED**
- [x] I-022 — `bun -e 'parseFullKey("..secret/x")'` 직접 실행 → `"..secret/x"` 통과 **재현 완료**. negative lookahead `(?!.*(?:^|\/)\.{1,2}(?:\/|$))` 가 segment 가 정확히 `.` 또는 `..` 일 때만 reject. **CONFIRMED**
- [x] I-023 — `bun -e 'parseFullKey("/foo/")'` → `"foo"` **재현 완료**. `normalizeSlug` 의 `.replace(/^\/+|\/+$/g, '')` 가 silent strip. **CONFIRMED**
- [x] I-024 — `card-key.ts:15` `class CardKeyError`, `markdown.ts` 다수 `CardValidationError` (`Invalid frontmatter field: key` 형태) — key 검증이 두 별 클래스 직접 확인 (PROBLEM 의 "3 가지" 는 normalizeSlug + asString + parseFullKey 경로 차이). **CONFIRMED**
- [x] I-025 — `validation.ts:230-233` validateParentExists 와 `:244-248` validateParentType 가 둘 다 `findByKey/existsByKey + Parent not found` throw 직접 확인. validateParentType 호출 site 가 ParentExists 도 호출하면 중복. **CONFIRMED**
- [x] I-026 — `cross-validate.ts:30` `\\b(...)\\b` 단어 경계 패턴 직접 확인. `glossary/validation.ts:8-25` length 만 검사 — word 가 비-단어 문자 (구두점/공백/이모지) 로 시작/끝나면 `\b` 매칭 실패해도 reject 안 함. **CONFIRMED**
- [x] I-027 — `cross-validate.ts:23` `for (const e of entries) canonMap.set(e.word.toLowerCase(), e.word)` 직접 확인. `Job` 와 `job` 둘 다 입력되면 같은 `'job'` 키로 last-write-wins 덮어씀. **CONFIRMED**
- [x] I-028 — `sync.ts:42-49` 직접 read. fixed order principle→domain→brief→spec 으로 build. JSON.stringify 결정적. Bun.YAML.parse insertion order 보존. round-trip 결정적. **REFUTED 재확인**
- [x] I-029 — `update.ts:248` validateChildrenHierarchy 호출은 `fields.type` 변경 시 만 직접 확인. 주기적 / standalone 검사 없음. **CONFIRMED**
- [x] I-030 — `validation.ts:213-217` `try { new Bun.Glob(pattern); } catch { throw }` 직접 확인. compile 결과 폐기 (보존 안 함). 호출 site 가 다시 `new Bun.Glob` (J-019). **CONFIRMED**
- [x] I-031 — **5차 deep 후속**: `types.ts:250` SpecStateTransition `{from, trigger, to, binds}` (id 부재), SKILL.md:178 동일, `markdown.ts:556-563` 파싱에 asId 호출 0. state_transitions 자체에 id 가 없으므로 "ID 중복 미검출" claim 자체가 잘못. 별도 array (preconditions/postconditions/invariants/failures/code_patterns/criteria 등) 에는 id 가 있고 중복 미검출 substance 가 적용되나 PROBLEM 의 array 지정은 부정확. **REFUTED (5차 후속 — claim 잘못)**

## J. db / fs / setup
- [x] J-001 — `schema.ts:104-115` `systemLock` table 정의 직접 확인. `drizzle/0002_*.sql` CREATE TABLE 직접 확인. `grep system_lock src/` schema.ts 외 사용처 0건. **CONFIRMED**
- [x] J-002 — `changelog-repo.ts:24` `findByCardKey` exists 직접 확인. findHistory 부재 자체는 정상. **REFUTED 재확인**
- [x] J-003 — `migration-upgrade.test.ts:71-75` `expect(after).toEqual({ name: 'system_lock' })` 직접 확인. 테스트가 dead schema 강제. **CONFIRMED**
- [x] J-004 — `ls drizzle/meta/` → 0002, 0003 snapshot 만 직접 확인. journal 에는 0000-0004 모두 등록 (5건). 0000/0001/0004 snapshot 누락. **CONFIRMED**
- [x] J-005 — `connection.ts:41` `migrateEmberdeck(db)` 무조건 호출 (createEmberdeckDb 안에서) 직접 확인. 매 CLI invocation 마다 실행. **CONFIRMED**
- [x] J-006 — `package-root.ts:14` `if (parent === dir) return from;` 직접 확인. miss 시 unresolved input 반환. **CONFIRMED**
- [x] J-007 — `relation-repo.ts:27-51` for-loop dedup 부재 직접 확인. `code-link-repo.ts:18-25` Set dedup 직접 확인 (비대칭). `schema.ts:74` `uq_card_relation` UNIQUE. 4차에서 직접 재현됨 (`relations: [keyA, keyA]` → UNIQUE 실패). **CONFIRMED**
- [x] J-008 — `card-repo.ts:142-153` `for (let i = 0; i < MAX_ANCESTOR_DEPTH && current?.parent; i++)` 직접 확인 — depth 도달 시 silent break (cycle 미검출). `validation.ts:280` validateParentCycle 동일 패턴. **CONFIRMED**
- [x] J-009 — `writer.ts:11-15` 자체 코멘트 "on partial Bun.write we leave the tmp behind for forensic recovery" 직접 확인. `:21` `await Bun.write(tmpPath, text)` 가 try 밖 — Bun.write 자체 실패 시 tmp 가 leak (rename 실패 시는 catch 가 unlink). **CONFIRMED**
- [x] J-010 — `reader.ts:5-9` `readCardFile` 가 `Bun.file().text()` 후 `parseCardMarkdown` 호출 직접 확인. missing 은 Bun.file().text() 의 ENOENT 가 transparent 던져짐, malformed 는 CardValidationError. caller 가 두 케이스 구분 불가 (둘 다 surface 다름). **CONFIRMED**
- [x] J-011 — `config-file.ts:262-275` mergeCliArgs args 인자 시그니처가 `{ dir, dbPath, projectRoot }` 만 직접 확인. ignorePatterns/regressionThreshold/analysisIgnore 미지원 — CLI 로 override 불가. **CONFIRMED**
- [x] J-012 — `config-file.ts:39` `CONFIG_FILE_NAMES = ['.emberdeck.jsonc', '.emberdeck.json']`, `:245-251` `for (const name) { if (exists) return ... }` 직접 확인. .jsonc 우선, 둘 다 있으면 .json 무시 (silent winner). **CONFIRMED**
- [x] J-013 — `config-file.ts:130-145` 직접 read. assertString (cardsDir/dbPath/projectRoot), assertStringArray (allowEmpty=true), assertNumber (regressionThreshold) 만 검사. 빈 string / glob syntax / ignorePatterns 의 빈 element 등 검사 0. **CONFIRMED**
- [x] J-014 — `Bun.JSONC.parse("{ \"a\": 1, garbage")` 직접 실행 → AggregateError, e.line=1, e.column=17, e.message="Failed to parse JSONC" 재현 완료. `config-file.ts:223-229` `errorMessage(e)` (= e.message 만) 사용 → line/col 폐기. **CONFIRMED**
- [x] J-015 — `connection.ts:22-27` 3 PRAGMAs (journal_mode WAL, foreign_keys ON, busy_timeout 5000) 직접 확인. synchronous 미설정. **CONFIRMED**
- [x] J-016 — `connection.ts:58-60` `db.$client.close()` 직접 확인. **5차 deep 재현**: `bun -e` 로 Database.close() 두 번 호출 → 둘 다 throw 안 함 (bun:sqlite 이 자체적으로 idempotent). PROBLEM 의 "non-idempotent" 가정 잘못. **REFUTED (5차 발견)**
- [x] J-017 — `connection.ts:68-70` `return tx as EmberdeckDb;` 직접 확인. 런타임 검증 없음. **CONFIRMED**
- [x] J-018 — alias of G-022. 위 G-022 검증 동일. **CONFIRMED**
- [x] J-019 — `glob.ts:7` `if (new Bun.Glob(p).match(path))` 매 호출마다 새 Glob 컴파일 직접 확인. `spec-sync.ts:748` `for (const file of linkedFiles) { matchesAnyGlob(file, ctx.ignorePatterns) }` hot loop 직접 확인. **CONFIRMED**
- [x] J-020 — `glob.ts` 전체 read. **5차 deep 재현**: `matchesAnyGlob("/abs/path/file.ts", ["**/*.ts"])` → true. `matchesAnyGlob("a/b/file.ts", ["*.ts"])` → false (top-level glob). abs path + relative pattern 가 매칭됨 — 의도와 다를 수 있음. 코멘트/문서 0. **CONFIRMED + behavior nuance**
- [x] J-021 — `error.ts` 전체: `e.message` 또는 String(e) 그대로 반환 직접 확인. PII redact 없음. **CONFIRMED**
- [x] J-022 — `schema.ts:79-83` `cardFts = sqliteTable('card_fts', ...)` (regular sqliteTable) 직접 확인. 실제 FTS5 virtual table 은 migration SQL + raw SQL 로만 (`card-repo.ts:105-120` `JOIN card_fts f ON c.rowid = f.rowid` raw). drizzle generate 시 footgun. **CONFIRMED**
- [x] J-023 — `0000_init.sql:99-104` `CREATE TRIGGER card_au AFTER UPDATE ON card BEGIN DELETE FROM card_fts ...; INSERT INTO card_fts ...` 직접 확인. UPDATE 시 FTS row 항상 rewrite (metadata-only update 도). **CONFIRMED**
- [x] J-024 — `config.ts:14` `projectRoot: string;` (required) 직접 확인. file 모드 (':memory:' 등) 시 silent default 처리는 별도 path 검증 필요 — 구조적 비대칭. **CONFIRMED**
- [x] J-025 — `relation-repo.ts:48` 와 `code-link-repo.ts:35` 둘 다 `msg.includes('FOREIGN KEY constraint failed')` substring 직접 확인. SQLite 에러 메시지 변경 시 fragile. **CONFIRMED**
- [x] J-026 — `relation-repo.ts:16-50` 직접 read. 두 delete + N (forward+reverse) insert 모두 별 statement, savepoint/internal transaction 없음. mid-loop UNIQUE/transient 시 partial 상태 가능. **CONFIRMED**
- [x] J-027 — `setup.ts:58-70` repo 생성자가 try/catch 밖. **5차 deep**: 모든 Drizzle*Repository constructor (`db/{card,code-link,classification,changelog,relation}-repo.ts:8-11`) 가 `private db` 단순 저장만 — throw 불가. 현재 코드에서 leak path 0. preventive concern 만 있음. **REFUTED (현재 코드)**
- [x] J-028 — `spec.ts:90` SELECT `value` only (updated_at 미read) 직접 확인. `:110-112` INSERT/UPSERT 에 updated_at 양쪽 write. read 0건 → write-only column. **CONFIRMED**
- [x] J-029 — `classification-repo.ts:48` `DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM card_tag)` 직접 확인. NOT IN subquery 형태 (LEFT JOIN/anti-join 보다 일반적으로 느림). **CONFIRMED**
- [x] J-030 — `writer.ts:19-28` 직접 read. random tmpPath + rename 만, flock/O_EXCL 없음. `grep flock|O_EXCL src/` → 0. lock 인프라 제거 후 동시 writer 보호 0. **CONFIRMED**

## K. SKILL audit
- [x] K-001 — SKILL.md:93 "자식 cascade" vs `delete.ts:23-24` "removes parent field from children" + `card.ts:320` "children are detached, not deleted" 직접 비교. SKILL claim 잘못. **CONFIRMED**
- [x] K-002 — alias of E1. 위 검증 동일. **CONFIRMED**
- [x] K-003 — SKILL.md:163 measure shape (numeric: `{predicate, value, comparator, unit, reference?}`, binary: `{predicate, method?, reference?}`, verification: `{method, reference, predicate?, unit?}`) vs `types.ts:175-178` 코드 union (numeric: `{value, comparator, unit}`, binary: `{predicate}`, verification: `{method, reference}`) 직접 비교. SKILL 의 optional 필드 코드에 0. **CONFIRMED**
- [x] K-004 — SKILL.md:351-355 `key/total_symbols/covered_symbols/coverage_ratio/uncovered` vs `check.ts:82-86` `declared/resolved/broken/coverage_ratio/unreferenced_symbols` 직접 비교. shape 완전히 다름. **CONFIRMED**
- [x] K-005 — `check.ts:72` `uncovered: uc.uncovered.slice(0, 100)` 직접 확인. SKILL.md grep 100 cap 명시 0건. **CONFIRMED**
- [x] K-006 — **5차 deep**: SKILL.md:362 정확한 shape `{key, type, files, symbols, reason, suggested_glossary}` 직접 확인. `check.ts:51-58` 출력 `{key, type, parent, files, symbols, reason, suggested_glossary}` — `parent` 필드 SKILL 누락 확인. **CONFIRMED**
- [x] K-007 — SKILL.md:105 `[--max-depth N]` 명시. `check.ts:21` 의 옵션은 `--no-auto-transition` 만 직접 확인. `--max-depth` 부재 — commander reject. 4차에서 직접 재현됨. **CONFIRMED**
- [x] K-008 — SKILL.md:88 표 marks rename "예" (destructive — 파괴적). `glossary.ts:115-143` action 에 confirmDestructive 호출 0건 직접 확인. **CONFIRMED**
- [x] K-009 — `card.ts:404-405` description "Default prints to STDOUT". SKILL.md:95 표는 `[--out FILE|--in-place]` (default 명시 없음). default behavior SKILL 누락. **CONFIRMED**
- [x] K-010 — `grep "ed init" SKILL.md` → 0건 직접 확인. `single.ts` 에는 init 명령 정의됨. SKILL <commands> 표 누락. **CONFIRMED**
- [x] K-011 — SKILL.md:266-281 표에 orphan-card/broken-parent/.../empty-tree 만 기재 직접 확인. `sync.ts:423` rework-dependency, `:486` boundary-overlap, `:501,508,549` content-mismatch, `:566` glossary-unused 모두 emit 직접 확인. SKILL 표 4종 누락. **CONFIRMED**
- [x] K-012 — A4 와 동일 substance. 위 A4 검증 동일. **CONFIRMED**
- [x] K-013 — `card.ts:497` command 정의 직접 확인. SKILL.md:101 한 줄만 ("직접 forward+reverse") — response shape 명시 0. **CONFIRMED**
- [x] K-014 — alias of B6. 위 B6 검증 동일. **CONFIRMED**
- [x] K-015 — SKILL.md:97 `--symbol`/`--glossary` 는 `--tag` 와 상호배타. `card.ts:142-143` `(opts.symbol || opts.glossary) && opts.tag` mutex check 직접 확인. SKILL 정확. **REFUTED-AS-DEFECT 재확인**
- [x] K-016 — alias of I-002 / B3 boundary 부분. 위 검증 동일. **CONFIRMED**
- [x] K-017 — `card.ts:433` `--reason-from <file|->` 옵션 정의 직접 확인. SKILL.md:96 표는 `[--reason TEXT]` 만 — `--reason-from` 누락. **CONFIRMED**
- [x] K-018 — SKILL.md:90 `--summary S` 가 표상 필수처럼 보이나 `card.ts:208-209` 에서 `--from` 파일 사용 시 summary 가 frontmatter 안에서 옴 직접 확인. SKILL 모호. **CONFIRMED**
- [x] K-019 — `validate.ts:97` `unresolved: errors.length` 출력 직접 확인. errors 는 BROKEN_LINK 만 push (line 87) — broken 과 unresolved 동일값. **CONFIRMED**
- [x] K-020 — SKILL.md:104 "ed validate cards + links 종합" 한 줄. `validate.ts:52-56` data shape `{cards: {issues}, links: {declared, broken}, total_issues}` 직접 확인 — SKILL 에 shape 명세 0. **CONFIRMED**
- [x] K-021 — alias of H-003. 위 H-003 검증 동일. **CONFIRMED**
- [x] K-022 — SKILL.md:13 rule 7 "--patch ... VALIDATION_ERROR" 직접 확인. CardValidationError 는 update 안 namespace 외 path (`assertCompleteNamespace`, summary length 등) 에서도 throw → VALIDATION_ERROR. SKILL rule 7 framing 이 namespace 만 강조. 실제는 더 넓은 범위. **CONFIRMED**
- [x] K-023 — SKILL.md:214 "본문에 구현 메커니즘명 X (WeakMap, FTS5, ...)" 직접 확인. 자동 검증 메커니즘 (lint/CI) 없음. advisory only. **CONFIRMED**
- [x] K-024 — SKILL.md:127-130 `principle.statement/rationale/applies_to/enforcement` "✓ 필수" 직접 확인. `principle/validate.ts:19-33` 가 namespace 존재 + applies_to empty 만 검사 — 다른 필드 missing 은 `assertCompleteNamespace` (update.ts:51) 에서 잡혀 activation-time 에 fail. create-time guard 약함. **CONFIRMED**
- [x] K-025 — SKILL.md:11 rule 4 "glossary 필드 필수". `update.ts:238` `if (fields.glossary !== undefined)` 만 검증 직접 확인 — 사용자가 omit 시 검증 skip. update-time 미강제. **CONFIRMED**
- [x] K-026 — SKILL.md grep ignorePatterns 발견되나 정확한 config 위치 (`.emberdeck.jsonc` 또는 CLI flag 인지) 미명시 직접 확인. **CONFIRMED**
- [x] K-027 — SKILL.md:394 rule 5 "서브에이전트 사용 시 카드 컨텍스트 손실" 직접 확인. 자동 검증 메커니즘 없음 — advisory. **ADVISORY 재확인**
- [x] K-028 — SKILL.md:46 "@spec card-key 주입" 와 spec-sync.ts:452 `@spec ${cardKey}` 일치 직접 확인. **REFUTED-AS-DEFECT 재확인**
- [x] K-029 — SKILL.md:98 `FTS_SYNTAX_ERROR (exit 2)`. `output.ts:145` `FTS_SYNTAX_ERROR: EXIT.VALIDATION_FAILURE` (=2) 직접 확인. SKILL 정확. **REFUTED-AS-DEFECT 재확인**
- [x] K-030 — SKILL.md:108 "regression ... fail 시 exit 2". `check.ts:143` `partialIsFailure: true,` 직접 확인. SKILL 정확. **REFUTED-AS-DEFECT 재확인**

## L. 테스트 품질
- [x] L-001 — `safe.spec.ts:7-8` 자체 코멘트 "synthetic actions — no real DB / fs needed since the contract is purely about call ordering" 직접 확인. **CONFIRMED**
- [x] L-002 — `crud-sync.test.ts:343-344` `expect(result.bodyReferencesFound).toEqual(['body-ref-src'])` 직접 확인 — bodyReferencesFound 만 검증, body 재읽기 / cascade rewrite 검증 0. rename.ts:144-185 도 body rewrite 부재 (G-012). **CONFIRMED**
- [x] L-003 — `crud-sync.test.ts:8` 코멘트 "rename: referencing file update (relations, parent), bodyReferencesFound" 직접 확인. relations + CDD + body 동시 시나리오 grep 결과 0. **CONFIRMED**
- [x] L-004 — `drift-analysis.test.ts:150,192,238,297,328,358` 각 drift type 테스트가 `createMockGildash({...})` 직접 확인. 6 type 중 symbol_changed/heritage_uncovered/pattern_violation/glossary_broken 가 mock-only. **CONFIRMED**
- [x] L-005 — `integrity.spec.ts:290,300,311,322,333,462,477` 7건 모두 `unmetConditions.join(' ').toMatch(/substring/)` 약한 assertion 직접 확인. **CONFIRMED**
- [x] L-006 — `json-envelope-schema.test.ts:29,86,91,96,101,107,112,137,142,147` 10건 모두 `expect([...statusList]).toContain(...)` 약한 assertion 직접 확인. 행동 검증 X. **CONFIRMED**
- [x] L-007 — `coverage-analysis.test.ts:95` `'/tmp/ed-coverage-boundary-' + Date.now()` hardcoded 직접 확인. Windows / non-/tmp 환경에서 깨짐. **CONFIRMED**
- [x] L-008 — `sync.test.ts:259-269` `expect(result.errors.length).toBeGreaterThanOrEqual(1); expect(result.synced).toBeGreaterThanOrEqual(1)` 직접 확인 — 정확값 미검증, "≥1" 약한 assertion. **CONFIRMED**
- [x] L-009 — `grep .toBeDefined()` 정확히 **87건** 직접 카운트 확인. 약한 assertion. **CONFIRMED**
- [x] L-010 — `repository.spec.ts:500-503` `expect((classificationRepo as unknown as Record<string, unknown>)['replaceKeywords']).toBeUndefined()` 직접 확인. type-existence 만 검증, 동작 검증 X. **CONFIRMED**
- [x] L-011 — `migration.test.ts` `toThrow('closed database')` 1건만 직접 확인. FK/column 타입 검증 grep 0. **CONFIRMED**
- [x] L-012 — `setup.spec.ts:60-69` 자체 코멘트 "leaked handle on Linux would not block, but on close failure the WAL would. Stronger check: ..." 직접 확인 — leak 검출이 indirect. **CONFIRMED**
- [x] L-013 — `property-fuzz.test.ts:46-53` 자체 코멘트 "values containing those round-trip-fail through parse. Real user input with these chars writes fine but fails on later read; a proper fix requires switching the YAML emitter" + filter regex 제외 직접 확인. **CONFIRMED**
- [x] L-014 — `drift-analysis.test.ts:63-89` autoTransition 테스트 직접 read. `expect(row!.status).toBe('drifted')` 만 검증. changelog 기록 / updatedAt 시간 검증 없음. **CONFIRMED**
- [x] L-015 — `phase2-polish.test.ts:411-413` `not.toContain('\\x1b[')`, `not.toContain('⠋')` 직접 확인. spinner 자체가 제거되어도 absence 가 통과. **CONFIRMED**
- [x] L-016 — `migration-upgrade.test.ts` `describe '0001 → 0002 upgrade path'` 단일 path test 만 직접 확인. clean install / idempotence path 0. **CONFIRMED**
- [x] L-017 — `phase2.test.ts:265-285` 자체 코멘트 "Either ok (gildash didn't pick up the annotation in this minimal fixture) or partial" 직접 확인. 두 outcome 모두 통과. **CONFIRMED**
- [x] L-018 — `phase2-polish.test.ts:127` `expect(afterStat.mtime.getTime()).toBe(beforeStat.mtime.getTime())` 직접 확인. 미세 시간 차로 flaky 가능. **CONFIRMED**
- [x] L-019 — `repository.spec.ts:448` `it('replaceForCard: silently skips when target card does not exist (FK violation)', ...)` 직접 확인 — silent FK skip 을 spec 으로 고정. **CONFIRMED**
- [x] L-020 — `safe.spec.ts` dbAction 시그니처 직접 확인 — 모두 sync `() => {...}`. async dbAction (Promise 반환) 시나리오 0. (safe.ts 의 dbAction 도 sync `() => T`). **CONFIRMED**
- [x] L-021 — `flows.test.ts:273-298` parent-delete cascade test 직접 read. parent null + orphan warnings 만 검증. relations 사후 검증 (relation rows 가 cascade 됐는지) 0. **CONFIRMED**
- [x] L-022 — `grep -rn "class:.*['\"]none['\"]" src/ test/` → **0건** 직접 grep. SKILL 컨벤션 테스트 부재. **CONFIRMED**
- [x] L-023 — `test/ops/rename.test.ts` 42 rename match 직접 확인. `src/ops/rename.spec.ts` 부재 (PROBLEM 의 cite 일부 stale — 그래도 test/ops 에 다른 ops 와 ops 내부 spec 의 분산 자체는 사실 — analyze.spec.ts, link-reindex.spec.ts, safe.spec.ts 가 src/ops 안에). **CONFIRMED (substance)**
- [x] L-024 — `git log 1624a5e` "remove: lock 인프라 + gildash dedicated 테스트 — 80s → 24s" 직접 확인. real-gildash dedicated 테스트 제거됨, drift 의 4 type 은 mock-only (L-004). **CONFIRMED**
- [x] L-025 — `package.json:27-32` scripts (build/typecheck/test/...) 직접 확인 — pretest/posttest hook 0. `.github`, `.husky`, `.lefthook.yaml`, `.pre-commit-config.yaml` 모두 부재 직접 확인. `bunfig.toml [test]` 블록에 typecheck 통합 0. **CONFIRMED**

## M. 잔재 / refactor
- [x] M-001 — alias of J-001. 위 검증 동일. **CONFIRMED**
- [x] M-002 — alias of J-003. 위 검증 동일. **CONFIRMED**
- [x] M-003 — `helpers.ts:14-16` 코멘트 "Cross-process system_lock (separate process IDs)" 직접 확인 — multiproc 테스트는 1624a5e 에서 삭제됨. 코멘트 stale. **CONFIRMED**
- [x] M-004 — `runner.spec.ts:21-23` `test('GILDASH_NOT_CONFIGURED → error ...')` 직접 확인. `setup.ts:17` `GildashInitError` (구 클래스명 변경됨). `errors.ts:35` `GILDASH_INIT_FAILED` 코드. 테스트가 dead code 참조. **CONFIRMED**
- [x] M-005 — `link.ts:273` 코멘트 "Returns the original list when gildash is not configured" 직접 확인. gildash 는 항상 configured (required). stale. **CONFIRMED**
- [x] M-006 — `cli/context.ts:17` `projectRoot?: string;` (CLI flag optional), `config-file.ts:267` `projectRoot?: string` (CLI args optional), `config.ts:14` `projectRoot: string` (required) 직접 확인. 비대칭. **CONFIRMED**
- [x] M-007 — `config-file.ts` 의 projectRoot default `resolvedDir` (config 파일 dir) 직접 확인. 과거 commit `a88c3a4 feat(cli): default output JSON; rename gildashIgnore → analysisIgnore` 등 refactor 다수. PROBLEM 의 "default 변경 silent breaking" substance 는 git log 추적 시점 의존. **CONFIRMED (substance)**
- [x] M-008 — alias of C4. 위 검증 동일. **CONFIRMED**
- [x] M-009 — `grep "throw new BoundaryValidationError" src/ test/` → src/ 에서 0건, errors.spec.ts:194 만 (테스트 자체) 직접 grep. production code 에서 throw 없음. **CONFIRMED**
- [x] M-010 — `setup.ts:82` `await ctx.gildash.close();` (non-optional chain) 직접 확인. mock 환경에서 close 메서드 부재 시 crash 가능. **CONFIRMED**
- [x] M-011 — `glossary.ts:326,330` raw `Promise.allSettled` 직접 grep. batchedAllSettled util 적용 누락 (a4bdc64 commit). **CONFIRMED**
- [x] M-012 — `runner.ts:30` 코멘트 "GILDASH_TRANSIENT: gildash search timeout (not yet emitted; reserved)". `runner.spec.ts:5-6` 테스트 존재. production emit 0. 테스트가 미배포 코드 검사. **CONFIRMED**
- [x] M-013 — `commands.test.ts:12` 코멘트 "Some tests still need real subprocess: STDIN piping, ANSI/env var verification" 직접 확인. NO_COLOR usage 가 `:299,321` 에 still present. PROBLEM 의 "ANSI 블록 삭제" 가 일부만 정확. **PARTIAL**
- [x] M-014 — `git status` `setup-config-root.card.md` untracked 직접 확인. spec card 가 src 의 `GildashInitError` 등 binding. 커밋 전이라 broken_link 가능. **CONFIRMED**
- [x] M-015 — meta. PROBLEM.md 자체 stale 클레임 — 본 5차 검증으로 갱신되어 더이상 stale 아님. **REFUTED 재확인**
- [x] M-016 — `setup.ts:34` `const db = createEmberdeckDb(options.dbPath)` 가 `:42` `Gildash.open` 보다 먼저 직접 확인. gildash 검증 실패 시 db 파일 (artifacts) 이미 disk 에 남음. **CONFIRMED**
- [x] M-017 — `git status --short`: 모드 엔트리 66, modified `^ M` = 59, untracked `^??` = 8 직접 카운트. PROBLEM 시점 59M+6 → 현 59M+8 (CHECKLIST.md, PROBLEM.md 추가). substance 정확. **CONFIRMED**
- [x] M-018 — `json-envelope-schema.test.ts:158-167` `setupTmpProject({projectRoot:'/nonexistent/...'})` 로 end-to-end fail path 실행 직접 확인. legitimate test. **REFUTED 재확인**
- [x] M-019 — `repository.spec.ts:7` `import { makeCardRow as makeCard } from '../../test/fixtures/card-row';` 직접 확인. test/fixtures/ 가 untracked (N-011) → 다른 사람 clone 시 import 깨짐. **CONFIRMED**
- [x] M-020 — alias of D1. 위 검증 동일. **CONFIRMED**

## N. 추가 발견
- [x] N-001 — `package.json:1-9` description/license/repository/author/keywords 부재 직접 확인. private:false. **CONFIRMED**
- [x] N-002 — `package.json:7-9` `bin: { ed: ./cli.ts }`, `cli.ts:1` `#!/usr/bin/env bun` 직접 확인. TypeScript source — Node 환경에서 exec failure. **CONFIRMED**
- [x] N-003 — `validate.ts:24` validateCards (1 query suite) + `:44` `for (const c of allCards) { await validateCodeLinks(rt.ctx, c.key) }` 직접 확인. N+1 (per-card sequential). **CONFIRMED**
- [x] N-004 — `schema.ts:31-33` `foreignKey({...}).onUpdate('cascade').onDelete('set null')` 직접 확인. `validation.ts:244` validateParentType 가 brief.parent=domain 강제 — onDelete set null 시 brief.parent=NULL 가 4-tier 위반. 4차에서 직접 재현됨. **CONFIRMED critical**
- [x] N-005 — alias of J-007 + J-026. mid-loop 비대칭 row 가능. 위 검증 동일. **CONFIRMED**
- [x] N-006 — `drizzle.config.ts:7` `url: 'file:./.zipbul/cache/emberdeck.sqlite'` 직접 확인. `grep .zipbul/cache src/` → 0건. dead path. **CONFIRMED**
- [x] N-007 — `grep "include\|exclude" tsconfig.json` → 0건 직접 확인. tsc 가 default 로 모든 .ts 스캔. **CONFIRMED**
- [x] N-008 — `find . -maxdepth 2 -iname "README*"` → 0건 직접 확인. **CONFIRMED**
- [x] N-009 — `grep -l "ctx\.gildash\." src/` → 6 prod 파일 + setup. `grep -ohE "gildash\.[a-zA-Z]+" src/ | sort -u` → 18 unique API 직접 확인. boundary 단일 파일 부재. **CONFIRMED**
- [x] N-010 — `package.json:35` `"@zipbul/gildash": "0.26.1"`, `setup.ts:45` `watchMode: false` 직접 확인. informational. **CONFIRMED**
- [x] N-011 — `git status --short` `?? test/fixtures/` (디렉토리 자체 untracked) 직접 확인. `git ls-files test/fixtures/` → 0건. card-row.ts + gildash.ts 둘 다 untracked. **CONFIRMED**
- [x] N-012 — `bench/large-scale.bench.ts:65` 코멘트 "Bypassing validation via direct upsert is fine for a synthetic perf benchmark" 직접 확인. boundary/codeLinks 미설정 → drift/coverage 핫패스 미측정. **CONFIRMED**
- [x] N-013 — alias of J-005. 위 검증 동일. **CONFIRMED**
- [x] N-014 — `.gitignore` 6 lines (node_modules, .emberdeck/*, !.emberdeck/cards/, dist, .gildash, coverage/) 직접 확인. `*.tmp.*` 미포함 (atomicWrite tmp artifact). **CONFIRMED**
- [x] N-015 — `validate.ts:52-56` data shape `{cards, links, total_issues}` 직접 확인 — glossary 블록 0. **CONFIRMED**
- [x] N-016 — alias of H-005/H-006. 위 검증 동일. **CONFIRMED**
- [x] N-017 — `index.ts:36` global `--project-root`, `single.ts:26` init's own `--project-root` 직접 확인. shadow. global `--dir` vs init's `--cards-dir` 이름 불일치. **CONFIRMED**
- [x] N-018 — alias of H-004. 위 검증 동일. **CONFIRMED**
- [x] N-019 — `spec.ts:108-112` `INSERT ... VALUES (?, ?, ?) ... .run(META_KEY, now, now)` 직접 확인. value=now (timestamp), updated_at=now (동일). 두 컬럼이 같은 값. value 와 updated_at 분리 의도 모호. **CONFIRMED**
- [x] N-020 — `output.ts:46-54` `ok()` 가 `errors: []` 강제, 호출자가 errors 전달 못 함 직접 확인. **CONFIRMED**
- [x] N-021 — `output.ts:46-102` `ok` errors:[], `err` errors:[] + error 단일, `unknown` errors:[] + error 단일, `partial` 만 errors:CliMessage[] 직접 확인. ok/error/unknown 항상 빈 배열 — 비대칭. **CONFIRMED**
- [x] N-022 — alias of J-014. 위 검증 동일. **CONFIRMED**
- [x] N-023 — `setup.ts:36-39` mergedIgnore = analysisIgnore + ignorePatterns (gildash open 에 전달), `:67` `ctx.ignorePatterns = options.ignorePatterns` (analysisIgnore 누락) 직접 확인. ctx 가 emberdeck filter 에서 못 봄. **CONFIRMED**
- [x] N-024 — alias of N-023. **CONFIRMED**
- [x] N-025 — alias of J-001. **CONFIRMED**
- [x] N-026 — alias of J-004. **CONFIRMED**
- [x] N-027 — alias of N-004. **CONFIRMED**
- [x] N-028 — `grep confirmDestructive src/cli/commands/` → card.ts:325 (delete), single.ts:163 (reset), glossary.ts:103 (remove only) 직접 확인. spec annotate --prune (H-019), glossary rename (K-008), card rename 등 destructive ops 에 confirm 부재 → 비대칭. **CONFIRMED**
- [x] N-029 — alias of H-013. **CONFIRMED**
- [x] N-030 — `schema.ts:134` `kind: text('kind').notNull()` 직접 확인. CHECK constraint 없음. **CONFIRMED**
- [x] N-031 — `wc -l CLAUDE.md` → 5 줄 직접 확인. 본문 4 줄 (제목+설명). 인간 대상 architecture doc 부재. **CONFIRMED**
- [x] N-032 — `bunfig.toml` `coverageThreshold = 0.95` 직접 확인. `.github` 부재 (CI hook 0). bun test 가 threshold 체크하더라도 pre-commit / CI gate 없음. **CONFIRMED**
- [x] N-033 — G-005 substance 와 동일. syncCardFromFile (sync.ts:113-153) 가 validation 0 → status: active 카드 검증 없이 upsert. 4차에서 직접 재현됨. **CONFIRMED**
- [x] N-034 — `output.ts:177` `JSON.stringify(result, null, 2)` 직접 확인. 항상 pretty-print, compact 옵션 없음. **CONFIRMED**
- [x] N-035 — `analyze.ts:94,205,296` unlinkedSymbols field 정의/생성 직접 확인. `validate.ts` 에 grep 결과 0 — validate aggregate 가 surface 안 함. **CONFIRMED**
- [x] N-036 — `bench:51-55` `writeFileSync(... 'src.ts', '', 'utf8')` 빈 src.ts, `projectRoot: tmpRoot` 직접 확인. gildash 가 인덱싱할 코드 0 → drift/coverage path short-circuit. **CONFIRMED**
- [x] N-037 — alias of J-022. **CONFIRMED**
- [x] N-038 — `ls drizzle/ | grep -i down` → 0건 직접 확인. up migration 5개만 (0000-0004), down 0. **CONFIRMED**
- [x] N-039 — alias of A3. **CONFIRMED**
- [x] N-040 — `test/fixtures/gildash.ts` head 코멘트 + grep unique mock methods → **10개** 직접 카운트 (close, getDependencies, getFileInfo, getModuleInterface, getSymbolChanges, getSymbolsByFile, listIndexedFiles, reindex, searchAnnotations, searchSymbols). production 18 사용 (N-009) 중 8 누락 (getDependents, getFanMetrics, findPattern, searchRelations, hasCycle, getCyclePaths, getAffected, getStats, pruneChangelog 등). PROBLEM "9" minor off. **CONFIRMED**

총: 267 entries (alias 포함). 247 unique items.
