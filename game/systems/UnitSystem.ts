import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, UnitState, FormationType, UnitStance, GameUnit } from '../../types';
import { UNIT_SPEED, UNIT_STATS, FORMATION_BONUSES, STANCE_TETHER_RADIUS } from '../../constants';
import { toIso } from '../utils/iso';
import { FormationSystem } from './FormationSystem';

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

export class UnitSystem {
    private scene: MainScene;
    private pathGraphics: Phaser.GameObjects.Graphics;
    private debugGraphics: Phaser.GameObjects.Graphics;

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
            this.updateUnitLogicTimed(allUnits[i], time);
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
            if (path) {
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
            // Direct steering fallback (no flow direction)
            this.scene.physics.moveTo(unit, unit.flowTarget.x, unit.flowTarget.y, speed);
            return;
        }

        // Blend flow direction (70%) + direct bias (30%)
        const toTargetLen = dist;
        const blendX = dir.x * 0.7 + (toTargetLen > 1 ? (-dx / toTargetLen) * 0.3 : 0);
        const blendY = dir.y * 0.7 + (toTargetLen > 1 ? (-dy / toTargetLen) * 0.3 : 0);
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
            if (startPath) {
                fullPath = startPath;
            } else {
                fullPath = [new Phaser.Math.Vector2(startPos.x, startPos.y)];
            }

            for (let i = 0; i < pathPoints.length - 1; i++) {
                const segment = this.scene.pathfinder.findPath(pathPoints[i], pathPoints[i + 1]);
                if (segment && segment.length > 0) {
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
                    if (path) {
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

            // Proximity chase: direct movement for close targets
            if (dist < 200) {
                unit.path = null;
                const speed = UNIT_SPEED[unit.unitType as UnitType] || 100;
                this.scene.physics.moveTo(unit, target.x, target.y, speed);
            } else {
                // Long-range chase: recalculate path periodically
                const lastRecalc = unit.getData('_lastPathRecalc') as number || 0;
                if (!unit.path || unit.path.length === 0 || (this.scene.time.now - lastRecalc > _PATH_RECALC_INTERVAL)) {
                    unit.setData('_lastPathRecalc', this.scene.time.now);
                    const path = this.scene.pathfinder.findPath(
                        new Phaser.Math.Vector2(unit.x, unit.y),
                        new Phaser.Math.Vector2(target.x, target.y)
                    );
                    if (path) {
                        unit.path = path;
                        unit.pathStep = 0;
                        unit.pathCreatedAt = time;
                    }
                }

                if (unit.path && unit.path.length > 0) {
                    this.moveAlongPath(unit);
                } else {
                    const speed = UNIT_SPEED[unit.unitType as UnitType] || 100;
                    this.scene.physics.moveTo(unit, target.x, target.y, speed);
                }
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
            const multiplier = FORMATION_BONUSES[formation]?.speed || 1.0;
            this.scene.physics.moveTo(unit, nextPoint.x, nextPoint.y, baseSpeed * multiplier);
        }

        // Stale path detection: if path is too old, clear it
        if (unit.pathCreatedAt && this.scene.gameTime - unit.pathCreatedAt > STALE_PATH_LIFETIME) {
            unit.path = null;
            unit.state = UnitState.IDLE;
        }
    }

    // ─── Combat Resolution ─────────────────────────────────────────────────
    private performAttack(unit: GameUnit, target: GameUnit): void {
        let dmg = unit.getData('attack') as number || 10;
        const formation = unit.getData('formation') as FormationType || FormationType.BOX;
        const attackMult = FORMATION_BONUSES[formation]?.attack || 1.0;
        dmg *= attackMult;

        // Axeman: bonus damage vs buildings
        const bonusVsBuilding = unit.getData('bonusVsBuilding') as number | undefined;
        if (bonusVsBuilding && target.getData('def')) {
            dmg *= bonusVsBuilding;
        }

        // Hoplite: defensive bonus (stacks multiplicatively with formation defense in handleDamage)
        const defensiveBonus = target.getData('defensiveBonus') as number | undefined;
        if (defensiveBonus) {
            dmg *= (1 - defensiveBonus);
        }

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

                this.scene.time.delayedCall(delay, () => {
                    if (unit.scene && target.scene) {
                        this.fireProjectile(origin, targetVaried, damagePerArrow);
                    }
                });
            }
        } else {
            // Melee: lunge animation
            const visual = unit.visual;
            if (visual) {
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

            if (target.takeDamage) {
                target.takeDamage(dmg);
            }
        }
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
