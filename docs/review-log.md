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

## Task 04-05 — ComboSystem, TempoSystem, CombatSystem (2026-11-17)

리뷰 대상: `src/core/{beatTimeline,comboSystem,tempoSystem,combatSystem}.ts`, `tests/{beatTimeline,comboSystem,tempoSystem,combatSystem}.test.ts`, `docs/decisions.md`, `docs/review-log.md` (커밋 `fbc214c`)
리뷰 원문: `docs/reviews/task-04-05-review.md`

| # | 심각도 | 지적 | 판단 | 이유 |
|---|---|---|---|---|
| 1 | Med | 템포 적용 후 getState().combo가 이전 콤보 반환 | 반영 | 태스크 6 UI에서 콤보 표시와 템포 업 자격이 불일치. getState가 effectiveCombo 사용 |
| 2 | Med | resolveBeat가 윈도우 종료를 검증하지 않음 | 반영 | resolveBeat(beat, nowSec)로 변경. 보정 시각 기준 Good 윈도우 종료 전이면 RangeError. 태스크 6 호출 타이밍 실수를 즉시 드러냄 |
| 3 | Low | BeatTimeline.requestTempo 공개 API 우회 가능 | 보류 | TS에 패키지 단위 접근 제어 없음. 호출처 1곳 검사 테스트로 위험 수용 |
| 4 | Low | 같은 비트·채널 경쟁 입력 순서 테스트 없음 | 보류 | 최초 입력 우선이 정상 동작. 일정상 후순위 |

조치 (`src/core/combatSystem.ts`, `tests/combatSystem.test.ts`):
- #1: `getState()` → `getState(nowSec)`. combo는 `effectiveCombo(currentBeatAt(nowSec))`(템포 요청 자격과 동일). 승패 확정 후에는 시각과 무관하게 확정 시점 값. 음수 nowSec는 beat 0으로 본다(오프셋 +200ms면 beat 0 확정이 입력 시간축 −39ms에 가능하므로). 테스트: 적용 비트 1ms 전 콤보 7, 적용 비트 정각·+50ms 콤보 0.
- #2: `resolveBeat(beat)` → `resolveBeat(beat, nowSec)`. 보정 시각이 `beatTime + Good(해당 비트 BPM) + JUDGE_EPS_MS` 이하이면 RangeError(Good 경계 포함이므로). 테스트: 100BPM +160ms 거부·+160.01ms 허용, 140BPM +110/+111ms, 템포 적용 비트(120BPM) +135/+136ms, 오프셋 −50ms +210/+211ms, 오프셋 +200ms −40/−39ms, 거부 후 도착한 Perfect 입력 정상 반영, NaN 거부.

---

## Task 06 — Phaser + Audio 연결, 텔레메트리 (2026-11-17)

리뷰 대상: `task-06.diff` (커밋 `20ce5d6`), 기획서 v0.3 3.1절·5장, `docs/decisions.md` D-05·D-07·D-08
리뷰 원문: `docs/reviews/task-06-review.md`

| # | 심각도 | 지적 | 판단 | 이유 |
|---|---|---|---|---|
| 1 | High | 확정 후 입력이 성공 통계에 포함 | 반영 | H2·H3 지표 왜곡. beat_already_resolved는 진단용으로만 기록, 성공률·첫 성공 시각에서 제외 |
| 2 | Med | 템포 업 기회 집계 누락 가능 | 반영 | H1 핵심 지표. 예약 성공 시 해당 가능 구간의 기회가 반드시 집계되도록 보장 |
| 3 | Med | 재시작 시 예약된 오디오 노드 미정리 | 보류 | 최대 100ms, 재시작은 결과 화면에서만 가능 |
| 4 | Med | 스케줄러 지연 시 클릭 누락 | 보류 | 의도된 정책. 늦은 재생은 틀린 박자를 들려줌. D-08에 명시 |
| 5 | Low | 두 시계를 원자적으로 읽지 않음 | 보류 | 실측 필요. UE 이식 시 Quartz로 재검토 |

조치 (`src/telemetry/runTelemetry.ts`, `src/game/battleSession.ts`, `tests/battleSession.test.ts`, `docs/decisions.md`):
- #1: `COUNTED_ATTACK_KINDS`에서 `beat_already_resolved` 제외. 해당 입력은 이벤트로 남기고 요약에는 진단용 `attackAfterResolveByBpm`으로만 집계. 테스트: 확정 후 Good → 성공 0·첫 성공 null·진단 1, 반영 입력과 섞인 경우, 확정 후 Miss(`late_miss_combo_reset`)는 Miss로 집계.
- #2: `requestTempoUp`이 core 호출 전에 가능 상태를 관찰(update와 같은 함수). 예약 성공 시 그 구간의 기회가 아직 없으면 기록. 테스트: update 관찰 전 프레임 사이 요청 → 기회 1·선택 1, 이미 관찰된 구간 → 중복 없음, 불가 상태 거절 → 기회 0.
- #4: D-08(e)로 정책 명시.
- D-08 (a)~(d) 승인으로 상태 변경.
- 텔레메트리 `version` 1 → 2. v1 로그의 공격 요약값은 확정 후 입력이 포함될 수 있음, 분석 시 events의 pending만 사용.

---

## Task 07 — D-09 적 공격 위치 이동, 템포 업 UI, 화면 선명도 (2026-11-17)

리뷰 생략, 플레이테스트로 검증 (사유: 규칙 변경 단순, 일정). 커밋 `3378a12`.

---

| 출처 | 내용 | 해결 예정 | 상태 |
|---|---|---|---|
| T1#2 | 판정 테스트를 입력→결과로 검증 | 태스크 3 | 해결 (06522d6) |
| T1#3 | duplicate 테스트 | 태스크 3 | 해결 (06522d6) |
| T1#3 | 템포 적용 시 콤보 리셋, 회피 HP, timeout 테스트 | 태스크 4~5 | 해결 (fbc214c) |
| T2#2 | 미래 비트 예약 차단 (D-05) | 태스크 4 | 해결 (fbc214c) |
| T4-5#3 | BeatTimeline.requestTempo 공개 API 우회 가능 | 미정 | 보류 (호출처 1곳 검사 테스트로 위험 수용) |
| T4-5#4 | 같은 비트·채널 경쟁 입력 순서 테스트 | 미정 | 보류 (일정상 후순위) |
| T6#3 | 재시작 시 예약된 오디오 노드 미정리 | 미정 | 보류 (최대 100ms, 재시작은 결과 화면에서만) |
| T6#4 | 스케줄러 지연 시 클릭 누락 | — | 보류 (의도된 정책, D-08(e)) |
| T6#5 | 두 시계를 원자적으로 읽지 않음 | UE 이식 | 보류 (실측 필요, Quartz로 재검토) |