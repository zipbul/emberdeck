---
key: training/plan-builder
summary: 운동 계획 빌더
status: draft
type: brief
parent: training
brief:
  context:
    problem: 초보 사용자가 무엇을 얼마나 할지 몰라 첫 주에 이탈한다.
    impact:
      - statement: 첫 주 이탈이 전체 이탈의 대부분을 차지한다.
  scope:
    goals:
      - id: G-001
        statement: 사용자가 목표를 고르면 주간 운동 계획이 자동 생성된다.
    non_goals:
      - id: NG-001
        statement: 식단 계획은 다루지 않는다.
    assumptions:
      - id: A-001
        statement: 운동 종목 라이브러리가 준비되어 있다.
  flow:
    - id: S-H-01
      kind: happy
      given: 목표와 가용 요일을 입력함
      when: 계획 생성을 실행함
      then: 주간 계획이 생성되어 저장된다
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: 가용 요일이 0일로 입력됨
      when: 계획 생성을 실행함
      then: 생성을 거부하고 최소 1일 이상을 요구한다
      covers:
        - G-001
  policy:
    - id: R-001
      subject: 계획 생성기
      keyword: MUST
      predicate: 가용 요일 수를 초과하는 세션을 배정하지 않아야 한다
      governs:
        - S-H-01
        - S-F-01
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: 생성된 계획의 세션 수가 가용 요일 수 이하이다
      verifies:
        - S-H-01
        - S-F-01
  rationale:
    alternatives:
      - option: 목표 기반 자동 생성
        pros:
          - 초보 진입 장벽 제거
        cons:
          - 개인화 한계
      - option: 빈 캘린더 수동 작성
        pros:
          - 완전한 자유도
        cons:
          - 초보가 첫 주에 포기
    chosen:
      option: 목표 기반 자동 생성
      reasoning: 첫 주 이탈이 문제의 본질이므로 시작 마찰 제거가 우선
    addresses: []
---
