import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, FormationType, UnitStance, GameUnit, DamageType, DamageProfile, ArmorProfile, UnitAbility, BuildingType } from '../../types';
import { UNIT_SPEED, UNIT_STATS, UNIT_VISION, FORMATION_BONUSES, STANCE_TETHER_RADIUS, computeDamage, scaleDamageProfile, FACTION_BONUSES, TERRAIN_CONFIG, ABILITY_CONFIG, UNIT_ABILITIES, WALL_DEFENSE_BONUS, WALL_MELEE_PENALTY, WALL_PROXIMITY_RADIUS, RAM_VS_WALL_MULTIPLIER } from '../../constants';
import { toIso, toIsoElev } from '../utils/iso';
import { FormationSystem } from './FormationSystem';
import {
  findResumePathStep,
  shouldRepathChase,
  stalePathAction,
  pathEndNearTarget,
} from '../utils/combatPath';

/**
 * UnitSystem - Optimized for Annihilation-scale (thousands+ units).
 * 
 * Key optimizations:
 * - SpatialHash for O(1) neighbor queries instead of O(n²) iteration
 * - Bucket-based update scheduling: units spread across frames
 * - Scan throttling: combat units scan every 16 ticks, non-combat less frequently
 * - Simplified distant-unit logic (LOD for game logic)
 * - Batch path recalculation using spatial coherence
 */

const SCAN_INTERVAL_COMBAT = 500;   // ms between target scans for combat units
const _SCAN_INTERVAL_IDLE = 1000;     // ms between scans for idle units
const _PATH_RECALC_INTERVAL = 2000;   // ms between path recalculations
const SEPARATION_INTERVAL = 3;       // frames between separation checks
const STALE_PATH_LIFETIME = 5000;    // ms before a path is considered stale

/** All trainable military unit types — used for combat eligibility, targeting, selection, path viz. */
const COMBAT_UNIT_TYPES: UnitType[] = [
    UnitType.PIKESMAN, UnitType.ARCHER, UnitType.CAVALRY, UnitType.LEGION,
    UnitType.SLINGER, UnitType.AXEMAN, UnitType.HOPLITE, UnitType.CHARIOT, UnitType.RAM,
];
const FLOW_FIELD_THRESHOLD = 12;     // min units to trigger flow field instead of individual paths
const FLOW_STEER_INTERVAL = 80;    // ms between flow direction updates per unit
const MAX_ENGAGE_PER_TARGET = 3;    // max friendly units engaging the same enemy before spread kicks in

interface StressEmitter extends Phaser.GameObjects.GameObject {
    start?: () => void;
    stop?: () => void;
    setPosition?: (x: number, y: number) => void;
    setVisible?: (visible: boolean) => StressEmitter;
    setDepth?: (depth: number) => StressEmitter;
}

interface StressProjectile {
    arrow: Phaser.GameObjects.Rectangle;
    emitter: StressEmitter;

    originX: number;
    originY: number;
    targetX: number;
    targetY: number;

    // Quadratic bezier points in iso-screen space (2D)
    p0x: number; p0y: number;
    p1x: number; p1y: number;
    p2x: number; p2y: number;

    startAt: number; // ms in simulation time
    duration: number; // ms

    dmg: number;
    takeDamage: (amt: number) => void;

    started: boolean;
    finished: boolean;
}

interface StressLunge {
    visual: Phaser.GameObjects.GameObject;
    startX: number;
    startY: number;
    endX: number;
    endY: number;

    startAt: number;
    duration: number;
    unitRef: GameUnit;
}

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;
    private debugGraphics: Phaser.GameObjects.Graphics;

    private activeStressProjectiles: StressProjectile[] = [];
    private activeStressLunges: StressLunge[] = [];

    private arrowPool: Phaser.GameObjects.Rectangle[] = [];
    private emitterPool: StressEmitter[] = [];

    private projectilePoolMax: number = 600;
    private lungeDurationMs: number = 100;

    public currentFormation: FormationType = FormationType.BOX;
    public currentStance: UnitStance = UnitStance.HOLD;

    // Per-frame update budget
    private maxUnitsPerFrame: number = 300;
    private updateIndex: number = 0;
    private separationFrame: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.pathGraphics = this.scene.add.graphics().setDepth(-4000);
        this.debugGraphics = this.scene.add.graphics().setDepth(100000);
    }

    // ─── Main Update ──────────────────────────────────────────────────────
    public update(time: number, _delta: number): void {
        const allUnits = this.scene.units.getChildren() as GameUnit[];
        const unitCount = allUnits.length;
        if (unitCount === 0) return;


        if (this.scene.stressTestConfig) {
            this.updateStressProjectiles(time);
            this.updateStressLunges(time);
        }
        // Active stress benchmark: orbital paths ONLY in peaceful mode (no combat).
        // In combat stress mode, units use normal physics/pathfinding/liquid steering.
        if (this.scene.stressTestConfig && !this.scene.stressTestConfig.enableEnemies) {
            const centerX = this.scene.mapWidth * 0.5;
            const centerY = this.scene.mapHeight * 0.5;
            const phaseTime = time * 0.00035;
            for (let i = 0; i < unitCount; i++) {
                const unit = allUnits[i];
                const body = unit.body as Phaser.Physics.Arcade.Body | null;
                if (body && !body.enable) continue;
                const phase = (unit.getData('stressPhase') as number | undefined) ?? (i * 0.017);
                if (unit.getData('stressPhase') === undefined) {
                    unit.setData('stressPhase', phase);
                }
                const radius = 260 + (i % 23) * 2;
                const x = centerX + Math.cos(phaseTime + phase) * radius;
                const y = centerY + Math.sin(phaseTime + phase) * radius * 0.62;
                unit.setPosition(x, y);
            }
        }

        if (this.scene.stressTestConfig && !this.scene.stressTestConfig.enableEnemies) {
            // Peaceful stress units are stationary: skip path queue + mass flow pass.
        } else {
            // Process pathfinding queue (throttle for large counts)
            if (unitCount < 1000) {
                this.scene.pathfinder.processQueue();
            } else {
                this.scene.pathfinder.processQueueBudgeted(100); // cap per frame
            }

            // Flow field steering is O(1) per unit — throttle makes expensive part rare
            for (let i = 0; i < unitCount; i++) {
                const unit = allUnits[i];
                if (!unit || !unit.scene) continue;
                if (unit.flowTarget) {
                    this.moveAlongFlowField(unit, time);
                }
            }
        }

        // Adaptive per-frame budget: scale with total units but cap sanity
        const budget = this.scene.stressTestConfig ? Math.min(600, unitCount) : this.maxUnitsPerFrame;
        const bucketSize = Math.max(1, Math.ceil(unitCount / Math.ceil(unitCount / budget)));
        const start = this.updateIndex;
        const end = Math.min(start + bucketSize, unitCount);

        const peacefulStress = !!this.scene.stressTestConfig && !this.scene.stressTestConfig.enableEnemies;
        if (!peacefulStress) {
            for (let i = start; i < end; i++) {
                const unit = allUnits[i];
                if (!unit) continue;
                this.updateUnitLogicTimed(unit, time);
                this.applyLiquidSteering(unit, time);
            }
        }

        // Advance or wrap bucket index
        this.updateIndex += bucketSize;
        if (this.updateIndex >= unitCount) {
            this.updateIndex = 0;
        }

        if (!peacefulStress) {
            // Dynamic separation interval: less frequent for dense groups
            const sepInterval = unitCount > 2000 ? 60 : (unitCount > 1000 ? 30 : (unitCount > 500 ? 15 : SEPARATION_INTERVAL));
            this.separationFrame++;
            if (this.separationFrame >= sepInterval) {
                this.separationFrame = 0;
                this.applySeparation();
            }
        }

        // Path rendering: only for small groups (<500) or debug mode
        // Fix 1: Gate drawUnitPaths to prevent O(n) iteration waste
        if (!peacefulStress && (unitCount < 500 || this.scene.debugMode)) {
            this.drawUnitPaths(time);
        } else {
            this.pathGraphics.clear();
        }
        if (this.scene.debugMode) {
            this.drawDebugLines();
        } else {
            this.debugGraphics.clear();
        }
    }

    /**
     * Update a single unit's logic with time-based throttling.
     */
    private updateUnitLogicTimed(unit: GameUnit, time: number): void {
        const body = unit.body as Phaser.Physics.Arcade.Body;
        if (!body) return;

        // Skip villagers and animals (managed by their own systems)
        if (unit.unitType === UnitType.VILLAGER || unit.unitType === UnitType.ANIMAL) return;

        // Skip flow field units — handled in the synchronous mass pass above
        if (unit.flowTarget) return;

        // Failsafe: peaceful mode forces enemy units to stop
        if (this.scene.peacefulMode === true && unit.getData('owner') !== 0) {
            if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
                unit.state = UnitState.IDLE;
                unit.target = null;
                body.setVelocity(0, 0);
            }
        }

        // Combat state handling

        if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) {
            this.handleCombatState(unit, time);
        }
        // Path following
        else if (unit.path && unit.path.length > 0) {
            this.moveAlongPath(unit);
        }
        // Idle: auto-target scan (throttled)
        else if (unit.state === UnitState.IDLE) {
            this.scanForTargets(unit, time);
        }
        // Fallback: stop any residual velocity
        else {
            if (body.velocity.length() > 0) body.setVelocity(0, 0);
        }
    }

    // ─── Separation (O(n) using SpatialHash) ──────────────────────────────
    private applySeparation(): void {
        const units = this.scene.units.getChildren() as GameUnit[];
        if (units.length < 2) return;

        // Use SpatialHash for neighbor queries
        const queryRadius = 20;
        const spatialHash = this.scene.unitSpatialHash;
        
        if (spatialHash) {
            for (const unit of units) {
                // Fix 2: Skip separation for units following flow fields.
                // Flow field crowd steering naturally handles spacing via the combined
                // flow direction + direct bias blended steering. Separation would fight
                // the flow field and creates massive O(k×n) overhead for packed armies.
                if (unit.flowTarget) continue;
                // Skip combat units: separation fights liquid steering + chase velocity
                if (unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING) continue;

                const body = unit.body as Phaser.Physics.Arcade.Body;
                if (!body || (body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y) < 1) continue;

                const neighbors = spatialHash.query(unit.x, unit.y, queryRadius);
                for (const other of neighbors) {
                    if (other === unit) continue;
                    const otherBody = other.body as Phaser.Physics.Arcade.Body;
                    if (!otherBody) continue;

                    const dx = unit.x - other.x;
                    const dy = unit.y - other.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < 324 && distSq > 0.0001) {
                        const dist = Math.sqrt(distSq);
                        const force = (18 - dist) * 0.8;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        body.velocity.x += nx * force;
                        body.velocity.y += ny * force;
                        otherBody.velocity.x -= nx * force;
                        otherBody.velocity.y -= ny * force;
                    }
                }
            }
        } else {
            // Fallback: brute force for very small unit counts
            for (let i = 0; i < units.length; i++) {
                const unit = units[i];
                const body = unit.body as Phaser.Physics.Arcade.Body;
                if (!body || (body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y) < 1) continue;

                for (let j = i + 1; j < units.length; j++) {
                    const other = units[j];
                    const otherBody = other.body as Phaser.Physics.Arcade.Body;
                    if (!otherBody) continue;
                    const dx = unit.x - other.x;
                    const dy = unit.y - other.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < 324 && distSq > 0.0001) {
                        const dist = Math.sqrt(distSq);
                        const force = (18 - dist) * 0.8;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        body.velocity.x += nx * force;
                        body.velocity.y += ny * force;
                        otherBody.velocity.x -= nx * force;
                        otherBody.velocity.y -= ny * force;
                    }
                }
            }
        }
    }
    // ─── Liquid Combat Steering ───────────────────────────────────────────
    /**
     * Apply fluid combat forces to a single unit: pressure + contact-line + velocity alignment.
     * Called inside the rotating bucket pass (update()) so every unit gets forces over time.
     * Skips civilians, flow-field units, and units without physics bodies.
     */
    private applyLiquidSteering(unit: GameUnit, _time: number): void {
        const liquidCombat = this.scene.liquidCombat;
        if (!liquidCombat || !liquidCombat.enabled) return;

        // Skip civilians (villagers, animals)
        if (unit.unitType === UnitType.VILLAGER || unit.unitType === UnitType.ANIMAL) return;

        // Skip flow-field units — mass steering already handles spacing for them
        if (unit.flowTarget) return;

        const body = unit.body as Phaser.Physics.Arcade.Body;
        if (!body || !body.enable) return;

        // Accumulate total combat force for visual deformation (per-soldier in renderSquad)
        let forceX = 0;
        let forceY = 0;

        // 1. Pressure force — outward push from dense cell
        const cellKey = unit.getData('spatialKey') as string;
        if (cellKey) {
            const pressure = liquidCombat.getPressure(cellKey);
            if (pressure && pressure.force > 0) {
                const px = pressure.dirX * pressure.force;
                const py = pressure.dirY * pressure.force;
                body.velocity.x += px;
                body.velocity.y += py;
                forceX += px;
                forceY += py;
            }
        }

        // 2. Contact-line force — backward push + lateral flow at enemy boundary
        const owner = unit.getData('owner') as number;
        if (owner >= 0) {
            const contact = liquidCombat.getContactForce(unit.x, unit.y, owner);
            if (contact.bx !== 0 || contact.by !== 0 || contact.lx !== 0 || contact.ly !== 0) {
                const cx = contact.bx + contact.lx;
                const cy = contact.by + contact.ly;
                body.velocity.x += cx;
                body.velocity.y += cy;
                forceX += cx;
                forceY += cy;
            }
        }

        // Store force for SquadSystem per-soldier deformation (scaled to px offset)
        // Divide by force scale to convert velocity-space force to visual displacement
        const DEFORMATION_SCALE = 0.15;
        unit.modifiedOffset = { x: forceX * DEFORMATION_SCALE, y: forceY * DEFORMATION_SCALE };

        // 3. Velocity alignment — smooth toward neighbor average (piggybacks on separation interval)
        // Only apply alignment on frames where separation runs, to avoid extra SpatialHash queries
        // We check the shared separationFrame counter
        if (this.separationFrame === 0) {
            liquidCombat.applyAlignment(unit);
        }

        // Cap velocity to prevent runaway acceleration
        const MAX_SPEED = 200;
        const vx = body.velocity.x;
        const vy = body.velocity.y;
        const speedSq = vx * vx + vy * vy;
        if (speedSq > MAX_SPEED * MAX_SPEED) {
            const scale = MAX_SPEED / Math.sqrt(speedSq);
            body.velocity.x = vx * scale;
            body.velocity.y = vy * scale;
        }
    }

    // ─── Movement Commands ─────────────────────────────────────────────────
    public commandMove(units: Phaser.GameObjects.GameObject[], target: Phaser.Math.Vector2, queue: boolean = false): void {
        // For large groups, compute one flow field instead of N individual paths
        if (units.length >= FLOW_FIELD_THRESHOLD && !queue) {
            this.commandMoveFlowField(units, target);
            return;
        }

        const spacing = 15;
        const groupOffsets = FormationSystem.getFormationOffsets(this.currentFormation, units.length, spacing);

        let rotationAngle = 0;
        if (this.currentFormation === FormationType.LINE || this.currentFormation === FormationType.WEDGE) {
            let sumX = 0, sumY = 0;
            for (const u of units) {
                const unit = u as Phaser.GameObjects.Image;
                sumX += unit.x;
                sumY += unit.y;
            }
            const avgX = sumX / units.length;
            const avgY = sumY / units.length;
            rotationAngle = Phaser.Math.Angle.Between(avgX, avgY, target.x, target.y) + Math.PI / 2;
        }

        for (let index = 0; index < units.length; index++) {
            const unit = units[index] as GameUnit;

            this.scene.squadSystem.applyFormation(unit, this.currentFormation);
            unit.setData('formation', this.currentFormation);

            const baseOffset = groupOffsets[index];
            const rotatedOffset = new Phaser.Math.Vector2(
                baseOffset.x * Math.cos(rotationAngle) - baseOffset.y * Math.sin(rotationAngle),
                baseOffset.x * Math.sin(rotationAngle) + baseOffset.y * Math.cos(rotationAngle)
            );

            const unitTarget = new Phaser.Math.Vector2(target.x + rotatedOffset.x, target.y + rotatedOffset.y);

            const startPos = (queue && unit.path && unit.path.length > 0)
                ? unit.path[unit.path.length - 1]
                : new Phaser.Math.Vector2(unit.x, unit.y);

            const path = this.scene.pathfinder.findPath(startPos, unitTarget);
            // Stay-put ([start] only) means no route — do not assign fake path
            if (path && path.length > 1) {
                if (queue && unit.path) {
                    unit.path = unit.path.concat(path);
                } else {
                    unit.path = path;
                    unit.pathStep = 0;
                    unit.pathCreatedAt = this.scene.gameTime;
                    unit.state = UnitState.IDLE;
                    unit.target = null;
                    (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
                    unit.setData('anchor', { x: target.x, y: target.y });
                }
            }

            // Per-unit path memory cleanup: cap path length for long queues
            if (unit.path && unit.path.length > 200) {
                unit.path = unit.path.slice(unit.pathStep);
                unit.pathStep = 0;
            }
        }

        // Visual feedback
        const iso = toIso(target.x, target.y);
        const color = queue ? 0xffff00 : 0xffffff;
        const circle = this.scene.add.circle(iso.x, iso.y, 5, color);
        circle.setScale(1, 0.5);
        circle.setDepth(iso.y);
        this.scene.tweens.add({
            targets: circle,
            scaleX: 0, scaleY: 0, alpha: 0,
            duration: 500,
            onComplete: () => circle.destroy()
        });
    }

    /**
     * Mass movement using flow fields.
     * Computes one flow field for the target, assigns it to all units.
     */
    private commandMoveFlowField(units: Phaser.GameObjects.GameObject[], target: Phaser.Math.Vector2): void {
        const flowField = this.scene.pathfinder.generateFlowField(target.x, target.y);
        const spacing = 15;
        const groupOffsets = FormationSystem.getFormationOffsets(this.currentFormation, units.length, spacing);

        let rotationAngle = 0;
        if (this.currentFormation === FormationType.LINE || this.currentFormation === FormationType.WEDGE) {
            let sumX = 0, sumY = 0;
            for (const u of units) {
                const img = u as Phaser.GameObjects.Image;
                sumX += img.x;
                sumY += img.y;
            }
            const avgX = sumX / units.length;
            const avgY = sumY / units.length;
            rotationAngle = Phaser.Math.Angle.Between(avgX, avgY, target.x, target.y) + Math.PI / 2;
        }

        for (let index = 0; index < units.length; index++) {
            const unit = units[index] as GameUnit;

            this.scene.squadSystem.applyFormation(unit, this.currentFormation);
            unit.setData('formation', this.currentFormation);

            const baseOffset = groupOffsets[index];
            const rotatedOffset = new Phaser.Math.Vector2(
                baseOffset.x * Math.cos(rotationAngle) - baseOffset.y * Math.sin(rotationAngle),
                baseOffset.x * Math.sin(rotationAngle) + baseOffset.y * Math.cos(rotationAngle)
            );

            unit.flowTarget = { x: target.x + rotatedOffset.x, y: target.y + rotatedOffset.y };
            unit.path = null;
            unit.state = UnitState.IDLE;
            unit.target = null;
            unit.pathCreatedAt = this.scene.gameTime;
            unit.setData('_lastFlowSteer', 0);
            unit.setData('_flowField', flowField);
            (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
            unit.setData('anchor', { x: target.x, y: target.y });
        }

        const iso = toIso(target.x, target.y);
        const circle = this.scene.add.circle(iso.x, iso.y, 5, 0xffffff);
        circle.setScale(1, 0.5);
        circle.setDepth(iso.y);
        this.scene.tweens.add({
            targets: circle,
            scaleX: 0, scaleY: 0, alpha: 0,
            duration: 500,
            onComplete: () => circle.destroy()
        });
    }

    /**
     * Steer unit using cached flow field (O(1) per unit per steer interval).
     */
    private moveAlongFlowField(unit: GameUnit, _time: number): void {
        if (!unit.flowTarget) return;
        // Shield Wall: immobile
        if (unit.getData('shieldWall')) {
            const body = unit.body as Phaser.Physics.Arcade.Body;
            if (body) body.setVelocity(0, 0);
            return;
        }

        const flowField = unit.getData('_flowField') as { dirX: Float64Array; dirY: Float64Array; cols: number; rows: number } | undefined;
        if (!flowField) return;

        const dx = unit.x - unit.flowTarget.x;
        const dy = unit.y - unit.flowTarget.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Arrived at destination
        if (dist < 8) {
            const body = unit.body as Phaser.Physics.Arcade.Body;
            if (body) {
                body.setVelocity(0, 0);
                // Fully disable physics body for stationary units in stress test
                // This prevents Arcade physics from processing idle bodies (massive saving)
                if (this.scene.stressTestConfig) {
                    body.enable = false;
                }
            }
            unit.flowTarget = undefined;
            unit.setData('_flowField', undefined);
            return;
        }

        // Re-enable body if it was disabled (unit has started moving again)
        const body = unit.body as Phaser.Physics.Arcade.Body;
        if (body && !body.enable) body.enable = true;

        const lastSteer = unit.getData('_lastFlowSteer') as number || 0;
        if (this.scene.time.now - lastSteer < FLOW_STEER_INTERVAL) return;
        unit.setData('_lastFlowSteer', this.scene.time.now);

        const dir = this.scene.pathfinder.getFlowDirection(flowField, unit.x, unit.y);

        const baseSpeed = UNIT_SPEED[unit.unitType as UnitType] || 100;
        const formation = unit.getData('formation') as FormationType || FormationType.BOX;
        const multiplier = FORMATION_BONUSES[formation]?.speed || 1.0;
        const moveMult = this.scene.researchManager?.getSnapshot(unit.getData('owner') as number).movementSpeedMult ?? 1;
        const speed = baseSpeed * multiplier * moveMult;

        if (!dir || (dir.x === 0 && dir.y === 0)) {
            // No flow (on water/blocked or field hole) — stop; never straight-line through water
            if (body) body.setVelocity(0, 0);
            return;
        }

        // Blend flow (70%) + direct bias (30%); zero bias if it points into blocked/water
        const toTargetLen = dist;
        let biasX = 0;
        let biasY = 0;
        if (toTargetLen > 1) {
            biasX = -dx / toTargetLen;
            biasY = -dy / toTargetLen;
            if (this.scene.pathfinder.isBlocked(unit.x + biasX * 24, unit.y + biasY * 24)) {
                biasX = 0;
                biasY = 0;
            }
        }
        const blendX = dir.x * 0.7 + biasX * 0.3;
        const blendY = dir.y * 0.7 + biasY * 0.3;
        const blendLen = Math.sqrt(blendX * blendX + blendY * blendY);

        if (body && blendLen > 0.001) {
            body.setVelocity((blendX / blendLen) * speed, (blendY / blendLen) * speed);
        }
    }

    public commandFollowPath(units: Phaser.GameObjects.GameObject[], pathPoints: Phaser.Math.Vector2[], queue: boolean = false): void {
        if (pathPoints.length < 2) return;

        for (const unitObj of units) {
            const unit = unitObj as GameUnit;
            let fullPath: Phaser.Math.Vector2[] = [];

            const startPos = (queue && unit.path && unit.path.length > 0)
                ? unit.path[unit.path.length - 1]
                : new Phaser.Math.Vector2(unit.x, unit.y);

            const startPath = this.scene.pathfinder.findPath(startPos, pathPoints[0]);
            // Stay-put ([start] only) means no route — seed with current pos only
            if (startPath && startPath.length > 1) {
                fullPath = startPath;
            } else {
                fullPath = [new Phaser.Math.Vector2(startPos.x, startPos.y)];
            }

            for (let i = 0; i < pathPoints.length - 1; i++) {
                const segment = this.scene.pathfinder.findPath(pathPoints[i], pathPoints[i + 1]);
                if (segment && segment.length > 1) {
                    const lastPoint = fullPath[fullPath.length - 1];
                    const startIdx = (lastPoint && Phaser.Math.Distance.Between(lastPoint.x, lastPoint.y, segment[0].x, segment[0].y) < 2) ? 1 : 0;
                    for (let j = startIdx; j < segment.length; j++) {
                        fullPath.push(segment[j]);
                    }
                }
            }

            if (fullPath.length > 0) {
                if (queue && unit.path) {
                    unit.path = unit.path.concat(fullPath);
                } else {
                    unit.path = fullPath;
                    unit.pathStep = 0;
                    unit.pathCreatedAt = this.scene.gameTime;
                    unit.state = UnitState.IDLE;
                    unit.target = null;
                    (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
                }
            }

            // Cap path length
            if (unit.path && unit.path.length > 200) {
                unit.path = unit.path.slice(unit.pathStep);
                unit.pathStep = 0;
            }
        }

        // Visual feedback at destination
        const lastPoint = pathPoints[pathPoints.length - 1];
        const iso = toIso(lastPoint.x, lastPoint.y);
        const color = queue ? 0x00ffff : 0x00ff00;
        const circle = this.scene.add.circle(iso.x, iso.y, 5, color);
        circle.setScale(1, 0.5);
        circle.setDepth(iso.y);
        this.scene.tweens.add({
            targets: circle,
            scaleX: 0, scaleY: 0, alpha: 0,
            duration: 500,
            onComplete: () => circle.destroy()
        });
    }

    // ─── Stance / Formation ───────────────────────────────────────────────
    public setStance(stance: UnitStance): void {
        this.currentStance = stance;
        const selected = this.scene.inputManager.selectedUnits;
        if (selected && selected.length > 0) {
            for (const obj of selected) {
                const u = obj as GameUnit;
                u.setData('stance', stance);
                if (stance === UnitStance.HOLD && u.state === UnitState.CHASING) {
                    u.state = UnitState.IDLE;
                    u.target = null;
                    const body = u.body as Phaser.Physics.Arcade.Body;
                    if (body) body.setVelocity(0, 0);
                }
                u.setData('anchor', { x: u.x, y: u.y });
            }
        }
    }

    public setFormation(type: FormationType): void {
        this.currentFormation = type;
    }

    // ─── Attack Commands ───────────────────────────────────────────────────
    public commandAttack(units: Phaser.GameObjects.GameObject[], target: Phaser.GameObjects.GameObject): void {
        for (const unitObj of units) {
            const unit = unitObj as GameUnit;

            if (this.scene.peacefulMode && unit.getData('owner') !== 0) {
                if (this.scene.debugMode) {
                    const iso = toIso(unit.x, unit.y);
                    const x = this.scene.add.text(iso.x, iso.y, "X", { color: '#ff0000', fontSize: '20px' });
                    x.setOrigin(0.5);
                    this.scene.tweens.add({ targets: x, y: iso.y - 20, alpha: 0, duration: 500, onComplete: () => x.destroy() });
                }
                return;
            }


            if (COMBAT_UNIT_TYPES.includes(unit.unitType)) {
                unit.target = target;
                unit.state = UnitState.CHASING;
                unit.path = null;
                unit.flowTarget = undefined;
                unit.setData('_flowField', undefined);
                unit.setData('explicitTarget', true);
                unit.setData('_lastPathRecalc', 0);
                unit.setData('_chaseTargetPos', undefined);
                (unit.body as Phaser.Physics.Arcade.Body).reset(unit.x, unit.y);
            }
        }

        // Visual Feedback
        const targetVisual = (target as GameUnit).visual;
        if (targetVisual) {
            this.scene.tweens.add({
                targets: targetVisual,
                alpha: 0.5, yoyo: true, duration: 100, repeat: 2
            });
        }
    }

    // ─── Target Scanning (SpatialHash optimized, spread targeting) ───────
    /** Per-frame engagement cache: enemy → number of friendly units targeting it. */
    private _engageCache: Map<Phaser.GameObjects.GameObject, number> = new Map();
    private _engageCacheFrame = -1;

    /**
     * Build (or reuse) a per-frame map of enemy → how many of `owner`'s units are targeting it.
     * Cached per frame so it's O(n) per frame, not O(n²) per scan call.
     */
    private _buildEngagementMap(owner: number): Map<Phaser.GameObjects.GameObject, number> {
        const frame = this.scene.game.loop.frame;
        if (this._engageCacheFrame === frame) return this._engageCache;

        this._engageCache.clear();
        const children = this.scene.units.getChildren();
        for (let i = 0, len = children.length; i < len; i++) {
            const u = children[i] as GameUnit;
            if (u.getData('owner') !== owner) continue;
            if (u.getData('hp') <= 0) continue;
            const tgt = u.target;
            if (!tgt) continue;
            this._engageCache.set(tgt, (this._engageCache.get(tgt) || 0) + 1);
        }
        this._engageCacheFrame = frame;
        return this._engageCache;
    }

    private scanForTargets(unit: GameUnit, _time: number): void {
        // Throttle: only scan periodically (~every 500ms)
        const lastScan = unit.getData('_lastScan') as number || 0;
        if (this.scene.time.now - lastScan < SCAN_INTERVAL_COMBAT) return;
        unit.setData('_lastScan', this.scene.time.now);

        const isCombatUnit = COMBAT_UNIT_TYPES.includes(unit.unitType);
        if (!isCombatUnit) return;

        const stance = unit.getData('stance') as UnitStance || UnitStance.DEFENSIVE;
        const visionRange = UNIT_VISION[unit.unitType] || 250;
        const myOwner = unit.getData('owner') as number;
        // Siege units (RAM) only target buildings, not units
        const isSiegeUnit = unit.unitType === UnitType.RAM;

        let closest: Phaser.GameObjects.GameObject | null = null;
        let closestDist = visionRange;

        // Siege units skip unit targeting — go straight to buildings
        if (!isSiegeUnit) {
            const spatialHash = this.scene.unitSpatialHash;
            let candidates: Phaser.GameObjects.GameObject[];

            if (spatialHash) {
                candidates = spatialHash.query(unit.x, unit.y, visionRange);
            } else {
                candidates = this.scene.units.getChildren();
            }

            const engageCount = this._buildEngagementMap(myOwner);

            let best: Phaser.GameObjects.GameObject | null = null;
            let bestDist = visionRange;
            let fallback: Phaser.GameObjects.GameObject | null = null;
            let fallbackDist = visionRange;

            for (const other of candidates) {
                if (other === unit) continue;
                const otherOwner = other.getData('owner') as number;
                if (otherOwner === myOwner) continue;
                const hp = other.getData('hp') as number;
                if (hp <= 0) continue;

                const otherType = other.getData('unitType') || (other as GameUnit).unitType;
                if (otherType === UnitType.ANIMAL) continue;

                const otherImg = other as Phaser.GameObjects.Image;
                const dx = unit.x - otherImg.x;
                const dy = unit.y - otherImg.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < fallbackDist) {
                    fallback = other;
                    fallbackDist = dist;
                }
                if (dist < bestDist && (engageCount.get(other) || 0) < MAX_ENGAGE_PER_TARGET) {
                    best = other;
                    bestDist = dist;
                }
            }

            closest = best || fallback;
            closestDist = best ? bestDist : fallbackDist;
        }

        // Scan buildings: always for siege, fallback for regular units
        if (!closest || isSiegeUnit) {
            for (const b of this.scene.buildings.getChildren()) {
                const bOwner = b.getData('owner') as number;
                if (bOwner === myOwner) continue;
                const bhp = b.getData('hp') as number;
                if (bhp <= 0) continue;

                const bImg = b as Phaser.GameObjects.Image;
                const dx = unit.x - bImg.x;
                const dy = unit.y - bImg.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < closestDist) {
                    closest = b;
                    closestDist = dist;
                }
            }
        }

        if (closest) {
            const range = unit.getData('range') as number || 40;
            if (stance === UnitStance.HOLD && closestDist > range) {
                return;
            }

            unit.target = closest;
            unit.setData('explicitTarget', false);
            unit.state = UnitState.CHASING;
        }
    }

    // ─── Combat State Machine ─────────────────────────────────────────────
    private handleCombatState(unit: GameUnit, time: number): void {
        const target = unit.target as Phaser.GameObjects.Image;
        const body = unit.body as Phaser.Physics.Arcade.Body;

        if (!target || !target.scene) {
            unit.state = UnitState.IDLE;
            unit.target = null;
            if (body) body.setVelocity(0, 0);
            return;
        }

        const dx = unit.x - target.x;
        const dy = unit.y - target.y;
        const rawDist = Math.sqrt(dx * dx + dy * dy);
        const baseRange = unit.getData('range') as number || 40;

        // Adjust for building size: if target is a building, compute effective distance
        // to its nearest edge instead of center. This prevents endless chasing because
        // the unit cannot reach the center (it's inside solid collision).
        let effectiveDist = rawDist;
        let chaseTargetX = target.x;
        let chaseTargetY = target.y;
        const def = target.getData('def') as { width: number; height: number } | undefined;
        if (def) {
            const halfW = def.width / 2;
            const halfH = def.height / 2;
            // Clamp unit position to building edge rectangle to get closest approach
            const closestX = Math.max(target.x - halfW, Math.min(unit.x, target.x + halfW));
            const closestY = Math.max(target.y - halfH, Math.min(unit.y, target.y + halfH));
            effectiveDist = Math.hypot(unit.x - closestX, unit.y - closestY);
            // Chase toward the edge point, not center
            chaseTargetX = closestX;
            chaseTargetY = closestY;
        }

        const range = baseRange;
        const attackSpeed = unit.getData('attackSpeed') as number || 1000;
        const stance = unit.getData('stance') as UnitStance || UnitStance.DEFENSIVE;
        const anchor = unit.getData('anchor') || { x: unit.x, y: unit.y };
        const explicitTarget = unit.getData('explicitTarget') === true;

        // Stance constraint checks
        if (!explicitTarget) {
            if (stance === UnitStance.DEFENSIVE) {
                const tetherDist = Phaser.Math.Distance.Between(unit.x, unit.y, anchor.x, anchor.y);
                if (tetherDist > STANCE_TETHER_RADIUS) {
                    unit.target = null;
                    unit.state = UnitState.IDLE;
                    // Spread return-to-anchor paths across frames via async queue
                    this.scene.pathfinder.requestPath(
                        new Phaser.Math.Vector2(unit.x, unit.y),
                        new Phaser.Math.Vector2(anchor.x, anchor.y),
                        (path) => {
                            if (!unit.scene) return;
                            if (path && path.length > 1) {
                                unit.path = path;
                                unit.pathStep = 0;
                                unit.pathCreatedAt = time;
                            }
                        }
                    );
                    return;
                }
            } else if (stance === UnitStance.HOLD) {
                if (effectiveDist > range) {
                    body.setVelocity(0, 0);
                    unit.target = null;
                    unit.state = UnitState.IDLE;
                    return;
                }
            }
        }

        // Attack or chase

        if (effectiveDist <= range) {
            body.setVelocity(0, 0);
            unit.state = UnitState.ATTACKING;
            unit.path = null;

            const now = time;
            const last = unit.lastAttackTime || 0;
            if (now - last > attackSpeed) {
                unit.lastAttackTime = now;
                this.performAttack(unit, target as GameUnit);
            }
        } else {
            unit.state = UnitState.CHASING;

            // Stable chase path: repath only when needed; never reset pathStep to 0
            // (that walked units back to the start cell → back-and-forth thrash).
            const nowMs = this.scene.time.now;
            const lastRecalc = (unit.getData('_lastPathRecalc') as number) || 0;
            const lastTarget = unit.getData('_chaseTargetPos') as { x: number; y: number } | undefined;
            const targetMoved = lastTarget
              ? Math.hypot(target.x - lastTarget.x, target.y - lastTarget.y)
              : Number.POSITIVE_INFINITY;

            const needRepath = shouldRepathChase({
              path: unit.path,
              pathStep: unit.pathStep ?? 0,
              timeSinceRecalc: nowMs - lastRecalc,
              targetMoved: Number.isFinite(targetMoved) ? targetMoved : 9999,
              distToTarget: effectiveDist,
              range,
            });

            const endStale = !!(
              unit.path
              && unit.path.length > 1
              && !pathEndNearTarget(unit.path, chaseTargetX, chaseTargetY)
              && (nowMs - lastRecalc) >= 450
            );

            if (needRepath || endStale) {
              unit.setData('_lastPathRecalc', nowMs);
              const tx = chaseTargetX, ty = chaseTargetY;
              unit.setData('_chaseTargetPos', { x: tx, y: ty });
              this.scene.pathfinder.requestPath(
                new Phaser.Math.Vector2(unit.x, unit.y),
                new Phaser.Math.Vector2(tx, ty),
                (path) => {
                  // Validate: unit alive, still chasing same-ish target, hasn't left CHASING
                  if (!unit.scene) return;
                  const t = unit.target as Phaser.GameObjects.Image;
                  if (!t || !t.scene || unit.state !== UnitState.CHASING) return;
                  const chased = unit.getData('_chaseTargetPos') as { x: number; y: number } | undefined;
                  if (!chased || Math.hypot(t.x - chased.x, t.y - chased.y) > range + 30) return;
                  if (path && path.length > 1) {
                    unit.path = path;
                    unit.pathStep = findResumePathStep(path, unit.x, unit.y);
                    unit.pathCreatedAt = this.scene.gameTime;
                  } else if (!unit.path || unit.path.length <= 1) {
                    unit.path = null;
                  }
                }
              );
            } else if (!lastTarget) {
              unit.setData('_chaseTargetPos', { x: chaseTargetX, y: chaseTargetY });
            }

            if (unit.path && unit.path.length > 1 && (unit.pathStep ?? 0) < unit.path.length) {
              this.moveAlongPath(unit);
            } else {
              // A terminal/one-point path can end at a walkable cell center short of a blocked target.
              // Keep closing directly until the attack-range check transitions to ATTACKING.
              const finalSpeed = UNIT_SPEED[unit.unitType as UnitType] || 100;
              const formation = unit.getData('formation') as FormationType || FormationType.BOX;
              const formationMultiplier = FORMATION_BONUSES[formation]?.speed || 1.0;
              const terrainModifier = this.scene.terrainSystem.getMovementModifier(unit.x, unit.y);
              const moveMult = this.scene.researchManager?.getSnapshot(unit.getData('owner') as number).movementSpeedMult ?? 1;
              const speed = finalSpeed * formationMultiplier * terrainModifier * moveMult;
              this.scene.physics.moveTo(unit, chaseTargetX, chaseTargetY, speed);
              if (unit.pathStep >= (unit.path?.length ?? 0)) unit.path = null;
            }
        }
    }

    // ─── Path Following ────────────────────────────────────────────────────
    private moveAlongPath(unit: GameUnit): void {
        if (!unit.path || unit.path.length === 0) return;

        if (unit.pathStep >= unit.path.length) {
            const body = unit.body as Phaser.Physics.Arcade.Body;
            body.setVelocity(0, 0);
            unit.path = null;
            return;
        }

        const nextPoint = unit.path[unit.pathStep];
        const dx = unit.x - nextPoint.x;
        const dy = unit.y - nextPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 4) {
            unit.pathStep++;
            // Skip duplicate nearby points
            while (unit.pathStep < unit.path.length) {
                const p = unit.path[unit.pathStep];
                const d = Phaser.Math.Distance.Between(unit.x, unit.y, p.x, p.y);
                if (d > 4) break;
                unit.pathStep++;
            }
        } else {
            const baseSpeed = UNIT_SPEED[unit.unitType as UnitType] || 100;
            const formation = unit.getData('formation') as FormationType || FormationType.BOX;
            const formationMultiplier = FORMATION_BONUSES[formation]?.speed || 1.0;
            
            // Apply terrain-based movement speed modifier
            const terrainModifier = this.scene.terrainSystem.getMovementModifier(unit.x, unit.y);
            const moveMult = this.scene.researchManager?.getSnapshot(unit.getData('owner') as number).movementSpeedMult ?? 1;
            const finalSpeed = baseSpeed * formationMultiplier * terrainModifier * moveMult;
            
            this.scene.physics.moveTo(unit, nextPoint.x, nextPoint.y, finalSpeed);
        }

        // Stale path: mid-chase clear+repath next tick (stay CHASING).
        // Non-combat still drops to IDLE so idle scan can take over.
        if (unit.pathCreatedAt && unit.path) {
            const age = this.scene.gameTime - unit.pathCreatedAt;
            const inCombat =
              unit.state === UnitState.CHASING || unit.state === UnitState.ATTACKING;
            const action = stalePathAction(age, STALE_PATH_LIFETIME, inCombat);
            if (action === 'clear_repath') {
                unit.path = null;
                // force repath on next combat tick
                unit.setData('_lastPathRecalc', 0);
            } else if (action === 'clear_idle') {
                unit.path = null;
                unit.state = UnitState.IDLE;
            }
        }
    }

    // ─── Combat Resolution ─────────────────────────────────────────────────
    private performAttack(unit: GameUnit, target: GameUnit): void {
        const isStress = !!this.scene.stressTestConfig;

        // Build the attacker's per-type damage profile (fall back to legacy flat attack)
        let profile: DamageProfile = (unit.getData('damage') as DamageProfile) || {};
        if (!profile || Object.keys(profile).length === 0) {
            profile = { [DamageType.HACK]: (unit.getData('attack') as number) || 10 };
        }

        const formation = unit.getData('formation') as FormationType || FormationType.BOX;
        const attackMult = FORMATION_BONUSES[formation]?.attack || 1.0;

        // Apply terrain-based combat modifiers
        const combatMods = this.scene.terrainSystem.getCombatModifiers(unit.x, unit.y, target.x, target.y);
        const heightAttackMult = 1 + combatMods.attackBonus;

        // River crossing combat penalty — fighting in rivers is harder
        const riverPenalty = this.scene.terrainSystem.isRiverAt(unit.x, unit.y) 
          ? TERRAIN_CONFIG.RIVER_COMBAT_PENALTY : 0;
        const riverAttackMult = 1 - riverPenalty;

        // Axeman: bonus damage vs buildings
        const bonusVsBuilding = unit.getData('bonusVsBuilding') as number | undefined;
        if (bonusVsBuilding && target.getData('def')) {
            profile = scaleDamageProfile(profile, bonusVsBuilding);
        }

        // Hoplite: defensive bonus (reduces incoming damage, stacks with per-type armor)
        const defensiveBonus = target.getData('defensiveBonus') as number | undefined;
        if (defensiveBonus) {
            profile = scaleDamageProfile(profile, 1 - defensiveBonus);
        }

        // Formation attack bonus + high-ground attack bonus + faction melee bonus
        const factionMeleeMult = unit.getData('factionMeleeMult') as number ?? 1;
        profile = scaleDamageProfile(profile, attackMult * heightAttackMult * riverAttackMult * factionMeleeMult);

        // Apply the target's per-type armor via the smooth reduction formula
        const targetArmor = (target.getData('armor') as ArmorProfile) || {};
        const effective = computeDamage(profile, targetArmor);
        const dmg = effective;

        // Ranged units have range >= 180 (ARCHER=200, SLINGER=180, CHARIOT=180), melee units have range <= 40
        if ((unit.getData('range') as number | undefined ?? 0) > 60) {
            // Ranged volley
            const maxHp = unit.getData('maxHp') as number;
            const currentHp = unit.getData('hp') as number;
            const squadSize = UNIT_STATS[unit.unitType]?.squadSize ?? 1;
            const soldiers = unit.getData('soldierStates') || [];

            const arrowCount = Math.max(1, Math.ceil((currentHp / maxHp) * squadSize));
            const damagePerArrow = dmg / arrowCount;

            for (let i = 0; i < arrowCount; i++) {
                const delay = Phaser.Math.Between(0, 300);
                const spread = 15;
                const targetVaried = {
                    x: target.x + Phaser.Math.Between(-spread, spread),
                    y: target.y + Phaser.Math.Between(-spread, spread),
                    scene: target.scene,
                    takeDamage: (amt: number) => { if (target && target.takeDamage) target.takeDamage(amt); }
                };

                const origin = (soldiers.length > 0)
                    ? soldiers[i % soldiers.length]
                    : { x: unit.x, y: unit.y };

                if (isStress) {
                    this.scheduleProjectile(origin, targetVaried, damagePerArrow, delay);
                } else {
                    this.scene.time.delayedCall(delay, () => {
                        if (unit.scene && target.scene) {
                            this.scene.proceduralSound.playBowRelease(origin.x, origin.y);
                            // Apply terrain-based defense bonus for ranged attacks too
                            const defMods = this.scene.terrainSystem.getCombatModifiers(target.x, target.y, unit.x, unit.y);
                            const targetOwner = target.getData('owner') as number;
                            const targetFaction = targetOwner === 0 ? this.scene.faction : this.scene.enemyFaction;
                            const rangedArmorMult = (FACTION_BONUSES[targetFaction]?.rangedArmorMult ?? 1);
                            const rangedDmg = Math.round(damagePerArrow * (1 - defMods.defenseBonus) * rangedArmorMult);
                            // Forest defense bonus — trees block projectiles (Design Pillar 5: terrain matters)
                            const forestMult = this.scene.terrainSystem.isForestAt(target.x, target.y) ? 0.7 : 1.0;
                            // Wall defense: units near walls are harder to hit with arrows
                            const wallDefMult = this.scene.buildingManager.getWallsNear(target.x, target.y, WALL_PROXIMITY_RADIUS).length > 0
                                ? (1 - WALL_DEFENSE_BONUS) : 1;
                            this.fireProjectile(origin, targetVaried, rangedDmg * forestMult * wallDefMult);
                        }
                    });
                }
            }
        } else {
            // Melee: lunge animation
            const visual = unit.visual;
            if (visual) {
                if (isStress) {
                    this.startLunge(visual, unit, target);
                } else {
                    const angle = Phaser.Math.Angle.Between(unit.x, unit.y, target.x, target.y);
                    const ox = visual.x;
                    const oy = visual.y;
                    const lungeX = ox + Math.cos(angle) * 10;
                    const lungeY = oy + Math.sin(angle) * 5;

                    this.scene.tweens.add({
                        targets: visual,
                        x: lungeX, y: lungeY,
                        duration: 100, yoyo: true,
                        onComplete: () => {
                            const iso = toIso(unit.x, unit.y);
                            visual.setPosition(iso.x, iso.y);
                        }
                    });
                }
            }

            if (target.takeDamage) {
                const unitOwner = unit.getData('owner') as number;
                const targetOwner = target.getData('owner') as number;
                const isOpposingFactions = unitOwner !== targetOwner && unitOwner >= 0 && targetOwner >= 0;
                
                const defCombatMods = this.scene.terrainSystem.getCombatModifiers(target.x, target.y, unit.x, unit.y);
                const heightDefenseMult = 1 - defCombatMods.defenseBonus;
                const snap = this.scene.researchManager?.getSnapshot(unitOwner);
                const dmgMult = snap?.damageMult ?? 1;
                // Siege Engineering: +25% damage for siege units vs buildings
                const siegeMult = (unit.unitType === UnitType.RAM && target.getData('def'))
                    ? (snap?.siegeBuildingDmgMult ?? 1) : 1;
                // RAM vs Wall: 3x bonus damage — battering rams shred walls
                const isRamVsWall = unit.unitType === UnitType.RAM && target.getData('def')?.type === BuildingType.WALL;
                const ramWallMult = isRamVsWall ? RAM_VS_WALL_MULTIPLIER : 1;
                // Forest defense bonus — trees block projectiles (Design Pillar 5: terrain matters)
                const forestMult = this.scene.terrainSystem.isForestAt(target.x, target.y) ? 0.7 : 1.0;
                // Cavalry Charge: 2x damage on first hit while charging
                const chargeMult = unit.getData('charging') ? 2 : 1;
                if (chargeMult > 1) {
                    unit.setData('charging', false); // Consume charge
                    if (unit.visual) (unit.visual as unknown as Phaser.GameObjects.Image).clearTint();
                }
                // Wall proximity defense: units near a wall take less damage
                const nearWall = this.scene.buildingManager.getWallsNear(target.x, target.y, WALL_PROXIMITY_RADIUS).length > 0;
                const wallDefenseMult = nearWall ? (1 - WALL_DEFENSE_BONUS) : 1;
                // Melee penalty: non-ram melee attackers deal reduced damage to targets behind walls
                const wallMeleeMult = (nearWall && unit.unitType !== UnitType.RAM) ? WALL_MELEE_PENALTY : 1;
                const finalDmg = Math.round(dmg * heightDefenseMult * dmgMult * siegeMult * ramWallMult * forestMult * chargeMult * wallDefenseMult * wallMeleeMult);

                if (isOpposingFactions) {
                    // Show floating damage number for melee hits on units and animals (buildings handled by EntityFactory)
                    if (!target.getData('def')) {
                        const primaryType = Object.entries(profile).reduce((a, b) => (b[1] > (a[1] ?? 0) ? b : a), ['', 0])[0];
                        this.scene.feedbackSystem.showDamageNumber(target.x, target.y, finalDmg, primaryType || undefined);
                        this.scene.feedbackSystem.showHitSpark(target.x, target.y, primaryType || undefined);
                    }
                    const isRamVsBuilding = unit.unitType === UnitType.RAM && target.getData('def');
                    if (isRamVsBuilding) {
                        this.scene.proceduralSound.playSiegeImpact(target.x, target.y);
                    } else {
                        const primaryType = Object.entries(profile).reduce((a, b) => (b[1] > (a[1] ?? 0) ? b : a), ['', 0])[0];
                        this.scene.proceduralSound.playAttackImpact(target.x, target.y, primaryType || undefined);
                    }
                }

                // Route to AnimalSystem if target is an animal container
                const targetType = target.getData('type') as string | undefined;
                if (targetType === 'animal') {
                    const animalData = target.getData('data');
                    if (animalData && this.scene.animalSystem) {
                        this.scene.animalSystem.takeDamage(animalData, finalDmg);
                    }
                } else {
                    target.takeDamage(finalDmg);
                }
            }
        }
    }

    // ─── Stress projectile scheduling / pooling ─────────────────────────────────
    private scheduleProjectile(
        origin: { x: number; y: number },
        target: { x: number; y: number; scene: Phaser.Scene; takeDamage: (amt: number) => void },
        dmg: number,
        delayMs: number
    ): void {
        const startIso = toIso(origin.x, origin.y);
        const endIso = toIso(target.x, target.y);

        const midX = (startIso.x + endIso.x) / 2;
        const midY = (startIso.y + endIso.y) / 2 - 50;

        // Match curve points from the non-pooled fireProjectile()
        const p0x = startIso.x;
        const p0y = startIso.y - 15;

        const p1x = midX;
        const p1y = midY - 50;

        const p2x = endIso.x;
        const p2y = endIso.y - 10;

        const arrow = this.getPooledArrow(startIso.x, startIso.y - 20);
        const emitter = this.getPooledEmitter();

        // Start hidden until delay elapses (still pooled to avoid allocations)
        arrow.setVisible(false);
        arrow.setActive(false);
        emitter.setVisible?.(false);


        this.activeStressProjectiles.push({
            arrow,
            emitter,
            originX: origin.x,
            originY: origin.y,
            targetX: target.x,
            targetY: target.y,
            p0x, p0y,
            p1x, p1y,
            p2x, p2y,
            startAt: this.scene.gameTime + delayMs,
            duration: 800,
            dmg,
            takeDamage: target.takeDamage,
            started: false,
            finished: false
        });

        // Hard cap to avoid unbounded growth if something goes wrong
        if (this.activeStressProjectiles.length > this.projectilePoolMax * 2) {
            // Drop the oldest unfinished projectile (won't affect sim determinism beyond VFX)
            const dropped = this.activeStressProjectiles.find(p => !p.finished && !p.started);
            if (dropped) this.recycleStressProjectile(dropped);
        }
    }

    private updateStressProjectiles(time: number): void {
        if (this.activeStressProjectiles.length === 0) return;

        for (let i = this.activeStressProjectiles.length - 1; i >= 0; i--) {
            const p = this.activeStressProjectiles[i];
            if (p.finished) {
                this.activeStressProjectiles.splice(i, 1);
                continue;
            }

            if (!p.started) {
                if (time < p.startAt) continue;
                p.started = true;

                // Match non-stress behavior: bow release sound triggers when projectile spawns
                this.scene.proceduralSound.playBowRelease(p.originX, p.originY);

                p.arrow.setVisible(true);
                p.arrow.setActive(true);
                p.emitter.setVisible?.(true);


                // Place at curve start
                p.arrow.setPosition(p.p0x, p.p0y);

                if (p.emitter.setPosition) {
                    p.emitter.setPosition(p.arrow.x, p.arrow.y);
                }

                if (p.emitter.start) p.emitter.start();

                // Keep depth consistent with non-pooled version
                p.emitter.setDepth?.(Number.MAX_VALUE - 100);
                p.arrow.setDepth(p.p0y + 100);

                continue;
            }

            const elapsed = time - p.startAt;
            const t = Math.min(1, Math.max(0, elapsed / p.duration));

            const omt = 1 - t;

            const x = omt * omt * p.p0x + 2 * omt * t * p.p1x + t * t * p.p2x;
            const y = omt * omt * p.p0y + 2 * omt * t * p.p1y + t * t * p.p2y;

            // Tangent for rotation (derivative of quadratic bezier)
            const dx = 2 * omt * (p.p1x - p.p0x) + 2 * t * (p.p2x - p.p1x);
            const dy = 2 * omt * (p.p1y - p.p0y) + 2 * t * (p.p2y - p.p1y);
            const angle = Math.atan2(dy, dx);

            p.arrow.setPosition(x, y);
            p.arrow.setRotation(angle);

            if (p.emitter.setPosition) {
                p.emitter.setPosition(x, y);
            }

            if (t >= 1) {
                // End
                p.finished = true;
                this.recycleStressProjectile(p);
                p.takeDamage(p.dmg);
                this.scene.proceduralSound.playAttackImpact(p.targetX, p.targetY, 'Pierce');
            }
        }
    }

    private recycleStressProjectile(p: StressProjectile): void {
        // Stop emitter and return to pools
        try {
            p.emitter.stop?.();
        } catch {
            // ignore
        }

        p.arrow.setVisible(false);
        p.arrow.setActive(false);
        p.emitter.setVisible?.(false);


        if (this.arrowPool.length < this.projectilePoolMax) this.arrowPool.push(p.arrow);
        if (this.emitterPool.length < this.projectilePoolMax) this.emitterPool.push(p.emitter);
    }

    private getPooledArrow(x: number, y: number): Phaser.GameObjects.Rectangle {
        const arrow = this.arrowPool.pop();
        if (arrow) {
            arrow.setPosition(x, y);
            arrow.setVisible(true);
            arrow.setActive(true);
            return arrow;
        }

        const newArrow = this.scene.add.rectangle(x, y, 10, 1, 0xffffff);
        if (this.scene.worldLayer) this.scene.worldLayer.add(newArrow);
        newArrow.setDepth(y + 120);
        return newArrow;
    }

    private getPooledEmitter(): StressEmitter {
        const pooled = this.emitterPool.pop();
        if (pooled) return pooled;

        const emitter = this.scene.add.particles(0, 0, 'white_flare', {
            speed: 0,
            scale: { start: 0.2, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 500,
            tint: 0xffffff,
            blendMode: 'ADD',
            frequency: 10,
            emitting: false
        });

        if (this.scene.worldLayer) this.scene.worldLayer.add(emitter);
        emitter.setDepth?.(Number.MAX_VALUE - 100);
        return emitter;
    }

    // ─── Stress melee lunge (manual animation, no tweens) ─────────────────────
    private startLunge(visual: Phaser.GameObjects.GameObject, unit: GameUnit, target: GameUnit): void {
        // If this visual already has a lunge, replace it (avoid stacking).
        this.activeStressLunges = this.activeStressLunges.filter(l => l.visual !== visual);

        const angle = Phaser.Math.Angle.Between(unit.x, unit.y, target.x, target.y);
        const v = visual as unknown as { x: number; y: number };
        const startX = v.x;
        const startY = v.y;
        const endX = startX + Math.cos(angle) * 10;
        const endY = startY + Math.sin(angle) * 5;

        this.activeStressLunges.push({
            visual,
            startX,
            startY,
            endX,
            endY,
            startAt: this.scene.gameTime,
            duration: this.lungeDurationMs,
            unitRef: unit
        });
    }

    private updateStressLunges(time: number): void {
        if (this.activeStressLunges.length === 0) return;

        for (let i = this.activeStressLunges.length - 1; i >= 0; i--) {
            const l = this.activeStressLunges[i];
            const visual = l.visual;
            if (!visual || !visual.scene) {
                this.activeStressLunges.splice(i, 1);
                continue;
            }

            const elapsed = time - l.startAt;
            const t = elapsed / l.duration;

            if (t >= 1) {
                const iso = toIsoElev(l.unitRef.x, l.unitRef.y, this.scene.terrainSystem.getHeightAt(l.unitRef.x, l.unitRef.y));
                const v = visual as unknown as { setPosition?: (x: number, y: number) => void };
                if (v.setPosition) {
                    v.setPosition(iso.x, iso.y);
                }
                this.activeStressLunges.splice(i, 1);
                continue;
            }

            const half = 0.5;
            let k: number;
            let x: number;
            let y: number;
            if (t < half) {
                k = t / half;
                x = Phaser.Math.Linear(l.startX, l.endX, k);
                y = Phaser.Math.Linear(l.startY, l.endY, k);
            } else {
                k = (t - half) / half;
                x = Phaser.Math.Linear(l.endX, l.startX, k);
                y = Phaser.Math.Linear(l.endY, l.startY, k);
            }

            const v = visual as unknown as { setPosition?: (x: number, y: number) => void };
            if (v.setPosition) {
                v.setPosition(x, y);
            }
        }
    }

    // ─── Projectile ────────────────────────────────────────────────────────
    /** Render a projectile arc and impact feedback without applying damage. */
    public showProjectile(origin: { x: number; y: number }, target: { x: number; y: number; scene: Phaser.Scene }): void {
        this.fireProjectile(origin, { ...target, takeDamage: () => {} }, 0);
    }
    private fireProjectile(origin: { x: number; y: number }, target: { x: number; y: number; scene: Phaser.Scene; takeDamage: (amt: number) => void }, dmg: number): void {
        const startIso = toIso(origin.x, origin.y);
        const endIso = toIso(target.x, target.y);

        const arrow = this.getPooledArrow(startIso.x, startIso.y - 20);
        const emitter = this.getPooledEmitter();
        emitter.setPosition?.(arrow.x, arrow.y);
        emitter.start?.();
        arrow.setDepth(startIso.y + 100);
        emitter.setDepth?.(Number.MAX_VALUE - 100);

        const midX = (startIso.x + endIso.x) / 2;
        const midY = (startIso.y + endIso.y) / 2 - 50;

        const curve = new Phaser.Curves.QuadraticBezier(
            new Phaser.Math.Vector2(startIso.x, startIso.y - 15),
            new Phaser.Math.Vector2(midX, midY - 50),
            new Phaser.Math.Vector2(endIso.x, endIso.y - 10)
        );

        const projectileObj = { t: 0, vec: new Phaser.Math.Vector2() };

        this.scene.tweens.add({
            targets: projectileObj,
            t: 1,
            duration: 800,
            onUpdate: () => {
                curve.getPoint(projectileObj.t, projectileObj.vec);
                arrow.setPosition(projectileObj.vec.x, projectileObj.vec.y);
                const tangent = curve.getTangent(projectileObj.t);
                arrow.setRotation(tangent.angle());
                emitter.setPosition?.(projectileObj.vec.x, projectileObj.vec.y);
            },
            onComplete: () => {
                this.recycleStressProjectile({
                    arrow,
                    emitter,
                    originX: origin.x,
                    originY: origin.y,
                    targetX: target.x,
                    targetY: target.y,
                    p0x: startIso.x,
                    p0y: startIso.y - 15,
                    p1x: midX,
                    p1y: midY - 50,
                    p2x: endIso.x,
                    p2y: endIso.y - 10,
                    startAt: 0,
                    duration: 800,
                    dmg,
                    takeDamage: target.takeDamage,
                    started: true,
                    finished: true,
                });
                if (target.takeDamage) {
                    target.takeDamage(dmg);
                    this.scene.feedbackSystem.showHitSpark(target.x, target.y, 'Pierce');
                    if (dmg > 0) this.scene.feedbackSystem.showDamageNumber(target.x, target.y, Math.round(dmg), 'Pierce');
                    this.scene.proceduralSound.playAttackImpact(target.x, target.y, 'Pierce');
                }
            }
        });
    }


    // ─── Debug Rendering ───────────────────────────────────────────────────
    private drawDebugLines(): void {
        this.debugGraphics.clear();
        for (const u of this.scene.units.getChildren() as GameUnit[]) {
            const startIso = toIso(u.x, u.y);

            if (u.target && u.target.scene) {
                const tgt = u.target as Phaser.GameObjects.Image;
                const endIso = toIso(tgt.x, tgt.y);
                this.debugGraphics.lineStyle(2, 0xff0000, 0.7);
                this.debugGraphics.beginPath();
                this.debugGraphics.moveTo(startIso.x, startIso.y);
                this.debugGraphics.lineTo(endIso.x, endIso.y);
                this.debugGraphics.strokePath();
            }

            if (u.path && u.path.length > 0) {
                const dest = u.path[u.path.length - 1];
                const endIso = toIso(dest.x, dest.y);
                this.debugGraphics.lineStyle(1, 0xffffff, 0.5);
                this.debugGraphics.beginPath();
                this.debugGraphics.moveTo(startIso.x, startIso.y);
                this.debugGraphics.lineTo(endIso.x, endIso.y);
                this.debugGraphics.strokePath();
            }
        }
    }

    private drawUnitPaths(time: number): void {
        this.pathGraphics.clear();
        for (const u of this.scene.units.getChildren() as GameUnit[]) {
            const isSelectable = COMBAT_UNIT_TYPES.includes(u.unitType);

            if (isSelectable && u.path && u.pathCreatedAt) {
                const age = time - u.pathCreatedAt;
                const fadeDuration = 1500;
                if (age < fadeDuration && u.path.length > u.pathStep) {
                    const alpha = Phaser.Math.Clamp(1 - (age / fadeDuration), 0, 1);
                    this.pathGraphics.beginPath();
                    const startIso = toIso(u.x, u.y);
                    this.pathGraphics.moveTo(startIso.x, startIso.y);
                    for (let i = u.pathStep; i < u.path.length; i++) {
                        const pt = u.path[i];
                        const iso = toIso(pt.x, pt.y);
                        this.pathGraphics.lineTo(iso.x, iso.y);
                    }
                    this.pathGraphics.lineStyle(2, 0xffffff, alpha);
                    this.pathGraphics.strokePath();
                    this.pathGraphics.lineStyle(6, 0xffffff, alpha * 0.3);
                    this.pathGraphics.strokePath();
                }
            }
        }
    }

    // ─── Unit Abilities ─────────────────────────────────────────────────────
    public activateAbility(unit: GameUnit): boolean {
        const ability = UNIT_ABILITIES[unit.unitType];
        if (!ability) return false;

        const now = this.scene.gameTime;
        const lastUsed = (unit.getData('abilityCooldown') as number) || 0;
        const config = ABILITY_CONFIG[ability];

        // Check cooldown
        if (now - lastUsed < config.cooldown) return false;

        // Set cooldown
        unit.setData('abilityCooldown', now);

        switch (ability) {
            case UnitAbility.SHIELD_WALL: {
                // +50% armor for 5s, immobile
                unit.setData('shieldWall', true);
                const baseArmor = unit.getData('armor') as ArmorProfile || {};
                const boostedArmor: ArmorProfile = {};
                for (const [key, val] of Object.entries(baseArmor)) {
                    boostedArmor[key as DamageType] = (val ?? 0) * 1.5;
                }
                unit.setData('shieldWallOriginalArmor', baseArmor);
                unit.setData('armor', boostedArmor);
                // Stop movement
                const body = unit.body as Phaser.Physics.Arcade.Body;
                if (body) body.setVelocity(0, 0);
                unit.flowTarget = undefined;
                // Visual feedback
                if (unit.visual) {
                    unit.visual.setAlpha(0.8);
                }
                // Remove after duration
                this.scene.time.delayedCall(config.duration, () => {
                    if (unit.scene) {
                        unit.setData('shieldWall', false);
                        unit.setData('armor', baseArmor);
                        if (unit.visual) unit.visual.setAlpha(1);
                    }
                });
                this.scene.feedbackSystem.showDamageNumber(unit.x, unit.y - 20, 0, 'Hack'); // Visual indicator
                return true;
            }
            case UnitAbility.RAIN_FIRE: {
                // Area volley: hit all enemies within 100px of unit's target or position
                const targetX = unit.target ? (unit.target as GameUnit).x : unit.x;
                const targetY = unit.target ? (unit.target as GameUnit).y : unit.y;
                const owner = unit.getData('owner') as number;
                const areaRadius = 100;

                // Find enemies in area
                const enemies = this.scene.units.getChildren().filter((e) => {
                    if ((e as GameUnit).getData('owner') === owner) return false;
                    const dx = (e as GameUnit).x - targetX;
                    const dy = (e as GameUnit).y - targetY;
                    return Math.sqrt(dx * dx + dy * dy) <= areaRadius;
                }) as GameUnit[];

                if (enemies.length === 0) return false;

                // Deal 50% damage to each
                const profile: DamageProfile = (unit.getData('damage') as DamageProfile) || { [DamageType.PIERCE]: 10 };
                const halfDmgProfile = scaleDamageProfile(profile, 0.5);

                for (const enemy of enemies) {
                    const enemyArmor = (enemy.getData('armor') as ArmorProfile) || {};
                    const finalDmg = computeDamage(halfDmgProfile, enemyArmor);
                    if (enemy.takeDamage) {
                        enemy.takeDamage(Math.round(finalDmg));
                    }
                    // Show damage number
                    this.scene.feedbackSystem.showDamageNumber(enemy.x, enemy.y, Math.round(finalDmg), 'Pierce');
                    // Fire visual arrow
                    this.fireProjectile(
                        { x: unit.x, y: unit.y },
                        { x: enemy.x, y: enemy.y, scene: enemy.scene, takeDamage: () => {} },
                        0 // Visual only, damage already applied
                    );
                }
                return true;
            }
            case UnitAbility.CHARGE: {
                // 2x damage on first hit after sprinting
                unit.setData('charging', true);
                // Visual feedback
                if (unit.visual) {
                    (unit.visual as unknown as Phaser.GameObjects.Image).setTint(0xff8800);
                }
                // Remove after duration
                this.scene.time.delayedCall(config.duration, () => {
                    if (unit.scene) {
                        unit.setData('charging', false);
                        if (unit.visual) (unit.visual as unknown as Phaser.GameObjects.Image).clearTint();
                    }
                });
                return true;
            }
        }
        return false;
    }

}
