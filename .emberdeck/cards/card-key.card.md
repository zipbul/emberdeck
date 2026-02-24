---
{key: card-key,summary: slug를 카드 key로 변환하는 순수 함수 설계,status: draft,keywords: [slug,key,pure-function,validation],tags: [core,card],codeLinks: [{kind: function,file: src/card/card-key.ts,symbol: parseCardKey},{kind: function,file: src/card/card-key.ts,symbol: cardKeyToSlug}]}
---
## 개요

카드 파일명(slug)을 내부 식별자(key)로 변환하는 순수 함수.

## 규칙

- slug = `.card.md` 확장자를 제거한 파일명 (예: `auth-token`)
- key = slug와 동일 (현재 1:1 매핑)
- 유효 문자: 소문자 알파벳, 숫자, 하이픈(`-`)
- 시작/끝은 알파벳 또는 숫자

## 인터페이스

```ts
function parseCardKey(slug: string): Result<CardKey, CardKeyError>
function cardKeyToSlug(key: CardKey): string
```

## 제약

- 빈 문자열 불가
- 연속 하이픈 불가 (`--`)
- 대문자 불가