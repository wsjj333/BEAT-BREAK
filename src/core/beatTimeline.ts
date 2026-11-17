/**
 * src/core/beatTimeline.ts
 * 비트 시각 계산과 템포 변경 예약을 담당하는 순수 로직 모듈.
 * 기획서 3.1/3.2 기준. Phaser/DOM/Web Audio 직접 참조 금지.
 */

import {
  BEATS_PER_BAR,
  type Bpm,
  INITIAL_BPM,
  MAX_BPM,
  MIDPOINT_EPS_SEC,
  beatDurationSec,
  nextBarBoundary,
  nextTempo,
} from './config';

export interface TempoSegment {
  startBeat: number;
  bpm: Bpm;
  startTime: number;
}

export class BeatTimeline {
  private segments: TempoSegment[];

  constructor(initialBpm: Bpm = INITIAL_BPM) {
    this.segments = [{ startBeat: 0, bpm: initialBpm, startTime: 0 }];
  }

  /** 해당 비트의 절대 시각(초)을 반환 */
  beatTime(beat: number): number {
    this.validateBeat(beat);
    const seg = this.segmentForBeat(beat);
    return seg.startTime + (beat - seg.startBeat) * beatDurationSec(seg.bpm);
  }

  /** t에 가장 가까운 비트 번호와 오차(ms, 부호 포함)를 반환 */
  nearestBeat(t: number): { beat: number; errorMs: number } {
    if (!Number.isFinite(t)) {
      throw new RangeError(`Invalid time: ${t}`);
    }

    if (t < 0) {
      return { beat: 0, errorMs: t * 1000 };
    }

    const seg = this.segmentForTime(t);
    const dur = beatDurationSec(seg.bpm);
    const fractional = (t - seg.startTime) / dur + seg.startBeat;

    const lo = Math.floor(fractional);
    const hi = lo + 1;

    const tLo = this.beatTime(lo);
    const distLo = t - tLo;

    // hi가 다음 segment에 속할 수 있으므로 beatTime으로 계산
    const tHi = this.beatTime(hi);
    const distHi = tHi - t;

    // 중간값 판정: lo까지 거리가 hi까지 거리보다 EPS 이내로 크면 이전 비트 선택 (D-04)
    if (distLo - distHi <= MIDPOINT_EPS_SEC) {
      return { beat: lo, errorMs: distLo * 1000 };
    }
    return { beat: hi, errorMs: (t - tHi) * 1000 };
  }

  /**
   * 시각 t에 이미 시작된 가장 최근 비트 번호(현재 비트)를 반환한다. D-05/D-07 참조.
   * nearestBeat와 달리 반올림하지 않는다 → 반환 비트는 항상 t 이전(또는 같은) 시각이다.
   * 비트 시각과의 부동소수점 오차는 MIDPOINT_EPS_SEC로 흡수한다.
   */
  currentBeatAt(t: number): number {
    if (!Number.isFinite(t) || t < 0) {
      throw new RangeError(`Invalid time: ${t}`);
    }
    const seg = this.segmentForTime(t);
    let beat = seg.startBeat + Math.floor((t - seg.startTime) / beatDurationSec(seg.bpm));
    if (this.beatTime(beat + 1) - t <= MIDPOINT_EPS_SEC) beat += 1;
    else if (this.beatTime(beat) - t > MIDPOINT_EPS_SEC) beat -= 1;
    return beat;
  }

  /**
   * 템포 변경을 예약한다.
   * D-05: TempoSystem 전용. 다른 모듈은 호출하지 않는다 (tests/tempoSystem.test.ts 구조 테스트).
   * 거절 사유 우선순위: at_max → pending → invalid_step
   * @param deferOneBar true면 다음 마디 경계가 아닌 그다음 경계에 적용 (D-07b).
   *   대기 중 판정(pending)은 항상 실제 currentBeat 기준이다.
   */
  requestTempo(
    bpm: Bpm,
    currentBeat: number,
    deferOneBar = false,
  ):
    | { scheduled: false; reason: string }
    | { scheduled: true; applyAtBeat: number } {
    this.validateBeat(currentBeat);

    const currentBpm = this.getBpmAtBeat(currentBeat);

    if (currentBpm === MAX_BPM) {
      return { scheduled: false, reason: 'at_max' };
    }

    // 대기 중인 변경이 있는지 확인
    const lastSeg = this.segments[this.segments.length - 1];
    if (lastSeg.startBeat > currentBeat) {
      return { scheduled: false, reason: 'pending' };
    }

    const next = nextTempo(currentBpm);
    if (next === null || bpm !== next) {
      return { scheduled: false, reason: 'invalid_step' };
    }

    const applyAtBeat = nextBarBoundary(currentBeat) + (deferOneBar ? BEATS_PER_BAR : 0);
    const applyAtTime = this.beatTime(applyAtBeat);

    this.segments.push({
      startBeat: applyAtBeat,
      bpm,
      startTime: applyAtTime,
    });

    return { scheduled: true, applyAtBeat };
  }

  /** 해당 비트의 BPM을 반환 */
  getBpmAtBeat(beat: number): Bpm {
    return this.segmentForBeat(beat).bpm;
  }

  private validateBeat(beat: number): void {
    if (!Number.isInteger(beat) || beat < 0) {
      throw new RangeError(`Invalid beat number: ${beat}`);
    }
  }

  /** beat가 속한 segment를 반환 (역순 탐색) */
  private segmentForBeat(beat: number): TempoSegment {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].startBeat <= beat) {
        return this.segments[i];
      }
    }
    return this.segments[0];
  }

  /** 시각 t가 속한 segment를 반환 (역순 탐색) */
  private segmentForTime(t: number): TempoSegment {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].startTime <= t) {
        return this.segments[i];
      }
    }
    return this.segments[0];
  }
}
