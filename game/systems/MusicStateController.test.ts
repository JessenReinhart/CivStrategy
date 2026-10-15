import { describe, expect, it } from 'vitest';

import {
  isPlayerEnemyEngagement,
  MusicStateController,
  resolveAdaptiveCrossfadeMs,
  resolveBattleTrackVolume,
  resolveCombatThreatLevel,
  type CombatThreatLevel,
} from './MusicStateController';

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

describe('resolveBattleTrackVolume', () => {
  it('scales battle volume smoothly from skirmish to full army clash', () => {
    const skirmish = resolveBattleTrackVolume(0.4, 1);
    const mediumClash = resolveBattleTrackVolume(0.4, 4);
    const fullBattle = resolveBattleTrackVolume(0.4, 12);

    expect(skirmish).toBeGreaterThan(0.36);
    expect(mediumClash).toBeGreaterThan(skirmish);
    expect(fullBattle).toBeGreaterThan(mediumClash);
    expect(fullBattle).toBeCloseTo(0.4 * 1.08, 5);
  });
});

describe('resolveCombatThreatLevel & resolveAdaptiveCrossfadeMs', () => {
  it('classifies calm, skirmish, and pitched-battle threat tiers accurately', () => {
    const calm: CombatThreatLevel = resolveCombatThreatLevel(0, 0);
    const skirmish: CombatThreatLevel = resolveCombatThreatLevel(2, 1);
    const pitchedByUnits: CombatThreatLevel = resolveCombatThreatLevel(6, 0);
    const pitchedByClashes: CombatThreatLevel = resolveCombatThreatLevel(3, 3);

    expect(calm).toBe('calm');
    expect(skirmish).toBe('skirmish');
    expect(pitchedByUnits).toBe('pitched-battle');
    expect(pitchedByClashes).toBe('pitched-battle');
  });

  it('uses faster crossfades for pitched battles and gentler releases back to idle', () => {
    expect(resolveAdaptiveCrossfadeMs('battle', 'pitched-battle')).toBe(850);
    expect(resolveAdaptiveCrossfadeMs('battle', 'skirmish')).toBe(1_400);
    expect(resolveAdaptiveCrossfadeMs('idle', 'calm')).toBe(2_400);
  });
});
