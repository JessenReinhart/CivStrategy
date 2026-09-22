import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UNIT_VISION } from '../../constants';
import { UnitType, AnimalSpecies } from '../../types';
import { Noise } from '../utils/Noise';

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

    // Procedural ink-wash brush. The fixed seed keeps the fog silhouette stable
    // between redraws while the small rotation drift below gives it subtle motion.
    private readonly VISION_BRUSH_RADIUS = 96;
    private readonly fogNoise = new Noise(2718);
    private fogMotionPhase = 0;

    // Cached camera/RT state for drawVision (set each update)
    private _topLeftX = 0;
    private _topLeftY = 0;
    private _globalScale = 0;
    private _viewLeft = 0;
    private _viewRight = 0;
    private _viewTop = 0;
    private _viewBottom = 0;

    // Last camera transform that the screen-space fog texture was rendered against.
    // MainScene intentionally throttles regular fog redraws, so camera motion must
    // force a same-frame refresh or the fog holes visibly lag behind the world.
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

        // 1. Create an organic ink-wash reveal brush instead of a perfectly
        // circular radial gradient. The reference look relies on an irregular,
        // hand-painted boundary that still reads clearly as unexplored space.
        const key = 'vision-brush-ink';
        this.createInkBrush(key);

        this.visionBrush = this.scene.make.image({ key, add: false });
        this.visionBrush.setOrigin(0.5);

        // 2. Initialize Render Texture
        this.createRenderTexture();
        this.scene.scale.on('resize', this.handleResize, this);

        // Camera input is processed during MainScene.update(). Running this check
        // at POST_UPDATE lets camera-bound fog catch up in the same frame, before
        // Phaser renders, while idle fog updates can remain throttled in MainScene.
        this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncCameraOnPostUpdate, this);
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
        // A neutral, slightly warm charcoal keeps the fog integrated with the
        // parchment/earth palette instead of reading like a UI overlay.
        this.screenRT.fill(0x565952, 0.74);
        const clearFillMs = performance.now() - clearStart;

        const cam = this.scene.cameras.main;
        const zoom = cam.zoom;
        const width = cam.width;
        const height = cam.height;
        this.captureCameraTransform(cam);

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
        // POST_UPDATE runs before Phaser refreshes camera matrices/worldView for the
        // render pass. Derive the live view directly from scroll + zoom so a zoom
        // performed in MainScene.update() cannot leave vision holes one frame behind.
        const visibleWidth = width / zoom;
        const visibleHeight = height / zoom;
        const topLeftX = cam.scrollX + (width - visibleWidth) * 0.5;
        const topLeftY = cam.scrollY + (height - visibleHeight) * 0.5;
        this._topLeftX = topLeftX;
        this._topLeftY = topLeftY;
        this._globalScale = zoom * this.RES_SCALE;

        const padding = 1000 / zoom;
        this._viewLeft = topLeftX - padding;
        this._viewRight = topLeftX + visibleWidth + padding;
        this._viewTop = topLeftY - padding;
        this._viewBottom = topLeftY + visibleHeight + padding;

        // Reset erase counter and advance the subtle ink-edge motion used by
        // each brush stamp. This remains deterministic for a given world point.
        let eraseCalls = 0;
        this.fogMotionPhase = (performance.now() * 0.00008) % (Math.PI * 2);

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

    /**
     * Build the soft, irregular reveal texture used to erase the fog.
     *
     * The centre stays readable so vision remains crisp, while the edge is
     * warped by two scales of Perlin noise to create an ink-wash silhouette.
     */
    private createInkBrush(key: string): void {
        if (this.scene.textures.exists(key)) return;

        const radius = this.VISION_BRUSH_RADIUS;
        const size = radius * 2;
        const canvas = this.scene.textures.createCanvas(key, size, size);
        if (!canvas) return;

        const ctx = canvas.context;
        const image = ctx.createImageData(size, size);
        const data = image.data;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const nx = (x - radius) / radius;
                const ny = (y - radius) / radius;
                const distance = Math.hypot(nx, ny);

                if (distance > 1.15) continue;

                const coarse = (this.fogNoise.perlin2(nx * 2.8 + 12, ny * 2.8 - 7) + 1) * 0.5;
                const fine = (this.fogNoise.perlin2(nx * 8.5 - 3, ny * 8.5 + 5) + 1) * 0.5;
                const warpedDistance = distance + (coarse - 0.5) * 0.18;

                const coreRadius = 0.54;
                const edgeRadius = 0.84 + fine * 0.22;
                let alpha = 1;

                if (warpedDistance > coreRadius) {
                    alpha = 1 - (warpedDistance - coreRadius) / Math.max(0.001, edgeRadius - coreRadius);
                    alpha = Math.max(0, Math.min(1, alpha));
                    alpha = alpha * alpha * (3 - 2 * alpha);
                }

                // A little fine-grain variation keeps the edge from looking like
                // a smooth computer-generated blur, without making the centre noisy.
                alpha *= warpedDistance < 0.68 ? 1 : 0.9 + fine * 0.1;

                if (warpedDistance > 1) {
                    alpha *= Math.max(0, Math.min(1, (1.15 - warpedDistance) / 0.15));
                }

                const index = (y * size + x) * 4;
                data[index] = 255;
                data[index + 1] = 255;
                data[index + 2] = 255;
                data[index + 3] = Math.round(alpha * 255);
            }
        }

        ctx.putImageData(image, 0, 0);
        canvas.refresh();
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

        // Brush texture is 192x192 (Radius 96)
        const brushScale = rtRadius / this.VISION_BRUSH_RADIUS;

        // Slightly vary the stamp per world point. Combined with the procedural
        // edge this prevents repeated reveals from looking like identical stamps.
        const localNoise = (this.fogNoise.perlin2(worldX * 0.003, worldY * 0.003) + 1) * 0.5;
        const localScale = 0.94 + localNoise * 0.12;
        const localRotation = (worldX * 0.0017 + worldY * 0.0011 + this.fogMotionPhase) % (Math.PI * 2);

        // Apply isometric distortion (2:1 ratio) + extra size for fade.
        this.visionBrush.setScale(brushScale * 2.5 * localScale, brushScale * 1.25 * localScale);
        this.visionBrush.setRotation(localRotation);
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
        this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncCameraOnPostUpdate, this);
    }
}