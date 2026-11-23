import { describe, it, expect } from 'vitest';
import { BattleSession } from '../src/game/battleSession';
import { RESOLVE_MARGIN_MS, isEnemyAttackBeat } from '../src/core/config';

const mk = (calibrationOffsetMs = 0) =>
  new BattleSession({ calibrationOffsetMs, runId: 'test', startedAt: '2026-11-17T00:00:00.000Z' });

/** 100BPM beat b 시각 */
const t100 = (b: number) => b * 0.6;

describe('BattleSession.update — 확정 타이밍 (D-08)', () => {
  it('RESOLVE_MARGIN_MS 초기값 50', () => {
    expect(RESOLVE_MARGIN_MS).toBe(50);
  });

  it('Good 윈도우(160ms) + 여유(50ms)가 지나야 확정', () => {
    const s = mk();
    expect(s.update(0.21)).toHaveLength(0);
    const r = s.update(0.2101);
    expect(r.map((x) => x.beat)).toEqual([0]);
  });

  it('여유 시간 안에 도착한 윈도우 내 입력이 확정에 반영된다', () => {
    const s = mk();
    // beat 1에 +150ms Good 입력이 처리 지연으로 beat 1 +200ms 시점에 도착
    s.update(t100(1) + 0.2);
    s.input(t100(1) + 0.15, 'attack');
    const r = s.update(t100(1) + 0.3);
    const b1 = r.find((x) => x.beat === 1)!;
    expect(b1.kind).toBe('normal');
    expect(b1.kind === 'normal' && b1.attack).toBe('good');
  });

  it('밀린 비트를 순서대로 한꺼번에 확정하고 RangeError가 나지 않는다', () => {
    const s = mk();
    const r = s.update(t100(10));
    expect(r.map((x) => x.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each([-200, -50, 50, 200])('오프셋 %ims에서도 resolveBeat 가드에 걸리지 않는다', (off) => {
    const s = mk(off);
    // 미입력 → beat 23에서 HP 0 패배까지 매 프레임 확정 (가드 위반 시 RangeError로 실패)
    for (let t = -1; t < 30; t += 0.016) s.update(t);
    expect(s.finishedRecord?.lastResolvedBeat).toBe(23);
  });

  it('오프셋은 보정 시각 기준: +100ms면 100ms 일찍 확정', () => {
    const s = mk(100);
    expect(s.update(0.11)).toHaveLength(0);
    expect(s.update(0.1101).map((x) => x.beat)).toEqual([0]);
  });
});

describe('BattleSession — 승패와 기록', () => {
  it('미입력이면 적 공격 5회 피격 후 beat 23에서 패배, 기록 1회 생성', () => {
    const s = mk();
    let t = 0;
    while (!s.finishedRecord && t < 80) {
      s.update(t);
      t += 0.016;
    }
    const rec = s.finishedRecord!;
    expect(rec.outcome).toBe('defeat');
    expect(rec.cause).toBe('player_hp');
    expect(rec.lastResolvedBeat).toBe(23);
    expect(rec.summary.hitsTaken).toBe(5);
    expect(rec.summary.enemyAttacks).toBe(5);
    expect(rec.summary.hitRate).toBe(1);
    expect(s.update(t + 1)).toEqual([]);
    expect(s.finishedRecord).toBe(rec);
  });

  it('전부 Perfect 공격 + Perfect 회피면 승리', () => {
    const s = mk();
    let beat = 0;
    let t = 0;
    while (!s.finishedRecord && t < 200) {
      t += 0.01;
      // 각 비트 정각에 입력
      const beatT = s.combat.beatTime(beat);
      if (t >= beatT) {
        s.input(beatT, isEnemyAttackBeat(beat) ? 'dodge' : 'attack');
        beat++;
      }
      s.update(t);
    }
    const rec = s.finishedRecord!;
    expect(rec.outcome).toBe('victory');
    expect(rec.summary.hitsTaken).toBe(0);
    expect(rec.summary.attackJudgeByBpm[100].perfect).toBeGreaterThan(0);
    expect(rec.summary.firstSuccessfulAttackSec).toBe(0);
  });
});

describe('BattleSession — 템포 업', () => {
  /** beat 0,1,2,3,5 Perfect → 콤보 5 (beat 4 미입력, 첫 적 공격은 beat 7) */
  function comboFive() {
    const s = mk();
    for (const b of [0, 1, 2, 3, 5]) s.input(t100(b), 'attack');
    return s;
  }

  it('시작 전(nowSec<0) 요청은 core를 호출하지 않고 not_started', () => {
    const s = mk();
    expect(s.requestTempoUp(-0.5)).toEqual({ scheduled: false, reason: 'not_started' });
    expect(s.tempoStatus(-0.5).kind).toBe('not_started');
  });

  it('콤보 5 달성 시 기회 1회 기록, 요청 시 선택 1회, 적용 비트에서 콤보 0', () => {
    const s = comboFive();
    s.update(t100(5) + 0.3); // beat 5 확정 → 콤보 5
    expect(s.getState(t100(5) + 0.3).combo).toBe(5);
    expect(s.tempoStatus(t100(5) + 0.3).kind).toBe('available');
    s.update(t100(5) + 0.31);
    const r = s.requestTempoUp(t100(6));
    expect(r).toMatchObject({ scheduled: true, applyAtBeat: 8 });
    expect(s.tempoStatus(t100(6)).kind).toBe('pending');
    s.update(t100(8) + 0.3);
    expect(s.combat.getBpmAtBeat(8)).toBe(120);
    expect(s.getState(t100(8) + 0.3).combo).toBe(0);

    s.update(20); // 계속 진행 후 패배까지
    for (let t = 20; !s.finishedRecord && t < 120; t += 0.05) s.update(t);
    const sum = s.finishedRecord!.summary;
    expect(sum.tempoOpportunities).toBe(1);
    expect(sum.tempoSelections).toBe(1);
    expect(sum.tempoRequests).toBe(1);
    expect(sum.maxBpm).toBe(120);
  });

  it('displayBeat는 템포 변경 후에도 비트 시각과 일치', () => {
    const s = comboFive();
    s.update(t100(5) + 0.3);
    s.requestTempoUp(t100(6));
    expect(s.displayBeat(-0.01)).toBe(-1);
    expect(s.displayBeat(0)).toBe(0);
    expect(s.displayBeat(4.8 - 1e-6)).toBe(7);
    expect(s.displayBeat(4.8)).toBe(8);
    expect(s.displayBeat(5.3)).toBe(9);
  });
});

/** 미입력으로 끝까지 진행해 기록을 얻는다 (beat 23 HP 0 패배) */
function runToEnd(s: BattleSession, from: number) {
  for (let t = from; !s.finishedRecord && t < 200; t += 0.05) s.update(t);
  return s.finishedRecord!;
}

describe('리뷰 T6#1: 확정 후 도착한 입력은 성공 통계에서 제외', () => {
  it('beat 1 확정 후 도착한 Good(+100ms) → beat_already_resolved, 성공률·첫 성공 시각에 안 들어감', () => {
    const s = mk();
    s.update(t100(1) + 0.3); // beat 0, 1 확정
    expect(s.getState(t100(1) + 0.3).lastResolvedBeat).toBe(1);
    const o = s.input(t100(1) + 0.1, 'attack');
    expect(o).toMatchObject({ kind: 'beat_already_resolved', beat: 1, result: 'good' });

    const sum = runToEnd(s, t100(1) + 0.35).summary;
    expect(sum.attackJudgeByBpm[100]).toEqual({ perfect: 0, good: 0, miss: 0 });
    expect(sum.firstSuccessfulAttackSec).toBeNull();
    expect(sum.attackAfterResolveByBpm[100]).toEqual({ perfect: 0, good: 1, miss: 0 });
    expect(sum.damageDealtByBpm[100]).toBe(0);
  });

  it('반영된 입력과 섞여도 반영된 것만 센다', () => {
    const s = mk();
    s.input(t100(0) + 0.01, 'attack'); // beat 0 Perfect (반영)
    s.update(t100(1) + 0.3);
    s.input(t100(1) + 0.02, 'attack'); // beat 1 확정 후 Perfect (미반영)
    const sum = runToEnd(s, t100(1) + 0.35).summary;
    expect(sum.attackJudgeByBpm[100]).toEqual({ perfect: 1, good: 0, miss: 0 });
    expect(sum.attackAfterResolveByBpm[100]).toEqual({ perfect: 1, good: 0, miss: 0 });
    expect(sum.firstSuccessfulAttackSec).toBeCloseTo(0.01, 9);
  });

  it('확정 후 Miss(late_miss_combo_reset)는 콤보를 바꾸므로 Miss로 센다', () => {
    const s = mk();
    s.update(t100(1) + 0.3);
    expect(s.input(t100(1) + 0.2, 'attack')).toMatchObject({ kind: 'late_miss_combo_reset' });
    const sum = runToEnd(s, t100(1) + 0.35).summary;
    expect(sum.attackJudgeByBpm[100]).toEqual({ perfect: 0, good: 0, miss: 1 });
  });
});

describe('D-10: wrong_action 텔레메트리', () => {
  it('일반 비트 F 먼저 / 적 공격 비트 J 먼저 → wrong_action 2건, 맞는 키 먼저면 기록 없음', () => {
    const s = mk();
    s.input(t100(1), 'dodge'); // 일반 비트 F 먼저 → wrong
    s.input(t100(1), 'attack'); // duplicate
    s.input(t100(2), 'attack'); // 맞는 키
    s.input(t100(2), 'dodge'); // duplicate → wrong_action 아님
    s.input(t100(7) + 0.1, 'attack'); // 적 공격 비트 J 먼저(Good 타이밍) → wrong
    s.input(t100(7) + 0.1, 'dodge'); // duplicate
    const rec = runToEnd(s, 0);
    expect(rec.version).toBe(3);
    const wrong = rec.events.filter((e) => e.type === 'wrong_action');
    expect(wrong).toEqual([
      { type: 'wrong_action', t: t100(1), beat: 1, bpm: 100, beatKind: 'normal', channel: 'dodge', result: 'perfect' },
      { type: 'wrong_action', t: t100(7) + 0.1, beat: 7, bpm: 100, beatKind: 'enemy_attack', channel: 'attack', result: 'good' },
    ]);
  });
});

describe('리뷰 T6#2: 프레임 사이 템포 요청에서도 기회 집계', () => {
  it('update()가 가능 상태를 관찰하기 전에 요청해 예약돼도 기회 1, 선택 1', () => {
    const s = mk();
    for (const b of [0, 1, 2, 3, 5]) s.input(t100(b), 'attack');
    // 직전 프레임: 아직 콤보 0 (불가)
    s.update(0.05);
    // 프레임 사이에 비트 0~5가 확정되어 콤보 5가 됨 (update가 관찰하지 못한 상태 변화)
    for (let b = 0; b <= 5; b++) s.combat.resolveBeat(b, t100(b) + 0.3);
    const now = t100(5) + 0.31;
    expect(s.requestTempoUp(now)).toMatchObject({ scheduled: true, applyAtBeat: 8 });

    const sum = runToEnd(s, now + 0.01).summary;
    expect(sum.tempoSelections).toBe(1);
    expect(sum.tempoOpportunities).toBe(1);
  });

  it('update()가 이미 관찰한 기회 구간에서 요청하면 중복 집계하지 않음', () => {
    const s = mk();
    for (const b of [0, 1, 2, 3, 5]) s.input(t100(b), 'attack');
    s.update(t100(5) + 0.3); // 여기서 기회 1
    s.requestTempoUp(t100(5) + 0.31);
    s.requestTempoUp(t100(5) + 0.32); // pending 거절
    const sum = runToEnd(s, t100(5) + 0.35).summary;
    expect(sum.tempoOpportunities).toBe(1);
    expect(sum.tempoSelections).toBe(1);
    expect(sum.tempoRequests).toBe(2);
  });

  it('불가 상태의 거절 요청은 기회로 세지 않음', () => {
    const s = mk();
    s.update(1);
    expect(s.requestTempoUp(1.01)).toMatchObject({ scheduled: false, reason: 'combo_too_low' });
    const sum = runToEnd(s, 1.05).summary;
    expect(sum.tempoOpportunities).toBe(0);
  });
});
