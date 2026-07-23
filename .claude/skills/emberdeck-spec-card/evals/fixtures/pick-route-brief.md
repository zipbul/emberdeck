---
key: warehouse/pick-route
summary: 피킹 경로 자동 산출
status: draft
type: brief
parent: warehouse
brief:
  context:
    problem: 주문 품목의 창고 내 피킹 동선을 작업자가 수기로 계획해 처리 시간이 들쭉날쭉하고 품목 누락이 잦다.
    impact:
      - statement: 주문당 피킹 소요 시간이 늘고 누락 품목이 반복된다.
  scope:
    goals:
      - id: G-001
        statement: 주문 품목 전부를 포함하는 피킹 경로가 방문 순서와 함께 자동 산출된다.
    non_goals:
      - id: NG-001
        statement: 피킹 작업자 배정과 창고 인력 운영은 다루지 않는다.
    assumptions:
      - id: A-001
        statement: SKU 프리픽스별 보관 구역(위치) 매핑이 유지·관리되고 있다.
  flow:
    - id: S-H-01
      kind: happy
      given: 위치 매핑이 있는 SKU 목록이 주어짐
      when: 피킹 경로 산출을 실행함
      then: 요청 품목이 모두 포함된 피킹 경로가 산출되어 저장된다
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: 재고 위치 데이터 미비
      when: 처리를 실행함
      then: 산출을 거부하고 사유를 알린다
      covers:
        - G-001
  policy:
    - id: R-001
      subject: 경로 산출기
      keyword: MUST
      predicate: 위치 매핑이 없는 SKU가 하나라도 있으면 경로를 산출하지 않아야 한다
      governs:
        - S-H-01
        - S-F-01
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: 요청한 모든 품목이 포함된 피킹 경로가 방문 순서와 함께 산출된다
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
      - option: 매핑 기반 자동 산출
        pros:
          - 동선 계획 병목 제거
        cons:
          - 매핑 미비 시 산출 중단
      - option: 작업자 수기 동선 유지
        pros:
          - 현장 상황 반영 가능
        cons:
          - 누락과 편차 지속
    chosen:
      option: 매핑 기반 자동 산출
      reasoning: 동선 계획이 병목이고, 매핑 미비는 조용한 오배정보다 거부로 드러나는 편이 안전하다
    addresses: []
---
