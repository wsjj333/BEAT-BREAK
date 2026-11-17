/**
 * src/core/combatSystem.ts
 * 입력 수집 → 비트별 확정 → HP/콤보/승패. 기획서 3.3 / D-01 기준.
 * Phaser/DOM/Web Audio 직접 참조 금지. 시간은 인자로 주입한다.
 *
 * 입력은 즉시 판정(시각 피드백용)하되 상태는 바꾸지 않고 버퍼에 담는다.
 * 최종 HP·콤보 반영은 resolveBeat(beat, nowSec)에서만 한다 → 입력 도착 순서와 무관 (3.3).
 */

import { BeatTimeline } from './beatTimeline';
import { ComboSystem, type AttackTiming } from './comboSystem';
import {
  BASE_ATTACK_DAMAGE,
  BPM_DAMAGE_MULTIPLIER,
  type Bpm,
  CALIBRATION_OFFSET_DEFAULT_MS,
  ENEMY_ATTACK_DAMAGE,
  ENEMY_HP,
  GOOD_WINDOW_MS,
  INITIAL_BPM,
  JUDGE_EPS_MS,
  MAX_BEATS,
  PLAYER_HP,
  TIMING_DAMAGE_MULTIPLIER,
  isEnemyAttackBeat,
} from './config';
import { type InputChannel, RhythmJudge } from './rhythmJudge';
import { TempoSystem, type TempoUpResult } from './tempoSystem';

/** 피해 = 10 × BPM 배율 × 타이밍 배율 (3.3) */
export function computeAttackDamage(bpm: Bpm, timing: AttackTiming): number {
  const timingMul =
    timing === 'perfect'
      ? TIMING_DAMAGE_MULTIPLIER.PERFECT
      : timing === 'good'
        ? TIMING_DAMAGE_MULTIPLIER.GOOD
        : TIMING_DAMAGE_MULTIPLIER.MISS;
  return BASE_ATTACK_DAMAGE * BPM_DAMAGE_MULTIPLIER[bpm] * timingMul;
}

export type CombatStatus =
  | { phase: 'playing' }
  | { phase: 'victory' }
  | { phase: 'defeat'; cause: 'player_hp' | 'timeout' };

export interface CombatState {
  playerHp: number;
  enemyHp: number;
  combo: number;
  /** 마지막으로 확정한 비트. 아직 없으면 -1 */
  lastResolvedBeat: number;
  status: CombatStatus;
}

export type InputOutcome =
  | { kind: 'ignored_finished' }
  | { kind: 'duplicate_ignored'; beat: number }
  | { kind: 'attack_ignored_dodge_beat'; beat: number; result: AttackTiming }
  | { kind: 'dodge_no_effect'; beat: number; result: AttackTiming }
  /** 확정 후 도착한 공격 Miss: 콤보만 0 (D-07). */
  | { kind: 'late_miss_combo_reset'; beat: number }
  /** 확정 후 도착한 그 외 입력: 상태 변경 없음 (D-07). */
  | { kind: 'beat_already_resolved'; beat: number; result: AttackTiming }
  /** 버퍼에 저장됨. result가 최종 판정이며 HP·콤보 반영은 resolveBeat에서. */
  | { kind: 'pending'; beat: number; channel: InputChannel; result: AttackTiming; errorMs: number };

export type BeatResolution =
  | { kind: 'ignored_finished'; beat: number }
  | {
      kind: 'enemy_attack';
      beat: number;
      bpm: Bpm;
      comboResetByTempo: boolean;
      dodge: AttackTiming | 'none';
      playerDamage: number;
      state: CombatState;
    }
  | {
      kind: 'normal';
      beat: number;
      bpm: Bpm;
      comboResetByTempo: boolean;
      attack: AttackTiming | 'none';
      enemyDamage: number;
      state: CombatState;
    };

export interface CombatOptions {
  /** 테스트용. 기본값 INITIAL_BPM(100) */
  initialBpm?: Bpm;
  calibrationOffsetMs?: number;
}

/** 한 판 단위. 재시작 시 새 인스턴스를 생성한다. */
export class CombatSystem {
  private readonly timeline: BeatTimeline;
  private readonly judge: RhythmJudge;
  private readonly combo = new ComboSystem();
  private readonly tempo: TempoSystem;

  private playerHp = PLAYER_HP;
  private enemyHp = ENEMY_HP;
  private lastResolvedBeat = -1;
  private status: CombatStatus = { phase: 'playing' };

  /**
   * 비트별 채널 최초 판정 결과 (확정 전). 입력 시 판정을 그대로 사용한다.
   * 이미 판정된 입력의 비트 BPM은 바뀌지 않는다 (D-07b, TempoSystem 참조).
   */
  private readonly pending = new Map<number, Partial<Record<InputChannel, AttackTiming>>>();

  constructor(options: CombatOptions = {}) {
    this.timeline = new BeatTimeline(options.initialBpm ?? INITIAL_BPM);
    this.judge = new RhythmJudge(
      this.timeline,
      options.calibrationOffsetMs ?? CALIBRATION_OFFSET_DEFAULT_MS,
    );
    this.tempo = new TempoSystem(
      this.timeline,
      (beat) => this.effectiveCombo(beat),
      () => this.judge.getCalibrationOffset(),
    );
  }

  // ─── 읽기 전용 조회 ────────────────────────────────────────────────────

  /**
   * 현재 전투 상태. combo는 템포 요청 자격과 같은 유효 콤보다 (리뷰 T4-5#1):
   * 템포 적용 비트가 시작됐지만 아직 확정 전이면 0.
   * 승패 확정 후에는 시각과 무관하게 확정 시점 값을 반환한다.
   * @param nowSec 오디오 시계 기준 현재 시각(초). 음수(beat 0 이전)는 beat 0으로 본다:
   *   양의 캘리브레이션 오프셋이면 beat 0 확정이 입력 시간축 음수 시각에 가능하다.
   *   NaN/Infinity는 RangeError.
   */
  getState(nowSec: number): CombatState {
    const combo = this.isFinished()
      ? this.combo.value
      : this.effectiveCombo(this.timeline.currentBeatAt(Math.max(0, nowSec)));
    return {
      playerHp: this.playerHp,
      enemyHp: this.enemyHp,
      combo,
      lastResolvedBeat: this.lastResolvedBeat,
      status: { ...this.status },
    };
  }

  beatTime(beat: number): number {
    return this.timeline.beatTime(beat);
  }

  getBpmAtBeat(beat: number): Bpm {
    return this.timeline.getBpmAtBeat(beat);
  }

  // ─── 입력 ──────────────────────────────────────────────────────────────

  /**
   * 공격/회피 입력. 상태(HP·콤보)는 바꾸지 않고 버퍼에 저장한다(예외: D-07 late Miss).
   * @param inputSec 시간축 정렬된 입력 시각(초)
   */
  input(inputSec: number, channel: InputChannel): InputOutcome {
    if (this.isFinished()) return { kind: 'ignored_finished' };

    const j = this.judge.judge(inputSec, channel);
    if (j.result === 'duplicate_ignored') return { kind: 'duplicate_ignored', beat: j.beat };

    const enemyBeat = isEnemyAttackBeat(j.beat);
    if (channel === 'attack' && enemyBeat) {
      return { kind: 'attack_ignored_dodge_beat', beat: j.beat, result: j.result };
    }
    if (channel === 'dodge' && !enemyBeat) {
      return { kind: 'dodge_no_effect', beat: j.beat, result: j.result };
    }

    if (j.beat <= this.lastResolvedBeat) {
      // D-07: Good 윈도우가 닫힌 뒤(=확정 후) 도착한 입력은 Miss뿐이다.
      // Miss는 HP에 영향이 없으므로 3.2 "Miss 시 콤보 0"만 반영한다.
      if (channel === 'attack' && j.result === 'miss') {
        this.combo.reset();
        return { kind: 'late_miss_combo_reset', beat: j.beat };
      }
      return { kind: 'beat_already_resolved', beat: j.beat, result: j.result };
    }

    const slot = this.pending.get(j.beat) ?? {};
    slot[channel] = j.result;
    this.pending.set(j.beat, slot);
    return { kind: 'pending', beat: j.beat, channel, result: j.result, errorMs: j.errorMs };
  }

  /** 템포 업 요청. 현재 비트는 nowSec에서 계산한다 (D-05). */
  requestTempoUp(nowSec: number): TempoUpResult | { scheduled: false; reason: 'finished' } {
    if (this.isFinished()) return { scheduled: false, reason: 'finished' };
    return this.tempo.requestTempoUp(nowSec);
  }

  // ─── 비트 확정 ─────────────────────────────────────────────────────────

  /**
   * 비트 결과를 확정한다. 0, 1, 2, ... 순서로 호출해야 하며, 순서가 어긋나면 RangeError.
   * 보정 시각(nowSec + 캘리브레이션 오프셋) 기준으로 해당 비트의 Good 윈도우가
   * 닫히기 전(경계 포함)이면 RangeError (리뷰 T4-5#2). 입력 지연 여유는 호출자가 더한다.
   * @param nowSec 오디오 시계 기준 현재 시각(초)
   */
  resolveBeat(beat: number, nowSec: number): BeatResolution {
    if (this.isFinished()) return { kind: 'ignored_finished', beat };
    if (beat !== this.lastResolvedBeat + 1) {
      throw new RangeError(`resolveBeat out of order: expected ${this.lastResolvedBeat + 1}, got ${beat}`);
    }
    if (!Number.isFinite(nowSec)) {
      throw new RangeError(`Invalid time: ${nowSec}`);
    }

    const bpm = this.timeline.getBpmAtBeat(beat);
    // Good 윈도우는 경계 포함(<=, D-06)이므로 window + EPS를 넘어야 닫힌 것이다
    const correctedNowSec = nowSec + this.judge.getCalibrationOffset() / 1000;
    const msAfterBeat = (correctedNowSec - this.timeline.beatTime(beat)) * 1000;
    if (msAfterBeat <= GOOD_WINDOW_MS[bpm] + JUDGE_EPS_MS) {
      throw new RangeError(`resolveBeat(${beat}) before Good window closed: +${msAfterBeat}ms`);
    }

    const slot = this.pending.get(beat) ?? {};
    this.pending.delete(beat);
    this.lastResolvedBeat = beat;

    // 템포 변경이 실제 적용되는 비트 → 콤보 0 (3.2)
    const comboResetByTempo = this.isTempoApplyBeat(beat);
    if (comboResetByTempo) this.combo.reset();

    if (isEnemyAttackBeat(beat)) {
      // 적 공격 비트 → 회피 판정 → 피격 → 플레이어 HP 검사. 콤보 유지 (D-01)
      const dodge = slot.dodge ?? 'none';
      const playerDamage = dodge === 'perfect' ? 0 : ENEMY_ATTACK_DAMAGE;
      this.playerHp = Math.max(0, this.playerHp - playerDamage);
      if (this.playerHp === 0) this.status = { phase: 'defeat', cause: 'player_hp' };
      this.checkTimeout(beat);
      return { kind: 'enemy_attack', beat, bpm, comboResetByTempo, dodge, playerDamage, state: this.getState(nowSec) };
    }

    // 일반 비트 → 공격 판정 → 적 HP 검사. 미입력은 효과 없음 (3.1)
    const attack = slot.attack ?? 'none';
    let enemyDamage = 0;
    if (attack !== 'none') {
      this.combo.applyAttack(attack);
      enemyDamage = computeAttackDamage(bpm, attack);
      this.enemyHp = Math.max(0, this.enemyHp - enemyDamage);
      if (this.enemyHp === 0) this.status = { phase: 'victory' };
    }
    this.checkTimeout(beat);
    return { kind: 'normal', beat, bpm, comboResetByTempo, attack, enemyDamage, state: this.getState(nowSec) };
  }

  // ─── 내부 ──────────────────────────────────────────────────────────────

  private isFinished(): boolean {
    return this.status.phase !== 'playing';
  }

  /** 최대 120비트(beat 0~119) 확정 후에도 승패가 없으면 timeout 패배 (3.3, D-07) */
  private checkTimeout(beat: number): void {
    if (!this.isFinished() && beat >= MAX_BEATS - 1) {
      this.status = { phase: 'defeat', cause: 'timeout' };
    }
  }

  private isTempoApplyBeat(beat: number): boolean {
    return beat > 0 && this.timeline.getBpmAtBeat(beat) !== this.timeline.getBpmAtBeat(beat - 1);
  }

  /**
   * 현재 비트 기준 유효 콤보. 템포 적용 비트가 이미 시작됐지만 아직 확정 전이면
   * 콤보는 그 순간 0이 된 것이므로 0을 반환한다 (3.2).
   */
  private effectiveCombo(currentBeat: number): number {
    const resolvedBpm = this.timeline.getBpmAtBeat(Math.max(0, this.lastResolvedBeat));
    if (this.timeline.getBpmAtBeat(currentBeat) !== resolvedBpm) return 0;
    return this.combo.value;
  }
}
