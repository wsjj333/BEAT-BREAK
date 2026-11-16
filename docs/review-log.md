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

조치:
- #3: `nearestBeat` 진입부에 `NaN`/`Infinity` 검증 추가
- #4: `tests/beatTimeline.test.ts`에 경계 테스트 추가
- #5: `requestTempo` JSDoc에 거절 사유 우선순위 명시
