> ⚠️ **Historical document.** Written when emberdeck shipped as an MCP server. emberdeck is now CLI-only (commit `c23851b`); MCP-specific paths and tool registrations in this file no longer apply. Design intent and analysis content remain valid.

# AI 에이전트 프레임워크 & 오케스트레이션 도구 심층 분석

> 2026-03-19 기준 | Zipbul 생태계 설계 참고용

---

## 목차

1. [개요 및 분류 체계](#1-개요-및-분류-체계)
2. [에이전트 프레임워크 심층 분석](#2-에이전트-프레임워크-심층-분석)
   - 2.1 LangGraph
   - 2.2 CrewAI
   - 2.3 AutoGen
   - 2.4 OpenAI Agents SDK
   - 2.5 Claude Agent SDK
   - 2.6 Google ADK
   - 2.7 Mastra AI
   - 2.8 Pydantic AI
   - 2.9 Vercel AI SDK
   - 2.10 AWS Strands Agents
   - 2.11 Semantic Kernel
   - 2.12 Dify
3. [AI 주도 개발 오케스트레이션 도구](#3-ai-주도-개발-오케스트레이션-도구)
4. [프로토콜 생태계](#4-프로토콜-생태계)
5. [비교 매트릭스](#5-비교-매트릭스)
6. [아키텍처 패턴 분류](#6-아키텍처-패턴-분류)
7. [Zipbul 관점의 시사점](#7-zipbul-관점의-시사점)

---

## 1. 개요 및 분류 체계

### 시장 규모

AI 오케스트레이션 시장: $11.47B (2025), CAGR 23%

### 분류 체계

에이전트 생태계는 5개 레이어로 분류된다:

```
Layer 5: AI 주도 SDLC 오케스트레이터  (GSD, BMAD, Claude Task Master)
Layer 4: 자율 코딩 에이전트           (Devin, OpenHands, Codex CLI)
Layer 3: AI 네이티브 IDE              (Cursor, Windsurf, Antigravity, Roo Code)
Layer 2: 에이전트 프레임워크           (LangGraph, CrewAI, Google ADK, ...)
Layer 1: 프로토콜/인프라              (MCP, A2A, ACP)
```

이 문서는 **Layer 2 (에이전트 프레임워크)**와 **Layer 5 (AI 주도 오케스트레이터)**를 심층 분석한다.

### GitHub Stars 순위 (2026.03 기준)

| 순위 | 프레임워크 | Stars | 언어 |
|------|-----------|-------|------|
| 1 | Dify | ~131k | Python |
| 2 | AutoGen | ~56k | Python |
| 3 | MetaGPT | ~48k | Python |
| 4 | CrewAI | ~46k | Python |
| 5 | LlamaIndex | ~40k | Python |
| 6 | Agno (구 Phidata) | ~39k | Python |
| 7 | Semantic Kernel | ~27.5k | C#, Python, Java |
| 8 | LangGraph | ~27k | Python, JS |
| 9 | DSPy | ~25k | Python |
| 10 | Vercel AI SDK | ~22.8k | TypeScript |
| 11 | Mastra | ~22k | TypeScript |
| 12 | OpenAI Agents SDK | ~20k | Python, TS |
| 13 | Google ADK | ~18.4k | Python, TS, Go, Java |
| 14 | Pydantic AI | ~15.6k | Python |
| 15 | Claude Agent SDK | ~5.6k | Python, TS |
| 16 | Strands Agents | ~5.3k | Python, TS |

---

## 2. 에이전트 프레임워크 심층 분석

---

### 2.1 LangGraph (LangChain)

**한줄 요약**: 그래프 기반 상태머신으로 에이전트 워크플로우를 모델링하는 프레임워크

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~27k (Python), ~2.7k (JS) |
| 언어 | Python (주력), TypeScript |
| 라이선스 | MIT |
| 가격 | 프레임워크 무료 / LangSmith $39/seat/mo |

#### 핵심 아키텍처

Google Pregel 기반 실행 엔진. 3가지 기본 요소:
- **State**: `TypedDict`/Pydantic `BaseModel`로 정의된 공유 상태. 각 키에 독립 reducer 함수 (기본: 덮어쓰기, 커스텀: append/merge)
- **Nodes**: 상태를 받아 부분 업데이트를 반환하는 함수. `START`, `END` 특수 노드
- **Edges**: 노드 간 전환 규칙. Normal (고정 A→B), Conditional (라우팅 함수가 다음 노드 결정), Conditional Entry Point

고급 라우팅:
- `Send`: 조건부 엣지에서 동적 팬아웃 (map-reduce 패턴)
- `Command`: 상태 업데이트 + 라우팅을 원자적 연산으로 결합, `Command.PARENT`로 서브그래프→부모 탐색

#### 주요 기능

**Persistence/Checkpointing**: 모든 상태 전환이 자동 체크포인트. 스레드(=대화 세션) 단위 관리. 장애 복구, 타임트래블 디버깅, Human-in-the-loop 지원. 백엔드: PostgreSQL, SQLite, DynamoDB, in-memory.

**Human-in-the-Loop**: 임의 노드에서 실행 일시정지 → 상태 직렬화 → 인간 검토/수정 → 재개. 초~시간 단위 대기 가능, 스레드 블로킹 없음.

**Streaming**: 7가지 모드 — values (전체 상태), updates (델타), messages (토큰 단위 LLM 출력), custom (커스텀 페이로드), checkpoints, tasks, debug. 복수 모드 조합 가능.

**Subgraphs**: 부모 그래프의 노드가 컴파일된 서브그래프가 될 수 있음. 서브그래프는 자체 상태 유지, `Command.PARENT`로 부모와 통신.

#### 에이전트 패턴

| 패턴 | 설명 |
|------|------|
| ReAct | LLM → 도구 호출 → 결과 → LLM 반복 (핵심 패턴) |
| Supervisor | 중앙 에이전트가 전문 서브에이전트 조율 |
| Hierarchical | 다층 supervisor (supervisor of supervisors) |
| Swarm | 탈중앙화, 에이전트가 자체 판단으로 참여 |
| Plan-and-Execute | 태스크 분해 → 단계별 실행 → 결과 통합 |
| Reflection | 순환 워크플로우에서 자기 비평 + 개선 |
| Map-Reduce | `Send`로 동적 팬아웃 → 병렬 처리 → 통합 |

#### 메모리 시스템

**단기 메모리 (스레드 내)**: 그래프 상태의 일부로 관리, 체크포인터로 영속화. 단일 대화 세션 범위.

**장기 메모리 (스레드 간)**: `BaseStore`에 JSON 문서 저장. 네임스페이스(폴더)/키(파일명)로 구조화. 3가지 개념적 메모리 타입:
- Semantic: 사실, 선호도, 지식 (프로필 또는 컬렉션)
- Episodic: 과거 이벤트, few-shot 예시
- Procedural: 시스템 지시사항, 규칙

메모리 쓰기 전략: Hot path (실시간, 레이턴시 추가) vs Background (비동기, 레이턴시 영향 없음)

#### 강점과 약점

**강점**: 명시적 제어 흐름, 프로덕션급 내구성, 최고 수준의 human-in-the-loop, 7가지 스트리밍 모드, 유연한 멀티에이전트 패턴, 타임트래블 디버깅, 모델 무관, MIT 라이선스

**약점**: 가파른 학습 곡선, 단순한 유스케이스에 과한 복잡성, 자율성보다 예측 가능성 우선, LangSmith 종속성, JS/TS가 Python 대비 뒤처짐, Enterprise 연 $100K+

---

### 2.2 CrewAI

**한줄 요약**: 역할 기반 멀티에이전트 팀 오케스트레이션 — 가장 빠른 프로토타이핑

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~46.5k |
| 언어 | Python only |
| 라이선스 | MIT |
| 가격 | 오픈소스 무료 / Enterprise 커스텀 |
| 펀딩 | $18M Series A (Insight Partners, Andrew Ng, Dharmesh Shah) |

#### 핵심 아키텍처

LangChain과 **완전히 독립**된 자체 구축 프레임워크. 두 가지 모드:

**Crews (자율 에이전트 팀)**: 역할/목표를 가진 에이전트들을 Crew로 묶고, 태스크를 할당하고, 프로세스 타입을 선택. 프레임워크가 위임, 컨텍스트 전달, 태스크 라우팅을 자동 처리.

**Flows (이벤트 기반 파이프라인)**: `@listen()` 데코레이터로 스텝 간 이벤트 관계 설정. 조건부 로직, 루프, 분기, 상태 관리 지원. 일 1,200만+ 실행.

프로세스 타입: Sequential (순차), Hierarchical (매니저 에이전트 자동 생성), Consensual (합의 기반, 실험적)

#### 에이전트 구성

3가지 필수 속성: Role (역할), Goal (개별 목표), Backstory (맥락/성격)

핵심 파라미터: `llm` (기본 gpt-4), `function_calling_llm` (도구 호출용 별도 모델), `max_iter` (최대 20 반복), `allow_delegation` (위임 허용), `reasoning` (반성/계획 활성화), `respect_context_window` (자동 요약), `code_execution_mode` ("safe" = Docker 샌드박스)

#### 메모리 시스템

통합 Memory 클래스 + 복합 스코어링:
- **Short-term**: ChromaDB + RAG, 현재 세션 컨텍스트
- **Long-term**: SQLite3, 세션 간 영속화
- **Entity**: RAG 기반 엔티티(사람, 장소, 개념) 정리
- **Contextual**: 위 세 가지를 결합한 상황 인식

계층적 스코프: 파일시스템 유사 트리 구조. 자동 추론 또는 수동 할당.

복합 스코어링: `semantic_weight(0.5) × similarity + recency_weight(0.3) × decay + importance_weight(0.2) × importance`

고급 기능: 중복 통합 (0.85 유사도 이상 자동 감지), 비차단 저장 (백그라운드 스레딩), 얕은/깊은 리콜

#### 도구 통합

100+ 빌트인 도구 (파일, 웹, 검색, 문서, 데이터, DB, RAG, 특수). LangChain/LlamaIndex 도구 호환.

#### 강점과 약점

**강점**: 가장 빠른 프로토타이핑, 직관적 역할 기반 멘탈 모델, 자동 매니저 모드, 독립 아키텍처 (프레임워크 bloat 없음), 100+ 빌트인 도구, Flows로 프로덕션 대응

**약점**: Python only, 단순 단일 에이전트에는 과다, 더 많은 에이전트 = 더 많은 프롬프트 튜닝, 경직된 역할 계층, 규제 환경 미흡, Enterprise 연 $120k

---

### 2.3 Microsoft AutoGen

**한줄 요약**: 대화 기반 멀티에이전트 프레임워크 — 유지보수 모드, Semantic Kernel과 통합 중

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~55.8k |
| 언어 | Python, .NET |
| 라이선스 | MIT |
| 가격 | 완전 무료 오픈소스 |

#### 핵심 아키텍처

**v0.2 (레거시)**: `ConversableAgent` 기반. `AssistantAgent` (LLM), `UserProxyAgent` (인간 프록시). `initiate_chat()`으로 동기 통신. `GroupChatManager`로 멀티에이전트 조율.

**v0.4 (2025.01 완전 재작성)**: 비동기, 이벤트 기반 아키텍처. 3개 레이어:
1. **Core**: 이벤트 기반 에이전트 시스템 기초. 액터 모델, 비동기 런타임. 크로스 언어 상호운용 (Python ↔ .NET)
2. **AgentChat**: 태스크 기반 고수준 API. `AssistantAgent`, `RoundRobinGroupChat`, `SelectorGroupChat`
3. **Extensions**: 모델 클라이언트, 도구, 메모리 제공자, 코드 실행기, MCP 서버

v0.2→v0.4 주요 변경: 동기→비동기, dict→타입 안전 메시지 클래스, 도구 사용이 단일 에이전트에 통합, `save_state()`/`load_state()` 상태 영속화

#### 에이전트 패턴

| 패턴 | 설명 |
|------|------|
| Two-Agent Chat | 가장 단순, 종료 조건까지 메시지 교환 |
| Sequential Chat | 체인 연결, carryover로 요약 전달 |
| Group Chat | 다수 에이전트 단일 스레드 공유, 발화자 선택 전략 (round_robin/random/manual/auto) |
| Nested Chat | 멀티에이전트 워크플로우를 단일 에이전트 인터페이스로 패키징 |
| Society of Mind | `SocietyOfMindAgent` — 내부 GroupChat을 "내적 독백"으로 실행 |

#### 현황: Microsoft Agent Framework 통합

2025.10, Microsoft가 AutoGen + Semantic Kernel을 **Microsoft Agent Framework**로 통합 발표. 2026 Q1 GA 목표. AutoGen 원본 리포는 유지보수 모드 (버그 수정/보안 패치만).

**AG2 포크**: 원 저자 Chi Wang, Qingyun Wu가 Microsoft를 떠나 [AG2](https://github.com/ag2ai/ag2)로 포크. PyPI 패키지(`autogen`, `pyautogen`)와 Discord 채널 상속. Apache 2.0. 커뮤니티 분열 원인.

#### 강점과 약점

**강점**: 가장 다양한 대화 패턴, 유연하고 확장 가능, Docker 코드 실행 성숙, AutoGen Studio 로우코드 UI, 크로스 언어 (Python + .NET), OpenTelemetry 관측성

**약점**: 예측 불가능한 자유 대화 (루프, 탈선), 중앙화된 GroupChatManager 병목, AG2 포크로 커뮤니티 분열, v0.4 마이그레이션 부담, 유지보수 모드 진입

---

### 2.4 OpenAI Agents SDK (구 Swarm)

**한줄 요약**: 최소 추상화, 핸드오프 + 가드레일 + 트레이싱 기반 경량 프로덕션 에이전트

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~20.1k (Python), ~2.5k (TS) |
| 언어 | Python, TypeScript |
| 라이선스 | MIT |
| 가격 | SDK 무료 / API 토큰 비용 |

#### 핵심 아키텍처

3가지 기본 요소:
- **Agent**: LLM + instructions + tools + handoffs. instructions는 동적 함수 가능 (런타임 컨텍스트 반영)
- **Runner**: 에이전트 루프 실행 — `run()` (비동기), `run_sync()` (동기), `run_streamed()` (스트리밍)
- **Handoff**: 에이전트 간 제어 위임. LLM에게는 도구로 표현됨 (`transfer_to_refund_agent`)

Runner 에이전트 루프: LLM 호출 → 최종 출력이면 종료 / 핸드오프면 에이전트 전환 / 도구 호출이면 실행 후 반복

#### 가드레일 시스템

3가지 타입:
- **Input Guardrails**: 첫 에이전트에서만 실행. 병렬(기본, 에이전트와 동시) 또는 차단 모드
- **Output Guardrails**: 최종 출력 생성 에이전트에서만 실행
- **Tool Guardrails**: 개별 도구 호출을 래핑. 호출 전/후 검증, 스킵/대체/tripwire 가능

검증 실패 시 **tripwire** 발동 → 예외 발생, 즉시 중단.

#### 세션 시스템

9가지 빌트인 구현: SQLiteSession, AsyncSQLiteSession, RedisSession, SQLAlchemySession, DaprSession, OpenAIConversationsSession, OpenAIResponsesCompactionSession, AdvancedSQLiteSession, EncryptedSession

#### 도구 통합

5가지 타입:
1. **Hosted OpenAI Tools**: WebSearchTool, FileSearchTool, CodeInterpreterTool, HostedMCPTool, ImageGenerationTool, ToolSearchTool
2. **Local/Runtime Tools**: ComputerTool, ShellTool, ApplyPatchTool
3. **Function Calling**: `@function_tool` 데코레이터
4. **Agents as Tools**: `agent.as_tool()` — 핸드오프 없이 다른 에이전트 호출, 매니저가 제어 유지
5. **Codex Tool** (실험적)

#### Swarm에서의 진화

Swarm (2024.10): 교육용, 프로덕션 아님, 21.2k stars
→ Agents SDK: 프로덕션 대응 + 가드레일 + 트레이싱(23개 외부 연동) + 세션(9가지) + 음성 에이전트 + MCP + 구조화된 출력 + Python + TS

#### 강점과 약점

**강점**: 미니멀 설계 (80% 유스케이스 커버), 프로덕션 대응 (트레이싱, 가드레일, 세션, HITL), 긴밀한 OpenAI 통합, 포괄적 세션 시스템, 23개 외부 트레이스 프로세서, 음성 에이전트

**약점**: OpenAI 종속 (hosted tools는 OpenAI만), LiteLLM 지원은 베타, RAG 파이프라인/복잡 워크플로우 DAG 없음, 빌트인 장기 메모리 없음, v0.x (pre-1.0)

---

### 2.5 Claude Agent SDK (Anthropic)

**한줄 요약**: Claude Code의 에이전트 루프를 라이브러리화 — 단일 스레드 마스터 루프 + MCP 생태계

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~5.6k (Python), ~979 (TS) |
| 언어 | Python, TypeScript |
| 라이선스 | MIT |
| 가격 | API 토큰 비용 (Opus 4.6: $5/$25 per 1M) |

#### 핵심 아키텍처

Claude Code와 동일한 실행 루프. 의도적으로 최소화된 단일 스레드 마스터 루프:

```
while(tool_call) -> execute tool -> feed results -> repeat
```

5단계: 프롬프트 수신 → 평가/응답 → 도구 실행 → 반복 → 결과 반환

**Model-in-the-Loop**: Claude가 매 턴마다 의사결정. SDK가 외부 계획 로직을 부과하지 않음 — 모델 자체가 컨트롤러.

**실시간 조향**: 비동기 이중 버퍼 큐로 태스크 중간 방향 수정 가능. 재시작 없이 새 지시 주입.

#### 빌트인 도구

14개 코어 도구: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, ToolSearch, Agent (서브에이전트), Skill, AskUserQuestion, TodoWrite

#### Hooks 시스템

실행 루프의 특정 시점에서 발화하는 콜백. 에이전트 컨텍스트 윈도우 밖에서 실행 (컨텍스트 소비 0):
- PreToolUse / PostToolUse: 도구 호출 전/후
- UserPromptSubmit: 프롬프트에 컨텍스트 주입
- Stop: 결과 검증, 상태 저장
- SubagentStart / SubagentStop: 병렬 태스크 추적
- PreCompact: 압축 전 아카이브

#### 컨텍스트 관리

컨텍스트 윈도우가 턴 간 리셋되지 않음 — 모든 것이 축적. 한계 접근 시 자동 **compaction** (요약). `compact_boundary` SystemMessage 발생.

컨텍스트 효율 전략: 서브에이전트 (태스크당 fresh context), 선택적 도구 범위, MCP Tool Search (온디맨드 로딩), effort 레벨 조절

#### MCP (Model Context Protocol)

Anthropic이 2024.11 발표한 오픈 표준. 3가지 기본 요소: Tools (실행 가능 함수), Resources (데이터 소스), Prompts (재사용 가능 템플릿).

2025.12 Linux Foundation 산하 AAIF에 기부. 공동 설립: Anthropic, Block, OpenAI. 지원: Google, Microsoft, AWS, Cloudflare, Bloomberg.

채택: 10,000+ 활성 공개 MCP 서버, 97M+ 월간 SDK 다운로드. ChatGPT, Cursor, Gemini, VS Code, Microsoft Copilot에서 채택.

#### 강점과 약점

**강점**: 아키텍처의 단순성 (while 루프), 빌트인 도구로 즉시 생산적, MCP 생태계 (10,000+ 서버), 자동 압축 + 서브에이전트 격리로 무한 세션, Claude Code와 동일 인프라, 유연한 권한 시스템, 멀티 프로바이더 (Anthropic/Bedrock/Vertex/Azure)

**약점**: 복잡 태스크에서 컨텍스트 고갈, E2E 테스트 갭, 컴퓨터 사용 56% 성공률, 대규모 코드 리뷰 어려움, compaction 정보 손실, 빌트인 평가 프레임워크 없음, Claude 모델 전용

---

### 2.6 Google ADK (Agent Development Kit)

**한줄 요약**: 4개 언어 지원 + A2A 프로토콜 네이티브 + Vertex AI 통합 멀티에이전트 개발킷

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~18.4k (Python), ~7.2k (Go), ~1.4k (Java) |
| 언어 | Python, TypeScript, Go, Java |
| 라이선스 | Apache 2.0 |
| 가격 | 프레임워크 무료 / Gemini API 무료 티어 제공 |

#### 핵심 아키텍처

코드 퍼스트, 테스트 가능, 버전 관리 가능한 에이전트 개발. 모델 무관 (Gemini 최적화). 핵심 구성:
- **Agent** (`BaseAgent`): 부모-자식 계층 (`sub_agents`)
- **Runner**: 단일 유저 호출의 중앙 오케스트레이터. 이벤트 처리, 서비스 연동
- **InvocationContext**: 단일 호출 범위의 실행 환경
- **Event**: Runner ↔ 실행 로직 간 원자적 메시지. `actions` (state_delta, artifact_delta) 포함
- **Services**: SessionService, ArtifactService, MemoryService

**협력적 yield/resume 이벤트 루프**: Agent가 Event를 yield → 실행 일시정지 → Runner가 서비스를 통해 처리/커밋 → 에이전트에게 resume 신호 → 반복

#### 에이전트 타입

| 타입 | 설명 |
|------|------|
| `LlmAgent` (alias: `Agent`) | LLM 기반 추론 에이전트. instruction에서 `{var}` 상태 보간 지원 |
| `SequentialAgent` | 서브에이전트를 순서대로 실행. `output_key`로 상태 공유 |
| `ParallelAgent` | 서브에이전트를 동시 실행. 컨텍스트 분기 |
| `LoopAgent` | `max_iterations` 또는 `escalate=True`까지 반복 |
| Custom Agent | `BaseAgent` 상속, `_run_async_impl` 구현 |

#### 상태 시스템 (4단계 스코프)

| 접두어 | 범위 | 영속성 |
|--------|------|--------|
| (없음) | 현재 세션만 | DB/Vertex 서비스 사용 시 |
| `user:` | 같은 user_id + app_name의 모든 세션 | DB/Vertex 서비스 사용 시 |
| `app:` | 앱의 모든 사용자, 모든 세션 | DB/Vertex 서비스 사용 시 |
| `temp:` | 현재 호출만 | 절대 영속화 안됨 |

#### Artifact 시스템

이름 + 버전으로 관리되는 바이너리 데이터 (이미지, PDF, 오디오). 자동 버전 관리. 세션 범위 또는 `user:` 접두어로 세션 간 접근. 백엔드: InMemory (dev), GCS (prod).

#### 도구 통합

Function Tools (자동 스키마 생성), Long-Running Function Tools (장시간 작업), AgentTool (에이전트를 도구로 래핑), 빌트인 (Google Search, Code Execution, RAG), MCP Tools (`McpToolset` — stdio/SSE), OpenAPI Tools, A2A Tools, 60+ 서드파티 통합

#### A2A 프로토콜

에이전트 간 안전하고 효율적인 협업을 위한 오픈 프로토콜. ADK에서 에이전트 노출 + 소비 모두 지원. Python, Go (실험적).

#### 배포

Local (`adk web/run/api_server`), Vertex AI Agent Engine (완전 관리형, VPC-SC/HIPAA/CMEK), Cloud Run, GKE, Docker/로컬 컨테이너

#### 강점과 약점

**강점**: 진정한 멀티언어 (4개 SDK), Vertex AI Agent Engine (엔터프라이즈급), 결정론적 + LLM 기반 오케스트레이션 공존, 60+ 통합, A2A 네이티브, Gemini Live 양방향 음성/영상, 4단계 상태 스코프, 버전화된 artifact 시스템, Apache 2.0

**약점**: Gemini 최적화 편향 (output_schema+tools는 Gemini 3.0+ 필요), Google Cloud 종속 위험, 상대적 신생, 복잡한 학습 곡선 (yield/resume, 4단계 스코프, 다수 에이전트 타입)

---

### 2.7 Mastra AI

**한줄 요약**: TypeScript-first 올인원 에이전트 프레임워크 — Gatsby 팀 출신, YC 지원

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~22k |
| 언어 | TypeScript only |
| 라이선스 | Apache 2.0 (core), Enterprise (ee/) |
| 가격 | 오픈소스 무료 / Platform ~$29/mo |
| 주간 npm 다운로드 | 300,000+ |

#### 핵심 아키텍처

`Mastra` 클래스가 중앙 오케스트레이터. `mastra.config.ts`로 설정. 모노레포: ~120개 패키지. HTTP 서버: Hono 기반. 94개 LLM 프로바이더, 3,373+ 모델 지원.

서버 어댑터: Express, Hono, Fastify, Koa에 임베드 가능.

#### 워크플로우 엔진

그래프 기반, 명시적 제어 흐름:
- `.then()`: 순차 실행
- `.parallel()`: 동시 실행
- `.branch()`: 조건부 경로 (첫 true 조건)
- `.dountil()` / `.dowhile()`: 반복
- `.foreach()`: 배열 항목별 적용 (동시성 설정 가능)
- `.map()`: 스텝 간 데이터 변환

3가지 실행 엔진: in-memory, event-driven, durable Inngest 기반

#### 메모리 시스템 (4가지 타입)

1. **Message History**: 현재 대화의 최근 메시지
2. **Observational Memory**: 백그라운드 Observer/Reflector 에이전트가 압축된 관찰 로그 생성
3. **Working Memory**: 영속적, 구조화된 사용자 데이터 (이름, 선호도, 목표)
4. **Semantic Recall**: RAG 기반 의미 유사성 검색

스토리지: PostgreSQL, MongoDB, LibSQL

#### 에이전트 패턴

Single Agent, Multi-Step Workflows, **Supervisor Pattern** (권장): 부모 에이전트가 subAgents에 위임, `onDelegationStart` 훅으로 프롬프트 수정/스텝 제한/거부, 에이전트 간 메모리 격리

Agent Networks (deprecated → supervisor로 대체)

#### MCP 지원

양방향: MCPClient (외부 MCP 서버 연결) + MCPServer (Mastra 도구/에이전트를 MCP 서버로 노출)

#### 강점과 약점

**강점**: TypeScript 네이티브 (Python 포트 아님), 올인원 (에이전트+워크플로우+메모리+RAG+평가+음성+관측성), 풍부한 워크플로우 프리미티브, 4가지 메모리 타입, Studio (로컬 테스트/디버깅), MCP 양방향, 빌트인 Evals

**약점**: TypeScript only, 문서 갭 (일부 404), 1.0이 2026.01에야 출시, LangChain 대비 작은 생태계, 브레이킹 체인지, 멀티에이전트 아직 성숙 중

---

### 2.8 Pydantic AI

**한줄 요약**: 타입 안전 에이전트 프레임워크 — "에이전트의 FastAPI", MCP + A2A 완전 지원

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~15.6k |
| 언어 | Python only |
| 라이선스 | MIT |
| 가격 | 완전 무료 오픈소스 (Logfire는 프리미엄) |

#### 핵심 아키텍처

`Agent[DependenciesType, OutputType]` — 두 타입 파라미터에 대해 제네릭. IDE 자동완성과 정적 타입 검사가 "쓰기 시점"에 오류를 잡음.

5가지 실행 메서드: `run()` (비동기), `run_sync()` (동기), `run_stream()` (스트리밍), `run_stream_events()` (원시 이벤트), `iter()` (노드별 수동 스테핑)

#### 타입 안전

프레임워크의 핵심 차별화. `RunContext`, 도구, 출력 검증기 모두 의존성 타입을 타입 시스템을 통해 전달. 벤치마크에서 **개발 중 23개 버그를 타입 안전이 포착** — 다른 프레임워크에서는 프로덕션까지 도달했을 버그.

#### 구조화된 출력 (7가지 모드)

Tool Output (기본), Native Output (모델의 JSON Schema 응답), Prompted Output, StructuredDict (동적 스키마), Output functions, TextOutput, BinaryImage

#### 의존성 주입

표준 Python 패턴. `RunContext[T]`로 시스템 프롬프트, 도구, 출력 검증기에서 접근. `agent.override(deps=...)`로 깨끗한 테스트. 프레임워크 전용 데코레이터 불필요.

#### Toolset 시스템

극도로 조합 가능: `CombinedToolset`, `FilteredToolset`, `PrefixedToolset`, `RenamedToolset`, `PreparedToolset`, `ApprovalRequiredToolset`, `WrapperToolset`, `ExternalToolset`

#### MCP + A2A 완전 지원

**MCP 클라이언트**: MCPServerStdio, MCPServerStreamableHTTP, MCPServerSSE, FastMCPToolset, MCPServerTool (프로바이더 네이티브)

**A2A**: `FastA2A` — Starlette 기반 프레임워크 무관 A2A 구현. `agent.to_a2a()`로 원커맨드 A2A 서버 변환.

UI 이벤트 스트림: Vercel AI SDK, AG-UI 표준 지원

#### 에이전트 패턴 (5단계)

Level 1: 단일 에이전트 / Level 2: 에이전트 위임 / Level 3: 프로그래밍 핸드오프 / Level 4: `pydantic-graph` 기반 상태머신 / Level 5: 계획+파일+위임+샌드박스+요약+승인+내구성 결합

#### 강점과 약점

**강점**: 1급 시민 타입 안전, Pythonic 설계, 26+ 프로바이더 진정한 모델 무관, 가장 유연한 toolset 시스템, OTel 네이티브 관측성 (벤더 무관), MCP + A2A 완전 지원, Pydantic 생태계 레버리지, 내구성 실행 (Temporal/DBOS/Prefect)

**약점**: LangChain/CrewAI 대비 작은 커뮤니티, 비교적 신생 (v1.0: 2025.09), 빌트인 영속 메모리 없음, pydantic-graph 학습 곡선, Python only, Logfire 상업적 연계, 선언적 crew/team 추상화 없음

---

### 2.9 Vercel AI SDK

**한줄 요약**: 프론트엔드/풀스택 네이티브 TypeScript AI 툴킷 — React Server Component 스트리밍

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~22.8k |
| 언어 | TypeScript only |
| 라이선스 | Apache 2.0 |
| 가격 | SDK 무료 / AI Gateway 제로 마크업 |
| 주간 npm 다운로드 | ~2.8M (#1 TS AI 프레임워크) |

#### 핵심 아키텍처

3개 레이어:
- **AI SDK Core**: `generateText`, `streamText`, `generateObject`/`streamObject`
- **AI SDK UI**: 프레임워크별 훅 (`useChat`, `useCompletion`, `useObject`, `useAssistant`) — React, Svelte, Vue, Angular
- **Provider Specification**: `LanguageModelV3` 표준화된 인터페이스

v6 (2026.02): AI Gateway 통해 `"openai/gpt-4o"` 같은 단순 문자열로 모델 참조. 프로바이더 설정 불필요.

#### 에이전트 패턴

v6의 `ToolLoopAgent`: 모델, instructions, 도구를 정의하고 재사용. 자동 컨텍스트 관리, 정지 조건, 도구 실행. `stopWhen` (정지 조건), `prepareStep` (스텝 간 모델/도구/메시지 수정)

#### 도구 승인 (HITL)

`needsApproval: true` (정적) 또는 `needsApproval: async (args) => boolean` (조건부). 클라이언트가 `approval-requested` 상태 수신 → 승인/거부 UI 렌더링 → `addToolApprovalResponse`로 결정 전송

#### UI 컴포넌트

`useChat`, `useCompletion`, `useObject`, `useAssistant`, **AI SDK RSC** (React Server Component에서 UI 요소를 직접 스트리밍 — LLM이 텍스트가 아닌 리치 컴포넌트 인터페이스 반환)

#### 강점과 약점

**강점**: 최고의 프론트엔드/풀스택 통합 (React 훅, RSC 스트리밍, SSE), 최대 채택 (주간 2.8M npm), 깔끔한 추상화, 통합 프로바이더 인터페이스, AI Gateway 제로 마크업

**약점**: Vercel 플랫폼 제약 (Pro 300초 타임아웃), Edge Middleware 전유 런타임 (마이그레이션 시 재작성), 비용 예측 불가 (pay-per-ms), TypeScript only

---

### 2.10 AWS Strands Agents

**한줄 요약**: 모델 주도 설계 + SOP + AWS 네이티브 에이전트 SDK

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~5.3k |
| 언어 | Python (주력), TypeScript (프리뷰) |
| 라이선스 | Apache 2.0 |
| 가격 | SDK 무료 / AgentCore 종량제 |
| 총 PyPI 다운로드 | 14M+ |

#### 핵심 아키텍처

```
Agent = Model + Tools + Prompt
```

**모델 주도**: LLM의 추론을 신뢰 — 모델이 도구 선택, 순서, 사용 방법을 자율적으로 결정. SDK가 에이전트 루프 (모델 호출 → 도구 실행 → 모델 호출) 자동 처리.

동일 에이전트 코드가 로컬 테스트와 AWS 프로덕션 배포에 모두 사용.

#### SOP (Standard Operating Procedures)

마크다운 기반 자연어 워크플로우. 파라미터화된 입력과 제약 기반 실행. AI 시스템 간 재사용 가능 (Strands, Kiro, Cursor, Claude, GPT-4).

#### 멀티에이전트 패턴

4가지 조합 가능 패턴:
1. **Agent-as-Tool**: 전문 에이전트를 조율 에이전트의 도구로 래핑
2. **Swarm**: 다수 에이전트가 동적 협업, 전문가에게 핸드오프
3. **Graph** (GraphBuilder): 타입화된 핸드오프, 실행 트레이스, 도구 계약
4. **Workflow**: 사전 정의된 순서/의존성 그래프

조합 가능: Swarm 안에 Graph, Graph가 Swarm 조율, 모든 패턴이 Agent-as-Tool 사용 가능

#### 엣지 디바이스 지원 (GA)

ARM/x86, sub-100ms 레이턴시, llama.cpp로 로컬 모델, 오프라인 시나리오

#### AgentCore 메모리

- **STM (단기)**: 대화 영속화
- **LTM (장기)**: 3가지 전략 — summaryMemoryStrategy (세션 요약), userPreferenceMemoryStrategy (사용자 선호), semanticMemoryStrategy (사실 추출)

#### 강점과 약점

**강점**: 극도의 단순성 (3-5줄로 기능 에이전트), AWS 네이티브, 프로덕션 입증 (Q Developer, Glue, Kiro에 내부 사용), 모델 무관, 4가지 조합 가능 멀티에이전트 패턴, SOP, 엣지 디바이스, OTel 네이티브

**약점**: TS 프리뷰, 프론트엔드 통합 없음, AWS 중력 (기본 모델 Bedrock Claude, 기본 리전 us-west-2), ConverseStream API 쓰로틀링, 2025.05 런칭으로 아직 성숙 중

---

### 2.11 Microsoft Semantic Kernel

**한줄 요약**: 엔터프라이즈 AI 오케스트레이션 SDK — DI 컨테이너 + 필터 미들웨어 + Azure 심화 통합

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~27.5k |
| 언어 | C# (주력), Python, Java |
| 라이선스 | MIT |
| 가격 | 완전 무료 오픈소스 |

#### 핵심 아키텍처

**Kernel** = DI 컨테이너. AI 서비스 선택, 프롬프트 템플릿 빌드, 응답 파싱까지 단일 진입점. 플러그인은 함수 그룹.

플러그인 3가지 임포트: Native Code (어노테이션된 클래스 메서드), OpenAPI (OpenAPI 스펙에서), MCP Server (MCP 서버에서)

**Planning**: 구 Stepwise/Handlebars planner 제거. 현재 **LLM function calling**으로만 계획 — 모델이 반복적으로 함수 호출 결정, 병렬 function calling 지원.

**Filters (엔터프라이즈 미들웨어)**: Function Invocation Filter, Prompt Render Filter, Auto Function Invocation Filter. PII 감지/삭제, 시맨틱 캐싱, 콘텐츠 안전, 품질 검사에 사용.

#### 에이전트 오케스트레이션 (5가지 패턴)

Concurrent (병렬), Sequential (순차), Handoff (동적 위임), Group Chat (그룹 대화), Magentic (MagenticOne 연구 기반 범용 멀티에이전트). 모든 패턴 동일 API — 패턴 전환에 에이전트 로직 재작성 불필요.

#### 현황: Microsoft Agent Framework 통합

AutoGen과 합쳐 **Microsoft Agent Framework**로 통합 중. 2026 Q1 GA 목표.

#### 강점과 약점

**강점**: 진정한 SDK/라이브러리 (앱에 임베드), 엔터프라이즈급 미들웨어 (필터, DI, 텔레메트리, 책임 AI), 멀티언어 (C#, Python, Java), Azure 심화 통합, MCP 양방향, 성숙한 에이전트 오케스트레이션 (5패턴), 경량 (커널 = DI 컨테이너)

**약점**: 비주얼 인터페이스 없음, Java SDK 기능 뒤처짐, 벡터 스토어 커넥터 프리뷰/RC, 빌트인 RAG 파이프라인 없음, 빌트인 UI/대시보드 없음

---

### 2.12 Dify

**한줄 요약**: 노코드/로우코드 LLMOps 플랫폼 — 비주얼 워크플로우 빌더 + RAG + 에이전트 모드

| 항목 | 내용 |
|------|------|
| GitHub Stars | ~131k (가장 많은 stars) |
| 언어 | Python (백엔드) |
| 라이선스 | Apache 2.0 + 추가 조건 |
| 가격 | 셀프호스트 무료 / Cloud 프리미엄 |
| Discord | 1M+ 멤버 |

#### 핵심 아키텍처

SDK가 아닌 **풀스택 플랫폼**. 웹 UI + API Layer + 워크플로우 엔진 + RAG 파이프라인 + 에이전트 프레임워크 + 모델 런타임.

#### 비주얼 워크플로우 빌더

드래그앤드롭 캔버스. 2가지 워크플로우 타입: Chatflow (대화형), Workflow (배치/API 기반). 노드: User Input, Parameter Extractor, IF/ELSE, List Operator, Doc Extractor, LLM, Iteration, Template (Jinja2), Agent, Output.

#### 에이전트

Function Calling (네이티브 LLM function calling) + ReAct (Thought-Action-Observation 사이클). 50+ 빌트인 도구. Workflow-as-Tool (워크플로우를 도구로 노출).

#### 빌트인 RAG 파이프라인

3가지 생성 방법: 빠른 생성 (자동화), 지식 파이프라인 (커스텀), 외부 통합 (API 동기화). PDF, PPT 등 문서 추출. 청크 관리, 검색 테스트, 메타데이터 강화.

#### LLMOps 모니터링

대시보드: 총 메시지, 활성 사용자, 평균 상호작용, 토큰 사용량 (비용 추적). 외부 통합: Langfuse, LangSmith, Opik, Arize Phoenix.

#### 강점과 약점

**강점**: 비주얼/로우코드 (비개발자 접근 가능), 올인원 플랫폼, 거대 커뮤니티 (131k stars, 1M+ Discord), Docker Compose로 쉬운 셀프호스트, 빌트인 RAG, 50+ 도구, LLMOps 대시보드, API 퍼스트, Workflow-as-Tool

**약점**: 임베더블 SDK 아님 (플랫폼), 프로그래밍 제어 제한, 멀티언어 SDK 없음, 멀티에이전트 오케스트레이션 제한, 라이선스 제한 (순수 Apache 2.0 아님), 무거운 설치 (PostgreSQL, Redis, 웹서버), 커스터마이징 한계

---

## 3. AI 주도 개발 오케스트레이션 도구

사람이 아니라 **AI가 흐름을 주도하고, 사람의 대답을 유도**하는 카테고리.

---

### 3.1 GSD (Get Shit Done) — ~32k Stars

**창시자**: TACHES (Lex Christopherson)
**리포**: gsd-build/get-shit-done (v1), gsd-build/gsd-2 (v2)

#### 해결하는 문제: Context Rot

컨텍스트 윈도우가 채워질수록 AI 정확도가 점진적 저하. Claude는 50%+ 사용 시 품질 하락 시작, 70%+에서 환각/망각/드리프트.

#### GSD v1 (프롬프트 인젝션)

npm 패키지 `get-shit-done-cc`. 6개 런타임 지원: Claude Code, OpenCode, Gemini CLI, Codex, GitHub Copilot, Antigravity.

**Thin Orchestrator 패턴**: 오케스트레이터가 파일 경로만 로드 (내용 아님), `gsd-tools` CLI에서 구조화된 JSON 사용, 15-30% 컨텍스트 사용으로 유지 → 70-85%를 서브에이전트에 할당.

에이전트 간 통신: **간접적 파일 아티팩트** — 직접 메시지 아님.

**Phase 생명주기**: discuss (AskUserQuestion으로 결정 캡처 → N-CONTEXT.md) → plan (연구자/플래너 스폰 → N-RESEARCH.md, N-0X-PLAN.md) → execute (실행자 스폰, 원자적 git 커밋) → verify (수동 테스트 + 자동 진단 → N-UAT.md)

**12개 전문 에이전트**: gsd-planner, gsd-plan-checker, gsd-executor, gsd-verifier, gsd-phase-researcher, gsd-project-researcher, gsd-research-synthesizer, gsd-codebase-mapper, gsd-roadmapper, gsd-debugger, gsd-integration-checker, gsd-orchestrator. `gsd-executor`만 Edit 권한 보유.

#### GSD-2 (Standalone CLI)

Pi SDK 기반 완전 재작성.

| 항목 | GSD v1 | GSD v2 |
|------|--------|--------|
| 런타임 | Claude Code 슬래시 커맨드 | Standalone CLI (Pi SDK) |
| 컨텍스트 | 비관리 축적 | 태스크당 fresh 세션 |
| 크래시 복구 | 없음 | 락 파일 + 세션 포렌식 |
| 비용 추적 | 없음 | 유닛별 토큰/비용 원장 |
| 자동화 | LLM 자기 루프 | 상태 머신 |

**계층**: Milestones (배포 가능 버전, 4-10 slices) → Slices (데모 가능 수직 기능, 1-7 tasks) → Tasks (컨텍스트 윈도우 크기 작업 단위. "태스크가 하나의 컨텍스트 윈도우에 맞지 않으면, 두 개의 태스크다.")

**3가지 운영 모드**: Step (`/gsd` — 단위 실행 + 일시정지), Auto (`/gsd auto` — 전체 마일스톤 자율), Headless (비대화형, CI/스크립트, 파일 기반 IPC)

---

### 3.2 기타 Spec-Driven 오케스트레이터

| 도구 | 핵심 | 특징 |
|------|------|------|
| **BMAD Method** | 12+ AI 페르소나 (PM, Architect, Dev, UX, Scrum Master) | 4단계: Analysis→Planning→Solutioning→Implementation. 아티팩트 기반 |
| **Claude Task Master** | 3 전문 에이전트 + 49 슬래시 커맨드 | PRD에서 태스크 자동 생성, MCP 통합 |
| **SuperClaude** (~20k stars) | 30+ 커맨드 + 인지 페르소나 | Claude Code 프롬프트 프레임워크, v4.2 딥 리서치 |
| **Google Conductor** | Track 기반 (spec→plan→phases→subtasks) | Gemini CLI 확장, 계획 리뷰 후에만 구현 진행 |

---

### 3.3 멀티에이전트 오케스트레이션 플랫폼

| 도구 | 핵심 |
|------|------|
| **Augment Code Intent** | coordinator/implementor/verifier 트리오 + living spec + 격리된 git worktree. SOC 2 Type II |
| **Gas Town** (Steve Yegge) | Go 기반, 20-30개 병렬 AI 에이전트를 tmux로 관리. Mayor/Polecats/Witness 역할 계층 |
| **Warp + Oz** | 터미널 기반 ADE. 클라우드 에이전트 오케스트레이션, cron, Slack/GitHub/Linear 트리거 |
| **Vibe Kanban** | 칸반 보드 = 에이전트 API (MCP 서버). 10+ 에이전트 병렬 관리 |

---

### 3.4 자율 코딩 에이전트

| 도구 | Stars | 특징 |
|------|-------|------|
| **Devin** (Cognition) | — (유료) | 최초 완전 자율 AI 개발자. Goldman Sachs, Nubank. Windsurf 인수 ($250M) |
| **OpenHands** | ~69k | 오픈소스 AI 개발 플랫폼. SWE-bench 46.8% |
| **Codex CLI** (OpenAI) | — | Rust 기반. GPT-5.3-Codex 25시간+ 연속. 주간 1M+ 활성 개발자 |
| **SWE-Agent** (Princeton) | ~19k | 연구 기반 자율 소프트웨어 엔지니어링 |
| **Cursor 2.0** | — | 8개 병렬 에이전트, git worktree 격리, Agent Workflows |
| **Roo Code** | — | 5모드 (Code/Debug/Ask/Architect/Orchestrator) |
| **Google Antigravity** | — | Editor + Manager Surface, SWE-bench 76.2%, 무료 |

---

## 4. 프로토콜 생태계

### 4.1 MCP (Model Context Protocol) — Anthropic

AI 시스템에 도구/데이터 접근을 제공하는 오픈 표준 (2024.11). JSON-RPC 기반 클라이언트-서버 모델. 3가지 기본 요소: Tools, Resources, Prompts. 트랜스포트: stdio, Streamable HTTP, SSE.

**거버넌스**: 2025.12 Linux Foundation AAIF에 기부. 10,000+ 활성 서버, 97M+ 월간 다운로드. 업계 표준 달성.

**채택**: OpenAI, Google, Microsoft, AWS, Cloudflare, 거의 모든 에이전트 프레임워크.

### 4.2 A2A (Agent-to-Agent) — Google

에이전트 간 통신을 위한 오픈 프로토콜 (2025.04). JSON-RPC over HTTP. 50+ 런칭 파트너. Google ADK에서 네이티브. Pydantic AI도 완전 지원 (FastA2A).

### 4.3 ACP (Agent Communication Protocol) — IBM

에이전트 통신 프로토콜. A2A와 Linux Foundation 하에 통합 중.

---

## 5. 비교 매트릭스

### 아키텍처 접근 방식

| 프레임워크 | 접근 방식 | 비유 |
|-----------|---------|------|
| LangGraph | 그래프 기반 상태머신 | "설계도대로 짓는 건축" |
| CrewAI | 역할 기반 팀 | "프로젝트 팀 빌딩" |
| AutoGen | 대화 기반 멀티에이전트 | "토론회" |
| OpenAI Agents SDK | 미니멀 핸드오프 | "레고 블록" |
| Claude Agent SDK | 단일 루프 + MCP | "만능 칼" |
| Google ADK | 계층적 에이전트 트리 | "군사 조직" |
| Mastra | TS 네이티브 올인원 | "스위스 군도" |
| Pydantic AI | 타입 안전 에이전트 | "타입스크립트의 정신을 파이썬으로" |
| Vercel AI SDK | 프론트엔드 네이티브 | "React의 AI 확장" |
| Strands Agents | 모델 주도 + SOP | "자율 주행" |
| Semantic Kernel | 엔터프라이즈 DI 미들웨어 | ".NET의 AI 확장" |
| Dify | 비주얼 노코드 플랫폼 | "Zapier for AI" |

### 언어 지원

| 프레임워크 | Python | TypeScript | Go | Java | C# |
|-----------|--------|-----------|-----|------|-----|
| LangGraph | ● | ○ | | | |
| CrewAI | ● | | | | |
| AutoGen | ● | | | | ○ |
| OpenAI Agents SDK | ● | ● | | | |
| Claude Agent SDK | ● | ● | | | |
| Google ADK | ● | ● | ● | ● | |
| Mastra | | ● | | | |
| Pydantic AI | ● | | | | |
| Vercel AI SDK | | ● | | | |
| Strands Agents | ● | ○ | | | |
| Semantic Kernel | ○ | | | ○ | ● |
| Dify | ● (backend) | | | | |

● = 주력, ○ = 지원/프리뷰

### 프로토콜 지원

| 프레임워크 | MCP | A2A |
|-----------|-----|-----|
| LangGraph | ○ | |
| CrewAI | ○ | |
| AutoGen | ○ | |
| OpenAI Agents SDK | ● | |
| Claude Agent SDK | ● | |
| Google ADK | ● | ● |
| Mastra | ● | |
| Pydantic AI | ● | ● |
| Vercel AI SDK | ○ | |
| Strands Agents | ● | ● |
| Semantic Kernel | ● | |
| Dify | | |

### 메모리 시스템

| 프레임워크 | 단기 | 장기 | 엔티티 | 시맨틱 |
|-----------|------|------|--------|--------|
| LangGraph | ● (체크포인트) | ● (BaseStore) | | ● |
| CrewAI | ● (ChromaDB) | ● (SQLite) | ● | ● |
| AutoGen | ● (대화) | ○ (Teachable) | | |
| OpenAI Agents SDK | ● (9가지 세션) | | | |
| Claude Agent SDK | ● (세션) | ○ (CLAUDE.md) | | |
| Google ADK | ● (세션) | ● (MemoryService) | | |
| Mastra | ● (메시지) | ● (Observational) | | ● (Semantic Recall) |
| Pydantic AI | ● (메시지 히스토리) | | | |
| Vercel AI SDK | ● (메시지 배열) | | | |
| Strands Agents | ● (SessionManager) | ● (AgentCore LTM) | | ● |
| Semantic Kernel | ● (ChatHistory) | ● (벡터 스토어) | | ● |
| Dify | ● (TokenBuffer) | ● (지식 베이스) | | |

---

## 6. 아키텍처 패턴 분류

### 에이전트 오케스트레이션 패턴

```
1. 단일 에이전트 + 도구
   └─ 모든 프레임워크 지원

2. 핸드오프 패턴 (라우팅)
   └─ OpenAI Agents SDK, Google ADK, Semantic Kernel

3. Supervisor 패턴
   └─ LangGraph, Mastra, CrewAI (hierarchical)

4. 그룹 챗
   └─ AutoGen, Semantic Kernel

5. 순차 파이프라인
   └─ Google ADK (SequentialAgent), Semantic Kernel, Strands (Workflow)

6. 병렬 팬아웃
   └─ Google ADK (ParallelAgent), LangGraph (Send), Semantic Kernel

7. 반복/루프
   └─ Google ADK (LoopAgent), LangGraph (cyclic), Mastra (dowhile/dountil)

8. 스웜 (탈중앙화)
   └─ LangGraph (langgraph-swarm), Strands (Swarm)

9. 그래프 기반 상태머신
   └─ LangGraph, Pydantic AI (pydantic-graph), Strands (GraphBuilder)

10. Spec-Driven 오케스트레이션
    └─ GSD, BMAD, Claude Task Master, Google Conductor
```

### 핵심 트렌드 (2026)

1. **"인간이 주도, AI가 보조" → "AI가 주도, 인간이 검토"** — 2026년의 결정적 전환
2. **SWE-bench에서 에이전트 스캐폴드가 모델 가중치보다 중요** — 동일 모델(Opus 4.5)이 스캐폴드에 따라 22점 차이
3. **MCP가 업계 표준으로 확정** — 모든 주요 프레임워크 채택
4. **A2A가 다음 표준 후보** — Google + Pydantic + AWS가 선도
5. **TypeScript 에이전트 생태계 급성장** — Mastra, Vercel AI SDK가 Python 독점 깨뜨리는 중

---

## 7. Zipbul 관점의 시사점

### Zipbul 생태계 구성

| 프로젝트 | 역할 |
|---------|------|
| zipbul | 백엔드 프레임워크 |
| emberdeck | 설계 지식 관리 (MCP) |
| gildash | TypeScript 코드 인덱싱 |
| baker | 데코레이터 기반 검증 |
| firebat | CLI 도구 |
| playground/playbook | 에이전트 워크플로우 |

### 포지셔닝 관찰

1. **TypeScript-first 에이전트 프레임워크 시장**: Mastra (~22k), Vercel AI SDK (~22.8k)가 양대 산맥. 그 외에는 Python 프레임워크의 JS 포트뿐.

2. **emberdeck의 차별화**: 에이전트 프레임워크들은 "도구/메모리/오케스트레이션"에 집중. **설계 지식 관리 (design knowledge)** 는 어느 프레임워크도 커버하지 않는 영역. 코드 심볼과 설계 카드의 양방향 링크는 고유한 가치.

3. **MCP가 통합 레이어**: emberdeck이 이미 MCP 서버로 동작. 모든 에이전트 프레임워크/IDE가 MCP를 채택했으므로, emberdeck은 프레임워크 무관하게 연결 가능.

4. **AI 주도 오케스트레이션**: GSD의 discuss→plan→execute→verify 패턴에서 emberdeck이 "설계 의도 보존" 역할을 할 수 있음. 에이전트가 코드를 변경하기 전에 emberdeck 카드를 조회하여 cascading impact를 감지하는 패턴.

5. **A2A 프로토콜**: Google ADK, Pydantic AI, Strands가 선도. 에이전트 간 통신 표준으로 성장 중. MCP (도구 접근) + A2A (에이전트 간 통신)가 보완 관계.
