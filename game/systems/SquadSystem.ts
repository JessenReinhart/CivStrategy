import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, FormationType, UnitState, GameUnit } from '../../types';
import { UNIT_STATS } from '../../constants';
import { toIso } from '../utils/iso';
import { FormationSystem } from './FormationSystem';

/**
 * SquadSystem - Optimized for Annihilation-scale (thousands+ units).
 * 
 * Key optimizations:
 * - LOD: Distant squads render fewer soldiers
 * - Early-out: Skip invisible/culled units immediately
 * - Reduced per-frame lerp for distant squads
 * - Soldier state recycling (no garbage generation)
 * - Simplified drawing for LOD_DOT (single circle)
 */

// LOD constants based on camera distance
const LOD_FULL = 0;       // 0-400px: render all soldiers
const LOD_MEDIUM = 1;     // 400-800px: render half the soldiers
const LOD_LOW = 2;        // 800-1200px: render 1/4 soldiers
const LOD_DOT = 3;        // >1200px: single dot

const LOD_THRESHOLDS: Record<number, number> = {
    [LOD_FULL]: 400,
    [LOD_MEDIUM]: 800,
    [LOD_LOW]: 1200,
};

// Maximum squads to process per frame (beyond this, skip update)
const MAX_SQUADS_PER_FRAME = 200;

// Simplify drawing at distance
const LOD_FACTORS: Record<number, number> = {
    [LOD_FULL]: 1,        // All soldiers
    [LOD_MEDIUM]: 2,      // Every 2nd soldier
    [LOD_LOW]: 4,         // Every 4th soldier
    [LOD_DOT]: Infinity,  // Just a dot
};

interface SoldierState {
    x: number;
    y: number;
    z: number;
    offset: { x: number; y: number };
}

export class SquadSystem {
    private scene: MainScene;
    private frameIndex: number = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    public createSquad(unit: Phaser.GameObjects.GameObject, type: UnitType, _owner: number): void {
        const stats = UNIT_STATS[type];
        if (!stats || stats.squadSize <= 1) return;

        const container = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(container);
        if (this.scene.worldLayer) this.scene.worldLayer.add(container);
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(container);
        const gfx = this.scene.add.graphics();
        container.add(gfx);

        unit.setData('squadContainer', container);
        unit.setData('squadCurrentCount', stats.squadSize);
        unit.setData('squadMaxCount', stats.squadSize);
        unit.setData('formationAngle', 0);

        this.initializeSoldiers(unit, stats.squadSize, type);

        if (!this.scene.worldLayer) this.scene.add.existing(container);
    }

    private initializeSoldiers(unit: Phaser.GameObjects.GameObject, count: number, _type: UnitType): void {
        const soldiers: SoldierState[] = [];
        const u = unit as Phaser.GameObjects.Container;

        for (let i = 0; i < count; i++) {
            soldiers.push({
                x: u.x,
                y: u.y,
                z: 0,
                offset: { x: 0, y: 0 }
            });
        }
        unit.setData('soldierStates', soldiers);
        this.applyFormation(unit, FormationType.BOX);
    }

    /**
     * Main squad update - batched and LOD-optimized.
     */
    public update(_dt: number): void {
        const allUnits = this.scene.units.getChildren();
        if (allUnits.length === 0) return;

        // Calculate per-frame budget
        const bucketSize = Math.max(1, Math.ceil(allUnits.length / Math.ceil(allUnits.length / MAX_SQUADS_PER_FRAME)));
        const start = this.frameIndex;
        const end = Math.min(start + bucketSize, allUnits.length);

        const cam = this.scene.cameras.main;
        const camCenter = cam.getWorldPoint(cam.width / 2, cam.height / 2);
        const zoom = cam.zoom;

        for (let i = start; i < end; i++) {
            const unit = allUnits[i] as GameUnit;
            const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
            if (!container) continue;

            // Culling check: skip if not visible
            if (!container.visible) continue;

            // Determine LOD based on screen distance
            const dx = unit.x - camCenter.x;
            const dy = unit.y - camCenter.y;
            const screenDist = Math.sqrt(dx * dx + dy * dy) / zoom;

            let lod = LOD_FULL;
            if (screenDist > LOD_THRESHOLDS[LOD_LOW]) lod = LOD_DOT;
            else if (screenDist > LOD_THRESHOLDS[LOD_MEDIUM]) lod = LOD_LOW;
            else if (screenDist > LOD_THRESHOLDS[LOD_FULL]) lod = LOD_MEDIUM;

            // Update container position
            const commanderIso = toIso(unit.x, unit.y);
            container.setPosition(commanderIso.x, commanderIso.y);
            container.setDepth(commanderIso.y);

            // Also update the visual container (used for click detection)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const visual = (unit as any).visual as Phaser.GameObjects.Container;
            if (visual && visual.visible) {
                visual.setPosition(commanderIso.x, commanderIso.y);
                visual.setDepth(commanderIso.y);
            }

            // Get formation facing angle
            const body = unit.body as Phaser.Physics.Arcade.Body;
            const stats = UNIT_STATS[unit.unitType as UnitType];
            if (!stats || stats.squadSize <= 1) continue;

            let angle = unit.getData('formationAngle') as number || 0;
            const speed = body ? body.velocity.length() : 0;
            const isMoving = speed > 10;

            // Smooth angle transitions (skip for LOD_DOT)
            if (lod !== LOD_DOT) {
                if (isMoving && body) {
                    const targetAngle = body.velocity.angle();
                    angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.1);
                    unit.setData('formationAngle', angle);
                } else if ((unit.state === UnitState.ATTACKING || unit.state === UnitState.CHASING) && unit.target) {
                    const tgt = unit.target as Phaser.GameObjects.Image;
                    const targetAngle = Phaser.Math.Angle.Between(unit.x, unit.y, tgt.x, tgt.y);
                    angle = Phaser.Math.Angle.RotateTo(angle, targetAngle, 0.1);
                    unit.setData('formationAngle', angle);
                }
            }

            // Update HP-based soldier count (skip for distant)
            const hp = unit.getData('hp') as number;
            const maxHp = unit.getData('maxHp') as number;
            const targetCount = Math.max(1, Math.ceil((hp / maxHp) * stats.squadSize));
            const soldiers = unit.getData('soldierStates') as SoldierState[];

            // Adjust soldier count without garbage generation
            if (soldiers && soldiers.length !== targetCount) {
                if (soldiers.length > targetCount) {
                    soldiers.length = targetCount; // Truncate (no GC)
                } else {
                    while (soldiers.length < targetCount) {
                        soldiers.push({
                            x: unit.x,
                            y: unit.y,
                            z: 0,
                            offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 }
                        });
                    }
                }
            }

            // Render based on LOD
            const gfx = container.getAt(0) as Phaser.GameObjects.Graphics;
            this.renderSquad(gfx, unit, soldiers, angle, isMoving, lod, commanderIso);
        }

        // Advance frame bucket
        this.frameIndex += bucketSize;
        if (this.frameIndex >= allUnits.length) {
            this.frameIndex = 0;
        }
    }

    /**
     * Render a squad with LOD-specific optimizations.
     */
    private renderSquad(
        gfx: Phaser.GameObjects.Graphics,
        unit: GameUnit,
        soldiers: SoldierState[],
        angle: number,
        isMoving: boolean,
        lod: number,
        commanderIso: { x: number; y: number }
    ): void {
        gfx.clear();

        const owner = unit.getData('owner') as number;
        const color = this.scene.getFactionColor(owner);

        // Selection circle (always visible if selected, regardless of LOD)
        if (unit.isSelected) {
            const stats = UNIT_STATS[unit.unitType as UnitType];
            gfx.lineStyle(2, 0xffffff, 0.8);
            const radius = Math.sqrt(stats.squadSize) * (stats.squadSpacing || 10) * 0.7;
            gfx.strokeEllipse(0, 0, radius * 2.5, radius * 1.5);
        }

        // LOD_DOT: single colored circle
        if (lod === LOD_DOT) {
            const dotSize = unit.unitType === UnitType.LEGION ? 8 :
                unit.unitType === UnitType.CAVALRY ? 6 : 5;
            gfx.fillStyle(color, 1);
            gfx.fillCircle(0, 0, dotSize);
            return;
        }

        // LOD step factor
        const step = LOD_FACTORS[lod];
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        for (let i = 0; i < soldiers.length; i += step) {
            const soldier = soldiers[i];
            const dx = soldier.offset.x * cos - soldier.offset.y * sin;
            const dy = soldier.offset.x * sin + soldier.offset.y * cos;
            const targetX = unit.x + dx;
            const targetY = unit.y + dy;

            // Reduce lerp iterations for distant squads
            const lerpSpeed = lod === LOD_MEDIUM ? 0.2 : (isMoving ? 0.15 : 0.1);
            soldier.x = Phaser.Math.Linear(soldier.x, targetX, lerpSpeed);
            soldier.y = Phaser.Math.Linear(soldier.y, targetY, lerpSpeed);

            // Walking animation (skip for low LOD)
            if (lod === LOD_FULL && isMoving) {
                soldier.z = Math.abs(Math.sin((this.scene.time.now / 150) + i)) * 3;
            } else if (lod === LOD_FULL) {
                soldier.z = Phaser.Math.Linear(soldier.z, 0, 0.2);
            } else {
                soldier.z = 0; // No bounce for distant squads
            }

            const isoSoldier = toIso(soldier.x, soldier.y);
            const drawX = isoSoldier.x - commanderIso.x;
            const drawY = isoSoldier.y - commanderIso.y - soldier.z;

            // Draw soldier based on unit type
            this.drawSoldier(gfx, unit.unitType, drawX, drawY, soldier.z, color, angle, lod);
        }
    }

    /**
     * Draw a single soldier with type-specific visuals.
     */
    private drawSoldier(
        gfx: Phaser.GameObjects.Graphics,
        unitType: UnitType,
        drawX: number,
        drawY: number,
        z: number,
        color: number,
        angle: number,
        lod: number
    ): void {
        if (lod >= LOD_LOW) {
            // Simplified: small colored rectangle
            gfx.fillStyle(color, 1);
            gfx.fillRect(drawX - 1.5, drawY - 2, 3, 4);
            return;
        }

        if (unitType === UnitType.LEGION || unitType === UnitType.PIKESMAN || unitType === UnitType.ARCHER) {
            // Pike for Pikesman
            if (unitType === UnitType.PIKESMAN && lod === LOD_FULL) {
                const pikeLen = 14;
                const pikeStartX = drawX + Math.cos(angle + Math.PI / 4) * 2;
                const pikeStartY = drawY - 2 + Math.sin(angle + Math.PI / 4) * 2;
                const pikeTipX = pikeStartX + Math.cos(angle) * pikeLen;
                const pikeTipY = pikeStartY + Math.sin(angle) * pikeLen;

                gfx.lineStyle(1, 0x8D6E63, 1);
                gfx.beginPath();
                gfx.moveTo(pikeStartX, pikeStartY);
                gfx.lineTo(pikeTipX, pikeTipY);
                gfx.strokePath();

                // Silver tip
                gfx.fillStyle(0xC0C0C0, 1);
                const tipLen = 3;
                const tipWidth = 2;
                const p1x = pikeTipX;
                const p1y = pikeTipY;
                const bx = pikeTipX - Math.cos(angle) * tipLen;
                const by = pikeTipY - Math.sin(angle) * tipLen;
                const px = Math.cos(angle + Math.PI / 2) * (tipWidth / 2);
                const py = Math.sin(angle + Math.PI / 2) * (tipWidth / 2);
                gfx.fillTriangle(p1x, p1y, bx + px, by + py, bx - px, by - py);
            }

            // Shadow
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 6, 3);
            // Body
            gfx.fillStyle(color, 1);
            gfx.fillRect(drawX - 2, drawY - 4, 4, 6);
            // Head
            gfx.fillStyle(0xffffff, 0.8);
            gfx.fillRect(drawX - 1, drawY - 6, 2, 2);
        } else if (unitType === UnitType.CAVALRY) {
            // Shadow
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 10, 5);
            // Body
            gfx.fillStyle(color, 1);
            gfx.fillEllipse(drawX, drawY, 14, 8);
            // Rider head
            gfx.fillStyle(0xffffff, 1);
            gfx.fillCircle(drawX, drawY - 5, 2.5);
        }
    }

    public destroySquad(unit: Phaser.GameObjects.GameObject): void {
        const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
        if (container) {
            container.destroy();
        }
        const uiIndicator = unit.getData('uiIndicatorContainer') as Phaser.GameObjects.Container;
        if (uiIndicator) {
            uiIndicator.destroy();
        }
    }

    public applyFormation(unit: Phaser.GameObjects.GameObject, formationType: FormationType): void {
        const soldiers = unit.getData('soldierStates') as SoldierState[];
        if (!soldiers || soldiers.length === 0) return;

        const count = soldiers.length;
        const stats = UNIT_STATS[unit.getData('unitType') as UnitType];
        const spacing = stats?.squadSpacing || 10;

        const offsets = FormationSystem.getFormationOffsets(formationType, count, spacing);

        for (let i = 0; i < count; i++) {
            if (i < offsets.length) {
                soldiers[i].offset = { x: offsets[i].x, y: offsets[i].y };
            }
        }
    }
}
