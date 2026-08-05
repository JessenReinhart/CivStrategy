import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, FormationType, UnitState, GameUnit } from '../../types';
import { UNIT_STATS } from '../../constants';
import { toIsoElev } from '../utils/iso';
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
const LOD_FULL = 0;       // 0-2500px: render all soldiers
const LOD_MEDIUM = 1;     // 2500-5000px: render half the soldiers
const LOD_LOW = 2;        // 5000-8000px: render 1/4 soldiers
const LOD_DOT = 3;        // >8000px: single dot

const LOD_THRESHOLDS: Record<number, number> = {
    [LOD_FULL]: 2500,
    [LOD_MEDIUM]: 5000,
    [LOD_LOW]: 8000,
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
    private lodDotBlitter!: Phaser.GameObjects.Blitter;
    private lodRectBlitter!: Phaser.GameObjects.Blitter;

    constructor(scene: MainScene) {
        this.scene = scene;
        // Blitters for batched LOD rendering — each Blitter = 1 GPU draw call for all bobs
        this.lodDotBlitter = scene.add.blitter(0, 0, 'lod_dot');
        this.lodRectBlitter = scene.add.blitter(0, 0, 'lod_rect');
        if (scene.worldLayer) {
            scene.worldLayer.add(this.lodDotBlitter);
            scene.worldLayer.add(this.lodRectBlitter);
        }
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
     * Sync squad container positions for ALL units every frame.
     * This is the CHEAP pass — just re-positioning containers based on physics body x/y.
     * Without this, containers hold stale positions from whenever their bucket last ran,
     * causing visual stutter (physics moves the body every frame, container only snaps
     * when SquadSystem's render bucket reaches it).
     */
    public syncPositions(): void {
        const allUnits = this.scene.units.getChildren();
        const unitCount = allUnits.length;
        for (let i = 0; i < unitCount; i++) {
            const unit = allUnits[i] as GameUnit;
            const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
            if (!container || !container.visible) continue;

            const h = this.scene.terrainSystem.getHeightAt(unit.x, unit.y);
            const commanderIso = toIsoElev(unit.x, unit.y, h);
            container.setPosition(commanderIso.x, commanderIso.y);
            container.setDepth(commanderIso.y);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const visual = (unit as any).visual as Phaser.GameObjects.Container;
            if (visual && visual.visible) {
                visual.setPosition(commanderIso.x, commanderIso.y);
                visual.setDepth(commanderIso.y);
            }
        }
    }

    /**
     * Main squad update - batched and LOD-optimized.
     * Only handles the expensive work: angle transitions, soldier count,
     * and rendering. Position sync is done in syncPositions() above.
     */
    public update(_dt: number): void {
        const allUnits = this.scene.units.getChildren();
        const unitCount = allUnits.length;
        if (unitCount === 0) return;

        // Fix 6: Dynamic squad budget - scale based on total unit count
        // For 2000+ units, only process 10% per frame (200 is fine)
        // For 500, process 200
        // For 100, process all
        const budget = this.scene.stressTestConfig
            ? Math.max(100, Math.min(300, Math.ceil(unitCount * 0.15)))
            : MAX_SQUADS_PER_FRAME;
        
        // Calculate per-frame budget
        const bucketSize = Math.max(1, Math.ceil(unitCount / Math.ceil(unitCount / budget)));
        const start = this.frameIndex;
        const end = Math.min(start + bucketSize, unitCount);

        const cam = this.scene.cameras.main;
        const camCenter = cam.getWorldPoint(cam.width / 2, cam.height / 2);
        const zoom = cam.zoom;

        // Clear Blitters each frame (rebuild bobs for visible LOD_DOT/LOD_LOW units)
        this.lodDotBlitter.clear();
        this.lodRectBlitter.clear();

        // Dynamic LOD thresholds: tighten when many units (closer cutoff for LOD transitions)
        const lodScale = unitCount > 800 ? 0.5 : unitCount > 400 ? 0.7 : 1.0;
        const lodFull = LOD_THRESHOLDS[LOD_FULL] * lodScale;
        const lodMed = LOD_THRESHOLDS[LOD_MEDIUM] * lodScale;
        const lodLow = LOD_THRESHOLDS[LOD_LOW] * lodScale;

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
            if (screenDist > lodLow) lod = LOD_DOT;
            else if (screenDist > lodMed) lod = LOD_LOW;
            else if (screenDist > lodFull) lod = LOD_MEDIUM;

            const stats = UNIT_STATS[unit.unitType as UnitType];
            if (!stats || stats.squadSize <= 1) continue;

            const h = this.scene.terrainSystem.getHeightAt(unit.x, unit.y);
            const commanderIso = toIsoElev(unit.x, unit.y, h);

            // LOD_DOT: one bob per squad on dot Blitter (1 draw call for ALL distant squads)
            if (lod === LOD_DOT) {
                const owner = unit.getData('owner') as number;
                const color = this.scene.getFactionColor(owner);
                const bob = this.lodDotBlitter.create(commanderIso.x, commanderIso.y);
                if (bob) {
                    bob.tint = color;
                }
                // Still need soldier states for HP tracking
                const hp = unit.getData('hp') as number;
                const maxHp = unit.getData('maxHp') as number;
                const soldiers = unit.getData('soldierStates') as SoldierState[];
                if (soldiers) {
                    const targetCount = Math.max(1, Math.ceil((hp / maxHp) * stats.squadSize));
                    if (soldiers.length > targetCount) soldiers.length = targetCount;
                    else while (soldiers.length < targetCount) soldiers.push({ x: unit.x, y: unit.y, z: 0, offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 } });
                }
                continue;
            }

            // LOD_LOW: one bob per visible soldier on rect Blitter
            if (lod === LOD_LOW) {
                const owner = unit.getData('owner') as number;
                const color = this.scene.getFactionColor(owner);
                const body = unit.body as Phaser.Physics.Arcade.Body;
                let angle = unit.getData('formationAngle') as number || 0;
                const speed = body ? body.velocity.length() : 0;
                const isMoving = speed > 10;
                if (isMoving && body) {
                    angle = Phaser.Math.Angle.RotateTo(angle, body.velocity.angle(), 0.1);
                    unit.setData('formationAngle', angle);
                } else if ((unit.state === UnitState.ATTACKING || unit.state === UnitState.CHASING) && unit.target) {
                    const tgt = unit.target as Phaser.GameObjects.Image;
                    angle = Phaser.Math.Angle.RotateTo(angle, Phaser.Math.Angle.Between(unit.x, unit.y, tgt.x, tgt.y), 0.1);
                    unit.setData('formationAngle', angle);
                }
                const hp = unit.getData('hp') as number;
                const maxHp = unit.getData('maxHp') as number;
                const soldiers = unit.getData('soldierStates') as SoldierState[];
                if (!soldiers) continue;
                const targetCount = Math.max(1, Math.ceil((hp / maxHp) * stats.squadSize));
                if (soldiers.length > targetCount) soldiers.length = targetCount;
                else while (soldiers.length < targetCount) soldiers.push({ x: unit.x, y: unit.y, z: 0, offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 } });
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const step = LOD_FACTORS[LOD_LOW];
                for (let j = 0; j < soldiers.length; j += step) {
                    const soldier = soldiers[j];
                    const sdx = soldier.offset.x * cos - soldier.offset.y * sin;
                    const sdy = soldier.offset.x * sin + soldier.offset.y * cos;
                    soldier.x = Phaser.Math.Linear(soldier.x, unit.x + sdx, 0.1);
                    soldier.y = Phaser.Math.Linear(soldier.y, unit.y + sdy, 0.1);
                    soldier.z = 0;
                    const isoSoldier = toIsoElev(soldier.x, soldier.y, this.scene.terrainSystem.getHeightAt(soldier.x, soldier.y));
                    const bob = this.lodRectBlitter.create(isoSoldier.x, isoSoldier.y);
                    if (bob) {
                        bob.tint = color;
                    }
                }
                continue;
            }

            // LOD_FULL/MEDIUM: per-unit Graphics (detail matters for nearby squads)
            const body = unit.body as Phaser.Physics.Arcade.Body;
            let angle = unit.getData('formationAngle') as number || 0;
            const speed = body ? body.velocity.length() : 0;
            const isMoving = speed > 10;
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
            const hp = unit.getData('hp') as number;
            const maxHp = unit.getData('maxHp') as number;
            const targetCount = Math.max(1, Math.ceil((hp / maxHp) * stats.squadSize));
            const soldiers = unit.getData('soldierStates') as SoldierState[];
            if (soldiers && soldiers.length !== targetCount) {
                if (soldiers.length > targetCount) soldiers.length = targetCount;
                else while (soldiers.length < targetCount) soldiers.push({ x: unit.x, y: unit.y, z: 0, offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 } });
            }
            const gfx = container.getAt(0) as Phaser.GameObjects.Graphics;
            this.renderSquad(gfx, unit, soldiers, angle, isMoving, lod, commanderIso);
        }

        // Blitters render at entity depth layer
        this.lodDotBlitter.setDepth(-10000);
        this.lodRectBlitter.setDepth(-9999);

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
        const isStress = !!this.scene.stressTestConfig;

        // Stress-mode cache: when squads are stationary, avoid redundant Graphics clears/redraws
        if (isStress && !isMoving) {
            const angleKey = Math.round((angle / Math.PI) * 16);
            const owner = unit.getData('owner') as number;
            const sig = `${lod}|${angleKey}|${soldiers.length}|${owner}`;
            const lastSig = unit.getData('stressSquadSig') as string | undefined;
            if (lastSig === sig) {
                return;
            }
            unit.setData('stressSquadSig', sig);
        }

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

        // LOD step factor (LOD_DOT/LOW handled by Blitter, only FULL/MEDIUM here)

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
            const isoSoldier = toIsoElev(soldier.x, soldier.y, this.scene.terrainSystem.getHeightAt(soldier.x, soldier.y));
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
        } else if (unitType === UnitType.SLINGER) {
            // Light infantry — small circle
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 5, 3);
            gfx.fillStyle(color, 1);
            gfx.fillCircle(drawX, drawY - 2, 3);
            gfx.fillStyle(0xffffff, 0.8);
            gfx.fillCircle(drawX, drawY - 4, 1.5);
        } else if (unitType === UnitType.AXEMAN) {
            // Melee — slightly larger circle with accent
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 6, 3);
            gfx.fillStyle(color, 1);
            gfx.fillCircle(drawX, drawY - 2, 3.5);
            // Axe accent
            gfx.fillStyle(0x8D6E63, 1);
            gfx.fillRect(drawX + 3, drawY - 6, 1.5, 6);
            gfx.fillStyle(0xC0C0C0, 1);
            gfx.fillRect(drawX + 2, drawY - 8, 4, 2.5);
            gfx.fillStyle(0xffffff, 0.8);
            gfx.fillCircle(drawX, drawY - 4, 1.5);
        } else if (unitType === UnitType.HOPLITE) {
            // Heavy infantry — circle with shield accent
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 7, 3);
            gfx.fillStyle(color, 1);
            gfx.fillRect(drawX - 2, drawY - 4, 4, 6);
            // Shield accent
            gfx.fillStyle(0xDAA520, 0.9);
            gfx.fillCircle(drawX - 3, drawY - 1, 3);
            gfx.fillStyle(0xffffff, 0.8);
            gfx.fillRect(drawX - 1, drawY - 6, 2, 2);
        } else if (unitType === UnitType.CHARIOT) {
            // Mounted — rectangle body
            gfx.fillStyle(0x000000, 0.3);
            gfx.fillEllipse(drawX, drawY + z, 12, 5);
            gfx.fillStyle(color, 1);
            gfx.fillRect(drawX - 6, drawY - 3, 12, 6);
            // Wheels
            gfx.fillStyle(0x8D6E63, 1);
            gfx.fillCircle(drawX - 4, drawY + 3, 2);
            gfx.fillCircle(drawX + 4, drawY + 3, 2);
            // Rider head
            gfx.fillStyle(0xffffff, 1);
            gfx.fillCircle(drawX, drawY - 5, 2);
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
