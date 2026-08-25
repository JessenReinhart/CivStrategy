import { describe, expect, it } from 'vitest';

import { isPlayerEnemyEngagement, MusicStateController } from './MusicStateController';

describe('MusicStateController', () => {
  it('uses idle music before combat starts', () => {
    const controller = new MusicStateController();

    expect(controller.resolve(1_000, false)).toBe('idle');
  });

  it('switches to battle music as soon as combat is active', () => {
    const controller = new MusicStateController();

    expect(controller.resolve(1_000, true)).toBe('battle');
  });

  it('holds battle music through brief disengagements', () => {
    const controller = new MusicStateController(8_000);

    controller.resolve(1_000, true);

    expect(controller.resolve(8_999, false)).toBe('battle');
    expect(controller.resolve(9_000, false)).toBe('idle');
  });

  it('extends the hold window when combat resumes', () => {
    const controller = new MusicStateController(8_000);

    controller.resolve(1_000, true);
    controller.resolve(7_000, true);

    expect(controller.resolve(14_999, false)).toBe('battle');
    expect(controller.resolve(15_000, false)).toBe('idle');
  });
});

describe('isPlayerEnemyEngagement', () => {
  it('accepts combat in either player-enemy direction', () => {
    expect(isPlayerEnemyEngagement(0, 1)).toBe(true);
    expect(isPlayerEnemyEngagement(1, 0)).toBe(true);
  });

  it('ignores allies and neutral animals', () => {
    expect(isPlayerEnemyEngagement(0, 0)).toBe(false);
    expect(isPlayerEnemyEngagement(0, -1)).toBe(false);
    expect(isPlayerEnemyEngagement(1, -1)).toBe(false);
  });
});
