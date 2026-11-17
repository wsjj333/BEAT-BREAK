/**
 * src/audio/metronome.ts
 * 오디오 시계 기반 메트로놈 (기획서 5장 "setTimeout은 재생 준비를 위한 보조 스케줄러").
 *
 * 25ms마다 깨어나 앞으로 100ms 안에 오는 비트를 AudioContext에 미리 예약한다.
 * 비트 시각은 매번 BeatTimeline(beatAudioTime)에서 새로 읽으므로 템포 변경을 그대로 따라간다.
 * setTimeout은 "언제 예약 작업을 할지"만 정하며, 소리 시각·판정 시각에는 쓰이지 않는다.
 *
 * 템포 변경과 예약의 안전성: 템포 변경은 미래 마디 경계 비트 b에 적용되고 b 자신의 시각은
 * 바뀌지 않는다. 바뀌는 건 b+1 이후(≥ 60/140초 ≈ 429ms 뒤)이므로 100ms 선행 예약과 겹치지 않는다.
 */

import { BEATS_PER_BAR } from '../core/config';

export const SCHEDULER_INTERVAL_MS = 25;
export const SCHEDULE_AHEAD_SEC = 0.1;

export interface MetronomeDeps {
  /** 오디오 시계 현재 시각(초) */
  audioNow(): number;
  /** 비트의 오디오 시계 시각(초). 원점 + BeatTimeline 시각 */
  beatAudioTime(beat: number): number;
  /** 지정 오디오 시각에 클릭 1회 예약 */
  playClick(audioTime: number, accent: boolean): void;
  /** 마지막으로 소리를 낼 비트 (포함) */
  lastBeat: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export class Metronome {
  private nextBeat = 0;
  private timer: unknown = null;
  private running = false;

  constructor(private readonly deps: MetronomeDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** 다음에 예약할 비트 (테스트·디버그용) */
  get nextScheduledBeat(): number {
    return this.nextBeat;
  }

  /** 앞으로 SCHEDULE_AHEAD_SEC 안에 오는 비트를 예약한다. 이미 지난 비트는 소리 없이 건너뛴다. */
  tick(): void {
    const now = this.deps.audioNow();
    while (this.nextBeat <= this.deps.lastBeat) {
      const t = this.deps.beatAudioTime(this.nextBeat);
      if (t >= now + SCHEDULE_AHEAD_SEC) break;
      if (t >= now) this.deps.playClick(t, this.nextBeat % BEATS_PER_BAR === 0);
      this.nextBeat++;
    }
    if (this.nextBeat > this.deps.lastBeat) this.stop();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.tick();
    if (this.running) this.timer = this.deps.setTimer(this.loop, SCHEDULER_INTERVAL_MS);
  };
}

/** Web Audio 오실레이터 클릭. 마디 첫 박(accent)은 높은 음. */
export function createClickPlayer(ctx: AudioContext): (audioTime: number, accent: boolean) => void {
  return (audioTime, accent) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.5, audioTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(audioTime);
    osc.stop(audioTime + 0.06);
  };
}
