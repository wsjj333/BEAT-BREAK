/**
 * src/core/tempoSystem.ts
 * 템포 업 요청 처리. 기획서 3.2 / D-05 / D-07 기준.
 *
 * D-05: 현재 비트는 호출자가 넘기지 않고 nowSec(오디오 시계)에서 직접 계산한다.
 * BeatTimeline.requestTempo를 호출하는 유일한 모듈이다.
 */

import type { BeatTimeline } from './beatTimeline';
import {
  COMBO_THRESHOLD_TEMPO_UP,
  GOOD_WINDOW_MS,
  JUDGE_EPS_MS,
  nextBarBoundary,
  nextTempo,
} from './config';

export type TempoUpResult =
  | { scheduled: true; currentBeat: number; applyAtBeat: number }
  | { scheduled: false; currentBeat: number; reason: string };

export class TempoSystem {
  /**
   * @param comboAt 현재 비트 기준 유효 콤보. 템포 적용 비트가 시작됐지만 아직 확정 전이면
   *   0이어야 한다(3.2 "적용되는 순간 콤보 0", D-07c). CombatSystem이 제공한다.
   * @param calibrationOffsetMs 입력 판정에 쓰는 캘리브레이션 오프셋(ms). D-07b 참조.
   */
  constructor(
    private readonly timeline: BeatTimeline,
    private readonly comboAt: (currentBeat: number) => number,
    private readonly calibrationOffsetMs: () => number,
  ) {}

  /**
   * 템포 업을 요청한다. 거절 사유 우선순위: combo_too_low → (BeatTimeline) at_max → pending.
   * @param nowSec 입력과 같은 시간축(오디오 시계)의 현재 시각(초)
   */
  requestTempoUp(nowSec: number): TempoUpResult {
    const currentBeat = this.timeline.currentBeatAt(nowSec);

    // 콤보 5 이상일 때만 BeatTimeline.requestTempo 호출 (3.2)
    if (this.comboAt(currentBeat) < COMBO_THRESHOLD_TEMPO_UP) {
      return { scheduled: false, currentBeat, reason: 'combo_too_low' };
    }

    const currentBpm = this.timeline.getBpmAtBeat(currentBeat);

    // D-07b: 다음 마디 경계 비트의 Good 윈도우(현재 BPM 기준)가 이미 열렸으면
    // 그 비트에 대한 입력이 옛 BPM 윈도우로 판정됐을 수 있으므로 그다음 경계로 미룬다.
    // 입력 판정과 같은 기준이 되도록 보정된 시각(now + 캘리브레이션 오프셋)으로 비교한다.
    // 경계 포함(<=): Good 윈도우 시작 시각 정각이면 이미 열린 것으로 본다.
    const boundary = nextBarBoundary(currentBeat);
    const correctedNowSec = nowSec + this.calibrationOffsetMs() / 1000;
    const msUntilBoundary = (this.timeline.beatTime(boundary) - correctedNowSec) * 1000;
    const windowOpened = msUntilBoundary <= GOOD_WINDOW_MS[currentBpm] + JUDGE_EPS_MS;

    // 최대 BPM이면 next가 null → 현재 BPM을 넘겨 BeatTimeline이 at_max로 거절하게 한다
    const target = nextTempo(currentBpm) ?? currentBpm;
    const r = this.timeline.requestTempo(target, currentBeat, windowOpened);
    return r.scheduled
      ? { scheduled: true, currentBeat, applyAtBeat: r.applyAtBeat }
      : { scheduled: false, currentBeat, reason: r.reason };
  }
}
