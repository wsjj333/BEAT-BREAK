/**
 * src/game/battleScene.ts
 * Phaser 화면·입력·표시. 도형과 텍스트만 사용한다 (그래픽 작업 없음).
 *
 * 시간 규칙:
 * - 모든 판정·확정 시각 = 오디오 시계(AudioContext.currentTime) - 원점(beat 0의 오디오 시각).
 * - 입력 시각 = KeyboardEvent.timeStamp를 오디오 시계로 변환한 값 (AudioClock.eventToAudioSec).
 * - Phaser의 프레임 delta/time은 판정에 쓰지 않는다. 판정 텍스트 페이드 같은 연출에만 tween을 쓴다.
 */

import Phaser from 'phaser';
import { AudioClock } from '../audio/audioClock';
import { Metronome, createClickPlayer } from '../audio/metronome';
import type { BeatResolution, InputOutcome } from '../core/combatSystem';
import {
  BEATS_PER_BAR,
  type Bpm,
  CALIBRATION_OFFSET_DEFAULT_MS,
  CALIBRATION_OFFSET_MAX_MS,
  CALIBRATION_OFFSET_MIN_MS,
  CALIBRATION_OFFSET_STEP_MS,
  ENEMY_HP,
  MAX_BEATS,
  PLAYER_HP,
  isEnemyAttackBeat,
  nextTempo,
} from '../core/config';
import type { TempoRequestOutcome, RunRecord } from '../telemetry/runTelemetry';
import { downloadRunsJson, markRestarted, saveRun } from '../telemetry/storage';
import { BattleSession, type TempoStatus } from './battleSession';

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/**
 * 시작/재시작 시 beat 0까지의 대기 시간(초). 오디오 예약은 미래 시각만 가능하므로 필요한 기술값.
 * 규칙(beat 0 = 전투 시작 기준)은 바뀌지 않는다. D-08(b) 제안.
 */
const START_LEAD_IN_SEC = 1.0;

/** 비트 표시기 깜빡임 길이(초). 표시 전용 */
const BEAT_FLASH_SEC = 0.1;

const FONT = 'system-ui, "Malgun Gothic", sans-serif';
const COLOR = {
  bg: 0x111318,
  player: 0x4fa3ff,
  enemy: 0xd9534f,
  enemyWarn: 0xffb020,
  hpBack: 0x333842,
  hpPlayer: 0x4fd18b,
  hpEnemy: 0xe0645f,
  beatOff: 0x2a2f3a,
  beatCurrent: 0x6b7385,
  beatFlash: 0xffffff,
  beatEnemy: 0xff5a4f,
};
const JUDGE_COLOR: Record<string, string> = {
  perfect: '#ffd34d',
  good: '#6fe08f',
  miss: '#9aa0aa',
  info: '#c8ccd4',
};

type Mode = 'title' | 'starting' | 'playing' | 'result';

const HANDLED_CODES = new Set(['KeyJ', 'KeyF', 'KeyT', 'KeyR', 'BracketLeft', 'BracketRight']);

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export class BattleScene extends Phaser.Scene {
  private mode: Mode = 'title';
  private clock: AudioClock | null = null;
  private session: BattleSession | null = null;
  private metronome: Metronome | null = null;
  private lastRecord: RunRecord | null = null;
  /** beat 0의 오디오 시계 시각(초) */
  private originSec = 0;
  /** 다음 판에 적용할 캘리브레이션 오프셋. 진행 중인 판은 생성 시 값을 유지 (CombatSystem에 setter 없음) */
  private offsetMs = CALIBRATION_OFFSET_DEFAULT_MS;
  private runCount = 0;

  // UI
  private titleLayer!: Phaser.GameObjects.Container;
  private battleLayer!: Phaser.GameObjects.Container;
  private resultLayer!: Phaser.GameObjects.Container;
  private titleStatus!: Phaser.GameObjects.Text;
  private offsetText!: Phaser.GameObjects.Text;

  private playerRect!: Phaser.GameObjects.Rectangle;
  private enemyRect!: Phaser.GameObjects.Rectangle;
  private playerHpFill!: Phaser.GameObjects.Rectangle;
  private enemyHpFill!: Phaser.GameObjects.Rectangle;
  private playerHpText!: Phaser.GameObjects.Text;
  private enemyHpText!: Phaser.GameObjects.Text;
  private bpmText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private tempoText!: Phaser.GameObjects.Text;
  private beatText!: Phaser.GameObjects.Text;
  private beatBoxes: Phaser.GameObjects.Rectangle[] = [];
  private warnText!: Phaser.GameObjects.Text;
  private judgeText!: Phaser.GameObjects.Text;
  private eventText!: Phaser.GameObjects.Text;
  private resultTitle!: Phaser.GameObjects.Text;
  private resultBody!: Phaser.GameObjects.Text;

  private readonly HP_BAR_W = 220;

  constructor() {
    super('battle');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg);
    this.buildTitle();
    this.buildBattle();
    this.buildResult();
    this.offsetText = this.add
      .text(GAME_WIDTH - 16, GAME_HEIGHT - 16, '', { fontFamily: FONT, fontSize: '16px', color: '#c8ccd4', align: 'right' })
      .setOrigin(1, 1);
    this.renderOffset();
    this.setMode('title');

    window.addEventListener('keydown', this.onKeyDown);
    this.game.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKeyDown);
      this.game.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
      this.metronome?.stop();
    });
  }

  // ─── 화면 구성 ───────────────────────────────────────────────────────────

  private text(x: number, y: number, s: string, size: number, color = '#e8eaf0'): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color });
  }

  private buildTitle(): void {
    const cx = GAME_WIDTH / 2;
    const title = this.text(cx, 130, 'BEAT//BREAK', 56).setOrigin(0.5);
    const controls = this.text(
      cx,
      260,
      [
        'J: 공격 (박자에 맞춰)   ·   F: 회피 (⚠ 표시된 적 공격 박자, Perfect만 성공)',
        'T: 템포 업 (콤보 5 이상, 다음 마디부터 BPM↑ · 피해↑ · 콤보 0)',
        '[ / ]: 오프셋 −10/+10ms   ·   R: 결과 화면에서 재시작',
      ].join('\n'),
      18,
      '#c8ccd4',
    )
      .setOrigin(0.5)
      .setAlign('center')
      .setLineSpacing(10);
    this.titleStatus = this.text(cx, 390, '클릭하여 시작', 26, '#ffd34d').setOrigin(0.5);
    this.titleLayer = this.add.container(0, 0, [title, controls, this.titleStatus]);
  }

  private buildBattle(): void {
    const px = 260;
    const ex = 700;
    const y = 300;
    this.playerRect = this.add.rectangle(px, y, 90, 130, COLOR.player);
    this.enemyRect = this.add.rectangle(ex, y, 130, 170, COLOR.enemy).setStrokeStyle(0, COLOR.enemyWarn);

    const hpY = 190;
    const pBack = this.add.rectangle(px, hpY, this.HP_BAR_W, 16, COLOR.hpBack);
    const eBack = this.add.rectangle(ex, hpY, this.HP_BAR_W, 16, COLOR.hpBack);
    this.playerHpFill = this.add.rectangle(px - this.HP_BAR_W / 2, hpY, this.HP_BAR_W, 16, COLOR.hpPlayer).setOrigin(0, 0.5);
    this.enemyHpFill = this.add.rectangle(ex - this.HP_BAR_W / 2, hpY, this.HP_BAR_W, 16, COLOR.hpEnemy).setOrigin(0, 0.5);
    this.playerHpText = this.text(px, hpY - 24, '', 16).setOrigin(0.5);
    this.enemyHpText = this.text(ex, hpY - 24, '', 16).setOrigin(0.5);

    this.bpmText = this.text(16, 14, '', 26);
    this.comboText = this.text(16, 48, '', 22);
    this.tempoText = this.text(16, 80, '', 18, '#c8ccd4');
    this.beatText = this.text(GAME_WIDTH - 16, 14, '', 16, '#9aa0aa').setOrigin(1, 0);

    const boxY = 60;
    for (let i = 0; i < BEATS_PER_BAR; i++) {
      const box = this.add.rectangle(GAME_WIDTH / 2 + (i - 1.5) * 52, boxY, 40, 40, COLOR.beatOff);
      this.beatBoxes.push(box);
    }
    const boxHint = this.text(GAME_WIDTH / 2, boxY + 30, '마디 첫 박(빨간 테두리) = 적 공격 박자 (beat 0 제외)', 13, '#9aa0aa').setOrigin(0.5, 0);

    this.warnText = this.text(ex, y + 110, '', 20, '#ffb020').setOrigin(0.5, 0);
    this.judgeText = this.text(GAME_WIDTH / 2, 410, '', 40).setOrigin(0.5);
    this.eventText = this.text(GAME_WIDTH / 2, 460, '', 20, '#c8ccd4').setOrigin(0.5);

    this.battleLayer = this.add.container(0, 0, [
      this.playerRect,
      this.enemyRect,
      pBack,
      eBack,
      this.playerHpFill,
      this.enemyHpFill,
      this.playerHpText,
      this.enemyHpText,
      this.bpmText,
      this.comboText,
      this.tempoText,
      this.beatText,
      ...this.beatBoxes,
      boxHint,
      this.warnText,
      this.judgeText,
      this.eventText,
    ]);
  }

  private buildResult(): void {
    const cx = GAME_WIDTH / 2;
    const shade = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75);
    this.resultTitle = this.text(cx, 90, '', 44).setOrigin(0.5);
    this.resultBody = this.text(cx, 145, '', 17, '#c8ccd4').setOrigin(0.5, 0).setAlign('center').setLineSpacing(6);
    const restart = this.text(cx, 430, 'R: 재시작', 24, '#ffd34d').setOrigin(0.5);
    const download = this.text(cx, 475, '[ 플레이 로그 JSON 다운로드 ]', 18, '#6fb6ff')
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    download.on('pointerdown', () => {
      if (this.lastRecord) downloadRunsJson(this.lastRecord);
    });
    this.resultLayer = this.add.container(0, 0, [shade, this.resultTitle, this.resultBody, restart, download]);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.titleLayer.setVisible(mode === 'title' || mode === 'starting');
    this.battleLayer.setVisible(mode === 'playing' || mode === 'result');
    this.resultLayer.setVisible(mode === 'result');
  }

  // ─── 시작 / 재시작 ───────────────────────────────────────────────────────

  /** 클릭(사용자 제스처) 핸들러 안에서 AudioContext를 만든다 (자동재생 정책) */
  private onCanvasPointerDown = (): void => {
    if (this.mode !== 'title') return;
    this.mode = 'starting';
    this.titleStatus.setText('오디오 시작 중…');
    AudioClock.startFromGesture()
      .then((clock) => {
        this.clock = clock;
        this.startRun();
      })
      .catch((err: unknown) => {
        console.error(err);
        this.mode = 'title';
        this.titleStatus.setText('오디오를 시작하지 못했습니다. 다시 클릭하세요.');
      });
  };

  /** 새 판 시작. CombatSystem/RunTelemetry는 BattleSession이 새 인스턴스로 만든다 */
  private startRun(): void {
    const clock = this.clock;
    if (!clock) return;
    this.metronome?.stop();
    this.runCount++;
    const startedAt = new Date().toISOString();
    const session = new BattleSession({
      calibrationOffsetMs: this.offsetMs,
      runId: `${startedAt}#${this.runCount}`,
      startedAt,
    });
    this.session = session;
    this.lastRecord = null;
    this.originSec = clock.now() + START_LEAD_IN_SEC;
    const origin = this.originSec;
    this.metronome = new Metronome({
      audioNow: () => clock.now(),
      beatAudioTime: (beat) => origin + session.combat.beatTime(beat),
      playClick: createClickPlayer(clock.ctx),
      lastBeat: MAX_BEATS - 1,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
    });
    this.metronome.start();
    this.judgeText.setText('');
    this.eventText.setText('');
    this.setMode('playing');
    this.renderOffset();
  }

  // ─── 입력 ─────────────────────────────────────────────────────────────────

  /** 한글 IME 상태에서도 동작하도록 e.key가 아닌 e.code(물리 키)를 쓴다 */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!HANDLED_CODES.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;

    switch (e.code) {
      case 'BracketLeft':
        this.adjustOffset(-CALIBRATION_OFFSET_STEP_MS);
        return;
      case 'BracketRight':
        this.adjustOffset(CALIBRATION_OFFSET_STEP_MS);
        return;
      case 'KeyR':
        if (this.mode === 'result') {
          if (this.lastRecord) markRestarted(this.lastRecord.runId);
          this.startRun();
        }
        return;
    }

    const clock = this.clock;
    const session = this.session;
    if (this.mode !== 'playing' || !clock || !session) return;

    if (e.code === 'KeyT') {
      // TempoSystem 계약: nowSec = 현재 시각(오디오 시계)
      const r = session.requestTempoUp(clock.now() - this.originSec);
      this.showTempoRequest(r);
      return;
    }

    // 입력 시각: 이벤트 발생 시각을 오디오 시계로 변환 → 원점 차감. 오프셋 보정은 core가 한다.
    const inputSec = clock.eventToAudioSec(e.timeStamp) - this.originSec;
    const channel = e.code === 'KeyJ' ? 'attack' : 'dodge';
    this.showJudge(session.input(inputSec, channel), channel);
  };

  private adjustOffset(delta: number): void {
    const next = this.offsetMs + delta;
    if (next < CALIBRATION_OFFSET_MIN_MS || next > CALIBRATION_OFFSET_MAX_MS) return;
    this.offsetMs = next;
    this.renderOffset();
  }

  // ─── 매 프레임 ──────────────────────────────────────────────────────────

  update(): void {
    if (this.mode !== 'playing' || !this.clock || !this.session) return;
    const nowSec = this.clock.now() - this.originSec;
    const session = this.session;

    for (const r of session.update(nowSec)) this.showResolution(r);
    this.renderBattle(nowSec);

    const record = session.finishedRecord;
    if (record) {
      this.metronome?.stop();
      this.lastRecord = record;
      saveRun(record);
      this.showResult(record);
    }
  }

  private renderBattle(nowSec: number): void {
    const session = this.session!;
    const state = session.getState(nowSec);
    const beat = session.displayBeat(nowSec);
    const bpm = session.combat.getBpmAtBeat(Math.max(0, beat));

    this.playerHpFill.width = (this.HP_BAR_W * state.playerHp) / PLAYER_HP;
    this.enemyHpFill.width = (this.HP_BAR_W * state.enemyHp) / ENEMY_HP;
    this.playerHpText.setText(`PLAYER  HP ${state.playerHp} / ${PLAYER_HP}`);
    this.enemyHpText.setText(`ENEMY  HP ${state.enemyHp.toFixed(1)} / ${ENEMY_HP}`);

    this.bpmText.setText(`${bpm} BPM`);
    this.comboText.setText(`콤보 ${state.combo}`);
    this.tempoText.setText(this.tempoLabel(session.tempoStatus(nowSec), bpm));
    this.beatText.setText(beat < 0 ? '준비…' : `beat ${beat} / ${MAX_BEATS - 1}`);

    // 비트 표시기: 마디 안 위치, 박 시작 후 BEAT_FLASH_SEC 동안 깜빡임 (오디오 시계 기준)
    const flashing = beat >= 0 && nowSec - session.combat.beatTime(beat) < BEAT_FLASH_SEC;
    const barBase = Math.max(0, beat) - (Math.max(0, beat) % BEATS_PER_BAR);
    this.beatBoxes.forEach((box, i) => {
      const isCurrent = beat >= 0 && beat % BEATS_PER_BAR === i;
      box.fillColor = isCurrent ? (flashing ? COLOR.beatFlash : COLOR.beatCurrent) : COLOR.beatOff;
      const enemyBox = isEnemyAttackBeat(barBase + i);
      box.setStrokeStyle(enemyBox ? 3 : 0, COLOR.beatEnemy);
    });

    // 적 공격 경고: 공격 비트 1박 전부터 그 비트 확정까지 (3.3)
    const preWarn = beat + 1 < MAX_BEATS && isEnemyAttackBeat(beat + 1);
    const onAttack = beat >= 0 && isEnemyAttackBeat(beat) && state.lastResolvedBeat < beat;
    if (preWarn) this.warnText.setText('⚠ 다음 박 적 공격 — F로 회피 준비');
    else if (onAttack) this.warnText.setText('⚠ 적 공격! F');
    else this.warnText.setText('');
    this.enemyRect.fillColor = preWarn || onAttack ? COLOR.enemyWarn : COLOR.enemy;
  }

  private tempoLabel(s: TempoStatus, bpm: Bpm): string {
    switch (s.kind) {
      case 'available':
        return `▶ T: 템포 업 가능 (→ ${nextTempo(bpm) ?? bpm} BPM)`;
      case 'combo_too_low':
        return `템포 업 불가: 콤보 ${s.need} 필요`;
      case 'pending':
        return `템포 업 예약됨: beat ${s.applyAtBeat}부터 ${s.bpm} BPM`;
      case 'at_max':
        return '최대 BPM';
      case 'not_started':
        return '준비…';
      case 'finished':
        return '';
    }
  }

  private renderOffset(): void {
    const cur = this.session?.calibrationOffsetMs;
    const lines = [`오프셋 ${signed(this.offsetMs)}ms  ( + 는 입력을 늦게 보정 )  [ / ] 조절`];
    if (this.mode === 'playing' && cur !== undefined && cur !== this.offsetMs) {
      lines.push(`현재 판 ${signed(cur)}ms 적용 중 — 새 값은 다음 판부터`);
    }
    this.offsetText.setText(lines.join('\n'));
  }

  // ─── 피드백 ───────────────────────────────────────────────────────────────

  private flashJudge(s: string, color: string): void {
    this.tweens.killTweensOf(this.judgeText);
    this.judgeText.setText(s).setColor(color).setAlpha(1);
    this.tweens.add({ targets: this.judgeText, alpha: 0, delay: 350, duration: 300 });
  }

  private flashEvent(s: string): void {
    this.tweens.killTweensOf(this.eventText);
    this.eventText.setText(s).setAlpha(1);
    this.tweens.add({ targets: this.eventText, alpha: 0, delay: 900, duration: 400 });
  }

  /** 입력 즉시 판정 표시. 최종 HP 반영은 비트 확정 시 */
  private showJudge(o: InputOutcome, channel: 'attack' | 'dodge'): void {
    const prefix = channel === 'dodge' ? '회피 ' : '';
    switch (o.kind) {
      case 'pending': {
        const err = `${o.errorMs >= 0 ? '+' : ''}${o.errorMs.toFixed(0)}ms`;
        this.flashJudge(`${prefix}${o.result.toUpperCase()}  ${err}`, JUDGE_COLOR[o.result]);
        break;
      }
      case 'late_miss_combo_reset':
        this.flashJudge(`MISS (늦음)`, JUDGE_COLOR.miss);
        break;
      case 'beat_already_resolved':
        this.flashJudge(`${prefix}${o.result.toUpperCase()} (이미 확정)`, JUDGE_COLOR[o.result]);
        break;
      case 'attack_ignored_dodge_beat':
        this.flashJudge('공격 무시 — 회피 박자', JUDGE_COLOR.info);
        break;
      case 'dodge_no_effect':
        this.flashJudge('회피 효과 없음 — 일반 박자', JUDGE_COLOR.info);
        break;
      case 'duplicate_ignored':
        this.flashJudge('중복 입력 무시', JUDGE_COLOR.info);
        break;
      case 'ignored_finished':
        break;
    }
  }

  private showTempoRequest(r: TempoRequestOutcome): void {
    if (r.scheduled) {
      this.flashEvent(`템포 업 예약: beat ${r.applyAtBeat}부터`);
      return;
    }
    const reasons: Record<string, string> = {
      combo_too_low: '템포 업 불가: 콤보 부족',
      at_max: '템포 업 불가: 최대 BPM',
      pending: '템포 업 이미 예약됨',
      not_started: '템포 업 불가: 시작 전',
      finished: '',
    };
    this.flashEvent(reasons[r.reason] ?? `템포 업 거절: ${r.reason}`);
  }

  private showResolution(r: BeatResolution): void {
    if (r.kind === 'ignored_finished') return;
    if (r.comboResetByTempo) this.flashEvent(`${r.bpm} BPM! 콤보 0`);
    if (r.kind === 'enemy_attack') {
      if (r.playerDamage > 0) {
        this.flashEvent(r.dodge === 'none' ? '피격 −1 (회피 안 함)' : `피격 −1 (회피 ${r.dodge.toUpperCase()})`);
        this.blink(this.playerRect);
      } else {
        this.flashEvent('회피 성공!');
      }
    } else if (r.enemyDamage > 0) {
      this.blink(this.enemyRect);
    }
  }

  private blink(rect: Phaser.GameObjects.Rectangle): void {
    this.tweens.killTweensOf(rect);
    rect.setAlpha(0.3);
    this.tweens.add({ targets: rect, alpha: 1, duration: 200 });
  }

  // ─── 결과 ─────────────────────────────────────────────────────────────────

  private showResult(rec: RunRecord): void {
    const s = rec.summary;
    this.resultTitle.setText(
      rec.outcome === 'victory' ? '승리!' : rec.cause === 'timeout' ? '패배 — 시간 초과 (120비트)' : '패배 — HP 0',
    );
    const judgeLines = ([100, 120, 140] as const)
      .map((b) => {
        const c = s.attackJudgeByBpm[b];
        return `${b} BPM  공격 P/G/M ${c.perfect}/${c.good}/${c.miss}  피해 ${s.damageDealtByBpm[b].toFixed(1)}`;
      })
      .join('\n');
    this.resultBody.setText(
      [
        `플레이 시간 ${rec.durationSec.toFixed(1)}초  ·  마지막 beat ${rec.lastResolvedBeat}`,
        `최고 BPM ${s.maxBpm}  ·  최대 콤보 ${s.maxCombo}`,
        `템포 업 기회 ${s.tempoOpportunities}회  ·  선택 ${s.tempoSelections}회`,
        `피격 ${s.hitsTaken} / 적 공격 ${s.enemyAttacks}`,
        judgeLines,
        `오프셋 ${signed(rec.calibrationOffsetMs)}ms`,
      ].join('\n'),
    );
    this.setMode('result');
    this.renderOffset();
  }
}
