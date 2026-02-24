import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { createEmberdeckDb, closeDb } from './db/connection';
import { DrizzleCardRepository } from './db/card-repo';
import { DrizzleRelationRepository } from './db/relation-repo';
import { DrizzleClassificationRepository } from './db/classification-repo';
import { DrizzleCodeLinkRepository } from './db/code-link-repo';
import { DEFAULT_RELATION_TYPES, type EmberdeckContext, type EmberdeckOptions } from './config';

/**
 * emberdeck 컨텍스트를 초기화한다.
 *
 * 1. SQLite DB를 열고 마이그레이션을 실행한다.
 * 2. Repository 인스턴스를 생성한다.
 * 3. `projectRoot`가 지정된 경우 gildash를 초기화한다.
 *    초기화 실패 시 gildash는 `undefined`로 설정되고 코드 링크 기능이 비활성화된다.
 *
 * @param options - 초기화 옵션.
 * @returns 초기화된 `EmberdeckContext`.
 */
export async function setupEmberdeck(options: EmberdeckOptions): Promise<EmberdeckContext> {
  const db = createEmberdeckDb(options.dbPath);

  let gildash: Gildash | undefined;
  if (options.projectRoot) {
    try {
      const result = await Gildash.open({
        projectRoot: options.projectRoot,
        ignorePatterns: options.gildashIgnore,
      });
      if (isErr(result)) {
        gildash = undefined;
      } else {
        gildash = result;
      }
    } catch {
      gildash = undefined;
    }
  }

  return {
    cardsDir: options.cardsDir,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    codeLinkRepo: new DrizzleCodeLinkRepository(db),
    allowedRelationTypes: options.allowedRelationTypes ?? [...DEFAULT_RELATION_TYPES],
    gildash,
  };
}

/**
 * emberdeck 컨텍스트를 정리한다.
 *
 * gildash 인덱스를 닫고 SQLite DB 연결을 닫는다.
 * 프로세스 종료 전 또는 컨텍스트를 재생성할 때 호출해야 한다.
 *
 * @param ctx - 정리할 컨텍스트.
 */
export async function teardownEmberdeck(ctx: EmberdeckContext): Promise<void> {
  await ctx.gildash?.close();
  closeDb(ctx.db);
}
