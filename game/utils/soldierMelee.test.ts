import { describe, it, expect } from 'vitest';

import {
  MAX_ATTACKERS,
  SEP_COMBAT_MULTIPLIER,
  CHARGE_IMPULSE,
  CHARGE_IMPULSE_DURATION_MS,
  FRONT_RANK_RADIUS,
  CROWD_PUSH_SCALE,
  COMBAT_SPACING_SCALE,
  COMBAT_JITTER_AMPLITUDE,
  COMBAT_JITTER_PERIOD_MS,
  CHARGE_THRUST_RATIO,
  CROWD_PUSH_FORWARD_RATIO,
  CHARGE_TIMER_DECAY_MS,
  computeSoldierCombatDeformation,
  selectTargetWithAttackerCap,
  computeFrontRankFlags,
  computeCrowdPush,
  type SoldierCombatState,
  type SoldierOffset,
  type CombatDeformation,
} from './soldierMelee';

describe('soldierMelee - pure soldier-level melee utilities', () => {
  // ─── Constants ───────────────────────────────────────────────────────────
  describe('constants', () => {
    it('MAX_ATTACKERS is 3 (front-rank lock)', () => {
      expect(MAX_ATTACKERS).toBe(3);
    });

    it('SEP_COMBAT_MULTIPLIER is 0.5 (combat clustering)', () => {
      expect(SEP_COMBAT_MULTIPLIER).toBe(0.5);
    });

    it('CHARGE_IMPULSE is 120 (first contact velocity boost, cozier)', () => {
      expect(CHARGE_IMPULSE).toBe(120);
    });

    it('CHARGE_IMPULSE_DURATION_MS is 300 (slower decay)', () => {
      expect(CHARGE_IMPULSE_DURATION_MS).toBe(300);
    });

    it('FRONT_RANK_RADIUS is 180', () => {
      expect(FRONT_RANK_RADIUS).toBe(180);
    });

    it('CROWD_PUSH_SCALE is 0.4', () => {
      expect(CROWD_PUSH_SCALE).toBe(0.4);
    });

    it('COMBAT_SPACING_SCALE is 0.5 (tighter cluster)', () => {
      expect(COMBAT_SPACING_SCALE).toBe(0.5);
    });

    it('COMBAT_JITTER_AMPLITUDE is 2', () => {
      expect(COMBAT_JITTER_AMPLITUDE).toBe(2);
    });

    it('COMBAT_JITTER_PERIOD_MS is 100', () => {
      expect(COMBAT_JITTER_PERIOD_MS).toBe(100);
    });

    it('CHARGE_THRUST_RATIO is 0.3', () => {
      expect(CHARGE_THRUST_RATIO).toBe(0.3);
    });

    it('CROWD_PUSH_FORWARD_RATIO is 0.2', () => {
      expect(CROWD_PUSH_FORWARD_RATIO).toBe(0.2);
    });

    it('CHARGE_TIMER_DECAY_MS is 16 (~1 frame at 60fps)', () => {
      expect(CHARGE_TIMER_DECAY_MS).toBe(16);
    });
  });

  // ─── computeSoldierCombatDeformation ───────────────────────────────────
  describe('computeSoldierCombatDeformation', () => {
    const mockSoldier: SoldierCombatState = {
      mode: 'combat',
      chargeTimer: CHARGE_IMPULSE_DURATION_MS,
      crowdPush: 0,
      phase: Math.PI / 4,
    };

    it('returns combat spacing scale (0.5) in combat mode', () => {
      const result = computeSoldierCombatDeformation(mockSoldier, 10, 5, 0, 1000);
      expect(result.spacingScale).toBe(COMBAT_SPACING_SCALE);
    });

    it('applies charge thrust along deformation direction', () => {
      const result = computeSoldierCombatDeformation(mockSoldier, 10, 5, 0, 1000);
      const expectedRatio = mockSoldier.chargeTimer / CHARGE_IMPULSE_DURATION_MS;
      expect(result.deformX).toBeCloseTo(10 * expectedRatio * CHARGE_THRUST_RATIO, 5);
      expect(result.deformY).toBeCloseTo(5 * expectedRatio * CHARGE_THRUST_RATIO, 5);
    });

    it('decays chargeTimer each call', () => {
      let soldier = { ...mockSoldier, chargeTimer: CHARGE_IMPULSE_DURATION_MS };
      const r1 = computeSoldierCombatDeformation(soldier, 10, 5, 0, 1000);
      soldier = { ...soldier, chargeTimer: r1.chargeTimer };
      const r2 = computeSoldierCombatDeformation(soldier, 10, 5, 0, 1016);
      expect(r2.chargeTimer).toBeLessThan(r1.chargeTimer);
      expect(r2.chargeTimer).toBeGreaterThanOrEqual(0);
    });

    it('adds sinusoidal jitter', () => {
      const result = computeSoldierCombatDeformation(mockSoldier, 0, 0, 0, 0);
      // jitter = sin(0 + π/4) * 2 = sqrt(2) ≈ 1.414
      // deformX/Y += jitter * 0.5 ≈ 0.707
      expect(result.deformX).toBeCloseTo(Math.sin(Math.PI / 4) * COMBAT_JITTER_AMPLITUDE * 0.5, 5);
      expect(result.deformY).toBeCloseTo(Math.sin(Math.PI / 4) * COMBAT_JITTER_AMPLITUDE * 0.5, 5);
    });

    it('applies crowd-push in formation mode', () => {
      const formationSoldier: SoldierCombatState = {
        mode: 'formation',
        chargeTimer: 0,
        crowdPush: 20,
        phase: 0,
      };
      const result = computeSoldierCombatDeformation(formationSoldier, 0, 0, 0, 1000);
      expect(result.spacingScale).toBe(1.0);
      expect(result.deformX).toBeCloseTo(Math.cos(0) * 20 * CROWD_PUSH_FORWARD_RATIO, 5);
      expect(result.deformY).toBeCloseTo(Math.sin(0) * 20 * CROWD_PUSH_FORWARD_RATIO, 5);
    });

    it('returns zero deformation for formation mode with no crowd-push', () => {
      const formationSoldier: SoldierCombatState = {
        mode: 'formation',
        chargeTimer: 0,
        crowdPush: 0,
        phase: 0,
      };
      const result = computeSoldierCombatDeformation(formationSoldier, 10, 5, 0, 1000);
      expect(result.deformX).toBe(0);
      expect(result.deformY).toBe(0);
      expect(result.spacingScale).toBe(1.0);
    });

    it('chargeTimer never goes below zero', () => {
      let soldier = { ...mockSoldier, chargeTimer: 10 };
      for (let i = 0; i < 5; i++) {
        const result = computeSoldierCombatDeformation(soldier, 10, 5, 0, 1000 + i * 16);
        soldier = { ...soldier, chargeTimer: result.chargeTimer };
      }
      expect(soldier.chargeTimer).toBe(0);
    });
  });

  // ─── selectTargetWithAttackerCap ───────────────────────────────────────
  describe('selectTargetWithAttackerCap', () => {
    const mockCandidates = [
      { x: 100, y: 100, state: 'chasing' },
      { x: 150, y: 100, state: 'attacking' },
      { x: 200, y: 100, state: 'idle' }, // should be filtered out
      { x: 120, y: 120, state: 'chasing' },
      { x: 300, y: 300, state: 'attacking' },
    ];

    it('filters only chasing and attacking states', () => {
      const result = selectTargetWithAttackerCap(mockCandidates, 0, 0, 0, 'chasing');
      expect(result.length).toBeLessThanOrEqual(MAX_ATTACKERS);
      for (const unit of result) {
        expect(['chasing', 'attacking']).toContain(unit.state);
      }
    });

    it('sorts by distance to target (closest first)', () => {
      const result = selectTargetWithAttackerCap(mockCandidates, 100, 100, 0, 'chasing');
      for (let i = 1; i < result.length; i++) {
        const prevDist = Math.hypot(result[i - 1].x - 100, result[i - 1].y - 100);
        const currDist = Math.hypot(result[i].x - 100, result[i].y - 100);
        expect(prevDist).toBeLessThanOrEqual(currDist);
      }
    });

    it('limits to MAX_ATTACKERS', () => {
      const manyCandidates = Array.from({ length: 10 }, (_, i) => ({
        x: 100 + i * 10,
        y: 100,
        state: 'chasing',
      }));
      const result = selectTargetWithAttackerCap(manyCandidates, 0, 0, 0, 'chasing');
      expect(result.length).toBe(MAX_ATTACKERS);
    });

    it('returns empty array for no valid candidates', () => {
      const result = selectTargetWithAttackerCap(
        [{ x: 100, y: 100, state: 'idle' }],
        0,
        0,
        0,
        'chasing'
      );
      expect(result).toEqual([]);
    });
  });

  // ─── computeFrontRankFlags ─────────────────────────────────────────────
  describe('computeFrontRankFlags', () => {
    const soldiers: SoldierOffset[] = [
      { x: 10, y: 0 }, // front
      { x: 0, y: 10 }, // side
      { x: -10, y: 0 }, // rear
      { x: 0, y: -10 }, // side
    ];

    it('returns true for soldiers facing target within radius', () => {
      const angle = 0;
      const targetDirX = 1;
      const targetDirY = 0;
      const flags = computeFrontRankFlags(soldiers, angle, targetDirX, targetDirY);
      // First soldier at (10, 0): dot = 10*1 + 0*0 = 10 > 0, dist = 10 < 180
      expect(flags[0]).toBe(true);
      // Third soldier at (-10, 0): dot = -10 < 0
      expect(flags[2]).toBe(false);
    });

    it('returns false for soldiers outside front rank radius', () => {
      const farSoldiers: SoldierOffset[] = [{ x: 200, y: 0 }];
      const flags = computeFrontRankFlags(farSoldiers, 0, 1, 0);
      expect(flags[0]).toBe(false);
    });

    it('respects formation angle rotation', () => {
      const angle = Math.PI / 2; // 90 degrees
      const targetDirX = 0;
      const targetDirY = 1;
      const flags = computeFrontRankFlags(soldiers, angle, targetDirX, targetDirY);
      // Soldier at (10, 0) rotated 90° -> (0, 10): dot = 0*0 + 10*1 = 10 > 0
      expect(flags[0]).toBe(true);
    });
  });

  // ─── computeCrowdPush ──────────────────────────────────────────────────
  describe('computeCrowdPush', () => {
    it('returns 0 at or beyond FRONT_RANK_RADIUS', () => {
      expect(computeCrowdPush(FRONT_RANK_RADIUS)).toBe(0);
      expect(computeCrowdPush(FRONT_RANK_RADIUS + 10)).toBe(0);
    });

    it('increases as distance decreases', () => {
      const push1 = computeCrowdPush(FRONT_RANK_RADIUS / 2);
      const push2 = computeCrowdPush(FRONT_RANK_RADIUS / 4);
      expect(push2).toBeGreaterThan(push1);
    });

    it('max push at distance 0', () => {
      const maxPush = computeCrowdPush(0);
      expect(maxPush).toBe(FRONT_RANK_RADIUS * CROWD_PUSH_SCALE);
    });

    it('never returns negative', () => {
      expect(computeCrowdPush(1000)).toBe(0);
      expect(computeCrowdPush(-10)).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Type exports ──────────────────────────────────────────────────────
  describe('type exports', () => {
    it('CombatDeformation has correct shape', () => {
      const deformation: CombatDeformation = {
        deformX: 1,
        deformY: 2,
        spacingScale: 0.5,
        chargeTimer: 100,
      };
      expect(typeof deformation.deformX).toBe('number');
      expect(typeof deformation.deformY).toBe('number');
      expect(typeof deformation.spacingScale).toBe('number');
      expect(typeof deformation.chargeTimer).toBe('number');
    });

    it('SoldierCombatState has correct shape', () => {
      const state: SoldierCombatState = {
        mode: 'combat',
        chargeTimer: 150,
        crowdPush: 20,
        phase: Math.PI,
      };
      expect(state.mode).toBe('combat');
      expect(typeof state.chargeTimer).toBe('number');
      expect(typeof state.crowdPush).toBe('number');
      expect(typeof state.phase).toBe('number');
    });
  });
});