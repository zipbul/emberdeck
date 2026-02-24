---
{key: init-prompt,summary: setup 프롬프트 파일 생성 규칙,status: draft,keywords: [prompt,setup,onboarding],tags: [cli,prompt],relations: [{type: related,target: cli-install},{type: depends-on,target: prompt-content}]}
---
## 목적

emberdeck install 시 프로젝트 루트에 setup 프롬프트 파일을 생성한다.
사용자가 이 파일 내용을 자기 에이전트에 복붙하면, 에이전트가 프로젝트 환경에 맞게 emberdeck 사용 룰을 자동 작성한다.

## 생성 위치

프로젝트 루트 (package.json 옆).

## 파일명

`EMBERDECK_SETUP.md`

## 생성 조건

- 이미 존재하면 생성하지 않음 (cli-install의 --force로 제어)
- .gitignore 대상 아님 — 팀원 공유 가능

## 파일 성격

- 일회성 setup 프롬프트
- 사용 후 삭제해도 무방
- 내용은 prompt-content 카드에서 정의