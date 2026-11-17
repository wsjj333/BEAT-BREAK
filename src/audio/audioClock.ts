/**
 * src/audio/audioClock.ts
 * AudioContext.currentTime을 게임의 유일한 시간 기준으로 제공한다 (기획서 3.1, 5장).
 */

/**
 * 입력 이벤트 타임스탬프(performance 시간축, ms)를 오디오 시계(초)로 변환한다.
 * audioNowSec와 perfNowMs는 같은 순간에 읽은 값이어야 한다.
 * 결과 = audioNow - (perfNow - eventTimeStamp) / 1000
 */
export function eventTimeToAudioSec(
  audioNowSec: number,
  perfNowMs: number,
  eventTimeStampMs: number,
): number {
  return audioNowSec - (perfNowMs - eventTimeStampMs) / 1000;
}

export class AudioClock {
  private constructor(readonly ctx: AudioContext) {}

  /**
   * 반드시 사용자 제스처(클릭) 핸들러 안에서 동기적으로 호출한다 (브라우저 자동재생 정책).
   * AudioContext를 만들고 resume이 끝나 시계가 흐르기 시작하면 resolve.
   */
  static async startFromGesture(): Promise<AudioClock> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state !== 'running') await ctx.resume();
    return new AudioClock(ctx);
  }

  /** 오디오 시계 현재 시각(초) */
  now(): number {
    return this.ctx.currentTime;
  }

  /** KeyboardEvent.timeStamp(ms) → 오디오 시계(초) */
  eventToAudioSec(eventTimeStampMs: number): number {
    return eventTimeToAudioSec(this.ctx.currentTime, performance.now(), eventTimeStampMs);
  }
}
