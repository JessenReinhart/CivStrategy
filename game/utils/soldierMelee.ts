/**
 * Soldier-Level Melee Utilities
 * Pure functions for Total War-style per-soldier melee steering.
 * Mirrors combatPath.ts pattern: stateless, testable, no Phaser deps.
 */

import {
  MAX_ATTACKERS,
  SEP_COMBAT,
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
} from '../../constants';

// ─── Re-export constants for external consumers ──────────────────────────────
export const STAGGER_DURATION_MS = 220;
export const STAGGER_KNOCKBACK_PX = 2.8;

export {
  MAX_ATTACKERS,
  SEP_COMBAT as SEP_COMBAT_MULTIPLIER,
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
};

// ─── Types ──────────────────────────────────────────────────────────────────
export type SoldierSteeringMode = 'formation' | 'combat';

export interface SoldierCombatState {
  mode: SoldierSteeringMode;
  chargeTimer: number;
  crowdPush: number;
  phase: number;
  /** Optional normalized melee strike cycle (0..1) for thrust/recovery kinematics. */
  strikeProgress?: number;
  /** Optional remaining knockback stagger timer in ms from heavy charge impact. */
  staggerTimer?: number;
}

export interface SoldierOffset {
  x: number;
  y: number;
}

export interface CombatDeformation {
  deformX: number;
  deformY: number;
  spacingScale: number;
  chargeTimer: number;
  staggerTimer?: number;
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

/**
 * Compute soldier combat deformation based on mode, charge, crowd-push, and jitter.
 * Called per-soldier in render loop.
 */
export function computeSoldierCombatDeformation(
  soldier: SoldierCombatState,
  baseDeformX: number,
  baseDeformY: number,
  angle: number,
  timeNow: number
): CombatDeformation {
  let deformX = 0;
  let deformY = 0;
  let spacingScale = 1.0;
  let chargeTimer = soldier.chargeTimer;
  let staggerTimer = soldier.staggerTimer ?? 0;

  if (soldier.mode === 'combat') {
    // Combat clustering: tighter spacing
    spacingScale = COMBAT_SPACING_SCALE;

    // Charge impulse surge: forward along contact direction
    if (chargeTimer > 0) {
      const chargeRatio = chargeTimer / CHARGE_IMPULSE_DURATION_MS;
      deformX = baseDeformX * chargeRatio * CHARGE_THRUST_RATIO;
      deformY = baseDeformY * chargeRatio * CHARGE_THRUST_RATIO;
      chargeTimer = Math.max(0, chargeTimer - CHARGE_TIMER_DECAY_MS);
    }

    // Per-soldier sinusoidal jitter (chaos) — only when no external deformation
    if (baseDeformX === 0 && baseDeformY === 0) {
      const jitter = Math.sin(timeNow / COMBAT_JITTER_PERIOD_MS + soldier.phase) * COMBAT_JITTER_AMPLITUDE;
      deformX += jitter * 0.5;
      deformY += jitter * 0.5;
    }

    // Optional procedural strike lunge & shield recoil along facing angle
    if (typeof soldier.strikeProgress === 'number' && soldier.strikeProgress > 0 && soldier.strikeProgress < 1) {
      const p = soldier.strikeProgress;
      const lungeAmplitude = p < 0.35
        ? (p / 0.35) * 3.5
        : (1 - (p - 0.35) / 0.65) * 3.5 - 0.8 * Math.sin(((p - 0.35) / 0.65) * Math.PI);
      deformX += Math.cos(angle) * lungeAmplitude;
      deformY += Math.sin(angle) * lungeAmplitude;
    }

    // Shock charge impact stagger: brief backward knockback and recovery along facing axis
    if (staggerTimer > 0) {
      const staggerRatio = Math.min(1, staggerTimer / STAGGER_DURATION_MS);
      const knockback = Math.sin(staggerRatio * Math.PI) * STAGGER_KNOCKBACK_PX;
      deformX -= Math.cos(angle) * knockback;
      deformY -= Math.sin(angle) * knockback;
      staggerTimer = Math.max(0, staggerTimer - CHARGE_TIMER_DECAY_MS);
    }
  } else {
    // Formation mode: crowd-push from rear ranks
    if (soldier.crowdPush > 0) {
      // Push forward along formation facing direction
      deformX = Math.cos(angle) * soldier.crowdPush * CROWD_PUSH_FORWARD_RATIO;
      deformY = Math.sin(angle) * soldier.crowdPush * CROWD_PUSH_FORWARD_RATIO;
    }
  }
  return { deformX, deformY, spacingScale, chargeTimer, staggerTimer };
}

/**
 * Compute shock charge stagger duration (ms) inflicted on a defender
 * based on closing speed and defender armor weight.
 */
export function computeChargeImpactStagger(
  chargeSpeed: number,
  armorWeight = 1.0,
): number {
  if (chargeSpeed <= 60) return 0;
  const normalizedSpeed = Math.min(1, (chargeSpeed - 60) / Math.max(1, CHARGE_IMPULSE - 60));
  const weightFactor = 1 / Math.max(0.5, armorWeight);
  return Math.min(STAGGER_DURATION_MS, Math.round(normalizedSpeed * STAGGER_DURATION_MS * weightFactor));
}
/**
 * Select target with attacker cap using spatial hash results.
 * Returns up to MAX_ATTACKERS units sorted by distance to target (closest = front rank).
 */
export function selectTargetWithAttackerCap(
  candidates: Array<{ x: number; y: number; state: string }>,
  targetX: number,
  targetY: number,
  _owner: number,
  _unitState: string
): Array<{ x: number; y: number; state: string }> {
  const frontRank: Array<{ x: number; y: number; state: string }> = [];

  for (const unit of candidates) {
    if (unit.state !== 'chasing' && unit.state !== 'attacking') continue;
    // In real usage, owner check happens here
    frontRank.push(unit);
  }

  // Sort by distance to target (front first)
  frontRank.sort((a, b) => {
    const da = Math.hypot(a.x - targetX, a.y - targetY);
    const db = Math.hypot(b.x - targetX, b.y - targetY);
    return da - db;
  });

  return frontRank.slice(0, MAX_ATTACKERS);
}

/**
 * Compute front-rank detection for a squad.
 * Returns boolean array indicating which soldiers are in front rank.
 */
export function computeFrontRankFlags(
  soldiers: SoldierOffset[],
  angle: number,
  targetDirX: number,
  targetDirY: number
): boolean[] {
  const len = Math.hypot(targetDirX, targetDirY);
  const normX = len > 0 ? targetDirX / len : 0;
  const normY = len > 0 ? targetDirY / len : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return soldiers.map(soldier => {
    // Soldier offset is already in formation-local space
    const wx = soldier.x * cos - soldier.y * sin;
    const wy = soldier.x * sin + soldier.y * cos;
    const dot = wx * normX + wy * normY;
    const dist = Math.hypot(wx, wy);
    // Front rank: facing target and within radius
    return dot > 0 && dist < FRONT_RANK_RADIUS;
  });
}

/**
 * Compute crowd-push weight for rear-rank soldiers.
 * Higher = more push forward through front line.
 */
export function computeCrowdPush(dist: number): number {
  if (dist >= FRONT_RANK_RADIUS) return 0;
  return Math.max(0, FRONT_RANK_RADIUS - dist) * CROWD_PUSH_SCALE;
}
