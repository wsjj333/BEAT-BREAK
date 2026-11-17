import { describe, it, expect } from 'vitest';
import { CombatSystem, computeAttackDamage, type BeatResolution } from '../src/core/combatSystem';
import type { InputChannel } from '../src/core/rhythmJudge';

/** beat 시각 + ms 오프셋(초) */
const at = (c: CombatSystem, beat: number, ms = 0) => c.beatTime(beat) + ms / 1000;

const GOOD_MS = { 100: 160, 120: 135, 140: 110 } as const;

/** beat의 Good 윈도우가 닫힌 직후(+1ms)의 입력 시간축 시각. 보정 시각 = 입력 + 오프셋 */
const closed = (c: CombatSystem, beat: number, offsetMs = 0) =>
  at(c, beat, GOOD_MS[c.getBpmAtBeat(beat)] + 1 - offsetMs);

/** 마지막 확정 비트의 윈도우 마감 직후 시각 기준 상태 (확정 전이면 0초) */
function st(c: CombatSystem) {
  const last = c.getState(0).lastResolvedBeat;
  return c.getState(last < 0 ? 0 : closed(c, last));
}

function resolveThrough(c: CombatSystem, last: number, offsetMs = 0): BeatResolution[] {
  const out: BeatResolution[] = [];
  for (let b = st(c).lastResolvedBeat + 1; b <= last; b++) out.push(c.resolveBeat(b, closed(c, b, offsetMs)));
  return out;
}

/** 0, 1, 2, 3, 5, ... 적 공격 비트가 아닌 비트 n개 */
function normalBeats(n: number): number[] {
  const out: number[] = [];
  for (let b = 0; out.length < n; b++) if (b === 0 || b % 4 !== 0) out.push(b);
  return out;
}

/**
 * beat 0,1,2,3,5,6 Perfect 공격 + beat 4 회피 Perfect, beat 6까지 확정 → 콤보 6.
 * beat 6 확정은 하지 않을 수 있도록 lastResolve로 조절.
 */
function buildCombo(c: CombatSystem, lastResolve: number, offsetMs = 0): void {
  // 보정 시각 = 입력 + 오프셋 → 정박에 맞추려면 입력은 비트 시각 − 오프셋
  for (const b of [0, 1, 2, 3, 5, 6]) c.input(at(c, b, -offsetMs), 'attack');
  c.input(at(c, 4, -offsetMs), 'dodge');
  resolveThrough(c, lastResolve, offsetMs);
}

describe('CombatSystem — 3.5 템포 예약 벡터', () => {
  it('beat 6 요청 → beat 7 기존 BPM, beat 8 새 BPM + 콤보 0', () => {
    const c = new CombatSystem();
    buildCombo(c, 5);
    expect(st(c).combo).toBe(5);

    expect(c.requestTempoUp(at(c, 6))).toEqual({ scheduled: true, currentBeat: 6, applyAtBeat: 8 });

    c.input(at(c, 7), 'attack');
    c.input(at(c, 9), 'attack');

    expect(c.resolveBeat(6, closed(c, 6))).toMatchObject({ bpm: 100, comboResetByTempo: false, state: { combo: 6 } });

    const r7 = c.resolveBeat(7, closed(c, 7));
    expect(r7).toMatchObject({ kind: 'normal', bpm: 100, enemyDamage: 12.5, comboResetByTempo: false, state: { combo: 7 } });
    expect(c.beatTime(7)).toBeCloseTo(4.2);
    expect(c.beatTime(8)).toBeCloseTo(4.8);
    expect(c.beatTime(9)).toBeCloseTo(5.3);

    const r8 = c.resolveBeat(8, closed(c, 8));
    expect(r8).toMatchObject({ kind: 'enemy_attack', bpm: 120, comboResetByTempo: true, state: { combo: 0 } });

    const r9 = c.resolveBeat(9, closed(c, 9));
    expect(r9).toMatchObject({ bpm: 120, enemyDamage: 15.625, comboResetByTempo: false, state: { combo: 1 } });
    // beat 0,1,2,3,5,6,7 × 12.5 + beat 9 × 15.625
    expect(st(c).enemyHp).toBe(300 - 7 * 12.5 - 15.625);
  });

  it('템포 적용 비트가 시작됐지만 확정 전이면 콤보는 이미 0 → 추가 요청 combo_too_low', () => {
    const c = new CombatSystem();
    buildCombo(c, 5);
    c.requestTempoUp(at(c, 6));
    c.input(at(c, 7), 'attack');
    resolveThrough(c, 7);
    expect(st(c).combo).toBe(7);

    // beat 8(120BPM 적용) +50ms, resolveBeat(8) 전
    expect(c.requestTempoUp(at(c, 8, 50))).toMatchObject({ scheduled: false, currentBeat: 8, reason: 'combo_too_low' });
    // 리뷰 T4-5#1: 공개 상태도 같은 유효 콤보 → 0. 적용 비트 직전에는 7
    expect(c.getState(at(c, 8, -1)).combo).toBe(7);
    expect(c.getState(at(c, 8)).combo).toBe(0);
    expect(c.getState(at(c, 8, 50)).combo).toBe(0);
    expect(c.getBpmAtBeat(12)).toBe(120);
  });

  it('콤보 4에서 요청 → combo_too_low, BPM 유지', () => {
    const c = new CombatSystem();
    for (const b of [0, 1, 2, 3]) c.input(at(c, b), 'attack');
    resolveThrough(c, 5);
    expect(st(c).combo).toBe(4);
    expect(c.requestTempoUp(at(c, 6))).toMatchObject({ scheduled: false, reason: 'combo_too_low' });
    expect(c.getBpmAtBeat(8)).toBe(100);
  });

  it('경계 직전 요청: 이미 판정된 beat 8 입력의 판정이 확정까지 유지됨 (D-07b)', () => {
    const c = new CombatSystem();
    buildCombo(c, 6);

    // beat 8 −80ms 회피: 100BPM(±90) 기준 perfect
    expect(c.input(at(c, 8, -80), 'dodge')).toMatchObject({ kind: 'pending', beat: 8, result: 'perfect' });

    // beat 8 Good 윈도우가 열린 뒤 요청 → beat 12로 연기, beat 8은 100BPM 유지
    expect(c.requestTempoUp(at(c, 8, -6))).toEqual({ scheduled: true, currentBeat: 7, applyAtBeat: 12 });
    expect(c.getBpmAtBeat(8)).toBe(100);

    c.resolveBeat(7, closed(c, 7));
    expect(c.resolveBeat(8, closed(c, 8))).toMatchObject({ bpm: 100, dodge: 'perfect', playerDamage: 0, comboResetByTempo: false });
  });

  /**
   * D-07b 불변식: 요청 시각까지 판정될 수 있었던 모든 입력의 비트 BPM은 요청 후에도 같다.
   * 입력이 비트 b에 Miss 외 판정을 받으려면 보정 시각 >= beatTime(b) − Good(b).
   * (Miss는 BPM이 올라 윈도우가 좁아져도 Miss로 남는다.)
   * beat 6~13 구간을 1ms 간격으로 요청 시각을 훑고, 오프셋 −200/0/+200ms에서 확인.
   */
  for (const offset of [-200, 0, 200]) {
    it(`이미 판정된 입력의 BPM 기준이 바뀌는 요청 시각이 없음 (오프셋 ${offset}ms)`, () => {
      const goodMs: Record<number, number> = { 100: 160, 120: 135, 140: 110 };
      let checked = 0;
      for (let ms = 3600; ms <= 7800; ms += 1) {
        const c = new CombatSystem({ calibrationOffsetMs: offset });
        buildCombo(c, 5, offset);
        const now = ms / 1000;
        const corrected = now + offset / 1000;
        const before = Array.from({ length: 20 }, (_, b) => c.getBpmAtBeat(b));
        const r = c.requestTempoUp(now);
        if (!r.scheduled) continue;
        checked++;
        for (let b = 0; b < 20; b++) {
          if (corrected >= c.beatTime(b) - goodMs[before[b]] / 1000) {
            expect(c.getBpmAtBeat(b), `now=${ms}ms beat=${b}`).toBe(before[b]);
          }
        }
      }
      expect(checked).toBeGreaterThan(4000);
    });
  }
});

describe('CombatSystem — 3.5 회피 벡터 (D-01)', () => {
  const cases: Array<[string, number | null, 'perfect' | 'good' | 'none', number]> = [
    ['회피 +90ms Perfect', 90, 'perfect', 0],
    ['회피 −90ms Perfect', -90, 'perfect', 0],
    ['회피 +91ms Good', 91, 'good', 1],
    ['회피 −160ms Good', -160, 'good', 1],
    ['미회피', null, 'none', 1],
  ];

  for (const [name, ms, dodge, dmg] of cases) {
    it(`beat 4 ${name} → 피해 ${dmg}, 콤보 유지`, () => {
      const c = new CombatSystem();
      for (const b of [0, 1, 2]) c.input(at(c, b), 'attack');
      if (ms !== null) c.input(at(c, 4, ms), 'dodge');
      resolveThrough(c, 3);
      expect(st(c).combo).toBe(3);

      expect(c.resolveBeat(4, closed(c, 4))).toMatchObject({ kind: 'enemy_attack', dodge, playerDamage: dmg, state: { playerHp: 5 - dmg, combo: 3 } });
    });
  }

  it('회피 Miss(+200ms)도 피해 1', () => {
    const c = new CombatSystem();
    c.input(at(c, 4, 200), 'dodge');
    resolveThrough(c, 3);
    expect(c.resolveBeat(4, closed(c, 4))).toMatchObject({ dodge: 'miss', playerDamage: 1 });
  });

  it('회피는 비트당 최초 1회: Good 후 Perfect 재입력은 duplicate → 피해 1', () => {
    const c = new CombatSystem();
    c.input(at(c, 4, 100), 'dodge');
    expect(c.input(at(c, 4), 'dodge')).toEqual({ kind: 'duplicate_ignored', beat: 4 });
    resolveThrough(c, 3);
    expect(c.resolveBeat(4, closed(c, 4))).toMatchObject({ dodge: 'good', playerDamage: 1 });
  });

  it('적 공격 비트에서 공격 입력 → attack_ignored_dodge_beat, 적 HP·콤보 변화 없음', () => {
    const c = new CombatSystem();
    for (const b of [0, 1]) c.input(at(c, b), 'attack');
    expect(c.input(at(c, 4), 'attack')).toMatchObject({ kind: 'attack_ignored_dodge_beat', beat: 4 });
    resolveThrough(c, 3);
    const r4 = c.resolveBeat(4, closed(c, 4));
    expect(r4).toMatchObject({ kind: 'enemy_attack', dodge: 'none', playerDamage: 1 });
    expect(r4.kind !== 'ignored_finished' && r4.state).toMatchObject({ enemyHp: 300 - 2 * 12.5, combo: 2 });
  });

  it('일반 비트에서 회피 입력 → dodge_no_effect, 상태 변화 없음', () => {
    const c = new CombatSystem();
    expect(c.input(at(c, 1), 'dodge')).toMatchObject({ kind: 'dodge_no_effect', beat: 1 });
    resolveThrough(c, 1);
    expect(st(c)).toMatchObject({ playerHp: 5, enemyHp: 300, combo: 0 });
  });
});

describe('CombatSystem — 피해량 (3.3)', () => {
  it('피해 표: 10 × BPM 배율 × 타이밍 배율', () => {
    expect(computeAttackDamage(100, 'perfect')).toBe(12.5);
    expect(computeAttackDamage(120, 'perfect')).toBe(15.625);
    expect(computeAttackDamage(140, 'perfect')).toBe(18.75);
    expect(computeAttackDamage(100, 'good')).toBe(10);
    expect(computeAttackDamage(120, 'good')).toBe(12.5);
    expect(computeAttackDamage(140, 'good')).toBe(15);
    expect(computeAttackDamage(100, 'miss')).toBe(0);
    expect(computeAttackDamage(120, 'miss')).toBe(0);
    expect(computeAttackDamage(140, 'miss')).toBe(0);
  });

  it('100BPM Perfect 입력 → 적 HP −12.5', () => {
    const c = new CombatSystem();
    c.input(at(c, 1, 30), 'attack');
    resolveThrough(c, 1);
    expect(st(c).enemyHp).toBe(287.5);
  });

  it('140BPM Perfect 입력 → 적 HP −18.75', () => {
    const c = new CombatSystem({ initialBpm: 140 });
    c.input(at(c, 1, -60), 'attack');
    resolveThrough(c, 1);
    expect(st(c).enemyHp).toBe(281.25);
  });

  it('Miss 입력 → 피해 0, 콤보 0', () => {
    const c = new CombatSystem();
    for (const b of [0, 1]) c.input(at(c, b), 'attack');
    c.input(at(c, 2, 200), 'attack');
    resolveThrough(c, 1);
    expect(c.resolveBeat(2, closed(c, 2))).toMatchObject({ attack: 'miss', enemyDamage: 0, state: { enemyHp: 275, combo: 0 } });
  });

  it('미입력 비트 → 효과 없음, 콤보 유지 (3.1)', () => {
    const c = new CombatSystem();
    c.input(at(c, 0), 'attack');
    resolveThrough(c, 0);
    expect(c.resolveBeat(1, closed(c, 1))).toMatchObject({ attack: 'none', enemyDamage: 0, state: { combo: 1, enemyHp: 287.5 } });
  });
});

describe('CombatSystem — 입력 순서 무관 확정 (3.3)', () => {
  const inputs: Array<[number, number, InputChannel]> = [
    [1, 20, 'attack'],
    [2, -120, 'attack'], // good
    [2, 50, 'dodge'], // 일반 비트 회피 → 효과 없음
    [3, 200, 'attack'], // miss
    [4, 10, 'attack'], // 적 공격 비트 → 무시
    [4, -40, 'dodge'], // perfect
    [5, 100, 'attack'], // good
    [6, -10, 'attack'],
    [8, 95, 'dodge'], // good → 피해 1
    [8, -30, 'attack'],
  ];

  function run(order: number[]): { results: BeatResolution[]; state: ReturnType<CombatSystem['getState']> } {
    const c = new CombatSystem();
    for (const i of order) {
      const [beat, ms, ch] = inputs[i];
      c.input(at(c, beat, ms), ch);
    }
    const results = resolveThrough(c, 9);
    return { results, state: st(c) };
  }

  it('정순·역순·섞은 순서 → resolveBeat 결과와 최종 상태가 동일', () => {
    const forward = run(inputs.map((_, i) => i));
    const reverse = run(inputs.map((_, i) => inputs.length - 1 - i));
    const shuffled = run([5, 2, 9, 0, 7, 4, 1, 8, 3, 6]);

    expect(reverse).toEqual(forward);
    expect(shuffled).toEqual(forward);
    // 기대값 고정: 공격 1(P) 2(G) 3(M) 5(G) 6(P), 회피 4(P) 8(G)
    expect(forward.state).toMatchObject({
      enemyHp: 300 - 12.5 - 10 - 0 - 10 - 12.5,
      playerHp: 4,
      combo: 2,
    });
  });

  describe('리뷰 T4-5#2: Good 윈도우 종료 전 resolveBeat 거부', () => {
    it('100BPM beat 1: +160ms(경계, 아직 열림) → RangeError, 상태 변화 없음', () => {
      const c = new CombatSystem();
      c.input(at(c, 0), 'attack');
      c.resolveBeat(0, closed(c, 0));
      const before = st(c);
      expect(() => c.resolveBeat(1, at(c, 1, 160))).toThrow(RangeError);
      expect(() => c.resolveBeat(1, at(c, 1))).toThrow(RangeError);
      expect(st(c)).toEqual(before);
      // 거부된 뒤 도착한 Perfect 입력은 정상 반영된다
      expect(c.input(at(c, 1, 20), 'attack')).toMatchObject({ kind: 'pending', result: 'perfect' });
      expect(c.resolveBeat(1, at(c, 1, 161))).toMatchObject({ attack: 'perfect', enemyDamage: 12.5 });
    });

    it('종료 직후(+160.01ms) 허용', () => {
      const c = new CombatSystem();
      c.resolveBeat(0, closed(c, 0));
      expect(c.resolveBeat(1, at(c, 1, 160.01))).toMatchObject({ kind: 'normal', beat: 1 });
    });

    it('140BPM: +110ms 거부, +111ms 허용', () => {
      const c = new CombatSystem({ initialBpm: 140 });
      expect(() => c.resolveBeat(0, at(c, 0, 110))).toThrow(RangeError);
      expect(c.resolveBeat(0, at(c, 0, 111))).toMatchObject({ beat: 0 });
    });

    it('템포 적용 비트는 새 BPM 윈도우 기준: 120BPM beat 8 +135ms 거부, +136ms 허용', () => {
      const c = new CombatSystem();
      buildCombo(c, 5);
      c.requestTempoUp(at(c, 6));
      resolveThrough(c, 7);
      expect(() => c.resolveBeat(8, at(c, 8, 135))).toThrow(RangeError);
      expect(c.resolveBeat(8, at(c, 8, 136))).toMatchObject({ bpm: 120 });
    });

    it('보정 시각 기준: 오프셋 −50ms면 입력 시간축 +210ms 거부, +211ms 허용', () => {
      const c = new CombatSystem({ calibrationOffsetMs: -50 });
      expect(() => c.resolveBeat(0, at(c, 0, 210))).toThrow(RangeError);
      expect(c.resolveBeat(0, at(c, 0, 211))).toMatchObject({ beat: 0 });
    });

    it('오프셋 +200ms면 beat 0은 입력 시간축 음수 시각(−39ms)에 확정 가능', () => {
      const c = new CombatSystem({ calibrationOffsetMs: 200 });
      expect(() => c.resolveBeat(0, at(c, 0, -40))).toThrow(RangeError);
      expect(c.resolveBeat(0, at(c, 0, -39))).toMatchObject({ beat: 0, state: { combo: 0 } });
    });

    it('nowSec NaN → RangeError (resolveBeat, getState)', () => {
      expect(() => new CombatSystem().getState(NaN)).toThrow(RangeError);
      const c = new CombatSystem();
      expect(() => c.resolveBeat(0, NaN)).toThrow(RangeError);
    });
  });

  it('resolveBeat는 0,1,2,... 순서만 허용', () => {
    const c = new CombatSystem();
    expect(() => c.resolveBeat(1, closed(c, 1))).toThrow(RangeError);
    c.resolveBeat(0, closed(c, 0));
    expect(() => c.resolveBeat(0, closed(c, 0))).toThrow(RangeError);
    expect(() => c.resolveBeat(2, closed(c, 2))).toThrow(RangeError);
  });

  it('확정 후 도착한 공격 Miss → 콤보 0, HP 변화 없음 (D-07)', () => {
    const c = new CombatSystem();
    c.input(at(c, 0), 'attack');
    resolveThrough(c, 1); // beat 1은 미입력으로 확정
    expect(st(c).combo).toBe(1);
    // beat 1 +200ms (Good 윈도우 밖, 중간값 300ms 전) → beat 1에 배정된 Miss
    expect(c.input(at(c, 1, 200), 'attack')).toEqual({ kind: 'late_miss_combo_reset', beat: 1 });
    expect(st(c)).toMatchObject({ combo: 0, enemyHp: 287.5 });
  });

  it('확정 후 도착한 Perfect 입력 → beat_already_resolved, 상태 변화 없음 (D-07)', () => {
    const c = new CombatSystem();
    resolveThrough(c, 1);
    const before = st(c);
    expect(c.input(at(c, 1, 10), 'attack')).toMatchObject({ kind: 'beat_already_resolved', beat: 1 });
    expect(st(c)).toEqual(before);
  });
});

describe('CombatSystem — 승패 (3.3)', () => {
  it('회피 없이 적 공격 5회 → beat 20에서 플레이어 HP 0 패배', () => {
    const c = new CombatSystem();
    resolveThrough(c, 19);
    expect(st(c)).toMatchObject({ playerHp: 1, status: { phase: 'playing' } });
    expect(c.resolveBeat(20, closed(c, 20))).toMatchObject({ playerDamage: 1, state: { playerHp: 0, status: { phase: 'defeat', cause: 'player_hp' } } });
  });

  it('적 HP는 0 아래로 내려가지 않음 → 승리', () => {
    const c = new CombatSystem();
    const beats = normalBeats(25);
    beats.slice(0, 23).forEach((b) => c.input(at(c, b), 'attack')); // 23 × 12.5 = 287.5
    c.input(at(c, beats[23], 100), 'attack'); // good 10 → 2.5 남음
    c.input(at(c, beats[24]), 'attack'); // perfect 12.5 → 0 (−10 아님)
    // 회피도 전부 Perfect로 넣어 플레이어 HP 유지
    for (let b = 4; b <= beats[24]; b += 4) c.input(at(c, b), 'dodge');

    resolveThrough(c, beats[23]);
    expect(st(c)).toMatchObject({ enemyHp: 2.5, status: { phase: 'playing' } });
    resolveThrough(c, beats[24]);
    expect(st(c)).toMatchObject({ enemyHp: 0, playerHp: 5, status: { phase: 'victory' } });
  });

  it('120비트(beat 0~119)까지 승부가 안 나면 timeout 패배', () => {
    const c = new CombatSystem();
    for (let b = 4; b < 120; b += 4) c.input(at(c, b), 'dodge');
    resolveThrough(c, 118);
    expect(st(c)).toMatchObject({ playerHp: 5, enemyHp: 300, status: { phase: 'playing' } });
    expect(c.resolveBeat(119, closed(c, 119))).toMatchObject({ state: { status: { phase: 'defeat', cause: 'timeout' } } });
  });

  it('beat 119에서 적 HP 0이면 timeout이 아닌 승리', () => {
    const c = new CombatSystem({ initialBpm: 140 }); // 18.75 × 16 = 300
    const beats = normalBeats(91);
    const last16 = beats.slice(-16);
    expect(last16[15]).toBe(119);
    last16.forEach((b) => c.input(at(c, b), 'attack'));
    for (let b = 4; b < 120; b += 4) c.input(at(c, b), 'dodge');
    resolveThrough(c, 119);
    expect(st(c).status).toEqual({ phase: 'victory' });
  });

  describe('확정 후 입력·비트 진행·템포 요청이 상태를 바꾸지 않음', () => {
    function finishedByDefeat(): CombatSystem {
      const c = new CombatSystem();
      for (const b of [0, 1, 2, 3, 5, 6, 7]) c.input(at(c, b), 'attack');
      resolveThrough(c, 20);
      return c;
    }

    function finishedByTimeout(): CombatSystem {
      const c = new CombatSystem();
      for (let b = 4; b < 120; b += 4) c.input(at(c, b), 'dodge');
      resolveThrough(c, 119);
      return c;
    }

    for (const [name, make] of [
      ['패배', finishedByDefeat],
      ['timeout', finishedByTimeout],
    ] as const) {
      it(name, () => {
        const c = make();
        const before = st(c);
        expect(before.status.phase).toBe('defeat');
        const next = before.lastResolvedBeat + 1;

        expect(c.input(at(c, next), 'attack')).toEqual({ kind: 'ignored_finished' });
        expect(c.input(at(c, next + 3), 'dodge')).toEqual({ kind: 'ignored_finished' });
        expect(c.requestTempoUp(at(c, next))).toEqual({ scheduled: false, reason: 'finished' });
        expect(c.resolveBeat(next, closed(c, next))).toEqual({ kind: 'ignored_finished', beat: next });
        expect(c.resolveBeat(next + 1, closed(c, next + 1))).toEqual({ kind: 'ignored_finished', beat: next + 1 });
        expect(st(c)).toEqual(before);
        expect(c.getBpmAtBeat(next + 8)).toBe(100);
      });
    }

    it('승리', () => {
      const c = new CombatSystem({ initialBpm: 140 });
      const beats = normalBeats(16);
      beats.forEach((b) => c.input(at(c, b), 'attack'));
      resolveThrough(c, beats[15]);
      const before = st(c);
      expect(before.status).toEqual({ phase: 'victory' });

      const next = before.lastResolvedBeat + 1;
      expect(c.input(at(c, next), 'attack')).toEqual({ kind: 'ignored_finished' });
      expect(c.requestTempoUp(at(c, next))).toEqual({ scheduled: false, reason: 'finished' });
      expect(c.resolveBeat(next, closed(c, next))).toEqual({ kind: 'ignored_finished', beat: next });
      expect(st(c)).toEqual(before);
    });
  });
});
