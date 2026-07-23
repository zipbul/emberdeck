---
key: ledger/close-month/run
summary: 월 마감 실행 계약
status: active
type: spec
parent: ledger/close-month
spec:
  preconditions:
    - id: PRE-001
      condition: 해당 월의 모든 분개가 입력되어 있다
      derives: 'ledger/close-month#G-999'
  postconditions:
    - id: POST-001
      guarantee: 마감 분개가 생성되고 잔액 검증 결과가 기록된다
      keyword: MUST
      derives: 'ledger/close-month#G-001'
  invariants:
    - id: INV-001
      statement: 같은 월에 대한 마감은 최대 1회다
      always_holds: cross-call
  failures:
    - id: FAIL-001
      violation: 미결 항목 존재
      behavior: 마감을 보류하고 미결 목록을 보고한다
      case_of: 'ledger/close-month#S-F-01'
---
