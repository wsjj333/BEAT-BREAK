# BEAT//BREAK

박자에 맞춰 공격하고 회피하며, 스스로 템포를 올려 더 빠르고 강하게 싸우는 웹 2D 리듬 전투 게임.

**▶ 플레이:** https://wsjj333.github.io/BEAT-BREAK/

## 조작법

| 키 | 동작 |
| --- | --- |
| `J` | 공격 |
| `F` | 회피 |
| `T` | 템포 업 |
| `R` | 재시작 (결과 화면에서) |
| `[` / `]` | 입력 타이밍 보정 (박자가 어긋나게 느껴질 때, 다음 판부터 적용) |

## 개발 과정

1. **기획** — 핵심 규칙과 수치를 기획서(v0.5)로 먼저 확정
2. **AI 구현** — 기획서를 기준으로 Claude Code가 태스크 단위로 구현 (순수 로직 → 테스트 → Phaser/Web Audio 연결)
3. **독립 리뷰** — 각 태스크의 diff를 별도로 리뷰하고 발견 사항과 조치를 기록
4. **플레이 데이터로 규칙 수정** — 플레이 로그(텔레메트리)를 근거로 규칙을 조정하고 결정 이유를 기록

## 문서

- [기획 및 개발계획 v0.5](docs/BEAT_BREAK_기획_및_개발계획_v0.5.md)
- [의사결정 기록 (decisions)](docs/decisions.md)
- [독립 리뷰 기록 (review-log)](docs/review-log.md)
- [플레이테스트 기록 (playtest-log)](docs/playtest-log.md)

## 로컬 실행

```bash
npm ci
npm run dev       # 개발 서버
npm run test      # 테스트
npm run build     # 빌드 (dist/)
npm run preview   # 빌드 결과 미리보기
```

기술 스택: Vite, TypeScript, Phaser 3, Vitest
