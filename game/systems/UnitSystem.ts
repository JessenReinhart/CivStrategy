import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, FormationType, UnitStance, GameUnit, DamageType, DamageProfile, ArmorProfile } from '../../types';
import { UNIT_SPEED, UNIT_STATS, FORMATION_BONUSES, STANCE_TETHER_RADIUS, EVENTS, computeDamage, scaleDamageProfile } from '../../constants';
import { toIso } from '../utils/iso';
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
const FLOW_FIELD_THRESHOLD = 12;     // min units to trigger flow field instead of individual paths
const FLOW_STEER_INTERVAL = 80;    // ms between flow direction updates per unit

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

        // Process pathfinding queue (throttle for large counts)
        if (unitCount < 1000) {
            this.scene.pathfinder.processQueue();
        } else {
            this.scene.pathfinder.processQueueBudgeted(100); // cap per frame
        }

        // ─── Mass flow field update (ALL units, every frame) ─────────────
        // Flow field steering is O(1) per unit (array lookup + setVelocity).
        // It has a 80ms throttle so the expensive part only fires every 80ms.
        // Running this pass for every unit each frame eliminates bucket-based
        // visual stutter — all units' steering updates synchronously.
        for (let i = 0; i < unitCount; i++) {
            const unit = allUnits[i];
            if (unit.flowTarget) {
                this.moveAlongFlowField(unit, time);
            }
        }

        // Adaptive per-frame budget: scale with total units but cap sanity
        const budget = this.scene.stressTestConfig ? Math.min(600, unitCount) : this.maxUnitsPerFrame;
        const bucketSize = Math.max(1, Math.ceil(unitCount / Math.ceil(unitCount / budget)));
        const start = this.updateIndex;
        const end = Math.min(start + bucketSize, unitCount);

        for (let i = start; i < end; i++) {
            const unit = allUnits[i];
            if (!unit) continue;
            this.updateUnitLogicTimed(unit, time);
        }

        // Advance or wrap bucket index
        this.updateIndex += bucketSize;
        if (this.updateIndex >= unitCount) {
            this.updateIndex = 0;
        }

        // Dynamic separation interval: less frequent for dense groups
        const sepInterval = unitCount > 1000 ? 30 : (unitCount > 500 ? 15 : SEPARATION_INTERVAL);
        this.separationFrame++;
        if (this.separationFrame >= sepInterval) {
            this.separationFrame = 0;
            this.applySeparation();
        }

        // Path rendering: only for small groups (<500) or debug mode
        // Fix 1: Gate drawUnitPaths to prevent O(n) iteration waste
        if (unitCount < 500 || this.scene.debugMode) {
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

                const body = unit.body as Phaser.Physics.Arcade.Body;
                if (!body || body.velocity.length() < 1) continue;

                const neighbors = spatialHash.query(unit.x, unit.y, queryRadius);
                for (const other of neighbors) {
                    if (other === unit) continue;
                    const otherBody = other.body as Phaser.Physics.Arcade.Body;
                    if (!otherBody) continue;

                    const dx = unit.x - other.x;
                    const dy = unit.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 18 && dist > 0.01) {
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
                if (!body || body.velocity.length() < 1) continue;

                for (let j = i + 1; j < units.length; j++) {
                    const other = units[j];
                    const otherBody = other.body as Phaser.Physics.Arcade.Body;
                    if (!otherBody) continue;

                    const dx = unit.x - other.x;
                    const dy = unit.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 18 && dist > 0.01) {
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
        const speed = baseSpeed * multiplier;

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

            const targetType = target.getData('type') || (target as GameUnit).unitType;
            if (targetType === 'animal' || targetType === UnitType.ANIMAL) {
                return;
            }

            if ([UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(unit.unitType)) {
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

    // ─── Target Scanning (SpatialHash optimized) ──────────────────────────
    private scanForTargets(unit: GameUnit, _time: number): void {
        // Throttle: only scan periodically (~every 500ms)
        const lastScan = unit.getData('_lastScan') as number || 0;
        if (this.scene.time.now - lastScan < SCAN_INTERVAL_COMBAT) return;
        unit.setData('_lastScan', this.scene.time.now);

        const isCombatUnit = [UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(unit.unitType);
        if (!isCombatUnit) return;

        const stance = unit.getData('stance') as UnitStance || UnitStance.DEFENSIVE;
        const visionRange = 250;
        const myOwner = unit.getData('owner') as number;

        // Use SpatialHash for O(k) neighbor scanning instead of O(n)
        const spatialHash = this.scene.unitSpatialHash;
        let candidates: Phaser.GameObjects.GameObject[];

        if (spatialHash) {
            candidates = spatialHash.query(unit.x, unit.y, visionRange);
        } else {
            // Fallback
            candidates = this.scene.units.getChildren();
        }

        let closest: Phaser.GameObjects.GameObject | null = null;
        let closestDist = visionRange;

        for (const other of candidates) {
            if (other === unit) continue;
            const otherOwner = other.getData('owner') as number;
            if (otherOwner === myOwner) continue;
            const hp = other.getData('hp') as number;
            if (hp <= 0) continue;

            // Skip non-combat entities for targeting
            const otherType = other.getData('unitType') || (other as GameUnit).unitType;
            if (otherType === UnitType.VILLAGER || otherType === UnitType.ANIMAL) continue;

            const otherImg = other as Phaser.GameObjects.Image;
            const dx = unit.x - otherImg.x;
            const dy = unit.y - otherImg.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < closestDist) {
                // Fog of War check - skip if fog system active and point not visible
                // Note: isVisible on FogOfWarSystem is a boolean flag, not a per-point check.
                // We skip this check for now; FogOfWarSystem currently doesn't expose point visibility.
                // TODO: Add isPointVisible(x,y,owner) to FogOfWarSystem if needed.
                closest = other;
                closestDist = dist;
            }
        }

        // If no unit target, scan buildings (smaller set, always cheaper)
        if (!closest) {
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
        const dist = Math.sqrt(dx * dx + dy * dy);
        const range = unit.getData('range') as number || 40;
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
                    const path = this.scene.pathfinder.findPath(
                        new Phaser.Math.Vector2(unit.x, unit.y),
                        new Phaser.Math.Vector2(anchor.x, anchor.y)
                    );
                    if (path && path.length > 1) {
                        unit.path = path;
                        unit.pathStep = 0;
                        unit.pathCreatedAt = time;
                    }
                    return;
                }
            } else if (stance === UnitStance.HOLD) {
                if (dist > range) {
                    body.setVelocity(0, 0);
                    unit.target = null;
                    unit.state = UnitState.IDLE;
                    return;
                }
            }
        }

        // Attack or chase
        if (dist <= range) {
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
              distToTarget: dist,
              range,
            });

            // Also repath if existing path no longer ends near the target
            const endStale = !!(
              unit.path
              && unit.path.length > 1
              && !pathEndNearTarget(unit.path, target.x, target.y)
              && (nowMs - lastRecalc) >= 450
            );

            if (needRepath || endStale) {
              unit.setData('_lastPathRecalc', nowMs);
              unit.setData('_chaseTargetPos', { x: target.x, y: target.y });
              const path = this.scene.pathfinder.findPath(
                new Phaser.Math.Vector2(unit.x, unit.y),
                new Phaser.Math.Vector2(target.x, target.y),
              );
              if (path && path.length > 1) {
                unit.path = path;
                unit.pathStep = findResumePathStep(path, unit.x, unit.y);
                unit.pathCreatedAt = time;
              } else if (!unit.path || unit.path.length <= 1) {
                unit.path = null;
                body.setVelocity(0, 0);
              }
              // If repath failed but old path exists, keep following it
            } else if (!lastTarget) {
              unit.setData('_chaseTargetPos', { x: target.x, y: target.y });
            }

            if (unit.path && unit.path.length > 0) {
              this.moveAlongPath(unit);
            } else {
              body.setVelocity(0, 0);
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
            const finalSpeed = baseSpeed * formationMultiplier * terrainModifier;
            
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

        // Formation attack bonus + high-ground attack bonus
        profile = scaleDamageProfile(profile, attackMult * heightAttackMult);

        // Apply the target's per-type armor via the smooth reduction formula
        const targetArmor = (target.getData('armor') as ArmorProfile) || {};
        const effective = computeDamage(profile, targetArmor);
        const dmg = effective;

        if (unit.unitType === UnitType.ARCHER) {
            // Ranged volley
            const maxHp = unit.getData('maxHp') as number;
            const currentHp = unit.getData('hp') as number;
            const squadSize = UNIT_STATS[UnitType.ARCHER].squadSize;
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
                            const rangedDmg = Math.round(damagePerArrow * (1 - defMods.defenseBonus));
                            this.fireProjectile(origin, targetVaried, rangedDmg);
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
                // Check if this is a clash between opposing factions
                const unitOwner = unit.getData('owner') as number;
                const targetOwner = target.getData('owner') as number;
                const isOpposingFactions = unitOwner !== targetOwner && unitOwner >= 0 && targetOwner >= 0;
                
                // Apply terrain-based defense bonus for defender
                const defCombatMods = this.scene.terrainSystem.getCombatModifiers(target.x, target.y, unit.x, unit.y);
                const heightDefenseMult = 1 - defCombatMods.defenseBonus;
                const finalDmg = Math.round(dmg * heightDefenseMult);

                if (isOpposingFactions) {
                    this.scene.events.emit(EVENTS.CLASH_START, { x: target.x, y: target.y });
                }

                this.scene.proceduralSound.playSwordClash(target.x, target.y);
                target.takeDamage(finalDmg);
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
                const iso = toIso(l.unitRef.x, l.unitRef.y);
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

    private toCartesianIsoDepth(y: number): number {
        // Depth convention: y acts like iso y; keep it consistent with other visuals.
        return y;
    }

    // ─── Projectile ────────────────────────────────────────────────────────
    private fireProjectile(origin: { x: number; y: number }, target: { x: number; y: number; scene: Phaser.Scene; takeDamage: (amt: number) => void }, dmg: number): void {
        const startIso = toIso(origin.x, origin.y);
        const endIso = toIso(target.x, target.y);

        const arrow = this.scene.add.rectangle(startIso.x, startIso.y - 20, 10, 1, 0xffffff);
        if (this.scene.worldLayer) this.scene.worldLayer.add(arrow);
        arrow.setDepth(startIso.y + 100);

        const emitter = this.scene.add.particles(0, 0, 'white_flare', {
            speed: 0,
            scale: { start: 0.2, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 500,
            tint: 0xffffff,
            blendMode: 'ADD',
            frequency: 10,
            follow: arrow
        });
        if (this.scene.worldLayer) this.scene.worldLayer.add(emitter);
        emitter.setDepth(Number.MAX_VALUE - 100);

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
            },
            onComplete: () => {
                arrow.destroy();
                emitter.destroy();
                if (target.takeDamage) {
                    target.takeDamage(dmg);
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
            const isSelectable = [UnitType.PIKESMAN, UnitType.CAVALRY, UnitType.LEGION, UnitType.ARCHER].includes(u.unitType);

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
}
