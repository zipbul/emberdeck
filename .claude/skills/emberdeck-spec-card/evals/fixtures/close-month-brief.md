---
key: ledger/close-month
summary: 월 마감 자동화
status: draft
type: brief
parent: ledger
brief:
  context:
    problem: 월 마감 분개 작성과 잔액 대사를 수기로 반복해 마감이 늦고 수정 분개가 쌓인다.
    impact:
      - statement: 마감 지연으로 재무 보고가 늦어지고 수기 분개 오류가 반복된다.
  scope:
    goals:
      - id: G-001
        statement: 월 마감이 자동으로 수행되고 잔액이 검증된다.
    non_goals:
      - id: NG-001
        statement: 세무 신고 제출과 외부 감사 대응은 다루지 않는다.
    assumptions:
      - id: A-001
        statement: 마감 대상 원장 항목이 마감 시점까지 전표 확정 상태다.
  flow:
    - id: S-H-01
      kind: happy
      given: 확정된 원장 항목이 주어짐
      when: 월 마감을 실행함
      then: 월 마감 분개가 생성되어 잔액이 검증된다
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: 미결 항목이 남아 있음
      when: 처리를 실행함
      then: 마감을 보류하고 미결 목록을 보고한다
      covers:
        - G-001
  policy:
    - id: R-001
      subject: 마감 처리기
      keyword: MUST
      predicate: 미결 항목이 남아 있으면 마감을 확정하지 않아야 한다
      governs:
        - S-H-01
        - S-F-01
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: 모든 원장 항목이 반영된 마감 분개가 생성되고 잔액 검증 결과가 남는다
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: 실패 입력이 거부되고 사유가 남는다
      verifies:
        - S-F-01
  rationale:
    alternatives:
      - option: 자동 마감
        pros:
          - 마감 주기 단축
        cons:
          - 예외 전표 대응 한계
      - option: 수기 마감 유지
        pros:
          - 예외를 유연하게 처리
        cons:
          - 지연과 수정 분개 반복
    chosen:
      option: 자동 마감
      reasoning: 마감 지연이 재무 보고를 막는 병목이고, 예외는 미결 목록 보고로 드러내면 된다
    addresses: []
---
