// src/main.ts — 게임 진입점
import Phaser from 'phaser';
import { BattleScene, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './game/battleScene';

new Phaser.Game({
  type: Phaser.AUTO,
  // 캔버스 실제 픽셀 = 논리 960×540 × devicePixelRatio. 표시 크기는 zoom으로 960×540 CSS px.
  // FIT(창 크기에 맞춰 늘림)을 쓰지 않는다: 저해상도 캔버스를 CSS로 확대하면 글자가 흐려진다.
  width: Math.round(GAME_WIDTH * RENDER_SCALE),
  height: Math.round(GAME_HEIGHT * RENDER_SCALE),
  backgroundColor: '#111318',
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / RENDER_SCALE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { roundPixels: true },
  // 오디오는 src/audio의 AudioContext만 사용한다. Phaser 사운드 매니저는 끈다.
  audio: { noAudio: true },
  // 키 입력은 KeyboardEvent.timeStamp를 직접 쓰기 위해 window 리스너로 받는다.
  input: { keyboard: false },
  scene: [BattleScene],
});
