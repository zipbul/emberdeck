---
key: streaming/subtitle-sync
summary: 자막 자동 동기화
status: draft
type: brief
parent: streaming
brief:
  context:
    problem: 자막이 영상과 어긋나 수동 보정에 회당 20분이 든다.
    impact:
      - statement: 자막 품질 불만이 반복 접수된다.
  scope:
    goals:
      - id: G-001
        statement: 업로드된 자막이 자동으로 영상과 동기화된다.
    non_goals:
      - id: NG-001
        statement: 자막 번역은 다루지 않는다.
    assumptions:
      - id: A-001
        statement: 영상에서 음성 타임스탬프를 추출할 수 있다.
  flow:
    - id: S-H-01
      kind: happy
      given: 자막 파일과 영상이 업로드됨
      when: 동기화 파이프라인이 실행됨
      then: 오프셋이 보정되어 저장된다
      covers:
        - G-999
  policy:
    - id: R-001
      subject: 동기화 파이프라인
      keyword: MUST
      predicate: 원본 자막 파일을 변경하지 않고 보정본을 별도 저장해야 한다
      governs:
        - S-H-01
  criteria:
    - id: SC-001
      type: numeric
      measure:
        predicate: 보정 후 자막 오프셋
        value: 200
        comparator: '<='
        unit: ms
      verifies:
        - S-H-01
  rationale:
    alternatives:
      - option: 음성 타임스탬프 기반 자동 보정
        pros:
          - 수동 개입 제거
        cons:
          - 무음 구간에서 취약
      - option: 수동 보정 유지
        pros:
          - 정확도 보장
        cons:
          - 회당 20분 소요
    chosen:
      option: 음성 타임스탬프 기반 자동 보정
      reasoning: 반복 비용 제거가 문제의 본질
    addresses: []
---

## Notes

covers가 존재하지 않는 G-999를 가리키고 failure flow가 없어 활성화가 거부되는 상태.
