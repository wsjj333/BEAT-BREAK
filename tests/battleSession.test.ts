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
