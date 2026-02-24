---
{key: cli-install,summary: emberdeck install 서브커맨드 진입점과 실행 흐름 정의,status: draft,keywords: [cli,install,init,setup],tags: [cli],relations: [{type: depends-on,target: init-config},{type: depends-on,target: init-prompt}]}
---
## 목적

사용자 프로젝트에 emberdeck을 초기 세팅하는 CLI 커맨드.

## 실행

```
emberdeck install
```

## 흐름

1. 프로젝트 루트 탐색 (가장 가까운 package.json 위치)
2. `.emberdeck.jsonc` 존재 여부 확인
   - 이미 존재 → 에러 또는 `--force` 옵션으로 덮어쓰기
   - 없음 → 생성
3. setup 프롬프트 파일 생성
4. stderr로 안내 메시지 출력:
   - 생성된 파일 목록
   - 프롬프트 파일 사용법 안내

## 옵션

- `--force` — 기존 파일이 있어도 덮어쓰기
- `--no-prompt` — 프롬프트 파일 생성 생략

## 종료 코드

- 0: 성공
- 1: 이미 존재 (--force 없이)