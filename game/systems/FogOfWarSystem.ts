import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UNIT_VISION } from '../../constants';
import { UnitType, AnimalSpecies } from '../../types';

/** Snapshot of internal FogOfWarSystem profiling for the last update() call. */
export interface FogProfSnapshot {
    totalMs: number;
    clearFillMs: number;
    unitsMs: number;
    animalsMs: number;
    buildingsMs: number;
    eraseCalls: number;
}

export class FogOfWarSystem {
    private scene: MainScene;
    public screenRT!: Phaser.GameObjects.RenderTexture;

    private visionBrush: Phaser.GameObjects.Image;
    private isVisible: boolean = true;

    // Low res for performance
    private readonly RES_SCALE = 0.25;

    // Cached camera/RT state for drawVision (set each update)
    private _topLeftX = 0;
    private _topLeftY = 0;
    private _globalScale = 0;
    private _viewLeft = 0;
    private _viewRight = 0;
    private _viewTop = 0;
    private _viewBottom = 0;

    // Internal profiling counters (per-update snapshot)
    private _profileSnapshot: FogProfSnapshot = {
        totalMs: 0,
        clearFillMs: 0,
        unitsMs: 0,
        animalsMs: 0,
        buildingsMs: 0,
        eraseCalls: 0,
    };

    constructor(scene: MainScene) {
        this.scene = scene;

        // 1. Create Brush (Soft gradient)
        const radius = 64;
        const key = 'vision-brush-soft';

        if (!this.scene.textures.exists(key)) {
            const canvas = this.scene.textures.createCanvas(key, radius * 2, radius * 2);
            if (canvas) {
                const ctx = canvas.context;

                const grd = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
                grd.addColorStop(0, 'rgba(0, 0, 0, 1)');
                grd.addColorStop(0.4, 'rgba(0, 0, 0, 1)');
                grd.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle = grd;
                ctx.fillRect(0, 0, radius * 2, radius * 2);
                canvas.refresh();
            }
        }

        this.visionBrush = this.scene.make.image({ key: key, add: false });
        this.visionBrush.setOrigin(0.5);

        // 2. Initialize Render Texture
        this.createRenderTexture();
        this.scene.scale.on('resize', this.handleResize, this);
    }

    private createRenderTexture() {
        if (this.screenRT) this.screenRT.destroy();

        const width = Math.ceil(this.scene.scale.width * this.RES_SCALE);
        const height = Math.ceil(this.scene.scale.height * this.RES_SCALE);

        this.screenRT = this.scene.add.renderTexture(0, 0, width, height);
        this.screenRT.setOrigin(0, 0);
        this.screenRT.setScrollFactor(0);
        // Initial scale, will be updated in update() loop
        this.screenRT.setScale(1 / this.RES_SCALE);
        this.screenRT.setDepth(10000);
    }

    private handleResize() {
        this.createRenderTexture();
    }

    public update() {
        if (!this.screenRT || !this.isVisible) return;

        const perfStart = performance.now();

        // Clear and fill fog (measured separately)
        const clearStart = performance.now();
        this.screenRT.clear();
        this.screenRT.fill(0x0c1820, 0.72);
        const clearFillMs = performance.now() - clearStart;

        const cam = this.scene.cameras.main;
        const zoom = cam.zoom;
        const width = cam.width;
        const height = cam.height;

        // --- FIX FOR ZOOM SCALING ---
        // We want the Fog RT to always cover the screen exactly, regardless of zoom.
        // Since the camera applies zoom to all objects (even scrollFactor 0),
        // we must counter-scale and counter-position the RT.

        // 1. Counter-Scale: If zoom is 0.5 (smaller), we scale RT up by 2.
        const baseScale = 1 / this.RES_SCALE;
        const targetScale = baseScale / zoom;
        this.screenRT.setScale(targetScale);

        // 2. Counter-Position: Keep top-left at (0,0) on screen.
        // Camera Zoom pivots around center.
        // Formula to keep Top-Left (0,0) fixed: Center * (1 - 1/Zoom)
        const offsetX = (width * 0.5) * (1 - 1 / zoom);
        const offsetY = (height * 0.5) * (1 - 1 / zoom);
        this.screenRT.setPosition(offsetX, offsetY);

        // --- Prepare cached state for drawVision ---
        const topLeft = cam.getWorldPoint(0, 0);
        this._topLeftX = topLeft.x;
        this._topLeftY = topLeft.y;
        this._globalScale = zoom * this.RES_SCALE;

        const viewRect = cam.worldView;
        const padding = 1000 / zoom;
        this._viewLeft = viewRect.x - padding;
        this._viewRight = viewRect.right + padding;
        this._viewTop = viewRect.y - padding;
        this._viewBottom = viewRect.bottom + padding;

        // Reset erase counter
        let eraseCalls = 0;

        // Local reference for speed
        const unitVision = UNIT_VISION;

        // 2. Process Units
        const unitsStart = performance.now();
        const units = this.scene.units.getChildren();
        for (let i = 0; i < units.length; i++) {
            const u = units[i] as Phaser.GameObjects.Sprite;
            if ((u as Phaser.GameObjects.Sprite & { unitType?: UnitType }).unitType === UnitType.ANIMAL) continue; // handled below via AnimalSystem
            if (u.getData('owner') !== 0) continue;

            // Inline toIso: isoX = x - y; isoY = (x + y) * 0.5
            const isoX = u.x - u.y;
            const isoY = (u.x + u.y) * 0.5;

            if (isoX < this._viewLeft || isoX > this._viewRight ||
                isoY < this._viewTop || isoY > this._viewBottom) continue;

            const range = unitVision[(u as Phaser.GameObjects.Sprite & { unitType?: UnitType }).unitType as UnitType] || 150;
            const inForest = this.scene.terrainSystem?.isForestAt(u.x, u.y) ?? false;
            const effectiveRange = inForest ? Math.round(range * 0.7) : range;
            this.drawVision(isoX, isoY, effectiveRange);
            eraseCalls++;
        }
        const unitsMs = performance.now() - unitsStart;

        // 2b. Herbivore animals reveal fog (deer, rabbit move through world)
        const animalsStart = performance.now();
        for (const animal of this.scene.animalSystem.getAnimals()) {
            if (animal.species !== AnimalSpecies.DEER && animal.species !== AnimalSpecies.RABBIT) continue;
            if (animal.hp <= 0) continue;
            if (!animal.visual || !animal.visual.visible) continue;

            const aIsoX = animal.x - animal.y;
            const aIsoY = (animal.x + animal.y) * 0.5;

            if (aIsoX < this._viewLeft || aIsoX > this._viewRight ||
                aIsoY < this._viewTop || aIsoY > this._viewBottom) continue;

            // Forest concealment: reduce vision in forests (same 0.7x as units)
            const animalInForest = this.scene.terrainSystem?.isForestAt(animal.x, animal.y) ?? false;
            const animalRange = animalInForest ? 70 : 100; // 100 * 0.7
            this.drawVision(aIsoX, aIsoY, animalRange); // small reveal radius
            eraseCalls++;
        }
        const animalsMs = performance.now() - animalsStart;

        // 3. Process Buildings
        const buildingsStart = performance.now();
        const buildings = this.scene.buildings.getChildren();
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i] as Phaser.GameObjects.Image;

            // Fix: Enemy buildings do not reveal fog
            if (b.getData('owner') !== 0) continue;

            const bIsoX = b.x - b.y;
            const bIsoY = (b.x + b.y) * 0.5;

            if (bIsoX < this._viewLeft || bIsoX > this._viewRight ||
                bIsoY < this._viewTop || bIsoY > this._viewBottom) continue;

            const def = b.getData('def');
            const range = def.territoryRadius || def.visionRadius || 200;
            const buildingInForest = this.scene.terrainSystem?.isForestAt(b.x, b.y) ?? false;
            const effectiveRange = buildingInForest ? Math.round(range * 0.7) : range;
            this.drawVision(bIsoX, bIsoY, effectiveRange);
            eraseCalls++;
        }
        const buildingsMs = performance.now() - buildingsStart;

        // Total update time
        const totalMs = performance.now() - perfStart;

        // Store snapshot for external inspection (e.g. browser console: fogOfWar.getProfileSnapshot())
        this._profileSnapshot = {
            totalMs,
            clearFillMs,
            unitsMs,
            animalsMs,
            buildingsMs,
            eraseCalls,
        };
    }

    /** Draw a single vision hole at world (iso) coordinates */
    private drawVision(worldX: number, worldY: number, worldRadius: number) {
        // 1. Calculate World Delta from Camera Top-Left
        const relWorldX = worldX - this._topLeftX;
        const relWorldY = worldY - this._topLeftY;

        // 2. Convert to RT Coordinates
        const drawX = relWorldX * this._globalScale;
        const drawY = relWorldY * this._globalScale;

        // 3. Calculate Brush Scale
        // Visual Radius on Screen = WorldRadius * Zoom
        // Radius in RT Pixels = ScreenRadius * RES_SCALE
        const rtRadius = worldRadius * this._globalScale;

        // Brush texture is 128x128 (Radius 64)
        const brushScale = rtRadius / 64;

        // Apply Isometric distortion (2:1 ratio) + extra size for fade
        this.visionBrush.setScale(brushScale * 2.5, brushScale * 1.25);
        this.visionBrush.setPosition(drawX, drawY);

        this.screenRT.erase(this.visionBrush);
    }

    /** Returns internal profiling snapshot for the last update() call */
    public getProfileSnapshot(): FogProfSnapshot {
        return this._profileSnapshot;
    }

    public destroy() {
        if (this.screenRT) this.screenRT.destroy();
        this.scene.scale.off('resize', this.handleResize, this);
    }
}