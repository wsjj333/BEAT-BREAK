import { describe, it, expect } from 'vitest';
import { BeatTimeline } from '../src/core/beatTimeline';

describe('BeatTimeline', () => {
  // 1. 100BPM beat 4 = 2.4초
  it('100BPM beat 4 = 2.4초', () => {
    const tl = new BeatTimeline(100);
    expect(tl.beatTime(4)).toBeCloseTo(2.4);
  });

  // 2. beat 6에서 120 요청 → beat 8부터 0.5초 간격
  it('beat 6에서 120 요청 → beat 7은 0.6초 간격, beat 8부터 0.5초 간격', () => {
    const tl = new BeatTimeline(100);
    const result = tl.requestTempo(120, 6);

    expect(result).toEqual({ scheduled: true, applyAtBeat: 8 });
    expect(tl.beatTime(7)).toBeCloseTo(4.2);
    expect(tl.beatTime(8)).toBeCloseTo(4.8);
    expect(tl.beatTime(9)).toBeCloseTo(5.3);
  });

  // 3. 템포 적용 직후 nearestBeat이 새 간격 기준
  it('템포 적용 직후 nearestBeat이 새 간격 기준', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6);

    const result = tl.nearestBeat(5.1);
    expect(result.beat).toBe(9);
    expect(result.errorMs).toBeCloseTo(-200);
  });

  // 4. 경계(beat 7~8 사이) 정확히 중간 → beat 7
  it('경계(beat 7~8 사이) 정확히 중간 → beat 7', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6);

    // midpoint = (4.2 + 4.8) / 2 = 4.5
    const result = tl.nearestBeat(4.5);
    expect(result.beat).toBe(7);
    expect(result.errorMs).toBeCloseTo(300);
  });

  // 5. 음수/양수 오차 반환
  it('음수 오차 반환', () => {
    const tl = new BeatTimeline(100);
    // beat 2 = 1.2s
    const result = tl.nearestBeat(1.1);
    expect(result.beat).toBe(2);
    expect(result.errorMs).toBeCloseTo(-100);
  });

  it('양수 오차 반환', () => {
    const tl = new BeatTimeline(100);
    const result = tl.nearestBeat(1.3);
    expect(result.beat).toBe(2);
    expect(result.errorMs).toBeCloseTo(100);
  });

  // 6. 대기 중 재요청 무시
  it('대기 중 재요청 무시', () => {
    const tl = new BeatTimeline(100);
    const first = tl.requestTempo(120, 6);
    expect(first).toEqual({ scheduled: true, applyAtBeat: 8 });

    const second = tl.requestTempo(120, 7);
    expect(second).toEqual({ scheduled: false, reason: 'pending' });
  });

  // 7. 140에서 요청 거부
  it('140(MAX_BPM)에서 요청 거부', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 0);  // → applyAtBeat 4
    tl.requestTempo(140, 4);  // → applyAtBeat 8

    const result = tl.requestTempo(140, 8);
    expect(result).toEqual({ scheduled: false, reason: 'at_max' });
  });

  // 8. 비트 번호 -1, 4.5 → RangeError
  it('비트 번호 -1 → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.beatTime(-1)).toThrow(RangeError);
  });

  it('비트 번호 4.5 → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.beatTime(4.5)).toThrow(RangeError);
  });

  // 9. 부동소수점 중간값 — 이전 비트 선택
  it('100BPM beat 2~3 중간 → beat 2 선택', () => {
    const tl = new BeatTimeline(100);
    // beat 2 = 1.2s, beat 3 = 1.8s, mid = 1.5s
    const mid = (tl.beatTime(2) + tl.beatTime(3)) / 2;
    const result = tl.nearestBeat(mid);
    expect(result.beat).toBe(2);
  });

  it('140BPM 구간 중간 → 이전 비트 선택', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 0);  // → applyAtBeat 4
    tl.requestTempo(140, 4);  // → applyAtBeat 8

    // 140BPM 구간의 beat 8~9 중간
    const mid = (tl.beatTime(8) + tl.beatTime(9)) / 2;
    const result = tl.nearestBeat(mid);
    expect(result.beat).toBe(8);
  });

  // 10. beat 4(마디 경계)에서 요청 → applyAtBeat 8
  it('beat 4(마디 경계)에서 요청 → applyAtBeat 8', () => {
    const tl = new BeatTimeline(100);
    const result = tl.requestTempo(120, 4);
    expect(result).toEqual({ scheduled: true, applyAtBeat: 8 });
  });

  // 11. 120 대기 중 140 요청 → reason 'pending'
  it('120 대기 중 140 요청 → reason pending', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6);  // → applyAtBeat 8

    const result = tl.requestTempo(140, 7);
    expect(result).toEqual({ scheduled: false, reason: 'pending' });
  });

  // 12. nearestBeat NaN/Infinity → RangeError (#3)
  it('nearestBeat(NaN) → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.nearestBeat(NaN)).toThrow(RangeError);
  });

  it('nearestBeat(Infinity) → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.nearestBeat(Infinity)).toThrow(RangeError);
  });

  it('nearestBeat(-Infinity) → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.nearestBeat(-Infinity)).toThrow(RangeError);
  });

  // 13. 경계 양방향 테스트 (#4) — 리뷰 표 6개 입력
  describe('nearestBeat 경계 양방향', () => {
    it('100BPM beat 0 직전 → beat 0', () => {
      const tl = new BeatTimeline(100);
      const result = tl.nearestBeat(0.01);
      expect(result.beat).toBe(0);
      expect(result.errorMs).toBeCloseTo(10);
    });

    it('100BPM beat 0~1 경계 직전 → beat 0', () => {
      const tl = new BeatTimeline(100);
      // beat 0 = 0s, beat 1 = 0.6s, mid = 0.3s
      // 중간값보다 살짝 전 → beat 0
      const result = tl.nearestBeat(0.29);
      expect(result.beat).toBe(0);
      expect(result.errorMs).toBeCloseTo(290);
    });

    it('100BPM beat 0~1 경계 직후 → beat 1', () => {
      const tl = new BeatTimeline(100);
      // 중간값보다 살짝 후 → beat 1
      const result = tl.nearestBeat(0.31);
      expect(result.beat).toBe(1);
      expect(result.errorMs).toBeCloseTo(-290);
    });

    it('100BPM 마지막 비트 직후 → 가까운 비트', () => {
      const tl = new BeatTimeline(100);
      // beat 10 = 6.0s, beat 10 직후
      const result = tl.nearestBeat(6.05);
      expect(result.beat).toBe(10);
      expect(result.errorMs).toBeCloseTo(50);
    });

    it('t=0 정확히 → beat 0, errorMs 0', () => {
      const tl = new BeatTimeline(100);
      const result = tl.nearestBeat(0);
      expect(result.beat).toBe(0);
      expect(result.errorMs).toBeCloseTo(0);
    });

    it('비트 정확히 위 → errorMs 0', () => {
      const tl = new BeatTimeline(100);
      // beat 3 = 1.8s
      const result = tl.nearestBeat(1.8);
      expect(result.beat).toBe(3);
      expect(result.errorMs).toBeCloseTo(0);
    });
  });

  // 14. 120→140 세그먼트 경계 중간값 (#4)
  it('120→140 세그먼트 경계 중간값 → 이전 비트', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 0);  // → applyAtBeat 4
    tl.requestTempo(140, 4);  // → applyAtBeat 8
    // beat 7 (120BPM 구간 마지막)과 beat 8 (140BPM 구간 시작) 사이 중간
    const mid = (tl.beatTime(7) + tl.beatTime(8)) / 2;
    const result = tl.nearestBeat(mid);
    expect(result.beat).toBe(7);
  });

  // 15. EPS 양방향: 중간값 ± EPS (#4)
  it('중간값 + EPS → 여전히 이전 비트', () => {
    const tl = new BeatTimeline(100);
    const mid = (tl.beatTime(2) + tl.beatTime(3)) / 2;
    // mid + 작은 값 (EPS 이내) → 여전히 beat 2
    const result = tl.nearestBeat(mid + 1e-10);
    expect(result.beat).toBe(2);
  });

  it('중간값 + 큰 오프셋 → 다음 비트', () => {
    const tl = new BeatTimeline(100);
    const mid = (tl.beatTime(2) + tl.beatTime(3)) / 2;
    // mid + 명확히 큰 값 → beat 3
    const result = tl.nearestBeat(mid + 0.01);
    expect(result.beat).toBe(3);
  });
});

describe('BeatTimeline.currentBeatAt (D-05/D-07)', () => {
  it('각 비트 시각 정각 → 그 비트 (부동소수점 오차 흡수), 템포 전환 전후 포함', () => {
    const tl = new BeatTimeline(100);
    tl.requestTempo(120, 6); // beat 8부터 120
    for (let b = 0; b <= 40; b++) {
      expect(tl.currentBeatAt(tl.beatTime(b))).toBe(b);
    }
  });

  it('반올림하지 않음: 다음 비트 1ms 전 → 이전 비트', () => {
    const tl = new BeatTimeline(100);
    expect(tl.currentBeatAt(2.4 - 0.001)).toBe(3);
    expect(tl.currentBeatAt(2.4 - 0.299)).toBe(3);
    tl.requestTempo(120, 6);
    expect(tl.currentBeatAt(4.8 - 0.001)).toBe(7);
    expect(tl.currentBeatAt(4.8 + 0.499)).toBe(8);
  });

  it('음수·NaN·Infinity → RangeError', () => {
    const tl = new BeatTimeline(100);
    expect(() => tl.currentBeatAt(-0.001)).toThrow(RangeError);
    expect(() => tl.currentBeatAt(NaN)).toThrow(RangeError);
    expect(() => tl.currentBeatAt(Infinity)).toThrow(RangeError);
  });
});
