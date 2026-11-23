import { describe, it, expect } from 'vitest';
import { BeatTimeline } from '../src/core/beatTimeline';
import { RhythmJudge } from '../src/core/rhythmJudge';
import type { Bpm } from '../src/core/config';

/**
 * 기대값은 config가 아닌 기획서 3.5의 숫자를 그대로 적는다 (입력→결과 검증).
 * 경계 안쪽 1ms(89/159 등)는 리뷰 T3#2로 추가: 비교 연산자 회귀 방지.
 */
const VECTORS: Array<{ bpm: Bpm; beatSec: number; cases: Array<[number, string]> }> = [
  {
    bpm: 100,
    beatSec: 0.6,
    cases: [[89, 'perfect'], [90, 'perfect'], [91, 'good'], [159, 'good'], [160, 'good'], [161, 'miss']],
  },
  {
    bpm: 120,
    beatSec: 0.5,
    cases: [[74, 'perfect'], [75, 'perfect'], [76, 'good'], [134, 'good'], [135, 'good'], [136, 'miss']],
  },
  {
    bpm: 140,
    beatSec: 60 / 140,
    cases: [[59, 'perfect'], [60, 'perfect'], [61, 'good'], [109, 'good'], [110, 'good'], [111, 'miss']],
  },
];

describe('RhythmJudge — 3.5 판정 벡터', () => {
  for (const { bpm, beatSec, cases } of VECTORS) {
    for (const [ms, expected] of cases) {
      for (const sign of [1, -1]) {
        const signed = sign * ms;

        it(`${bpm}BPM beat 0 기준 ${signed > 0 ? '+' : ''}${signed}ms → ${expected}`, () => {
          const judge = new RhythmJudge(new BeatTimeline(bpm));
          const r = judge.judge(signed / 1000, 'attack');
          expect(r).toMatchObject({ beat: 0, result: expected });
          if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(signed);
        });

        // beat 0 음수 쪽은 t<0 경로이므로, 일반 경로를 beat 1에서도 확인
        it(`${bpm}BPM beat 1 기준 ${signed > 0 ? '+' : ''}${signed}ms → ${expected}`, () => {
          const judge = new RhythmJudge(new BeatTimeline(bpm));
          const r = judge.judge(beatSec + signed / 1000, 'attack');
          expect(r).toMatchObject({ beat: 1, result: expected });
          if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(signed);
        });
      }
    }
  }
});

describe('RhythmJudge — 비트당 1회 판정', () => {
  it('같은 비트 첫 Miss 후 Perfect → duplicate_ignored', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    // beat 2 = 1.2s
    expect(judge.judge(1.2 + 0.2, 'attack')).toMatchObject({ beat: 2, result: 'miss' });
    expect(judge.judge(1.2, 'attack')).toEqual({ beat: 2, result: 'duplicate_ignored' });
  });

  it('첫 Perfect 후 재입력도 duplicate_ignored', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    expect(judge.judge(1.2, 'attack')).toMatchObject({ beat: 2, result: 'perfect' });
    expect(judge.judge(1.21, 'attack')).toEqual({ beat: 2, result: 'duplicate_ignored' });
  });

  it('다른 비트는 영향 없음', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    judge.judge(1.2, 'attack');
    expect(judge.judge(1.8, 'attack')).toMatchObject({ beat: 3, result: 'perfect' });
  });

  it('D-10: 판정 기록은 박자 단위 — 첫 입력(채널 무관)만 판정, 이후 공격·회피 모두 duplicate', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    expect(judge.judge(1.2 + 0.2, 'attack')).toMatchObject({ beat: 2, result: 'miss' });
    expect(judge.judge(1.2 + 0.1, 'dodge')).toEqual({ beat: 2, result: 'duplicate_ignored' });
    expect(judge.judge(1.2, 'attack')).toEqual({ beat: 2, result: 'duplicate_ignored' });
    expect(judge.judge(1.2, 'dodge')).toEqual({ beat: 2, result: 'duplicate_ignored' });
  });

  it('D-10: 회피가 먼저면 같은 비트의 공격은 duplicate, 다른 비트는 영향 없음', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    expect(judge.judge(1.2, 'dodge')).toMatchObject({ beat: 2, result: 'perfect' });
    expect(judge.judge(1.2, 'attack')).toEqual({ beat: 2, result: 'duplicate_ignored' });
    expect(judge.judge(1.8, 'attack')).toMatchObject({ beat: 3, result: 'perfect' });
  });
});

describe('RhythmJudge — 템포 경계', () => {
  // 100BPM에서 beat 6에 120 요청 → beat 8 (4.8s)부터 120BPM
  const setup = () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6);
    return new RhythmJudge(tl);
  };

  it('beat 8 +76ms → good (120BPM 윈도우; 100BPM이면 perfect)', () => {
    expect(setup().judge(4.8 + 0.076, 'attack')).toMatchObject({ beat: 8, result: 'good' });
  });

  it('beat 8 -76ms → good', () => {
    expect(setup().judge(4.8 - 0.076, 'attack')).toMatchObject({ beat: 8, result: 'good' });
  });

  it('beat 8 +136ms → miss (100BPM이면 good)', () => {
    expect(setup().judge(4.8 + 0.136, 'attack')).toMatchObject({ beat: 8, result: 'miss' });
  });

  it('beat 8 ±75ms → perfect', () => {
    // D-10: 같은 비트는 첫 입력만 판정하므로 부호마다 새 판정기
    expect(setup().judge(4.8 + 0.075, 'attack')).toMatchObject({ beat: 8, result: 'perfect' });
    expect(setup().judge(4.8 - 0.075, 'dodge')).toMatchObject({ beat: 8, result: 'perfect' });
  });

  it('beat 7은 기존 100BPM 윈도우 유지 (+90 perfect, -91 good)', () => {
    expect(setup().judge(4.2 + 0.09, 'attack')).toMatchObject({ beat: 7, result: 'perfect' });
    expect(setup().judge(4.2 - 0.091, 'attack')).toMatchObject({ beat: 7, result: 'good' });
  });
});

describe('RhythmJudge — 캘리브레이션 오프셋', () => {
  it('기본값 0ms', () => {
    expect(new RhythmJudge(new BeatTimeline(100)).getCalibrationOffset()).toBe(0);
  });

  it('+50ms: beat 2 -50ms 입력 → 보정 후 0ms, perfect', () => {
    const judge = new RhythmJudge(new BeatTimeline(100), 50);
    const r = judge.judge(1.2 - 0.05, 'attack');
    expect(r).toMatchObject({ beat: 2, result: 'perfect' });
    if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(0);
  });

  it('+50ms: beat 2 +41ms 입력 → 보정 후 +91ms, good (오프셋 0이면 perfect)', () => {
    const withOffset = new RhythmJudge(new BeatTimeline(100), 50);
    const without = new RhythmJudge(new BeatTimeline(100));
    expect(withOffset.judge(1.2 + 0.041, 'attack')).toMatchObject({ beat: 2, result: 'good' });
    expect(without.judge(1.2 + 0.041, 'attack')).toMatchObject({ beat: 2, result: 'perfect' });
  });

  it('+50ms: beat 2 -211ms 입력 → 보정 후 errorMs -161ms, miss', () => {
    const judge = new RhythmJudge(new BeatTimeline(100), 50);
    const r = judge.judge(1.2 - 0.211, 'attack');
    expect(r).toMatchObject({ beat: 2, result: 'miss' });
    if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(-161);
  });

  it('setCalibrationOffset로 변경 후 판정 이동', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    judge.setCalibrationOffset(50);
    expect(judge.judge(1.2 + 0.041, 'attack')).toMatchObject({ beat: 2, result: 'good' });
  });

  it('범위 경계 -200, +200 허용', () => {
    const judge = new RhythmJudge(new BeatTimeline(100));
    expect(() => judge.setCalibrationOffset(-200)).not.toThrow();
    expect(() => judge.setCalibrationOffset(200)).not.toThrow();
  });

  it.each([-210, 210, 55, 5, -1, 0.5, NaN, Infinity])('잘못된 오프셋 %s → RangeError', (ms) => {
    expect(() => new RhythmJudge(new BeatTimeline(100), ms)).toThrow(RangeError);
    const judge = new RhythmJudge(new BeatTimeline(100), 30);
    expect(() => judge.setCalibrationOffset(ms)).toThrow(RangeError);
    expect(judge.getCalibrationOffset()).toBe(30); // 거부 시 기존 값 유지
  });
});

describe('RhythmJudge — 120→140 템포 경계 (리뷰 T3#1)', () => {
  // 실제 플레이 경로: 100 시작 → beat 6에 120 요청(beat 8, 4.8s 적용)
  // → beat 10에 140 요청(beat 12 적용). beat 11 = 6.3s, beat 12 = 6.8s
  const setup = () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6);
    tl.requestTempo(140, 10);
    return new RhythmJudge(tl);
  };

  const beat12: Array<[number, string]> = [
    [60, 'perfect'], [61, 'good'], [110, 'good'], [111, 'miss'],
  ];
  for (const [ms, expected] of beat12) {
    for (const sign of [1, -1]) {
      const signed = sign * ms;
      it(`beat 12 ${signed > 0 ? '+' : ''}${signed}ms → ${expected} (140BPM 윈도우)`, () => {
        const r = setup().judge(6.8 + signed / 1000, 'attack');
        expect(r).toMatchObject({ beat: 12, result: expected });
        if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(signed);
      });
    }
  }

  // 140BPM 윈도우라면 75 → good, 135 → miss가 되므로 120BPM 유지를 구분할 수 있다
  const beat11: Array<[number, string]> = [
    [75, 'perfect'], [76, 'good'], [135, 'good'], [136, 'miss'],
  ];
  for (const [ms, expected] of beat11) {
    for (const sign of [1, -1]) {
      const signed = sign * ms;
      it(`beat 11 ${signed > 0 ? '+' : ''}${signed}ms → ${expected} (직전 비트 120BPM 유지)`, () => {
        const r = setup().judge(6.3 + signed / 1000, 'attack');
        expect(r).toMatchObject({ beat: 11, result: expected });
        if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(signed);
      });
    }
  }
});

describe('RhythmJudge — 음수 캘리브레이션 오프셋 (리뷰 T3#3)', () => {
  it('-50ms: beat 2 +50ms 입력 → 보정 후 0ms, perfect', () => {
    const r = new RhythmJudge(new BeatTimeline(100), -50).judge(1.2 + 0.05, 'attack');
    expect(r).toMatchObject({ beat: 2, result: 'perfect' });
    if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(0);
  });

  it('-50ms: beat 2 -41ms 입력 → 보정 후 -91ms, good (오프셋 0이면 perfect)', () => {
    const withOffset = new RhythmJudge(new BeatTimeline(100), -50);
    const without = new RhythmJudge(new BeatTimeline(100));
    expect(withOffset.judge(1.2 - 0.041, 'attack')).toMatchObject({ beat: 2, result: 'good' });
    expect(without.judge(1.2 - 0.041, 'attack')).toMatchObject({ beat: 2, result: 'perfect' });
  });

  it('-200ms: 오프셋으로 비트 배정이 바뀜 (1.51s: 0이면 beat 3 miss, -200이면 beat 2 good)', () => {
    // 100BPM beat 2 = 1.2s, beat 3 = 1.8s, 중간 1.5s
    const without = new RhythmJudge(new BeatTimeline(100)).judge(1.51, 'attack');
    expect(without).toMatchObject({ beat: 3, result: 'miss' });
    if (without.result !== 'duplicate_ignored') expect(without.errorMs).toBeCloseTo(-290);

    const withOffset = new RhythmJudge(new BeatTimeline(100), -200).judge(1.51, 'attack');
    expect(withOffset).toMatchObject({ beat: 2, result: 'good' });
    if (withOffset.result !== 'duplicate_ignored') expect(withOffset.errorMs).toBeCloseTo(110);
  });
});

describe('RhythmJudge — D-06 허용 오차 경계 확장 (리뷰 T3#4)', () => {
  // [BPM, 경계(ms), 경계 안쪽 판정, 경계 바깥 판정]
  const bounds: Array<[Bpm, number, string, string]> = [
    [100, 90, 'perfect', 'good'], [100, 160, 'good', 'miss'],
    [120, 75, 'perfect', 'good'], [120, 135, 'good', 'miss'],
    [140, 60, 'perfect', 'good'], [140, 110, 'good', 'miss'],
  ];

  for (const [bpm, window, upper, lower] of bounds) {
    for (const sign of [1, -1]) {
      it(`${bpm}BPM ${sign > 0 ? '+' : '-'}(${window}+0.5e-6)ms → ${upper}`, () => {
        const ms = sign * (window + 0.5e-6);
        const r = new RhythmJudge(new BeatTimeline(bpm)).judge(ms / 1000, 'attack');
        expect(r).toMatchObject({ beat: 0, result: upper });
        if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(ms, 9);
      });

      it(`${bpm}BPM ${sign > 0 ? '+' : '-'}(${window}+2e-6)ms → ${lower}`, () => {
        const ms = sign * (window + 2e-6);
        const r = new RhythmJudge(new BeatTimeline(bpm)).judge(ms / 1000, 'attack');
        expect(r).toMatchObject({ beat: 0, result: lower });
        if (r.result !== 'duplicate_ignored') expect(r.errorMs).toBeCloseTo(ms, 9);
      });
    }
  }
});
