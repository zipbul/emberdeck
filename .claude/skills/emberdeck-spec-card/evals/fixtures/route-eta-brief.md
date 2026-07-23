---
key: geo/route-eta
summary: 경로 ETA 추정
status: draft
type: brief
parent: geo
brief:
  context:
    problem: 배차 상담원이 경험으로 도착 시간을 안내해 예측 편차가 크고 근거가 남지 않는다.
    impact:
      - statement: 부정확한 도착 예측으로 고객 문의와 배차 차질이 반복된다.
  scope:
    goals:
      - id: G-001
        statement: 출발-도착 좌표에 대해 ETA가 추정된다.
    non_goals:
      - id: NG-001
        statement: 실시간 교통 데이터 수집과 지도 렌더링은 다루지 않는다.
    assumptions:
      - id: A-001
        statement: 출발·도착 좌표가 십진수 위경도 형식으로 주어진다.
  flow:
    - id: S-H-01
      kind: happy
      given: 서비스 범위 안의 좌표 쌍이 주어짐
      when: ETA 추정을 실행함
      then: ETA가 계산되어 반환된다
      covers:
        - G-001
    - id: S-F-01
      kind: failure
      given: 좌표가 서비스 범위 밖
      when: 처리를 실행함
      then: 추정을 거부하고 범위 밖임을 알린다
      covers:
        - G-001
  policy:
    - id: R-001
      subject: ETA 추정기
      keyword: MUST
      predicate: 서비스 범위 밖이거나 형식이 틀린 요청은 추정하지 않아야 한다
      governs:
        - S-H-01
        - S-F-01
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: 요청 구간에 대한 ETA가 분 단위로 반환된다
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
      - option: 좌표 기반 자동 추정
        pros:
          - 일관된 근거 있는 예측
        cons:
          - 범위 밖 요청은 거부됨
      - option: 상담원 수기 안내 유지
        pros:
          - 특수 상황 감안 가능
        cons:
          - 편차와 무근거 안내 지속
    chosen:
      option: 좌표 기반 자동 추정
      reasoning: 편차가 문제의 본질이고, 범위 밖은 거부로 드러내는 편이 낫다
    addresses: []
---
