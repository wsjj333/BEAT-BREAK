/**
 * src/audio/sfx.ts
 * 짧은 효과음. 판정·비트 시각과 무관한 표시용 소리다.
 */

/** 템포 업 가능 알림: 두 음 상승 (triangle, 메트로놈 클릭과 음색 구분). 총 약 120ms */
export function playTempoReadyCue(ctx: AudioContext): void {
  const t0 = ctx.currentTime + 0.005;
  const notes: Array<[number, number]> = [
    [880, 0],
    [1320, 0.06],
  ];
  for (const [freq, dt] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = t0 + dt;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }
}
