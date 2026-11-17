/**
 * src/core/comboSystem.ts
 * 콤보 카운터. 기획서 3.2 기준.
 * 언제 무엇을 반영할지(비트 확정, 템포 적용 리셋)는 CombatSystem이 결정한다.
 */

export type AttackTiming = 'perfect' | 'good' | 'miss';

export class ComboSystem {
  private count = 0;

  get value(): number {
    return this.count;
  }

  /** Perfect/Good 공격 → +1, Miss → 0 */
  applyAttack(result: AttackTiming): void {
    this.count = result === 'miss' ? 0 : this.count + 1;
  }

  /** 템포 변경이 실제 적용되는 비트에서 호출 → 0 */
  reset(): void {
    this.count = 0;
  }
}
