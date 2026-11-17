import { describe, it, expect } from 'vitest';
import { ComboSystem } from '../src/core/comboSystem';

describe('ComboSystem (3.2)', () => {
  it('Perfect/Good +1, Miss → 0', () => {
    const c = new ComboSystem();
    c.applyAttack('perfect');
    c.applyAttack('good');
    expect(c.value).toBe(2);
    c.applyAttack('miss');
    expect(c.value).toBe(0);
    c.applyAttack('good');
    expect(c.value).toBe(1);
  });

  it('reset → 0', () => {
    const c = new ComboSystem();
    for (let i = 0; i < 7; i++) c.applyAttack('perfect');
    c.reset();
    expect(c.value).toBe(0);
  });
});
