/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { BeatTimeline } from '../src/core/beatTimeline';
import { TempoSystem } from '../src/core/tempoSystem';
import { CombatSystem } from '../src/core/combatSystem';

/** 100BPM: beat n = 0.6n초 */
const sec100 = (beat: number) => beat * 0.6;

function setup(combo: number, bpm: 100 | 120 | 140 = 100, offsetMs = 0) {
  const tl = new BeatTimeline(bpm);
  const ts = new TempoSystem(tl, () => combo, () => offsetMs);
  return { tl, ts };
}

describe('TempoSystem — 콤보 조건 (3.2)', () => {
  it('콤보 4 → combo_too_low, 시간표 변경 없음', () => {
    const { tl, ts } = setup(4);
    expect(ts.requestTempoUp(sec100(6))).toEqual({ scheduled: false, currentBeat: 6, reason: 'combo_too_low' });
    expect(tl.getBpmAtBeat(8)).toBe(100);
    expect(tl.beatTime(8)).toBeCloseTo(4.8);
  });

  it('콤보 5 → beat 6 요청이 beat 8에 120BPM 예약', () => {
    const { tl, ts } = setup(5);
    expect(ts.requestTempoUp(sec100(6))).toEqual({ scheduled: true, currentBeat: 6, applyAtBeat: 8 });
    expect(tl.getBpmAtBeat(7)).toBe(100);
    expect(tl.getBpmAtBeat(8)).toBe(120);
  });

  it('대기 중 추가 요청 → pending', () => {
    const { ts } = setup(9);
    ts.requestTempoUp(sec100(6));
    expect(ts.requestTempoUp(sec100(7))).toEqual({ scheduled: false, currentBeat: 7, reason: 'pending' });
  });

  it('최대 BPM → at_max', () => {
    const { ts } = setup(9, 140);
    expect(ts.requestTempoUp(60 / 140 * 6)).toMatchObject({ scheduled: false, reason: 'at_max' });
  });

  it('120 적용 후 다시 요청하면 140 예약', () => {
    const { tl, ts } = setup(5);
    ts.requestTempoUp(sec100(6)); // beat 8부터 120
    const now = tl.beatTime(9) + 0.1; // beat 9 진행 중
    expect(ts.requestTempoUp(now)).toEqual({ scheduled: true, currentBeat: 9, applyAtBeat: 12 });
    expect(tl.getBpmAtBeat(12)).toBe(140);
  });
});

describe('TempoSystem — D-05 현재 비트는 nowSec에서 계산', () => {
  it('현재 비트는 반올림이 아닌 "이미 시작된 비트": beat 3.6 → beat 3 → beat 4 예약', () => {
    const { ts } = setup(5);
    // beat 4까지 240ms: 반올림이면 beat 4(→ beat 8 예약), 내림이면 beat 3
    expect(ts.requestTempoUp(sec100(3) + 0.36)).toEqual({ scheduled: true, currentBeat: 3, applyAtBeat: 4 });
  });

  it('beat 4 시각 정각 → currentBeat 4 → beat 8 예약', () => {
    const { ts } = setup(5);
    expect(ts.requestTempoUp(sec100(4))).toEqual({ scheduled: true, currentBeat: 4, applyAtBeat: 8 });
  });

  it('API에 비트 인자가 없다 (requestTempoUp(nowSec) 1개)', () => {
    expect(TempoSystem.prototype.requestTempoUp.length).toBe(1);
    expect(CombatSystem.prototype.requestTempoUp.length).toBe(1);
  });

  it('src에서 BeatTimeline.requestTempo를 호출하는 곳은 tempoSystem.ts뿐', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >;
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    const callers = Object.entries(sources)
      .filter(([, code]) => /\.requestTempo\s*\(/.test(code))
      .map(([path]) => path);
    expect(callers).toEqual(['../src/core/tempoSystem.ts']);
  });
});

describe('TempoSystem — D-07b 다음 경계의 Good 윈도우가 열린 뒤 요청은 그다음 경계로', () => {
  it('100BPM beat 8 시각 −161ms 요청 → beat 8 적용', () => {
    const { tl, ts } = setup(5);
    expect(ts.requestTempoUp(4.8 - 0.161)).toEqual({ scheduled: true, currentBeat: 7, applyAtBeat: 8 });
    expect(tl.getBpmAtBeat(8)).toBe(120);
  });

  it('100BPM beat 8 시각 −160ms 요청 → beat 12 적용 (경계 포함)', () => {
    const { tl, ts } = setup(5);
    expect(ts.requestTempoUp(4.8 - 0.16)).toEqual({ scheduled: true, currentBeat: 7, applyAtBeat: 12 });
    expect(tl.getBpmAtBeat(11)).toBe(100);
    expect(tl.getBpmAtBeat(12)).toBe(120);
  });

  it('120BPM(현재 BPM 기준 ±135ms): 다음 경계 −136ms → 그 경계, −135ms → 그다음 경계', () => {
    const a = setup(5, 120);
    expect(a.ts.requestTempoUp(4.0 - 0.136)).toMatchObject({ scheduled: true, applyAtBeat: 8 });
    const b = setup(5, 120);
    expect(b.ts.requestTempoUp(4.0 - 0.135)).toMatchObject({ scheduled: true, applyAtBeat: 12 });
  });

  it('연기된 예약도 대기 중이면 추가 요청은 pending', () => {
    const { ts } = setup(9);
    ts.requestTempoUp(4.8 - 0.1); // → beat 12
    expect(ts.requestTempoUp(4.8 + 0.1)).toMatchObject({ scheduled: false, currentBeat: 8, reason: 'pending' });
  });

  it('beat 8 적용 대기 중, beat 8 윈도우가 열린 뒤 재요청 → pending (beat 12에 중복 예약 안 됨)', () => {
    const { tl, ts } = setup(9);
    ts.requestTempoUp(sec100(6)); // → beat 8
    expect(ts.requestTempoUp(4.8 - 0.05)).toMatchObject({ scheduled: false, currentBeat: 7, reason: 'pending' });
    expect(tl.getBpmAtBeat(12)).toBe(120);
  });

  it('캘리브레이션 오프셋 반영: +50ms면 beat 8 −211ms 요청 → beat 8, −210ms → beat 12', () => {
    expect(setup(5, 100, 50).ts.requestTempoUp(4.8 - 0.211)).toMatchObject({ applyAtBeat: 8 });
    expect(setup(5, 100, 50).ts.requestTempoUp(4.8 - 0.21)).toMatchObject({ applyAtBeat: 12 });
  });
});
