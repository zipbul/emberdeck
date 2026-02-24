---
{key: prompt-content,summary: setup 프롬프트 파일에 포함할 내용 정의,status: draft,tags: [prompt,spec],keywords: [prompt,content,onboarding,agent-rules],relations: [{type: related,target: init-prompt}]}
---
## 목적

EMBERDECK_SETUP.md에 포함될 프롬프트 내용 정의.
에이전트가 이 프롬프트를 받으면 프로젝트 환경에 맞게 emberdeck 사용 룰을 자동 작성한다.

## 프롬프트 구조 — 3축

### 축 1: 금지 규칙

- `.emberdeck/cards/*.card.md` 파일을 직접 read/write/delete 하지 않는다
- 반드시 emberdeck MCP 도구를 통해 카드를 조작한다
- 이유: DB와 카드 파일의 정합성을 MCP가 보장하며, 직접 편집 시 정합성이 깨진다

### 축 2: 하드 게이트

에이전트가 건너뛸 수 없는 필수 체크포인트.

| 게이트 | 시점 | 도구 | 조건 |
|--------|------|------|------|
| 스펙 확인 | 코드 변경 전 | find_affected_cards | 관련 스펙 있으면 get_card로 읽고 이해 후 진행 |
| 스펙 퍼스트 | 새 모듈 생성 전 | create_card | 설계 카드가 먼저 존재해야 코드 작성 가능 |
| 정합성 검증 | 작업 완료 후 | validate_code_links | 통과해야 commit 제안 가능 |

### 축 3: 트리거→액션 테이블

에이전트가 즉시 참조할 수 있는 상황별 도구 매핑.

| 상황 | 도구 |
|------|------|
| 기능 계획/시작 | search_cards, list_cards |
| 관련 스펙 존재 확인 | find_affected_cards |
| 스펙 내용 확인 | get_card |
| 스펙 주변 맥락 파악 | get_card_context |
| 관계 그래프 탐색 | get_relation_graph, list_card_relations |
| 새 설계 작성 | create_card |
| 스펙 수정 | update_card |
| 스펙 상태 변경 | update_card_status |
| 스펙 삭제 | delete_card |
| 스펙 이름 변경 | rename_card |
| 코드↔스펙 정합성 확인 | validate_code_links |
| 전체 카드 상태 점검 | validate_cards |
| 심볼로 카드 검색 | find_cards_by_symbol |
| 코드 링크 해석 | resolve_code_links |
| 파일에서 카드 동기화 | sync_card_from_file |
| 전체 카드 동기화 | bulk_sync_cards |
| 카드를 파일로 내보내기 | export_card_to_file |

## 프롬프트 말미 지시

에이전트에게 마지막으로 요청:

1. 이 프로젝트의 에이전트 룰 체계를 파악하라 (AGENTS.md, .cursorrules, .github/copilot 등)
2. 위 3축 내용을 해당 체계 형식에 맞게 통합하라
3. MCP 서버 설정이 없으면 추가하라 (.vscode/mcp.json 등)
4. 통합 결과를 사용자에게 보고하라

## 톤

- 간결하고 명령적
- 에이전트가 즉시 실행할 수 있는 지시문 형태
- 불필요한 설명 최소화