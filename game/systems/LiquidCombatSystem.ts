import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, GameUnit } from '../../types';

/**
 * LiquidCombatSystem — produces the visual illusion of liquid mass melee.
 *
 * Three cheap, scalable forces (no Navier-Stokes, no fluid engine):
 *
 * 1. Pressure        — high-density SpatialHash cells push units outward.
 *                      Front lines compress naturally; units squeeze around congestion.
 * 2. Contact line    — opposing-formation pairs detected once per frame (m = formations,
 *                      NOT n = units). At contact boundaries, push backward + lateral tangent.
 *                      Contact lines ripple and bend instead of stopping abruptly.
 * 3. Velocity align  — lerp each unit's velocity toward neighbor average. Kills jitter,
 *                      makes the mass flow coherently instead of chaos.
 *
 * Integration: the per-unit force application lives inside UnitSystem's existing
 * rotating bucket (maxUnitsPerFrame) — see UnitSystem.applyLiquidSteering().
 * This system only does the once-per-frame precomputation (pressure grid + contact lines).
 * Velocity alignment is done per-unit in the bucket pass to avoid a second O(n) neighbor sweep.
 *
 * Performance:
 * - Pressure: O(cells with units) ≈ O(n) but with tiny constant (Map lookup + counter).
 * - Contact:  O(formations²) where formations << units (we group by owner + 150px cell).
 * - Align:    O(n × neighbors) but piggybacks on the existing separation tick interval
 *             and reuses the same SpatialHash.query() results — no double sweep.
 *
 * The visual payoff: two armies collide → dense front compresses → pressure propagates
 * → contact line ripples sideways → units flow around congestion → formations deform
 * but maintain cohesion via alignment. Reads as "wall of bodies" from RTS camera.
 */

// ─── Tuning constants ────────────────────────────────────────────────────
// All forces are velocity-space nudges (units/sec²), NOT positional displacement.

/** Pressure: units per cell at which pressure is "maxed" (outward push saturates). */
const PRESSURE_DENSITY_MAX = 8;
/** Pressure: max outward push strength (px/s applied to velocity). */
const PRESSURE_FORCE_MAX = 60;
/** Pressure: how strongly density above baseline generates force. Quadratic = realistic compression. */
const PRESSURE_CURVE = 2.0;

/** Contact line: max distance (px) at which opposing forces still apply. */
const CONTACT_RANGE = 100;
/** Contact line: backward push strength (push away from enemy). */
const CONTACT_BACKWARD_FORCE = 80;
/** Contact line: lateral tangent push strength (flow along the front). */
const CONTACT_LATERAL_FORCE = 50;
/** Contact line: how far (px) to sample the enemy centroid for normal calculation. */
const CONTACT_SAMPLE_RADIUS = 80;

/** Velocity alignment: max neighbor query radius (px). */
const ALIGN_RADIUS = 30;
/** Velocity alignment: max interpolation factor toward neighbor average (per application). */
const ALIGN_STRENGTH = 0.15;
/** Velocity alignment: min neighbor count before alignment kicks in (avoid lone-unit drift). */
const ALIGN_MIN_NEIGHBORS = 2;

/** SpatialHash cell size (must match MainScene's unitSpatialHash = 150). */
const CELL_SIZE = 150;

// ─── Types ───────────────────────────────────────────────────────────────

interface CellPressure {
    /** Outward pressure direction + magnitude (normalized × force). */
    dirX: number;
    dirY: number;
    /** Raw force magnitude for this cell. */
    force: number;
    /** Unit count. */
    density: number;
}

interface ContactLine {
    /** Contact boundary center. */
    x: number;
    y: number;
    /** Normal pointing from friendly → enemy. */
    nx: number;
    ny: number;
    /** Tangent (perpendicular to normal) for lateral flow. */
    tx: number;
    ty: number;
    /** Strength 0–1 based on proximity of the two formations. */
    strength: number;
    /** Which owner this contact affects (the friendly side). */
    owner: number;
}

// ─── System ──────────────────────────────────────────────────────────────

export class LiquidCombatSystem {
    private scene: MainScene;

    /** Per-frame pressure grid, keyed by "cx,cy" SpatialHash cell key. */
    private pressureGrid: Map<string, CellPressure> = new Map();

    /** Per-frame contact lines, one per opposing formation pair. */
    private contactLines: ContactLine[] = [];

    /** Diagnostic: whether liquid combat is active (disabled in peaceful/stress-peaceful). */
    public enabled: boolean = true;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    /**
     * Once-per-frame precomputation. Called BEFORE UnitSystem's bucket pass so
     * the pressure grid and contact lines are ready for per-unit force application.
     *
     * Cost: O(units) for pressure + O(formations²) for contact detection.
     * At 5000 units this is ~0.5–1ms on a modern CPU.
     */
    public precompute(): void {
        if (!this.enabled) return;

        // Peaceful / stress-peaceful: no combat forces needed.
        const peacefulStress = !!this.scene.stressTestConfig && !this.scene.stressTestConfig.enableEnemies;
        if (peacefulStress || this.scene.peacefulMode) {
            this.pressureGrid.clear();
            this.contactLines.length = 0;
            return;
        }

        const allUnits = this.scene.units.getChildren() as GameUnit[];

        // ── 1. Pressure grid ──────────────────────────────────────────
        // Count units per cell, then compute outward pressure from density gradients.
        this.buildPressureGrid(allUnits);

        // ── 2. Contact lines ──────────────────────────────────────────
        // Detect opposing formation pairs and compute contact boundaries.
        this.detectContactLines(allUnits);
    }

    // ─── Pressure ────────────────────────────────────────────────────────

    /**
     * Build the pressure grid: for each occupied cell, compute the average
     * outward pressure direction (away from cell centroid) and force magnitude
     * based on density².
     *
     * We approximate "outward" by comparing this cell's density to the average
     * of its 8 neighbors. High-density cells surrounded by lower-density cells
     * get strong outward pressure; uniformly dense areas get less (no gradient).
     */
    private buildPressureGrid(units: GameUnit[]): void {
        this.pressureGrid.clear();

        // Phase 1: count density + accumulate centroid per cell.
        const cellData = new Map<string, { count: number; sx: number; sy: number }>();

        for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            // Only military units contribute to combat pressure.
            if (this.isCivilian(unit)) continue;

            const key = unit.getData('spatialKey') as string;
            if (!key) continue;

            let data = cellData.get(key);
            if (!data) {
                data = { count: 0, sx: 0, sy: 0 };
                cellData.set(key, data);
            }
            data.count++;
            data.sx += unit.x;
            data.sy += unit.y;
        }

        // Phase 2: compute pressure from density gradient.
        // For each occupied cell, check 8 neighbors. Pressure direction = away
        // from the weighted neighbor centroid. Force = (localDensity - avgNeighborDensity)².
        for (const [key, data] of cellData) {
            const [cx, cy] = key.split(',').map(Number);

            let neighborCount = 0;
            let neighborDensitySum = 0;
            // Gradient vector: points from high density → low density.
            let gx = 0;
            let gy = 0;

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const nKey = `${cx + dx},${cy + dy}`;
                    const nData = cellData.get(nKey);
                    if (nData) {
                        neighborCount++;
                        neighborDensitySum += nData.count;
                        // Gradient: this density minus neighbor density, weighted by direction.
                        const diff = data.count - nData.count;
                        gx += dx * diff;
                        gy += dy * diff;
                    }
                }
            }

            const avgNeighborDensity = neighborCount > 0 ? neighborDensitySum / neighborCount : 0;
            const densityExcess = Math.max(0, data.count - avgNeighborDensity);

            // Force scales with density excess² (quadratic = compression feel).
            // Normalize by PRESSURE_DENSITY_MAX so a cell with 8 excess units = max force.
            const normalizedExcess = Math.min(1, densityExcess / PRESSURE_DENSITY_MAX);
            const force = Math.pow(normalizedExcess, PRESSURE_CURVE) * PRESSURE_FORCE_MAX;

            if (force < 1) continue; // skip negligible pressure

            // Pressure direction: along the density gradient (high → low).
            // If no gradient (uniform density), use the cell centroid → unit direction.
            let dirX: number;
            let dirY: number;

            const gMag = Math.sqrt(gx * gx + gy * gy);
            if (gMag > 0.001) {
                dirX = gx / gMag;
                dirY = gy / gMag;
            } else {
                // Uniform density: push outward from cell centroid.
                const centroidX = data.sx / data.count;
                const centroidY = data.sy / data.count;
                const cellCenterX = cx * CELL_SIZE + CELL_SIZE / 2;
                const cellCenterY = cy * CELL_SIZE + CELL_SIZE / 2;
                dirX = cellCenterX - centroidX;
                dirY = cellCenterY - centroidY;
                const dMag = Math.sqrt(dirX * dirX + dirY * dirY);
                if (dMag > 0.001) {
                    dirX /= dMag;
                    dirY /= dMag;
                } else {
                    // Degenerate: random-ish stable direction based on cell coords.
                    dirX = Math.cos(cx * 0.7 + cy * 1.3);
                    dirY = Math.sin(cx * 0.7 + cy * 1.3);
                }
            }

            this.pressureGrid.set(key, {
                dirX,
                dirY,
                force,
                density: data.count,
            });
        }
    }

    /**
     * Get the pressure force for a unit at a given cell key.
     * Returns null if no pressure (cell empty or negligible).
     */
    public getPressure(cellKey: string): CellPressure | null {
        return this.pressureGrid.get(cellKey) ?? null;
    }

    // ─── Contact Lines ───────────────────────────────────────────────────

    /**
     * Detect contact lines between opposing formations.
     *
     * Strategy: group military units by (owner, cellKey) → centroid + count + AABB.
     * For each friendly formation, check AABB gap to enemy formations. If
     * front-to-front gap < CONTACT_RANGE (overlapping or near-engaged fronts),
     * compute a contact line at the gap midpoint (not centroid midpoint).
     * Enables contact line ripple at real combat boundaries.
     *
     * This is O(cells × neighbor_cells) which is tiny — cells are 150px and
     * only occupied cells are iterated.
     */
    private detectContactLines(units: GameUnit[]): void {
        this.contactLines.length = 0;

        // Group military units by (owner, cellKey) → centroid + count + AABB.
        // The AABB (min/max per axis) lets us measure FRONT-TO-FRONT proximity:
        // formation centroids stay 100px+ apart even at full engagement (fronts
        // stop at attack range), so centroid distance never registers contact.
        const formations = new Map<string, {
            owner: number; cx: number; cy: number; count: number; sx: number; sy: number;
            minX: number; maxX: number; minY: number; maxY: number;
        }>();

        for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            if (this.isCivilian(unit)) continue;

            const owner = unit.getData('owner') as number;
            if (owner < 0) continue; // skip neutral

            const key = unit.getData('spatialKey') as string;
            if (!key) continue;

            const fKey = `${owner}|${key}`;
            let f = formations.get(fKey);
            if (!f) {
                const [cx, cy] = key.split(',').map(Number);
                f = {
                    owner, cx, cy, count: 0, sx: 0, sy: 0,
                    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
                };
                formations.set(fKey, f);
            }
            f.count++;
            f.sx += unit.x;
            f.sy += unit.y;
            if (unit.x < f.minX) f.minX = unit.x;
            if (unit.x > f.maxX) f.maxX = unit.x;
            if (unit.y < f.minY) f.minY = unit.y;
            if (unit.y > f.maxY) f.maxY = unit.y;
        }

        // For each friendly formation, find nearby enemy formations.
        for (const [, friendly] of formations) {
            const friendlyX = friendly.sx / friendly.count;
            const friendlyY = friendly.sy / friendly.count;

            // Check neighboring cells (within CONTACT_RANGE / CELL_SIZE cells).
            const cellReach = Math.ceil(CONTACT_RANGE / CELL_SIZE);

            for (let dx = -cellReach; dx <= cellReach; dx++) {
                for (let dy = -cellReach; dy <= cellReach; dy++) {
                    const enemyCx = friendly.cx + dx;
                    const enemyCy = friendly.cy + dy;
                    const enemyKey = `${1 - friendly.owner}|${enemyCx},${enemyCy}`;
                    const enemy = formations.get(enemyKey);
                    if (!enemy) continue;

                    // Front-to-front gap: axis-separated AABB distance.
                    // Overlapping boxes (engaged fronts) → 0; far apart → px gap.
                    const gapX = Math.max(0, Math.max(friendly.minX, enemy.minX) - Math.min(friendly.maxX, enemy.maxX));
                    const gapY = Math.max(0, Math.max(friendly.minY, enemy.minY) - Math.min(friendly.maxY, enemy.maxY));
                    const gap = Math.sqrt(gapX * gapX + gapY * gapY);

                    if (gap > CONTACT_RANGE) continue;

                    // Contact strength: 1.0 at full front contact, 0.0 at CONTACT_RANGE.
                    const strength = Math.min(1, 1 - gap / CONTACT_RANGE);

                    // Normal: friendly → enemy (from centroids; fall back to cell centers).
                    const enemyX = enemy.sx / enemy.count;
                    const enemyY = enemy.sy / enemy.count;
                    const distX = enemyX - friendlyX;
                    const distY = enemyY - friendlyY;
                    let nx: number;
                    let ny: number;
                    const dist = Math.sqrt(distX * distX + distY * distY);
                    if (dist > 0.001) {
                        nx = distX / dist;
                        ny = distY / dist;
                    } else {
                        const ddx = enemy.cx - friendly.cx;
                        const ddy = enemy.cy - friendly.cy;
                        const dd = Math.sqrt(ddx * ddx + ddy * ddy);
                        if (dd > 0.001) {
                            nx = ddx / dd;
                            ny = ddy / dd;
                        } else {
                            nx = 1;
                            ny = 0;
                        }
                    }

                    // Tangent: perpendicular to normal (lateral flow direction).
                    // Pick the tangent that creates a more natural flow (alternate per cell parity).
                    const parity = ((friendly.cx + friendly.cy) & 1) === 0 ? 1 : -1;
                    const tx = -ny * parity;
                    const ty = nx * parity;

                    // Contact boundary: midpoint of the front gap/overlap where the
                    // two blobs actually face each other (not the centroid midpoint,
                    // which sits deep inside each formation at real engagements).
                    const contactX = (Math.max(friendly.minX, enemy.minX) + Math.min(friendly.maxX, enemy.maxX)) / 2;
                    const contactY = (Math.max(friendly.minY, enemy.minY) + Math.min(friendly.maxY, enemy.maxY)) / 2;

                    this.contactLines.push({
                        x: contactX,
                        y: contactY,
                        nx,
                        ny,
                        tx,
                        ty,
                        strength,
                        owner: friendly.owner,
                    });
                }
            }
        }
    }


    /**
     * Get the total contact force for a unit at position (x, y) with given owner.
     * Sums all contact lines within CONTACT_SAMPLE_RADIUS.
     * Returns { backwardX, backwardY, lateralX, lateralY } force components.
     */
    public getContactForce(
        x: number,
        y: number,
        owner: number
    ): { bx: number; by: number; lx: number; ly: number } {
        let bx = 0;
        let by = 0;
        let lx = 0;
        let ly = 0;

        const rangeSq = CONTACT_SAMPLE_RADIUS * CONTACT_SAMPLE_RADIUS;

        for (let i = 0; i < this.contactLines.length; i++) {
            const cl = this.contactLines[i];
            if (cl.owner !== owner) continue;

            const dx = x - cl.x;
            const dy = y - cl.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) continue;

            // Falloff: 1.0 at center, 0.0 at edge.
            const dist = Math.sqrt(distSq);
            const falloff = 1 - dist / CONTACT_SAMPLE_RADIUS;
            const force = cl.strength * falloff;

            // Backward push: away from enemy (along normal, reversed = toward friendly).
            // Normal points friendly→enemy, so backward = -normal.
            bx -= cl.nx * CONTACT_BACKWARD_FORCE * force;
            by -= cl.ny * CONTACT_BACKWARD_FORCE * force;

            // Lateral flow: along tangent.
            lx += cl.tx * CONTACT_LATERAL_FORCE * force;
            ly += cl.ty * CONTACT_LATERAL_FORCE * force;
        }

        return { bx, by, lx, ly };
    }

    // ─── Velocity Alignment ──────────────────────────────────────────────

    /**
     * Compute velocity alignment for a unit using SpatialHash neighbors.
     * Called per-unit in UnitSystem's bucket pass to avoid a second O(n) sweep.
     *
     * Returns the target average velocity { x, y } and neighbor count,
     * or null if not enough neighbors.
     */
    public getAlignmentVelocity(
        unit: GameUnit
    ): { vx: number; vy: number; count: number } | null {
        const spatialHash = this.scene.unitSpatialHash;
        if (!spatialHash) return null;

        const neighbors = spatialHash.query(unit.x, unit.y, ALIGN_RADIUS);
        if (neighbors.length < ALIGN_MIN_NEIGHBORS) return null;

        let avgVx = 0;
        let avgVy = 0;
        let count = 0;

        for (let i = 0; i < neighbors.length; i++) {
            const other = neighbors[i] as GameUnit;
            if (other === unit) continue;
            if (this.isCivilian(other)) continue;

            const body = other.body as Phaser.Physics.Arcade.Body;
            if (!body) continue;

            avgVx += body.velocity.x;
            avgVy += body.velocity.y;
            count++;
        }

        if (count < ALIGN_MIN_NEIGHBORS) return null;

        return {
            vx: avgVx / count,
            vy: avgVy / count,
            count,
        };
    }

    /**
     * Apply velocity alignment to a unit. Interpolates toward neighbor average.
     * Alignment strength scales with neighbor count (more neighbors = stronger alignment).
     */
    public applyAlignment(unit: GameUnit): void {
        const alignment = this.getAlignmentVelocity(unit);
        if (!alignment) return;

        const body = unit.body as Phaser.Physics.Arcade.Body;
        if (!body) return;

        // Strength scales with neighbor count, capped at ALIGN_STRENGTH.
        const strength = Math.min(ALIGN_STRENGTH, alignment.count * 0.03);

        body.velocity.x = Phaser.Math.Linear(body.velocity.x, alignment.vx, strength);
        body.velocity.y = Phaser.Math.Linear(body.velocity.y, alignment.vy, strength);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /**
     * Check if a unit is civilian (villager/animal) and should be excluded from combat fluid.
     */
    private isCivilian(unit: GameUnit): boolean {
        return unit.unitType === UnitType.VILLAGER || unit.unitType === UnitType.ANIMAL;
    }

    /**
     * Get the count of active contact lines (for debugging/profiling).
     */
    public get contactLineCount(): number {
        return this.contactLines.length;
    }

    /**
     * Get the count of active pressure cells (for debugging/profiling).
     */
    public get pressureCellCount(): number {
        return this.pressureGrid.size;
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────

    public destroy(): void {
        this.pressureGrid.clear();
        this.contactLines.length = 0;
    }
}
