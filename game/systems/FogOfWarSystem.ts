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

/**
 * Fog of war with a persistent explored layer (R3) and a per-frame visible
 * hole layer (R2).
 *
 * - `screenRT` is the single on-screen fog texture (public for MainScene).
 * - `exploredRT` is a persistent RenderTexture that accumulates explored cells
 *   and is only rebuilt on resize. Camera pans re-blit exploredRT into screenRT
 *   without losing history.
 * - Live vision is batched into one Graphics object and erased in a single
 *   RenderTexture.erase call (R4).
 * - Friendly units/buildings/animals are queried through unitSpatialHash and
 *   viewport bounding, not scanned globally every frame (R5).
 * - RT sizing is devicePixelRatio-aware and stamp coords snap to whole texels
 *   (R6/R7).
 */
export class FogOfWarSystem {
    private scene: MainScene;
    public screenRT!: Phaser.GameObjects.RenderTexture;
    private exploredRT: Phaser.GameObjects.RenderTexture | null = null;

    private fogCloudLayer: Phaser.GameObjects.TileSprite;
    private visionBatch: Phaser.GameObjects.Graphics;
    private exploredStamp: Phaser.GameObjects.Graphics;
    private isVisible: boolean = true;

    // Low-res for performance; DPR-aware so hidpi screens stay crisp.
    private readonly RES_SCALE = 0.25;
    private dpr = Math.max(1, window.devicePixelRatio || 1);

    // Persistent explored mask (R3). Cell size in Cartesian world units.
    private readonly EXPLORE_CELL = 32;
    private explored: Uint8Array = new Uint8Array(0);
    private exploredCols = 0;
    private exploredRows = 0;

    // Cached camera/RT state for stamping (set each update)
    private _topLeftX = 0;
    private _topLeftY = 0;
    private _globalScale = 0;
    private _viewLeft = 0;
    private _viewRight = 0;
    private _viewTop = 0;
    private _viewBottom = 0;

    private _lastCameraScrollX = Number.NaN;
    private _lastCameraScrollY = Number.NaN;
    private _lastCameraZoom = Number.NaN;
    private _lastCameraWidth = Number.NaN;
    private _lastCameraHeight = Number.NaN;

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

        // Batched erase target (R4): one Graphics object reused per frame.
        this.visionBatch = this.scene.add.graphics();
        this.visionBatch.setVisible(false);

        // Persistent explored stamp (R3): a white disc drawn into exploredRT.
        this.exploredStamp = this.scene.add.graphics();
        this.exploredStamp.setVisible(false);

        // Fog material texture (unchanged look, tinted in-game).
        this.fogCloudLayer = this.scene.make.tileSprite({
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            key: 'fog-clouds',
            add: false,
        });
        this.fogCloudLayer.setOrigin(0, 0);

        this.rebuildExploredGrid();
        this.createRenderTexture();

        this.scene.scale.on('resize', this.handleResize, this);
        this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncCameraOnPostUpdate, this);
    }

    private rebuildExploredGrid(): void {
        const mapW = Math.max(1, this.scene.mapWidth);
        const mapH = Math.max(1, this.scene.mapHeight);
        this.exploredCols = Math.ceil(mapW / this.EXPLORE_CELL);
        this.exploredRows = Math.ceil(mapH / this.EXPLORE_CELL);
        this.explored = new Uint8Array(this.exploredCols * this.exploredRows);
    }

    /** Refresh devicePixelRatio and recreate the render targets. */
    private createRenderTexture(): void {
        if (this.screenRT) this.screenRT.destroy();
        if (this.exploredRT) this.exploredRT.destroy();

        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(2, Math.ceil(this.scene.scale.width * this.RES_SCALE * this.dpr));
        const height = Math.max(2, Math.ceil(this.scene.scale.height * this.RES_SCALE * this.dpr));

        this.screenRT = this.scene.add.renderTexture(0, 0, width, height);
        this.screenRT.setOrigin(0, 0);
        this.screenRT.setScrollFactor(0);
        this.screenRT.setDepth(10000);

        // Persistent explored layer: full map bounds, never re-cleared on pan.
        const mapW = Math.max(2, Math.ceil(this.scene.mapWidth * this.RES_SCALE));
        const mapH = Math.max(2, Math.ceil(this.scene.mapHeight * this.RES_SCALE));
        this.exploredRT = this.scene.make.renderTexture({ width: mapW, height: mapH }, false);
    }

    private handleResize(): void {
        this.rebuildExploredGrid();
        this.createRenderTexture();
    }

    public update(): void {
        if (!this.screenRT || !this.exploredRT || !this.isVisible) return;

        const perfStart = performance.now();
        const cam = this.scene.cameras.main;
        const zoom = cam.zoom || 1;
        const width = cam.width;
        const height = cam.height;

        // Counter-scale/position so the RT covers the screen exactly (R2).
        const baseScale = 1 / this.RES_SCALE;
        const targetScale = baseScale / zoom;
        this.screenRT.setScale(targetScale);
        const offsetX = (width * 0.5) * (1 - 1 / zoom);
        const offsetY = (height * 0.5) * (1 - 1 / zoom);
        this.screenRT.setPosition(offsetX, offsetY);

        const visibleWidth = width / zoom;
        const visibleHeight = height / zoom;
        const topLeftX = cam.scrollX + (width - visibleWidth) * 0.5;
        const topLeftY = cam.scrollY + (height - visibleHeight) * 0.5;

        this._topLeftX = topLeftX;
        this._topLeftY = topLeftY;
        this._globalScale = zoom * this.RES_SCALE * this.dpr;

        const padding = 1000 / zoom;
        this._viewLeft = topLeftX - padding;
        this._viewRight = topLeftX + visibleWidth + padding;
        this._viewTop = topLeftY - padding;
        this._viewBottom = topLeftY + visibleHeight + padding;

        const transformChanged = this.hasCameraTransformChanged(cam);
        this.captureCameraTransform(cam);

        // R2: only re-blit the shroud when the camera actually moved/resized.
        // Panning re-stamps the persistent exploredRT instead of clearing it.
        const clearStart = performance.now();
        if (transformChanged || this.screenRT.getData('_needsReblit') !== false) {
            this.screenRT.clear();
            this.screenRT.fill(0x111411, 0.96);
            this.fogCloudLayer.setSize(this.screenRT.width, this.screenRT.height);
            this.screenRT.draw(this.fogCloudLayer, 0, 0);
            // Re-apply persistent explored layer as partial transparency.
            this.screenRT.erase(this.exploredRT);
            this.screenRT.setData('_needsReblit', false);
        }
        const clearFillMs = performance.now() - clearStart;

        // R5: gather friendly units near the visible viewport via spatial hash.
        const unitsStart = performance.now();
        const centerX = cam.scrollX + width / 2 / zoom;
        const centerY = cam.scrollY + height / 2 / zoom;
        // Convert camera center back to Cartesian for the spatial hash query.
        const cartCenterX = centerY + centerX * 0.5;
        const cartCenterY = centerY - centerX * 0.5;
        const queryRadius = Math.max(visibleWidth, visibleHeight) + 1000;

        const candidates = this.scene.unitSpatialHash
            ? this.scene.unitSpatialHash.query(cartCenterX, cartCenterY, queryRadius)
            : this.scene.units.getChildren();

        this.visionBatch.clear();
        for (let i = 0; i < candidates.length; i++) {
            const u = candidates[i] as Phaser.GameObjects.Sprite;
            if (!u || !u.scene) continue;
            if ((u as Phaser.GameObjects.Sprite & { unitType?: UnitType }).unitType === UnitType.ANIMAL) continue;
            if (u.getData('owner') !== 0) continue;

            const isoX = u.x - u.y;
            const isoY = (u.x + u.y) * 0.5;
            if (isoX < this._viewLeft || isoX > this._viewRight || isoY < this._viewTop || isoY > this._viewBottom) continue;

            const range = UNIT_VISION[(u as Phaser.GameObjects.Sprite & { unitType?: UnitType }).unitType as UnitType] || 150;
            const inForest = this.scene.terrainSystem?.isForestAt(u.x, u.y) ?? false;
            const effectiveRange = inForest ? Math.round(range * 0.7) : range;

            this.markExplored(u.x, u.y, effectiveRange);
            this.stampVision(isoX, isoY, effectiveRange);
        }
        const unitsMs = performance.now() - unitsStart;

        // Herbivore animals reveal fog (deer, rabbit move through world)
        const animalsStart = performance.now();
        for (const animal of this.scene.animalSystem.getAnimals()) {
            if (animal.species !== AnimalSpecies.DEER && animal.species !== AnimalSpecies.RABBIT) continue;
            if (animal.hp <= 0) continue;
            if (!animal.visual || !animal.visual.visible) continue;

            const aIsoX = animal.x - animal.y;
            const aIsoY = (animal.x + animal.y) * 0.5;
            if (aIsoX < this._viewLeft || aIsoX > this._viewRight || aIsoY < this._viewTop || aIsoY > this._viewBottom) continue;

            const animalInForest = this.scene.terrainSystem?.isForestAt(animal.x, animal.y) ?? false;
            const animalRange = animalInForest ? 70 : 100;
            this.markExplored(animal.x, animal.y, animalRange);
            this.stampVision(aIsoX, aIsoY, animalRange);
        }
        const animalsMs = performance.now() - animalsStart;

        // Player buildings reveal fog (enemy buildings do not)
        const buildingsStart = performance.now();
        const buildings = this.scene.buildings.getChildren();
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i] as Phaser.GameObjects.Image;
            if (b.getData('owner') !== 0) continue;
            const bIsoX = b.x - b.y;
            const bIsoY = (b.x + b.y) * 0.5;
            if (bIsoX < this._viewLeft || bIsoX > this._viewRight || bIsoY < this._viewTop || bIsoY > this._viewBottom) continue;

            const def = b.getData('def');
            const range = def?.territoryRadius || def?.visionRadius || 200;
            const buildingInForest = this.scene.terrainSystem?.isForestAt(b.x, b.y) ?? false;
            const effectiveRange = buildingInForest ? Math.round(range * 0.7) : range;

            this.markExplored(b.x, b.y, effectiveRange);
            this.stampVision(bIsoX, bIsoY, effectiveRange);
        }
        const buildingsMs = performance.now() - buildingsStart;

        // R4: erase the whole live-vision batch in one pass instead of per entity.
        this.screenRT.erase(this.visionBatch);
        this.visionBatch.clear();

        const totalMs = performance.now() - perfStart;
        this._profileSnapshot = {
            totalMs,
            clearFillMs,
            unitsMs,
            animalsMs,
            buildingsMs,
            eraseCalls: 1,
        };
    }

    /** Mark explored grid cells within the Cartesian radius (persistent, R3). */
    private markExplored(x: number, y: number, radius: number): void {
        if (!this.explored.length) return;
        const cellR = Math.max(0, Math.ceil(radius / this.EXPLORE_CELL));
        const cx0 = Math.floor(x / this.EXPLORE_CELL);
        const cy0 = Math.floor(y / this.EXPLORE_CELL);
        const stampR = Math.max(this.EXPLORE_CELL * 0.6, radius * this.RES_SCALE);

        for (let dy = -cellR; dy <= cellR; dy++) {
            for (let dx = -cellR; dx <= cellR; dx++) {
                if (dx * dx + dy * dy > cellR * cellR) continue;
                const gx = cx0 + dx;
                const gy = cy0 + dy;
                if (gx < 0 || gy < 0 || gx >= this.exploredCols || gy >= this.exploredRows) continue;
                const idx = gy * this.exploredCols + gx;
                if (this.explored[idx] === 1) continue;
                this.explored[idx] = 1;

                // Stamp the explored layer (partial reveal, fogged).
                if (this.exploredRT) {
                    const px = Math.round(gx * this.EXPLORE_CELL * this.RES_SCALE);
                    const py = Math.round(gy * this.EXPLORE_CELL * this.RES_SCALE);
                    this.exploredStamp.clear();
                    this.exploredStamp.fillStyle(0xffffff, 0.55);
                    this.exploredStamp.fillCircle(px, py, stampR);
                    this.exploredRT.draw(this.exploredStamp, 0, 0);
                }
            }
        }
    }

    /** Add a texel-snapped live vision stamp to the batch (R6/R7). */
    private stampVision(isoX: number, isoY: number, radius: number): void {
        const relX = isoX - this._topLeftX;
        const relY = isoY - this._topLeftY;
        // R7: snap to whole RT texels to avoid shimmer during camera movement.
        const drawX = Math.round(relX * this._globalScale);
        const drawY = Math.round(relY * this._globalScale);
        const rtRadius = Math.max(1, Math.round(radius * this._globalScale));

        this.visionBatch.fillStyle(0xffffff, 1);
        this.visionBatch.fillCircle(drawX, drawY, rtRadius);
    }

    private captureCameraTransform(cam: Phaser.Cameras.Scene2D.Camera): void {
        this._lastCameraScrollX = cam.scrollX;
        this._lastCameraScrollY = cam.scrollY;
        this._lastCameraZoom = cam.zoom;
        this._lastCameraWidth = cam.width;
        this._lastCameraHeight = cam.height;
    }

    private hasCameraTransformChanged(cam: Phaser.Cameras.Scene2D.Camera): boolean {
        const epsilon = 0.001;
        return !Number.isFinite(this._lastCameraZoom)
            || Math.abs(cam.scrollX - this._lastCameraScrollX) > epsilon
            || Math.abs(cam.scrollY - this._lastCameraScrollY) > epsilon
            || Math.abs(cam.zoom - this._lastCameraZoom) > epsilon
            || cam.width !== this._lastCameraWidth
            || cam.height !== this._lastCameraHeight;
    }

    private syncCameraOnPostUpdate(): void {
        if (!this.screenRT || !this.isVisible || this.scene.stressTestConfig) return;
        const cam = this.scene.cameras.main;
        if (this.hasCameraTransformChanged(cam)) {
            this.update();
        }
    }

    public getProfileSnapshot(): FogProfSnapshot {
        return this._profileSnapshot;
    }

    public destroy(): void {
        if (this.screenRT) this.screenRT.destroy();
        if (this.exploredRT) this.exploredRT.destroy();
        this.visionBatch.destroy();
        this.exploredStamp.destroy();
        this.fogCloudLayer.destroy();
        this.scene.scale.off('resize', this.handleResize, this);
        this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncCameraOnPostUpdate, this);
    }
}