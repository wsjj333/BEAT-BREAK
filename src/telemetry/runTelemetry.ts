/**
 * src/telemetry/runTelemetry.ts
 * 한 판의 플레이 이벤트 수집 (기획서 4장 지표, 5장 RunTelemetry). 순수 로직 — DOM/저장소 접근 없음.
 * 시각 t는 모두 전투 시간축(오디오 시계 - 원점, beat 0 = 0초)의 초 단위.
 * 한 판 단위로 사용하며 재시작 시 새 인스턴스를 만든다.
 */

import type { BeatResolution, CombatStatus, InputOutcome } from '../core/combatSystem';
import type { AttackTiming } from '../core/comboSystem';
import { type Bpm, TEMPO_STEPS } from '../core/config';
import type { InputChannel } from '../core/rhythmJudge';
import type { TempoUpResult } from '../core/tempoSystem';

export type TempoRequestOutcome =
  | TempoUpResult
  | { scheduled: false; reason: string; currentBeat?: number };

export type TelemetryEvent =
  | {
      type: 'judge';
      t: number;
      channel: InputChannel;
      kind: InputOutcome['kind'];
      beat: number | null;
      bpm: Bpm | null;
      result: AttackTiming | null;
      errorMs: number | null;
    }
  | { type: 'tempo_opportunity'; t: number; beat: number; bpm: Bpm; combo: number }
  | {
      type: 'tempo_request';
      t: number;
      bpm: Bpm | null;
      combo: number;
      scheduled: boolean;
      applyAtBeat: number | null;
      reason: string | null;
    }
  | {
      type: 'enemy_attack';
      t: number;
      beat: number;
      bpm: Bpm;
      dodge: AttackTiming | 'none';
      playerDamage: number;
      playerHp: number;
    }
  | {
      type: 'attack_resolved';
      t: number;
      beat: number;
      bpm: Bpm;
      attack: AttackTiming | 'none';
      enemyDamage: number;
      enemyHp: number;
      combo: number;
    }
  | { type: 'tempo_applied'; t: number; beat: number; bpm: Bpm }
  | { type: 'run_end'; t: number; outcome: 'victory' | 'defeat'; cause: string | null; lastResolvedBeat: number };

type TimingCounts = { perfect: number; good: number; miss: number };
type DodgeCounts = { perfect: number; good: number; miss: number; none: number; hits: number };

export interface RunSummary {
  /** BPM별 공격 판정 수 (일반 비트에서 판정된 공격만. 중복·회피 비트 공격 제외) */
  attackJudgeByBpm: Record<Bpm, TimingCounts>;
  /** BPM별 적 공격 비트 결과 (확정 기준) */
  dodgeByBpm: Record<Bpm, DodgeCounts>;
  damageDealtByBpm: Record<Bpm, number>;
  enemyAttacks: number;
  hitsTaken: number;
  /** 피격률 = hitsTaken / enemyAttacks (적 공격이 없었으면 null) */
  hitRate: number | null;
  /** 템포 업 가능 상태로 바뀐 횟수 (불가→가능 전환 1회 = 기회 1회). D-08(c) */
  tempoOpportunities: number;
  /** 템포 업 요청 중 실제 예약된 횟수 */
  tempoSelections: number;
  tempoRequests: number;
  maxBpm: Bpm;
  maxCombo: number;
  /** 첫 Perfect/Good 공격 입력 시각(초, beat 0 기준). 없으면 null. H3 */
  firstSuccessfulAttackSec: number | null;
}

export interface RunRecord {
  version: 1;
  runId: string;
  startedAt: string;
  calibrationOffsetMs: number;
  resolveMarginMs: number;
  outcome: 'victory' | 'defeat';
  cause: string | null;
  /** 플레이 시간(초): beat 0부터 승패 확정 시점까지 (오디오 시계) */
  durationSec: number;
  lastResolvedBeat: number;
  /** 결과 화면에서 R로 재시작했는지 (H4). 저장 후 갱신된다 */
  restarted: boolean;
  summary: RunSummary;
  events: TelemetryEvent[];
}

function perBpm<T>(make: () => T): Record<Bpm, T> {
  const out = {} as Record<Bpm, T>;
  for (const b of TEMPO_STEPS) out[b] = make();
  return out;
}

export class RunTelemetry {
  private readonly events: TelemetryEvent[] = [];
  private record: RunRecord | null = null;

  constructor(
    private readonly meta: {
      runId: string;
      startedAt: string;
      calibrationOffsetMs: number;
      resolveMarginMs: number;
    },
  ) {}

  get finished(): boolean {
    return this.record !== null;
  }

  recordInput(t: number, channel: InputChannel, outcome: InputOutcome, bpmAt: (beat: number) => Bpm): void {
    if (this.finished || outcome.kind === 'ignored_finished') return;
    const beat = outcome.beat;
    const result =
      'result' in outcome ? outcome.result : outcome.kind === 'late_miss_combo_reset' ? 'miss' : null;
    this.events.push({
      type: 'judge',
      t,
      channel,
      kind: outcome.kind,
      beat,
      bpm: bpmAt(beat),
      result,
      errorMs: outcome.kind === 'pending' ? outcome.errorMs : null,
    });
  }

  recordTempoOpportunity(t: number, beat: number, bpm: Bpm, combo: number): void {
    if (this.finished) return;
    this.events.push({ type: 'tempo_opportunity', t, beat, bpm, combo });
  }

  recordTempoRequest(t: number, bpm: Bpm | null, combo: number, r: TempoRequestOutcome): void {
    if (this.finished) return;
    this.events.push({
      type: 'tempo_request',
      t,
      bpm,
      combo,
      scheduled: r.scheduled,
      applyAtBeat: r.scheduled ? r.applyAtBeat : null,
      reason: r.scheduled ? null : r.reason,
    });
  }

  recordResolution(t: number, r: BeatResolution): void {
    if (this.finished || r.kind === 'ignored_finished') return;
    if (r.comboResetByTempo) this.events.push({ type: 'tempo_applied', t, beat: r.beat, bpm: r.bpm });
    if (r.kind === 'enemy_attack') {
      this.events.push({
        type: 'enemy_attack',
        t,
        beat: r.beat,
        bpm: r.bpm,
        dodge: r.dodge,
        playerDamage: r.playerDamage,
        playerHp: r.state.playerHp,
      });
    } else {
      this.events.push({
        type: 'attack_resolved',
        t,
        beat: r.beat,
        bpm: r.bpm,
        attack: r.attack,
        enemyDamage: r.enemyDamage,
        enemyHp: r.state.enemyHp,
        combo: r.state.combo,
      });
    }
  }

  /** 승패 확정 시 1회 호출. 이후 기록은 무시된다. 두 번째 호출부터는 같은 레코드를 반환. */
  finish(t: number, status: CombatStatus, lastResolvedBeat: number): RunRecord {
    if (this.record) return this.record;
    if (status.phase === 'playing') throw new Error('finish() called while playing');
    const cause = status.phase === 'defeat' ? status.cause : null;
    this.events.push({ type: 'run_end', t, outcome: status.phase, cause, lastResolvedBeat });
    this.record = {
      version: 1,
      ...this.meta,
      outcome: status.phase,
      cause,
      durationSec: t,
      lastResolvedBeat,
      restarted: false,
      summary: summarize(this.events),
      events: [...this.events],
    };
    return this.record;
  }
}

const COUNTED_ATTACK_KINDS: ReadonlySet<InputOutcome['kind']> = new Set([
  'pending',
  'late_miss_combo_reset',
  'beat_already_resolved',
]);

export function summarize(events: readonly TelemetryEvent[]): RunSummary {
  const s: RunSummary = {
    attackJudgeByBpm: perBpm(() => ({ perfect: 0, good: 0, miss: 0 })),
    dodgeByBpm: perBpm(() => ({ perfect: 0, good: 0, miss: 0, none: 0, hits: 0 })),
    damageDealtByBpm: perBpm(() => 0),
    enemyAttacks: 0,
    hitsTaken: 0,
    hitRate: null,
    tempoOpportunities: 0,
    tempoSelections: 0,
    tempoRequests: 0,
    maxBpm: TEMPO_STEPS[0],
    maxCombo: 0,
    firstSuccessfulAttackSec: null,
  };
  for (const e of events) {
    switch (e.type) {
      case 'judge':
        if (e.channel === 'attack' && COUNTED_ATTACK_KINDS.has(e.kind) && e.bpm !== null && e.result) {
          s.attackJudgeByBpm[e.bpm][e.result]++;
          if (e.result !== 'miss' && s.firstSuccessfulAttackSec === null) s.firstSuccessfulAttackSec = e.t;
        }
        break;
      case 'tempo_opportunity':
        s.tempoOpportunities++;
        break;
      case 'tempo_request':
        s.tempoRequests++;
        if (e.scheduled) s.tempoSelections++;
        break;
      case 'enemy_attack':
        s.enemyAttacks++;
        s.dodgeByBpm[e.bpm][e.dodge]++;
        if (e.playerDamage > 0) {
          s.hitsTaken++;
          s.dodgeByBpm[e.bpm].hits++;
        }
        if (e.bpm > s.maxBpm) s.maxBpm = e.bpm;
        break;
      case 'attack_resolved':
        s.damageDealtByBpm[e.bpm] += e.enemyDamage;
        if (e.combo > s.maxCombo) s.maxCombo = e.combo;
        if (e.bpm > s.maxBpm) s.maxBpm = e.bpm;
        break;
      default:
        break;
    }
  }
  s.hitRate = s.enemyAttacks > 0 ? s.hitsTaken / s.enemyAttacks : null;
  return s;
}
