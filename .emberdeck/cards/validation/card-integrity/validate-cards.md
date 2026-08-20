---
key: validation/card-integrity/validate-cards
summary: 'validate cards 명령의 계약: 파일 권위 재조정·비초안 바디 무결성 강제·verbosity 불변 exit 규약·무변조'
status: active
type: spec
parent: validation/card-integrity
spec:
  preconditions:
    - id: PRE-001
      condition: 덱 설정이 로드되어 cardsDir 경로가 정해져 있고, 그 경로 아래의 파일이 이 덱의 카드 집합 전부다
      derives: validation/card-integrity#G-001
  postconditions:
    - id: POST-001
      guarantee: 파일이 파싱에 실패하면 대응 DB row 유무와 무관하게 게이트 finding으로 보고하고 exit 2를 반환한다
      keyword: MUST
      derives: validation/card-integrity#G-002
    - id: POST-002
      guarantee: >-
        아직 materialize되지 않은 cardsDir와 빈 인덱스는 빈 카드 집합으로 처리한다 — 신규 덱의 부트스트랩은 결함이
        아니므로 카드에서 비롯된 게이트 finding도 internal-error도 내지 않는다
      keyword: MUST
      derives: validation/card-integrity#G-001
    - id: POST-003
      guarantee: 게이트 결함은 stdout 구조 출력에 실리며 exit 코드는 -q 포함 모든 verbosity에서 동일하다
      keyword: MUST
      derives: validation/card-integrity#G-005
    - id: POST-004
      guarantee: >-
        실행은 단일 진실인 카드 파일을 변조하지 않는다. 파생 인덱스를 파일 기준으로 재계산하는 것은 변조가 아니며, 재계산 후의 판정은
        파일이 말하는 상태를 따른다
      keyword: MUST
      derives: validation/card-integrity#G-005
    - id: POST-005
      guarantee: >-
        파일이 선언한 status가 draft가 아닌 카드는 부모 타입·계층, 필수 네임스페이스, 그리고 tier별 상호참조(brief
        커버리지 웹, spec derives·case_of·invokes, domain 교차의존 대상)를 만족해야 하며 위반은
        게이트한다. 소스 바인딩은 active binding 원칙이 지배할 때만 그 enforcement에 따라 증거 존재로 판정하고,
        심볼 해석은 이 명령의 대상이 아니다
      keyword: MUST
      derives: validation/card-integrity#G-003
    - id: POST-006
      guarantee: >-
        active이고 평가 엔진을 가진(structural·binding) 원칙의 blocking 위반은 게이트한다.
        warning·advisory는 그 원칙이 스스로 게이트하지 않기로 선언한 것이므로 게이트하지 않는다 — 카드가 선언한 강제
        수준을 검증기가 덮어쓰지 않는다
      keyword: MUST
      derives: validation/card-integrity#G-004
    - id: POST-007
      guarantee: >-
        draft 카드는 바디 완결성을 면제받되 가독성(파싱), 정체성(선언 key와 경로 일치), 안전한 계층(부모 실존·타입 규칙)은
        동일하게 강제된다
      keyword: MUST
      derives: validation/card-integrity#G-006
    - id: POST-008
      guarantee: >-
        판정 시점에 파일 집합과 인덱스가 일대일로 대응하지 않으면 게이트한다. 파생 인덱스의 재계산이 흡수한 차이(새 파일 편입, 사라진
        파일의 row 제거, 흡수된 내용 변경)는 판정 시점에 이미 해소된 것이므로 결함이 아니며, 재계산이 흡수하지 못한 불일치만 남아
        보고된다
      keyword: MUST
      derives: validation/card-integrity#G-001
  invariants:
    - id: INV-001
      statement: >-
        검증 결과가 산출되고 출력에 성공한 실행에서 exit 0 ⇔ 게이트 finding 집합이 비어 있다(출력 I/O 실패는 판정이
        아니라 별도 exit 코드로 구분된다)
      always_holds: per-call
    - id: INV-002
      statement: 카드 파일 집합의 내용과 인덱스가 그대로인 채 반복 실행하면 동일한 finding 집합과 동일한 exit 코드를 낸다
      always_holds: per-call
  failures:
    - id: FAIL-001
      violation: 인덱스 row를 가진 카드 파일이 더는 파싱되지 않는다
      behavior: 그 파일을 지목한 게이트 finding을 stdout에 싣고 덱을 clean으로 보고하지 않는다
      case_of: validation/card-integrity#S-F-01
    - id: FAIL-002
      violation: cardsDir를 열거할 수 없다(디렉토리 부재가 아닌 ENOTDIR·EACCES 등)
      behavior: >-
        판정 결과(구조 출력)를 내지 않고 stderr에 오류를 보고하며 0이 아닌 exit로 종료한다 — 빈 덱으로 간주해 clean을
        보고하지 않는다
---
