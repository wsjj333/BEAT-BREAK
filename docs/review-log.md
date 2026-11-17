# BEAT//BREAK — diff 독립 리뷰 기록

형식: 태스크 번호 / 리뷰 대상 파일 / 발견 사항 / 조치.

---

## Task 01 — 프로젝트 초기화 (2026-11-16)

리뷰 대상: `package.json`, `tsconfig.json`, `vite.config.ts`, `src/core/config.ts`, `tests/config.test.ts`
리뷰 원문: `docs/reviews/task-01-review.md`

| # | 심각도 | 지적 | 판단 | 이유 |
|---|---|---|---|---|
| 1 | High | diff 내 구문 오류 | 기각 | PowerShell 리다이렉션 인코딩 문제. 원본 정상 확인, diff 추출을 git diff --output으로 변경 |
| 2 | Med | 판정 테스트가 상수 비교 | 보류 | 태스크 3 DoD에 반영 |
| 3 | Med | 상태 전이 테스트 누락 | 보류 | 태스크 2~5 DoD에 반영 |
| 4 | Med | vite.config.ts 타입검사 제외 | 반영 | 아래 수정 |
| 5 | Med | 입력 유효성 부재 | 반영 | D-03: Bpm 유니온 타입 |
| 6 | Low | 한글 인코딩 손상 | 기각 | #1과 동일 원인 |

조치:
- #4: `vite.config.ts` — `defineConfig`를 `vitest/config`에서 import하도록 변경 (커밋 `ebcdbf0`)
- #5: `src/core/config.ts` — `beatDurationSec(bpm: number)` → `beatDurationSec(bpm: Bpm)` 변경 (커밋 `ebcdbf0`)

---

## Task 02 — BeatTimeline (2026-11-16)

리뷰 대상: `src/core/beatTimeline.ts`, `tests/beatTimeline.test.ts`, `src/core/config.ts`, `docs/decisions.md`
리뷰 원문: `docs/reviews/task-02-review.md`

| # | 심각도 | 지적 | 판단 | 이유 |
|---|---|---|---|---|
| 1 | High | diff 구문 손상 | 기각 | PowerShell 5.1 Get-Content가 UTF-8을 CP949로 디코딩. 리뷰 전달을 파일 첨부로 변경 |
| 2 | Med | requestTempo 미래 비트 예약 가능 | 보류 | D-05: 태스크 4 TempoSystem이 nowSec에서 현재 비트를 직접 계산하도록 구조로 해결 |
| 3 | Med | nearestBeat NaN/Infinity 미검증 | 반영 | D-03 진입점 검증 원칙. 비유한수 입력 시 RangeError |
| 4 | Low | 경계 양방향 테스트 누락 | 반영 | 리뷰 표의 6개 입력 + 120→140 경계 + EPS 양방향 테스트 추가 |
| 5 | Low | 거절 사유 우선순위 미문서화 | 반영 | JSDoc에 at_max → pending → invalid_step 명시. 로직 변경 없음 |

조치 (커밋 `96b1830`, 구현과 함께 커밋됨):
- #3: nearestBeat 진입부에 NaN/Infinity 검증 추가
- #4: tests/beatTimeline.test.ts에 경계 테스트 추가
- #5: requestTempo JSDoc에 거절 사유 우선순위 명시

리뷰 외 발견:
- 계획 단계: 시각 비교의 부동소수점 오차로 중간값 규칙(3.1)이 뒤집힐 위험을 사람이 발견 → 계획 수정 요청 (toBeCloseTo, EPS, D-04)
- 구현 단계: 계획의 중간값 조건식 방향 오류(distHi - distLo)를 구현 AI가 구현 중 발견·수정하고 "요구사항과 달라진 점"으로 보고 → 사람이 확인

구현과 리뷰 반영이 한 커밋에 합쳐짐 (커밋 순서 실수). 사후 분리는 기록 재구성이 되므로 하지 않음. 태스크 3부터 feat → 리뷰 → fix 순서 준수.

---

## Task 03 — RhythmJudge (2026-11-17)

리뷰 대상: `docs/decisions.md`, `src/core/config.ts`, `src/core/rhythmJudge.ts`, `tests/rhythmJudge.test.ts` (커밋 `06522d6`)
리뷰 원문: `docs/reviews/task-03-review.md`

| # | 심각도 | 지적 | 판단 | 이유 |
|---|---|---|---|---|
| 1 | Med | 120→140 전환 경계 테스트 누락 | 반영 | 실제 플레이 경로. 경계 비트 ±60/61, ±110/111ms + 직전 비트 120BPM 유지 |
| 2 | Low | 경계 안쪽 1ms 테스트 누락 | 반영 | 비교 연산자 회귀 방지. 3개 BPM 양방향 |
| 3 | Low | 음수 오프셋 방향 미검증 | 반영 | -50ms 보정 + 오프셋으로 비트 배정이 바뀌는 경우 |
| 4 | Low | D-06 경계 확장 미검증 | 반영 | window+0.5e-6ms는 상위 판정, window+2e-6ms는 하위 판정 |
| - | - | D-04 중간값 추가 확인 필요 | 기각 | 범위 밖. 태스크 2에서 테스트됨 (96b1830) |

조치 (테스트만 추가, 코드 로직 변경 없음, `tests/rhythmJudge.test.ts`, 커밋 `358af0a`):
- #1: 100→120(beat 8)→140(beat 12) 경로에서 beat 12 ±60/61/110/111ms, beat 11 ±75/76/135/136ms (16개)
- #2: 3.5 벡터에 경계 안쪽 1ms(89/159, 74/134, 59/109) 추가, beat 0·beat 1 양방향 (24개)
- #3: -50ms 보정(+50ms 입력 → 0ms), -50ms로 perfect→good 이동, -200ms로 beat 3→beat 2 배정 변경 (3개)
- #4: 6개 경계 × 양방향 × (+0.5e-6 / +2e-6ms), errorMs 9자리 확인 (24개)

---

| 출처 | 내용 | 해결 예정 | 상태 |
|---|---|---|---|
| T1#2 | 판정 테스트를 입력→결과로 검증 | 태스크 3 | 해결 (06522d6) |
| T1#3 | duplicate 테스트 | 태스크 3 | 해결 (06522d6) |
| T1#3 | 템포 적용 시 콤보 리셋, 회피 HP, timeout 테스트 | 태스크 4~5 | 구현됨, 커밋·리뷰 대기 (`tests/combatSystem.test.ts`) |
| T2#2 | 미래 비트 예약 차단 (D-05) | 태스크 4 | 구현됨, 커밋·리뷰 대기 (`TempoSystem.requestTempoUp(nowSec)`, D-07a) |