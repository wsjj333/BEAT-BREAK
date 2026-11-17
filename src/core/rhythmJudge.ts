/**
 * src/core/rhythmJudge.ts
 * 입력 시각 → 비트 배정 → Perfect/Good/Miss 판정. 기획서 3.1 / 3.5 기준.
 * Phaser/DOM/Web Audio 직접 참조 금지. 시간은 인자로 주입한다.
 *
 * 범위 밖(다른 태스크): 적 공격 비트 처리(D-01), 콤보, 피해.
 */

import type { BeatTimeline } from './beatTimeline';
import {
  CALIBRATION_OFFSET_DEFAULT_MS,
  CALIBRATION_OFFSET_MAX_MS,
  CALIBRATION_OFFSET_MIN_MS,
  CALIBRATION_OFFSET_STEP_MS,
  GOOD_WINDOW_MS,
  JUDGE_EPS_MS,
  PERFECT_WINDOW_MS,
} from './config';

export type InputChannel = 'attack' | 'dodge';

export type JudgeResult =
  | { beat: number; result: 'perfect' | 'good' | 'miss'; errorMs: number }
  | { beat: number; result: 'duplicate_ignored' };

/**
 * 한 판 단위로 사용한다. 판정 기록(채널별 판정한 비트)은 초기화하지 않으므로
 * 재시작 시 새 인스턴스를 생성한다.
 */
export class RhythmJudge {
  private offsetMs: number = CALIBRATION_OFFSET_DEFAULT_MS;

  /** 채널별로 이미 판정한 비트 (Miss 포함) */
  private readonly judgedBeats: Record<InputChannel, Set<number>> = {
    attack: new Set(),
    dodge: new Set(),
  };

  constructor(
    private readonly timeline: BeatTimeline,
    calibrationOffsetMs: number = CALIBRATION_OFFSET_DEFAULT_MS,
  ) {
    this.setCalibrationOffset(calibrationOffsetMs);
  }

  /**
   * 캘리브레이션 오프셋(ms)을 설정한다.
   * -200~+200 범위의 10ms 단위 정수만 허용. 그 외는 RangeError (D-03 진입점 검증 원칙).
   */
  setCalibrationOffset(ms: number): void {
    if (
      !Number.isInteger(ms) ||
      ms < CALIBRATION_OFFSET_MIN_MS ||
      ms > CALIBRATION_OFFSET_MAX_MS ||
      ms % CALIBRATION_OFFSET_STEP_MS !== 0
    ) {
      throw new RangeError(`Invalid calibration offset: ${ms}ms`);
    }
    this.offsetMs = ms;
  }

  getCalibrationOffset(): number {
    return this.offsetMs;
  }

  /**
   * 입력을 판정한다.
   * @param inputSec 시간축 정렬된 입력 시각(초). 캘리브레이션 오프셋은 여기서 더한다.
   * @param channel 입력 채널. 채널마다 비트당 최초 1회만 판정하며 Miss도 기회를 소모한다.
   */
  judge(inputSec: number, channel: InputChannel): JudgeResult {
    // 보정된 입력시각 = 시간축 정렬된 입력시각 + 캘리브레이션 오프셋 (3.1)
    const correctedSec = inputSec + this.offsetMs / 1000;
    const { beat, errorMs } = this.timeline.nearestBeat(correctedSec);

    const judged = this.judgedBeats[channel];
    if (judged.has(beat)) {
      return { beat, result: 'duplicate_ignored' };
    }
    judged.add(beat);

    // 판정 윈도우는 해당 비트의 BPM 기준
    const bpm = this.timeline.getBpmAtBeat(beat);
    const absErr = Math.abs(errorMs);

    // 경계값 포함(<=), Perfect 우선. 부동소수점 오차는 JUDGE_EPS_MS로 흡수 (D-06)
    if (absErr <= PERFECT_WINDOW_MS[bpm] + JUDGE_EPS_MS) {
      return { beat, result: 'perfect', errorMs };
    }
    if (absErr <= GOOD_WINDOW_MS[bpm] + JUDGE_EPS_MS) {
      return { beat, result: 'good', errorMs };
    }
    return { beat, result: 'miss', errorMs };
  }
}
