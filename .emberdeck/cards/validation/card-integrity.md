---
key: validation/card-integrity
summary: 'validate cards 무결성 판정: 파일 권위 재조정과 비초안 바디 무결성 강제'
status: active
type: brief
parent: validation
brief:
  context:
    problem: >-
      오늘 validate cards는 파일이 아니라 캐시 스냅샷을 판정할 수 있어, 파싱 안 되는 카드도 DB row만 있으면
      clean(exit 0)으로 통과시키고, -q를 붙이면 그 증거마저 사라진다. 손편집으로 active가 된 깨진 카드도 잡지 못한다.
    impact:
      - statement: 검증기가 손상된 덱을 "정상"이라 보고해, 카드가 진실이라는 전제가 검증 지점에서 무너진다.
  scope:
    goals:
      - id: G-001
        statement: 모든 카드 파일이 파싱되고, 파생 인덱스가 그 파일 집합의 충실한 전단사임이 증명된다.
      - id: G-002
        statement: >-
          판정 시점에 읽을 수 없거나 인덱스와 어긋난 채 남은 카드는 캐시 row가 있든 없든 게이트된다(무엇으로 보고되는지는 상태에
          따라 다를 수 있다).
      - id: G-003
        statement: 비초안(active·drifted) 카드는 활성화와 동등한 바디·참조 무결성을 덱 전역에서 만족한다.
      - id: G-004
        statement: 활성 blocking 원칙의 위반은 게이트된다.
      - id: G-005
        statement: >-
          exit 코드는 -q 포함 모든 verbosity에서 동일하며, 검증은 단일 진실인 카드 파일을 변조하지 않는다(파생 인덱스는
          파일로부터 다시 계산될 수 있다).
      - id: G-006
        statement: 초안 카드는 완결성만 면제되고 가독성·정체성·안전한 계층은 지킨다.
    non_goals:
      - id: NG-001
        statement: 소스 심볼 해석, 프로즈 품질 판단, 구조 스멜 게이트는 다루지 않는다.
    assumptions:
      - id: A-001
        statement: cardsDir 설정이 존재하며, 부재 시 빈 덱으로 취급된다.
  flow:
    - id: S-H-01
      kind: happy
      given: >-
        모든 카드 파일이 파싱되고 인덱스와 일치하며 비초안 카드가 각 tier 규칙을 만족하고 초안 카드도 가독성·정체성·안전한 계층을
        지킴
      when: validate cards 실행
      then: total 0 · exit 0 이고 카드 파일을 변조하지 않는다
      covers:
        - G-001
        - G-003
        - G-005
        - G-006
    - id: S-F-01
      kind: failure
      given: 파싱 안 되는 카드 파일이 DB row를 가진 채 존재함
      when: validate cards(및 -q) 실행
      then: 그 파일을 게이트 finding으로 stdout에 싣고 exit 2를 반환한다
      covers:
        - G-002
    - id: S-F-02
      kind: failure
      given: 활성 blocking 원칙을 위반하는 비초안 카드가 존재함
      when: validate cards 실행
      then: 위반을 게이트하고 exit 2를 반환한다
      covers:
        - G-004
  policy:
    - id: R-001
      subject: 검증기
      keyword: MUST
      predicate: 판정 대상은 카드 파일이며 인덱스가 파일의 충실한 투영임을 게이트 전제로 증명해야 한다
      governs:
        - S-H-01
        - S-F-01
    - id: R-002
      subject: 검증기
      keyword: MUST NOT
      predicate: 검증 중 카드 파일을 변조하면 안 된다 — 파생 인덱스를 파일 기준으로 갱신하는 것은 변조가 아니라 파생물의 재계산이다
      governs:
        - S-H-01
    - id: R-003
      subject: 검증기
      keyword: MUST
      predicate: 게이트 결함은 stdout 구조 출력에 실려야 하며 exit 코드는 verbosity와 무관해야 한다
      governs:
        - S-F-01
    - id: R-004
      subject: 검증기
      keyword: MUST
      predicate: 활성 blocking 원칙 위반은 게이트해야 한다
      governs:
        - S-F-02
  criteria:
    - id: SC-001
      type: binary
      measure:
        predicate: 정상 덱에서 total 0 · exit 0 이고 카드 파일이 무변조로 유지된다
      verifies:
        - S-H-01
    - id: SC-002
      type: binary
      measure:
        predicate: row 있는 파싱불가 카드에서 exit 2이고 결함이 stdout에 나타난다
      verifies:
        - S-F-01
    - id: SC-003
      type: binary
      measure:
        predicate: 활성 blocking 원칙 위반 카드에서 exit 2를 반환한다
      verifies:
        - S-F-02
  rationale:
    alternatives:
      - option: 파일 권위 재조정(파일 판정 + 인덱스 전단사 증명)
        pros:
          - 손상 파일을 캐시가 가리지 못함
        cons:
          - 재조정 비용
      - option: 스냅샷(캐시)만 판정
        pros:
          - 단순·빠름
        cons:
          - 손상 파일 위에서 clean이라 거짓말 — 기각
    chosen:
      option: 파일 권위 재조정(파일 판정 + 인덱스 전단사 증명)
      reasoning: 카드가 SoT라는 교리상 캐시만 판정하면 손상 파일을 정상이라 증명하게 된다.
    addresses: []
---
