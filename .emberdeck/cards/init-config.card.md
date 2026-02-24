---
{key: init-config,summary: .emberdeck.jsonc 초기 파일 생성 규칙,status: draft,keywords: [config,jsonc,init],tags: [cli,config],relations: [{type: related,target: cli-install}]}
---
## 목적

emberdeck install 시 프로젝트 루트에 `.emberdeck.jsonc` 초기 파일을 생성한다.

## 생성 위치

가장 가까운 package.json이 있는 디렉토리.

## 생성 내용

JSONC 형식. 모든 필드에 주석으로 설명 포함. 기본값만 채워서 즉시 동작 가능해야 함.

## 필드

- `cardsDir` — 카드 디렉토리 (기본: `.emberdeck/cards`)
- `dbPath` — SQLite DB 경로 (기본: `.emberdeck/data.db`)
- `projectRoot` — gildash용 프로젝트 루트 (기본: `.`)
- `allowedRelationTypes` — 허용 관계 타입 목록
- `cardExtension` — 카드 파일 확장자 (기본: `.card.md`)

## 조건

- 이미 존재하면 생성하지 않음 (cli-install의 --force로 제어)
- 디렉토리가 없으면 재귀 생성