---
key: geo/route-eta/estimate
summary: ETA 추정 계약
status: draft
type: spec
parent: geo/route-eta
spec:
  preconditions:
    - id: PRE-001
      condition: 출발·도착 좌표가 십진수 위경도 형식이고 직선거리 500km(서비스 범위) 안이다
      derives: 'geo/route-eta#G-001'
  postconditions:
    - id: POST-001
      guarantee: 출발-도착 좌표가 같으면 0분, 다르면 1분 이상의 분 단위 ETA가 반환된다
      keyword: MUST
      derives: 'geo/route-eta#G-001'
  invariants:
    - id: INV-001
      statement: 반환 ETA는 0 이상이다
      always_holds: per-call
  failures:
    - id: FAIL-001
      violation: 좌표 형식 오류 또는 직선거리 500km(서비스 범위) 초과
      behavior: 추정을 거부하고 범위 밖임을 알린다
      case_of: 'geo/route-eta#S-F-01'
---
