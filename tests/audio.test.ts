import { describe, it, expect } from 'vitest';
import { eventTimeToAudioSec } from '../src/audio/audioClock';
import { Metronome, SCHEDULE_AHEAD_SEC } from '../src/audio/metronome';
import { BeatTimeline } from '../src/core/beatTimeline';

describe('eventTimeToAudioSec', () => {
  it('audioNow - (perfNow - eventTimeStamp)/1000', () => {
    expect(eventTimeToAudioSec(10, 5000, 4980)).toBeCloseTo(9.98, 12);
    expect(eventTimeToAudioSec(10, 5000, 5000)).toBe(10);
  });
});

/** 가짜 오디오 시계 + 수동 타이머로 메트로놈 예약을 검증 */
function harness(beatTime: (b: number) => number, lastBeat = 119) {
  let now = 0;
  const clicks: { t: number; accent: boolean }[] = [];
  let pending: (() => void) | null = null;
  const m = new Metronome({
    audioNow: () => now,
    beatAudioTime: beatTime,
    playClick: (t, accent) => clicks.push({ t, accent }),
    lastBeat,
    setTimer: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  return {
    m,
    clicks,
    advance(to: number) {
      // 25ms마다 깨어나는 루프를 흉내 (setTimeout 지연과 무관하게 시각은 audioNow에서 읽음)
      while (now < to) {
        now = Math.min(to, now + 0.025);
        const fn = pending;
        pending = null;
        fn?.();
      }
    },
  };
}

describe('Metronome', () => {
  it('앞으로 100ms 안의 비트만 예약하고, 마디 첫 박은 accent', () => {
    const tl = new BeatTimeline(100);
    const h = harness((b) => 1 + tl.beatTime(b));
    h.m.start();
    expect(h.clicks).toEqual([]); // beat 0 = 1.0s, now = 0
    h.advance(0.9);
    expect(h.clicks).toHaveLength(0);
    h.advance(0.925);
    expect(h.clicks).toEqual([{ t: 1, accent: true }]);
    h.advance(3.5);
    expect(h.clicks.map((c) => c.accent)).toEqual([true, false, false, false, true]);
    for (const c of h.clicks) expect(c.t).toBeGreaterThan(0); // 과거 시각 예약 없음
  });

  it('템포 변경 후 비트 시각을 따라간다 (beat 8부터 120BPM)', () => {
    const tl = new BeatTimeline(100);
    const h = harness((b) => tl.beatTime(b));
    h.m.start();
    h.advance(3.0); // beat 5 (3.0s) 부근
    tl.requestTempo(120, 5);
    h.advance(7);
    const times = h.clicks.map((c) => c.t);
    expect(times[8]).toBeCloseTo(4.8, 9);
    expect(times[9]).toBeCloseTo(5.3, 9);
  });

  it('이미 지난 비트는 소리 없이 건너뛴다 (백그라운드 탭 복귀 등)', () => {
    const tl = new BeatTimeline(100);
    const h = harness((b) => tl.beatTime(b));
    // start 전에 시계가 2.0s까지 흐름 → beat 0~3은 지남
    h.advance(2.0);
    h.m.start();
    expect(h.clicks).toHaveLength(0);
    expect(h.m.nextScheduledBeat).toBe(4);
    h.advance(2.4 - SCHEDULE_AHEAD_SEC + 0.01);
    expect(h.clicks).toEqual([{ t: 2.4, accent: true }]);
  });

  it('lastBeat까지만 예약하고 멈춘다', () => {
    const tl = new BeatTimeline(100);
    const h = harness((b) => tl.beatTime(b), 3);
    h.m.start();
    h.advance(5);
    expect(h.clicks).toHaveLength(4);
  });
});
