/**
 * tests/config.test.ts
 * config.ts의 v0.4 규칙값 및 헬퍼 함수 검증.
 * 3.5절 테스트 벡터와 헬퍼 함수의 경계값을 확인한다.
 */

import { describe, it, expect } from "vitest";
import {
  BEATS_PER_BAR,
  TEMPO_STEPS,
  INITIAL_BPM,
  MAX_BPM,
  PERFECT_WINDOW_MS,
  GOOD_WINDOW_MS,
  CALIBRATION_OFFSET_DEFAULT_MS,
  CALIBRATION_OFFSET_MIN_MS,
  CALIBRATION_OFFSET_MAX_MS,
  CALIBRATION_OFFSET_STEP_MS,
  COMBO_THRESHOLD_TEMPO_UP,
  PLAYER_HP,
  ENEMY_HP,
  BASE_ATTACK_DAMAGE,
  BPM_DAMAGE_MULTIPLIER,
  TIMING_DAMAGE_MULTIPLIER,
  ENEMY_ATTACK_BEAT_INTERVAL,
  ENEMY_ATTACK_FIRST_BEAT,
  ENEMY_ATTACK_DAMAGE,
  MAX_BEATS,
  beatDurationSec,
  isEnemyAttackBeat,
  nextBarBoundary,
  nextTempo,
} from "../src/core/config";

// ─── 3.1 규칙값 ────────────────────────────────────────────────────────────

describe("config — 3.1 시간과 판정 규칙값", () => {
  it("4/4박자: BEATS_PER_BAR = 4", () => {
    expect(BEATS_PER_BAR).toBe(4);
  });

  it("템포 단계: 100 → 120 → 140", () => {
    expect(TEMPO_STEPS).toEqual([100, 120, 140]);
  });

  it("초기 BPM = 100, 최대 BPM = 140", () => {
    expect(INITIAL_BPM).toBe(100);
    expect(MAX_BPM).toBe(140);
  });

  it("Perfect 윈도우: 100/120/140 BPM → ±90/±75/±60ms", () => {
    expect(PERFECT_WINDOW_MS[100]).toBe(90);
    expect(PERFECT_WINDOW_MS[120]).toBe(75);
    expect(PERFECT_WINDOW_MS[140]).toBe(60);
  });

  it("Good 윈도우: 100/120/140 BPM → ±160/±135/±110ms", () => {
    expect(GOOD_WINDOW_MS[100]).toBe(160);
    expect(GOOD_WINDOW_MS[120]).toBe(135);
    expect(GOOD_WINDOW_MS[140]).toBe(110);
  });

  it("캘리브레이션 오프셋: 초기 0ms, 범위 -200~+200ms, 10ms 단위", () => {
    expect(CALIBRATION_OFFSET_DEFAULT_MS).toBe(0);
    expect(CALIBRATION_OFFSET_MIN_MS).toBe(-200);
    expect(CALIBRATION_OFFSET_MAX_MS).toBe(200);
    expect(CALIBRATION_OFFSET_STEP_MS).toBe(10);
  });

  // 3.5절 테스트 벡터 — 경계값 확인
  it("3.5 벡터: 100BPM +90ms → Perfect (경계 포함)", () => {
    expect(90 <= PERFECT_WINDOW_MS[100]).toBe(true);
  });

  it("3.5 벡터: 100BPM +91ms → Good (Perfect 초과, Good 이내)", () => {
    expect(91 > PERFECT_WINDOW_MS[100]).toBe(true);
    expect(91 <= GOOD_WINDOW_MS[100]).toBe(true);
  });

  it("3.5 벡터: 100BPM +160ms → Good (경계 포함)", () => {
    expect(160 <= GOOD_WINDOW_MS[100]).toBe(true);
  });

  it("3.5 벡터: 100BPM +161ms → Miss (Good 초과)", () => {
    expect(161 > GOOD_WINDOW_MS[100]).toBe(true);
  });

  it("3.5 벡터: 120BPM 경계값 (±75ms Perfect, ±135ms Good)", () => {
    expect(75 <= PERFECT_WINDOW_MS[120]).toBe(true);
    expect(76 > PERFECT_WINDOW_MS[120]).toBe(true);
    expect(135 <= GOOD_WINDOW_MS[120]).toBe(true);
    expect(136 > GOOD_WINDOW_MS[120]).toBe(true);
  });

  it("3.5 벡터: 140BPM 경계값 (±60ms Perfect, ±110ms Good)", () => {
    expect(60 <= PERFECT_WINDOW_MS[140]).toBe(true);
    expect(61 > PERFECT_WINDOW_MS[140]).toBe(true);
    expect(110 <= GOOD_WINDOW_MS[140]).toBe(true);
    expect(111 > GOOD_WINDOW_MS[140]).toBe(true);
  });
});

// ─── 3.2 콤보·템포 ─────────────────────────────────────────────────────────

describe("config — 3.2 콤보·템포 규칙값", () => {
  it("템포 업 최소 콤보 = 5", () => {
    expect(COMBO_THRESHOLD_TEMPO_UP).toBe(5);
  });
});

// ─── 3.3 전투 ──────────────────────────────────────────────────────────────

describe("config — 3.3 공격·적·승패 규칙값", () => {
  it("플레이어 HP = 5, 적 HP = 300", () => {
    expect(PLAYER_HP).toBe(5);
    expect(ENEMY_HP).toBe(300);
  });

  it("기본 공격 피해 = 10", () => {
    expect(BASE_ATTACK_DAMAGE).toBe(10);
  });

  it("BPM 배율: 100/120/140 → 1.00/1.25/1.50", () => {
    expect(BPM_DAMAGE_MULTIPLIER[100]).toBe(1.0);
    expect(BPM_DAMAGE_MULTIPLIER[120]).toBe(1.25);
    expect(BPM_DAMAGE_MULTIPLIER[140]).toBe(1.5);
  });

  it("타이밍 배율: Perfect=1.25, Good=1.00, Miss=0", () => {
    expect(TIMING_DAMAGE_MULTIPLIER.PERFECT).toBe(1.25);
    expect(TIMING_DAMAGE_MULTIPLIER.GOOD).toBe(1.0);
    expect(TIMING_DAMAGE_MULTIPLIER.MISS).toBe(0);
  });

  it("적 공격 간격 = 4비트, 첫 적 공격 = beat 7 (D-09), 적 공격 피해 = 1", () => {
    expect(ENEMY_ATTACK_BEAT_INTERVAL).toBe(4);
    expect(ENEMY_ATTACK_FIRST_BEAT).toBe(7);
    expect(ENEMY_ATTACK_DAMAGE).toBe(1);
  });

  it("최대 비트 = 120", () => {
    expect(MAX_BEATS).toBe(120);
  });
});

// ─── 헬퍼 함수 ─────────────────────────────────────────────────────────────

describe("config — beatDurationSec", () => {
  it("100BPM → 0.6초", () => {
    expect(beatDurationSec(100)).toBeCloseTo(0.6);
  });

  it("120BPM → 0.5초", () => {
    expect(beatDurationSec(120)).toBeCloseTo(0.5);
  });

  it("140BPM → 60/140초", () => {
    expect(beatDurationSec(140)).toBeCloseTo(60 / 140);
  });
});

describe("config — isEnemyAttackBeat", () => {
  // D-09(a): 4k+3 (k≥1)
  it("beat 7, 11, 15, 119 → true", () => {
    for (const b of [7, 11, 15, 119]) {
      expect(isEnemyAttackBeat(b)).toBe(true);
    }
  });

  it("beat 3 → false (첫 마디는 적응 구간)", () => {
    expect(isEnemyAttackBeat(3)).toBe(false);
  });

  it("beat 0, 1, 2, 4, 5, 6, 8, 12 → false (마디 경계 포함)", () => {
    for (const b of [0, 1, 2, 4, 5, 6, 8, 12]) {
      expect(isEnemyAttackBeat(b)).toBe(false);
    }
  });
});

describe("config — nextBarBoundary", () => {
  it("3.5 벡터: beat 6 요청 → beat 8에서 적용", () => {
    expect(nextBarBoundary(6)).toBe(8);
  });

  it("beat 7 → 8", () => {
    expect(nextBarBoundary(7)).toBe(8);
  });

  it("beat 8 → 12 (마디 경계에서 요청하면 다음 마디)", () => {
    expect(nextBarBoundary(8)).toBe(12);
  });

  it("beat 0 → 4", () => {
    expect(nextBarBoundary(0)).toBe(4);
  });

  it("beat 4 → 8", () => {
    expect(nextBarBoundary(4)).toBe(8);
  });
});

describe("config — nextTempo", () => {
  it("100 → 120", () => {
    expect(nextTempo(100)).toBe(120);
  });

  it("120 → 140", () => {
    expect(nextTempo(120)).toBe(140);
  });

  it("140 (최대) → null", () => {
    expect(nextTempo(140)).toBeNull();
  });
});
