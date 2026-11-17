// src/main.ts — 게임 진입점
import Phaser from 'phaser';
import { BattleScene, GAME_HEIGHT, GAME_WIDTH } from './game/battleScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#111318',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // 오디오는 src/audio의 AudioContext만 사용한다. Phaser 사운드 매니저는 끈다.
  audio: { noAudio: true },
  // 키 입력은 KeyboardEvent.timeStamp를 직접 쓰기 위해 window 리스너로 받는다.
  input: { keyboard: false },
  scene: [BattleScene],
});
