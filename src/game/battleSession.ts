/**
 * src/game/battleSession.ts
 * 한 판의 진행 접착층: CombatSystem 호출 + 비트 확정 타이밍 + 텔레메트리.
 * Phaser/DOM/Web Audio를 참조하지 않는다 → 시간을 주입해 테스트할 수 있다.
 *
 * 시간축: 모든 nowSec/inputSec는 "오디오 시계 - 원점"(초). 원점 = beat 0의 오디오 시계 시각.
 * 원점 차감은 같은 시계의 상수 이동일 뿐이며 프레임 델타·setTimeout은 쓰지 않는다.
 */

import { type BeatResolution, CombatSystem, type CombatState, type InputOutcome } from '../core/combatSystem';
import {
  type Bpm,
  COMBO_THRESHOLD_TEMPO_UP,
  GOOD_WINDOW_MS,
  JUDGE_EPS_MS,
  MAX_BEATS,
  MAX_BPM,
  RESOLVE_MARGIN_MS,
} from '../core/config';
import type { InputChannel } from '../core/rhythmJudge';
import { type RunRecord, RunTelemetry, type TempoRequestOutcome } from '../telemetry/runTelemetry';

export interface BattleSessionOptions {
  calibrationOffsetMs: number;
  runId: string;
  startedAt: string;
  resolveMarginMs?: number;
}

export type TempoStatus =
  | { kind: 'available' }
  | { kind: 'combo_too_low'; need: number }
  | { kind: 'pending'; applyAtBeat: number; bpm: Bpm }
  | { kind: 'at_max' }
  | { kind: 'not_started' }
  | { kind: 'finished' };

export class BattleSession {
  readonly combat: CombatSystem;
  readonly telemetry: RunTelemetry;
  readonly calibrationOffsetMs: number;
  readonly resolveMarginMs: number;

  private pendingTempo: { applyAtBeat: number } | null = null;
  private tempoWasAvailable = false;
  private record: RunRecord | null = null;

  constructor(opts: BattleSessionOptions) {
    this.calibrationOffsetMs = opts.calibrationOffsetMs;
    this.resolveMarginMs = opts.resolveMarginMs ?? RESOLVE_MARGIN_MS;
    this.combat = new CombatSystem({ calibrationOffsetMs: opts.calibrationOffsetMs });
    this.telemetry = new RunTelemetry({
      runId: opts.runId,
      startedAt: opts.startedAt,
      calibrationOffsetMs: opts.calibrationOffsetMs,
      resolveMarginMs: this.resolveMarginMs,
    });
  }

  /** 승패 확정 후 1회 생성되는 기록. 진행 중이면 null */
  get finishedRecord(): RunRecord | null {
    return this.record;
  }

  getState(nowSec: number): CombatState {
    return this.combat.getState(nowSec);
  }

  /**
   * 화면 표시용 현재 비트: beatTime(b) <= nowSec인 가장 큰 b. beat 0 이전이면 -1.
   * 판정에는 쓰지 않는다 (판정은 core가 입력 시각으로 직접 한다).
   */
  displayBeat(nowSec: number): number {
    if (nowSec < this.combat.beatTime(0)) return -1;
    // beatTime은 단조 증가 → 0..MAX_BEATS 이분 탐색
    let lo = 0;
    let hi = MAX_BEATS;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.combat.beatTime(mid) <= nowSec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 공격/회피 입력. inputSec = 이벤트 타임스탬프를 오디오 시계로 변환 후 원점 차감한 값 */
  input(inputSec: number, channel: InputChannel): InputOutcome {
    const outcome = this.combat.input(inputSec, channel);
    this.telemetry.recordInput(inputSec, channel, outcome, (b) => this.combat.getBpmAtBeat(b));
    return outcome;
  }

  /**
   * 템포 업 요청. beat 0 이전(nowSec < 0)에는 core의 currentBeatAt이 음수 시각을 받지 않으므로
   * core를 호출하지 않고 'not_started'로 거절한다.
   */
  requestTempoUp(nowSec: number): TempoRequestOutcome {
    const state = this.combat.getState(nowSec);
    const beat = this.displayBeat(nowSec);
    const bpm = beat >= 0 ? this.combat.getBpmAtBeat(beat) : null;
    const r: TempoRequestOutcome =
      nowSec < 0 ? { scheduled: false, reason: 'not_started' } : this.combat.requestTempoUp(nowSec);
    if (r.scheduled) this.pendingTempo = { applyAtBeat: r.applyAtBeat };
    this.telemetry.recordTempoRequest(nowSec, bpm, state.combo, r);
    return r;
  }

  /** 화면 표시용 템포 업 가능 여부. 실제 허용 여부는 requestTempoUp에서 core가 결정한다. */
  tempoStatus(nowSec: number): TempoStatus {
    const state = this.combat.getState(nowSec);
    if (state.status.phase !== 'playing') return { kind: 'finished' };
    const beat = this.displayBeat(nowSec);
    if (beat < 0) return { kind: 'not_started' };
    if (this.pendingTempo && beat < this.pendingTempo.applyAtBeat) {
      const at = this.pendingTempo.applyAtBeat;
      return { kind: 'pending', applyAtBeat: at, bpm: this.combat.getBpmAtBeat(at) };
    }
    if (this.combat.getBpmAtBeat(beat) === MAX_BPM) return { kind: 'at_max' };
    if (state.combo < COMBO_THRESHOLD_TEMPO_UP) return { kind: 'combo_too_low', need: COMBO_THRESHOLD_TEMPO_UP };
    return { kind: 'available' };
  }

  /**
   * 매 프레임 호출. 보정 시각 기준 Good 윈도우 종료 + RESOLVE_MARGIN_MS가 지난 비트를
   * 순서대로 확정한다. 한 프레임에 여러 비트가 밀려 있으면 모두 확정한다.
   * @returns 이번 호출에서 확정된 비트 결과
   */
  update(nowSec: number): BeatResolution[] {
    const out: BeatResolution[] = [];
    if (this.record) return out;

    const correctedNowSec = nowSec + this.calibrationOffsetMs / 1000;
    let state = this.combat.getState(nowSec);
    while (state.status.phase === 'playing') {
      const beat = state.lastResolvedBeat + 1;
      if (beat >= MAX_BEATS) break;
      const bpm = this.combat.getBpmAtBeat(beat);
      const msAfterBeat = (correctedNowSec - this.combat.beatTime(beat)) * 1000;
      if (msAfterBeat <= GOOD_WINDOW_MS[bpm] + JUDGE_EPS_MS + this.resolveMarginMs) break;
      const r = this.combat.resolveBeat(beat, nowSec);
      this.telemetry.recordResolution(nowSec, r);
      out.push(r);
      state = this.combat.getState(nowSec);
    }

    if (state.status.phase !== 'playing') {
      this.record = this.telemetry.finish(nowSec, state.status, state.lastResolvedBeat);
      return out;
    }

    // 템포 업 기회: 불가 → 가능 전환 1회를 기회 1회로 센다 (D-08(c))
    const available = this.tempoStatus(nowSec).kind === 'available';
    if (available && !this.tempoWasAvailable) {
      const beat = this.displayBeat(nowSec);
      this.telemetry.recordTempoOpportunity(nowSec, beat, this.combat.getBpmAtBeat(beat), state.combo);
    }
    this.tempoWasAvailable = available;
    return out;
  }
}
