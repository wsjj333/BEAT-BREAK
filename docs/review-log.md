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
