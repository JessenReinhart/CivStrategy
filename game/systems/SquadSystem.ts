import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitType, FormationType, UnitState, GameUnit, SoldierSteeringMode } from '../../types';
import { UNIT_STATS, STRESS_RENDER_INTERVAL, FRONT_RANK_RADIUS, CROWD_PUSH_SCALE, COMBAT_JITTER_AMPLITUDE, COMBAT_JITTER_PERIOD_MS, CHARGE_THRUST_RATIO, CROWD_PUSH_FORWARD_RATIO, CHARGE_TIMER_DECAY_MS, CHARGE_IMPULSE_DURATION_MS } from '../../constants';
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
 * - Sprite-based rendering for LOD_FULL/MEDIUM (replaces Graphics draw calls)
 */

// LOD constants based on camera distance (dynamic scaling at 400u: 0.7x, 800u: 0.5x)
const LOD_FULL = 0;       // 0-800px: render all soldiers (400px at 800u)
const LOD_MEDIUM = 1;     // 800-1500px: render half the soldiers (750px at 800u)
const LOD_LOW = 2;        // 1500-3000px: Blitter rect bobs (1500px at 800u)
const LOD_DOT = 3;        // >3000px: single dot bob (Blitter)

const LOD_THRESHOLDS: Record<number, number> = {
    [LOD_FULL]: 800,
    [LOD_MEDIUM]: 1500,
    [LOD_LOW]: 3000,
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

// UnitType → Phaser texture key (textures loaded in MainScene.load())
const TEXTURE_KEY_MAP: Record<string, string> = {
    [UnitType.VILLAGER]: 'unit_villager',
    [UnitType.PIKESMAN]: 'unit_pikesman',
    [UnitType.CAVALRY]: 'unit_cavalry',
    [UnitType.LEGION]: 'unit_legion',
    [UnitType.ARCHER]: 'unit_archer',
    [UnitType.SLINGER]: 'unit_slinger',
    [UnitType.AXEMAN]: 'unit_axeman',
    [UnitType.HOPLITE]: 'unit_hoplite',
    [UnitType.CHARIOT]: 'unit_chariot',
    [UnitType.RAM]: 'unit_ram',
};

const POOL_INITIAL_SIZE = 200;

export interface SoldierState {
    x: number;
    y: number;
    z: number;
    offset: { x: number; y: number };
    mode?: SoldierSteeringMode;
    chargeTimer?: number;
    crowdPush?: number;
    phase?: number;
}

export class SquadSystem {
    private scene: MainScene;
    private frameIndex: number = 0;
    // Stress mode: soldier sprites are hidden exactly once at startup (they never
    // re-render — stress forces LOD_DOT). Avoids re-issuing setVisible(false) on
    // ~10 children × 5000 units every frame.
    private stressSpritesHidden: boolean = false;
    // Public: MainScene.setupStressTest pre-allocates persistent bobs here
    public lodDotBlitter!: Phaser.GameObjects.Blitter;
    private lodRectBlitter!: Phaser.GameObjects.Blitter;
    // Sprite pool keyed by texture key (e.g. 'unit_pikesman')
    private spritePool: Map<string, Phaser.GameObjects.Sprite[]>;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.spritePool = new Map();
        // Blitters for batched LOD rendering — each Blitter = 1 GPU draw call for all bobs
        this.lodDotBlitter = scene.add.blitter(0, 0, 'lod_dot');
        this.lodRectBlitter = scene.add.blitter(0, 0, 'lod_rect');
        if (scene.worldLayer) {
            scene.worldLayer.add(this.lodDotBlitter);
            scene.worldLayer.add(this.lodRectBlitter);
        }
    }

    /**
     * Get (or lazily create) the sprite pool for a given texture key.
     */
    private getPool(textureKey: string): Phaser.GameObjects.Sprite[] {
        let pool = this.spritePool.get(textureKey);
        if (!pool) {
            pool = [];
            for (let i = 0; i < POOL_INITIAL_SIZE; i++) {
                const sprite = this.scene.add.sprite(0, 0, textureKey)
                    .setOrigin(0.5, 1)
                    .setScale(0.5)
                    .setVisible(false)
                    .setActive(false);
                this.scene.worldLayer?.add(sprite);
                this.scene.uiCamera?.ignore(sprite);
                pool.push(sprite);
            }
            this.spritePool.set(textureKey, pool);
        }
        return pool;
    }

    /**
     * Acquire a sprite from the pool. Grows pool if exhausted.
     */
    private acquireSprite(textureKey: string): Phaser.GameObjects.Sprite {
        const pool = this.getPool(textureKey);
        const sprite = pool.pop();
        if (sprite) {
            sprite.setActive(true).setVisible(true);
            return sprite;
        }
        // Pool exhausted — create one more
        const extra = this.scene.add.sprite(0, 0, textureKey)
            .setOrigin(0.5, 1)
            .setScale(0.5);
        this.scene.worldLayer?.add(extra);
        this.scene.uiCamera?.ignore(extra);
        return extra;
    }

    /**
     * Return a sprite to the pool for reuse.
     */
    private releaseSprite(sprite: Phaser.GameObjects.Sprite): void {
        sprite.setVisible(false).setActive(false).clearTint();
        const key = sprite.texture.key;
        let pool = this.spritePool.get(key);
        if (!pool) {
            pool = [];
            this.spritePool.set(key, pool);
        }
        pool.push(sprite);
    }

    public createSquad(unit: Phaser.GameObjects.GameObject, type: UnitType, _owner: number): void {
        const stats = UNIT_STATS[type];
        if (!stats || stats.squadSize <= 1) return;

        const container = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(container);
        if (this.scene.worldLayer) this.scene.worldLayer.add(container);
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(container);

        // Acquire soldier sprites from pool and add to container
        const textureKey = TEXTURE_KEY_MAP[type] || 'unit_pikesman';
        const soldierSprites: Phaser.GameObjects.Sprite[] = [];
        for (let i = 0; i < stats.squadSize; i++) {
            const sprite = this.acquireSprite(textureKey);
            soldierSprites.push(sprite);
            container.add(sprite);
        }

        // Graphics overlay for selection circle only (drawn on top of sprites)
        const gfx = this.scene.add.graphics();
        container.add(gfx);

        unit.setData('squadContainer', container);
        unit.setData('squadCurrentCount', stats.squadSize);
        unit.setData('squadMaxCount', stats.squadSize);
        unit.setData('formationAngle', 0);
        unit.setData('squadTextureKey', textureKey);
        unit.setData('soldierSprites', soldierSprites);

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
                offset: { x: 0, y: 0 },
                mode: SoldierSteeringMode.FORMATION,
                chargeTimer: 0,
                crowdPush: 0
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
        if (unitCount === 0) return;

        // Stress mode: skip per-unit container repositioning since DOT uses unit.x/y directly
        if (this.scene.stressTestConfig) {
            return;
        }

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

        // Stress benchmarks need a complete visible frame, not a bucket of dots
        // that disappears when the blitter is cleared. Normal games retain the
        // budgeted bucket path to spread sprite work across frames.
        const stressMode = !!this.scene.stressTestConfig;
        const budget = stressMode
            ? unitCount
            : (unitCount > 800 ? 200 : MAX_SQUADS_PER_FRAME);

        const bucketSize = stressMode
            ? unitCount
            : Math.max(1, Math.ceil(unitCount / Math.ceil(unitCount / budget)));
        const start = stressMode ? 0 : this.frameIndex;
        const end = stressMode ? unitCount : Math.min(start + bucketSize, unitCount);

        const cam = this.scene.cameras.main;
        const camCenter = cam.getWorldPoint(cam.width / 2, cam.height / 2);
        const zoom = cam.zoom;
        // Stress bobs persist for the full run; normal LOD buckets rebuild each frame.
        if (!stressMode) this.lodDotBlitter.clear();
        this.lodRectBlitter.clear();

        // Dynamic LOD thresholds: tighten with more units
        // Dynamic LOD thresholds: tighten with more units; STRESS MODE forces everything to DOT
        const lodScale = this.scene.stressTestConfig ? 0.01 : (unitCount > 800 ? 0.5 : unitCount > 400 ? 0.7 : 1.0);
        const lodFull = LOD_THRESHOLDS[LOD_FULL] * lodScale;
        const lodMed = LOD_THRESHOLDS[LOD_MEDIUM] * lodScale;
        const lodLow = LOD_THRESHOLDS[LOD_LOW] * lodScale;
        // Stress mode forces every squad to LOD_DOT, rendering only every Nth unit.
        // Step the loop by STRESS_RENDER_INTERVAL instead of visiting all 5,000
        // units and skipping 4,750 of them — identical output, ~20x less work.
        const loopStep = stressMode ? STRESS_RENDER_INTERVAL : 1;
        // Stress mode: hide all soldier sprites once, unhide on exit
        if (stressMode && !this.stressSpritesHidden) {
            for (let i = 0; i < allUnits.length; i++) {
                this.hideSoldierSprites(allUnits[i] as GameUnit);
            }
            this.stressSpritesHidden = true;
        } else if (!stressMode && this.stressSpritesHidden) {
            // Exiting stress mode: restore soldier sprites for normal LOD rendering
            this.showAllSoldierSprites();
            this.stressSpritesHidden = false;
        }
        for (let i = start; i < end; i += loopStep) {
            const unit = allUnits[i] as GameUnit;
            const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
            if (!container) continue;
            if (!container.visible && !stressMode) continue;

            // Stress-mode culling avoids updating bobs well outside the camera.
            if (stressMode) {
                const dx = unit.x - camCenter.x;
                const dy = unit.y - camCenter.y;
                if (Math.abs(dx) > cam.width * 2 || Math.abs(dy) > cam.height * 2) continue;
            }

            const screenDist = stressMode
                ? 0
                : Math.sqrt((unit.x - camCenter.x) ** 2 + (unit.y - camCenter.y) ** 2) / zoom;
            const lod = stressMode ? LOD_DOT : (
                screenDist > lodLow ? LOD_DOT :
                screenDist > lodMed ? LOD_LOW :
                screenDist > lodFull ? LOD_MEDIUM : LOD_FULL
            );

            const stats = UNIT_STATS[unit.unitType as UnitType];
            if (!stats || stats.squadSize <= 1) continue;

            // Stress terrain is intentionally flat; avoid 5,000 height lookups per frame.
            const commanderIso = stressMode
                ? { x: unit.x, y: unit.y }
                : toIsoElev(unit.x, unit.y, this.scene.terrainSystem.getHeightAt(unit.x, unit.y));

            // LOD_DOT: one bob per squad on dot Blitter (1 draw call for ALL distant squads)
            if (lod === LOD_DOT) {
                const owner = unit.getData('owner') as number;
                const color = this.scene.getFactionColor(owner);
                const bob = (stressMode ? unit.getData('stressBob') : undefined) as Phaser.GameObjects.Bob | undefined
                    ?? this.lodDotBlitter.create(commanderIso.x, commanderIso.y);
                bob.x = commanderIso.x;
                bob.y = commanderIso.y;
                bob.tint = color;
                // Soldier state bookkeeping is not part of the stress render benchmark.
                if (!stressMode) {
                    const hp = unit.getData('hp') as number;
                    const maxHp = unit.getData('maxHp') as number;
                    const soldiers = unit.getData('soldierStates') as SoldierState[];
                    if (soldiers) {
                        const targetCount = Math.max(1, Math.ceil((hp / maxHp) * stats.squadSize));
                        if (soldiers.length > targetCount) soldiers.length = targetCount;
                        else while (soldiers.length < targetCount) soldiers.push({ x: unit.x, y: unit.y, z: 0, offset: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 } });
                    }
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
                // Hide sprites when in LOW LOD
                this.hideSoldierSprites(unit);
                continue;
            }

            // LOD_FULL/MEDIUM: sprite-based soldier rendering
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
            this.updateSoldierModes(unit);
            this.renderSquad(unit, soldiers, angle, isMoving, lod, commanderIso);
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
     * Hide all soldier sprites for a unit (when using Blitter LODs).
     */
    private hideSoldierSprites(unit: Phaser.GameObjects.GameObject): void {
        const sprites = unit.getData('soldierSprites') as Phaser.GameObjects.Sprite[] | undefined;
        if (sprites) {
            for (let i = 0; i < sprites.length; i++) {
                sprites[i].setVisible(false);
            }
        }
    }

    /**
     * One-shot hide of every unit's soldier sprites when entering stress mode.
     * Replaces per-frame per-unit setVisible(false) for ~50,000 sprite children.
     */
    private hideAllSoldierSprites(): void {
        const allUnits = this.scene.units.getChildren();
        for (let i = 0; i < allUnits.length; i++) {
            this.hideSoldierSprites(allUnits[i]);
        }
    }

    /**
     * One-shot show of every unit's soldier sprites when exiting stress mode.
     * Restores visibility for normal LOD rendering.
     */
    private showAllSoldierSprites(): void {
        const allUnits = this.scene.units.getChildren();
        for (let i = 0; i < allUnits.length; i++) {
            const sprites = allUnits[i].getData('soldierSprites') as Phaser.GameObjects.Sprite[] | undefined;
            if (sprites) {
                for (let j = 0; j < sprites.length; j++) {
                    sprites[j].setVisible(true);
                }
            }
        }
    }

    /**
     * Render a squad with LOD-specific optimizations.
     * LOD_FULL/MEDIUM now use Sprite-based rendering instead of Graphics draw calls.
     */
    private renderSquad(
        unit: GameUnit,
        soldiers: SoldierState[],
        angle: number,
        isMoving: boolean,
        lod: number,
        commanderIso: { x: number; y: number }
    ): void {
        const isStress = !!this.scene.stressTestConfig;

        // Stress-mode cache: when squads are stationary, avoid redundant redraws
        // Stress-mode cache: when squads are stationary, avoid redundant redraws.
        // Include modifiedOffset in signature so liquid combat deformation triggers redraws.
        if (isStress && !isMoving) {
            const angleKey = Math.round((angle / Math.PI) * 16);
            const owner = unit.getData('owner') as number;
            const mo = unit.modifiedOffset;
            const deformKey = mo ? `${Math.round(mo.x)}|${Math.round(mo.y)}` : '0|0';
            const sig = `${lod}|${angleKey}|${soldiers.length}|${owner}|${deformKey}`;
            const lastSig = unit.getData('stressSquadSig') as string | undefined;
            if (lastSig === sig) {
                return;
            }
            unit.setData('stressSquadSig', sig);
        }

        const owner = unit.getData('owner') as number;
        const color = this.scene.getFactionColor(owner);
        const soldierSprites = unit.getData('soldierSprites') as Phaser.GameObjects.Sprite[];

        // Selection circle (Graphics overlay, always visible if selected)
        const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
        const gfx = container.getAt(container.length - 1) as Phaser.GameObjects.Graphics;
        gfx.clear();
        if (unit.isSelected) {
            const stats = UNIT_STATS[unit.unitType as UnitType];
            gfx.lineStyle(2, 0xffffff, 0.8);
            const radius = Math.sqrt(stats.squadSize) * (stats.squadSpacing || 10) * 0.7;
            gfx.strokeEllipse(0, 0, radius * 2.5, radius * 1.5);
        }

        // LOD step factor
        const step = LOD_FACTORS[lod];
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // Position soldier sprites
        // Position soldier sprites
        for (let i = 0; i < soldiers.length; i++) {
            const soldier = soldiers[i];
            // Base formation offset + liquid combat deformation (projected per-soldier)
            const mo = unit.modifiedOffset;
            let deformX = 0;
            let deformY = 0;
            if (mo) {
                // World-space soldier offset from formation origin
                const sox = soldier.offset.x * cos - soldier.offset.y * sin;
                const soy = soldier.offset.x * sin + soldier.offset.y * cos;
                const soLen = Math.sqrt(sox * sox + soy * soy);
                const fLen = Math.sqrt(mo.x * mo.x + mo.y * mo.y);
                if (soLen > 1 && fLen > 1) {
                    // Front-rank soldiers (offset aligned with force) deform most
                    const weight = 0.5 + 0.5 * Math.max(-1, Math.min(1, (sox * mo.x + soy * mo.y) / (soLen * fLen)));
                    deformX = mo.x * weight;
                    deformY = mo.y * weight;
                } else {
                    deformX = mo.x;
                    deformY = mo.y;
                }
            }

            // Soldier-melee deformation: charge impulse, crowd-push, combat clustering
            let meleeDeformX = 0;
            let meleeDeformY = 0;
            let spacingScale = 1.0;
            const mode = soldier.mode ?? SoldierSteeringMode.FORMATION;
            if (mode === SoldierSteeringMode.COMBAT) {
                // Combat clustering: tighter spacing
                spacingScale = 0.5;
                // Charge impulse surge: forward along contact direction
                if (soldier.chargeTimer && soldier.chargeTimer > 0) {
                    const chargeRatio = soldier.chargeTimer / CHARGE_IMPULSE_DURATION_MS;
                    meleeDeformX = deformX * chargeRatio * CHARGE_THRUST_RATIO;
                    meleeDeformY = deformY * chargeRatio * CHARGE_THRUST_RATIO;
                    soldier.chargeTimer = Math.max(0, soldier.chargeTimer - CHARGE_TIMER_DECAY_MS);
                }
                // Per-soldier sinusoidal jitter (chaos) – only when no external deformation
                if (deformX === 0 && deformY === 0) {
                    const phase = soldier.phase ?? Math.random() * Math.PI * 2;
                    soldier.phase = phase;
                    const jitter = Math.sin(this.scene.time.now / COMBAT_JITTER_PERIOD_MS + phase) * COMBAT_JITTER_AMPLITUDE;
                    meleeDeformX += jitter * 0.5;
                    meleeDeformY += jitter * 0.5;
                }
            } else {
                // Formation mode: crowd-push from rear ranks
                if (soldier.crowdPush && soldier.crowdPush > 0) {
                    meleeDeformX = Math.cos(angle) * soldier.crowdPush * CROWD_PUSH_FORWARD_RATIO;
                    meleeDeformY = Math.sin(angle) * soldier.crowdPush * CROWD_PUSH_FORWARD_RATIO;
                }
            }

            const baseX = soldier.offset.x * spacingScale + deformX + meleeDeformX;
            const baseY = soldier.offset.y * spacingScale + deformY + meleeDeformY;
            const dx = baseX * cos - baseY * sin;
            const dy = baseX * sin + baseY * cos;
            const targetX = unit.x + dx;
            const targetY = unit.y + dy;

            // Reduce lerp iterations for distant squads
            const lerpSpeed = lod === LOD_MEDIUM ? 0.2 : (isMoving ? 0.15 : 0.1);
            const distToTarget = Math.hypot(targetX - soldier.x, targetY - soldier.y);
            if (distToTarget < 0.05 && !isMoving) {
                // Convergence: snap to exact target so idle soldiers stop shimmering
                soldier.x = targetX;
                soldier.y = targetY;
            } else {
                soldier.x = Phaser.Math.Linear(soldier.x, targetX, lerpSpeed);
                soldier.y = Phaser.Math.Linear(soldier.y, targetY, lerpSpeed);
            }

            // Walking animation (skip for low LOD)
            if (lod === LOD_FULL && isMoving) {
                soldier.z = Math.abs(Math.sin((this.scene.time.now / 150) + i)) * 3;
            } else if (lod === LOD_FULL) {
                soldier.z = Phaser.Math.Linear(soldier.z, 0, 0.2);
            } else {
                soldier.z = 0; // No bounce for distant squads
            }

            // Determine visibility based on LOD step
            const visible = (i % step === 0);
            const sprite = soldierSprites[i];
            if (!sprite) continue;

            if (!visible) {
                sprite.setVisible(false);
                continue;
            }

            // Position sprite relative to container (container is at commanderIso)
            const isoSoldier = toIsoElev(soldier.x, soldier.y, this.scene.terrainSystem.getHeightAt(soldier.x, soldier.y));
            const relX = isoSoldier.x - commanderIso.x;
            const relY = isoSoldier.y - commanderIso.y - soldier.z;
            sprite.setPosition(relX, relY);
            // Depth controlled by container depth (set in syncPositions); no per-child setDepth needed
            sprite.setTint(color);
            sprite.setVisible(true);
        }

        // Hide extra sprites beyond current soldier count
        for (let i = soldiers.length; i < soldierSprites.length; i++) {
            soldierSprites[i].setVisible(false);
        }
    }

    /**
     * Draw a single soldier with type-specific visuals.
     * Kept for potential fallback; LOD_FULL/MEDIUM now use sprites.
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
        const soldierSprites = unit.getData('soldierSprites') as Phaser.GameObjects.Sprite[] | undefined;
        const container = unit.getData('squadContainer') as Phaser.GameObjects.Container;
        if (soldierSprites && container) {
            for (const sprite of soldierSprites) {
                container.remove(sprite);
                this.releaseSprite(sprite);
            }
            unit.setData('soldierSprites', null);
        }
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

    /**
     * Update per-soldier steering mode based on combat state and front rank.
     */
    public updateSoldierModes(unit: GameUnit): void {
        const soldiers = unit.getData('soldierStates') as SoldierState[];
        if (!soldiers) return;
        const target = unit.target as Phaser.GameObjects.Image | null;
        if (!target) {
            // No target – all soldiers stay in formation mode.
            for (const s of soldiers) s.mode = SoldierSteeringMode.FORMATION;
            return;
        }
        const dirX = target.x - unit.x;
        const dirY = target.y - unit.y;
        const len = Math.hypot(dirX, dirY);
        const normX = len > 0 ? dirX / len : 0;
        const normY = len > 0 ? dirY / len : 0;

        for (const s of soldiers) {
            // Rotate soldier offset into world space
            const cos = Math.cos(unit.getData('formationAngle') || 0);
            const sin = Math.sin(unit.getData('formationAngle') || 0);
            const wx = s.offset.x * cos - s.offset.y * sin;
            const wy = s.offset.x * sin + s.offset.y * cos;
            const dot = wx * normX + wy * normY;
            const dist = Math.hypot(wx, wy);
            if (dot > 0 && dist < FRONT_RANK_RADIUS) {
                s.mode = SoldierSteeringMode.COMBAT;
                s.crowdPush = 0;
            } else {
                s.mode = SoldierSteeringMode.FORMATION;
                // Crowd-push weight: rear ranks push forward through front line
                const push = Math.max(0, FRONT_RANK_RADIUS - dist) * CROWD_PUSH_SCALE;
                s.crowdPush = push;
            }
        }
    }
}
