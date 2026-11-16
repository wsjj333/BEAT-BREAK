# BEAT//BREAK — Claude Code 작업 규칙

## 목표
`docs/BEAT_BREAK_v0.3.md`를 기준으로 웹 2D 게임의 핵심 메커니즘을 구현한다. **문서에 없는 규칙을 임의로 만들지 않는다.** 불명확한 점은 질문하거나 `docs/decisions.md`에 제안으로만 기록한다.

## 기술 스택
- Vite, TypeScript(`strict`), Phaser 3, Vitest
- `npm run dev`, `npm run build`, `npm run test`, `npm run typecheck`

## 폴더 구조
- `src/core/` — 순수 TypeScript 로직 (Phaser/DOM/Web Audio 직접 참조 금지)
- `src/core/config.ts` — v0.3 규칙값의 단일 원천
- `src/game/` — Phaser 화면·입력·표시
- `src/audio/` — Web Audio 시계 및 메트로놈 어댑터
- `src/telemetry/` — 플레이 이벤트 수집
- `tests/` — Vitest 테스트
- `docs/decisions.md` — 기획 선택과 수정 이유
- `docs/review-log.md` — diff 독립 리뷰 및 조치 기록

## 개발 순서
1. 프로젝트 초기화 및 샘플 테스트
2. BeatTimeline
3. RhythmJudge
4. ComboSystem + TempoSystem
5. CombatSystem
6. Phaser + Audio 연결
7. 플레이 로그/밸런스 실험

## 품질 규칙
- 테스트와 순수 로직은 시간·난수 의존성을 주입할 수 있게 구성한다.
- 음악/판정 기준은 프레임 타이머나 setTimeout 누적이 아닌 오디오 시계 기반이다.
- 한 태스크씩 구현한다. 현재 태스크 밖의 콘텐츠/연출/리팩터링을 추가하지 않는다.
- 각 태스크 후 변경 파일, 주요 설계 선택, 실행 명령과 실제 실행 결과, 미해결 위험을 보고한다.
- 통과하지 않은 테스트나 실행하지 않은 빌드를 통과했다고 보고하지 않는다.
- 코드 diff는 별도의 독립 리뷰에 제출할 수 있도록 제공한다.

## 보고 형식
- 완료한 작업
- 수정/생성 파일
- 실행한 검증 명령 및 결과
- 요구사항과 달라진 점 (없으면 '없음')
- 미해결 질문 및 다음 태스크
