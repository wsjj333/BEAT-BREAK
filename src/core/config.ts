/**
 * src/core/config.ts
 * v0.3 규칙값의 단일 원천. docs/BEAT_BREAK_기획_및_개발계획_v0.3.md 3장 기준.
 * 수치를 임의로 변경하지 않는다. 변경 제안은 docs/decisions.md에 기록 후 승인.
 */

// ─── 3.1 시간과 판정 ───────────────────────────────────────────────────────

/** 4/4박자 — 1마디의 박 수 */
export const BEATS_PER_BAR = 4;

/** 템포 단계 (BPM). 100 → 120 → 140 순으로 올라가며, 하강 없음 */
export const TEMPO_STEPS = [100, 120, 140] as const;
export type Bpm = (typeof TEMPO_STEPS)[number];

/** 전투 시작 시 초기 BPM */
export const INITIAL_BPM: Bpm = 100;

/** 최대 BPM */
export const MAX_BPM: Bpm = 140;

/**
 * BPM별 Perfect 판정 윈도우 (단위: ms). 경계값 포함 (<=).
 * 100 BPM → ±90ms, 120 BPM → ±75ms, 140 BPM → ±60ms
 */
export const PERFECT_WINDOW_MS: Record<Bpm, number> = {
  100: 90,
  120: 75,
  140: 60,
};

/**
 * BPM별 Good 판정 윈도우 (단위: ms). 경계값 포함 (<=). Perfect 우선.
 * 100 BPM → ±160ms, 120 BPM → ±135ms, 140 BPM → ±110ms
 */
export const GOOD_WINDOW_MS: Record<Bpm, number> = {
  100: 160,
  120: 135,
  140: 110,
};

/** 캘리브레이션 오프셋 초기값 (ms) */
export const CALIBRATION_OFFSET_DEFAULT_MS = 0;

/** 캘리브레이션 오프셋 최솟값 (ms) */
export const CALIBRATION_OFFSET_MIN_MS = -200;

/** 캘리브레이션 오프셋 최댓값 (ms) */
export const CALIBRATION_OFFSET_MAX_MS = 200;

/** 캘리브레이션 오프셋 조정 단위 (ms) */
export const CALIBRATION_OFFSET_STEP_MS = 10;

// ─── 3.2 콤보·템포 변경 ───────────────────────────────────────────────────

/** 템포 업 선택 가능 최소 콤보 */
export const COMBO_THRESHOLD_TEMPO_UP = 5;

// ─── 3.3 공격·적·승패 ─────────────────────────────────────────────────────

/** 플레이어 초기 HP */
export const PLAYER_HP = 5;

/** 적 초기 HP */
export const ENEMY_HP = 300;

/** 기본 공격 피해 (BPM·타이밍 배율 적용 전) */
export const BASE_ATTACK_DAMAGE = 10;

/**
 * BPM별 공격 배율.
 * 100 BPM → 1.00, 120 BPM → 1.25, 140 BPM → 1.50
 */
export const BPM_DAMAGE_MULTIPLIER: Record<Bpm, number> = {
  100: 1.0,
  120: 1.25,
  140: 1.5,
};

/**
 * 타이밍 배율.
 * Perfect → 1.25, Good → 1.00, Miss → 0
 */
export const TIMING_DAMAGE_MULTIPLIER = {
  PERFECT: 1.25,
  GOOD: 1.0,
  MISS: 0,
} as const;

/**
 * 적 공격 비트 간격.
 * beat 4, 8, 12, ... (0보다 큰 4의 배수)
 */
export const ENEMY_ATTACK_BEAT_INTERVAL = 4;

/** 적 공격 1회 피해 */
export const ENEMY_ATTACK_DAMAGE = 1;

/** 한 판 최대 비트 수. 초과 시 timeout 패배 */
export const MAX_BEATS = 120;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────

/** BPM에서 1박 길이를 초 단위로 반환 */
export function beatDurationSec(bpm: Bpm): number {
  return 60 / bpm;
}

/**
 * 비트가 적 공격 비트인지 확인 (beat 4, 8, 12, ... — 0보다 큰 4의 배수)
 */
export function isEnemyAttackBeat(beat: number): boolean {
  return beat > 0 && beat % ENEMY_ATTACK_BEAT_INTERVAL === 0;
}

/**
 * 주어진 비트가 속한 마디의 다음 마디 경계 비트 번호를 반환.
 * 템포 업 예약 시 적용 시점 계산에 사용.
 * 예: beat 6 → 8, beat 8 → 12, beat 0 → 4
 */
export function nextBarBoundary(currentBeat: number): number {
  return Math.floor(currentBeat / BEATS_PER_BAR) * BEATS_PER_BAR + BEATS_PER_BAR;
}

/**
 * TEMPO_STEPS 에서 현재 BPM의 다음 단계 BPM을 반환.
 * 최대 BPM이면 null 반환.
 */
export function nextTempo(bpm: Bpm): Bpm | null {
  const idx = TEMPO_STEPS.indexOf(bpm);
  if (idx === -1 || idx === TEMPO_STEPS.length - 1) return null;
  return TEMPO_STEPS[idx + 1];
}
