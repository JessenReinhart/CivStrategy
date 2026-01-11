
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UNIT_VISION } from '../../constants';
import { UnitType } from '../../types';
import { toIso } from '../utils/iso';

export class FogOfWarSystem {
    private scene: MainScene;
    private screenRT: Phaser.GameObjects.RenderTexture;
    private visionBrush: Phaser.GameObjects.Image;
    private isVisible: boolean = true;

    // Low res for performance
    private readonly RES_SCALE = 0.25;

    constructor(scene: MainScene) {
        this.scene = scene;

        // 1. Create Brush (Soft gradient)
        const radius = 64;
        const key = 'vision-brush-soft';

        if (!this.scene.textures.exists(key)) {
            const canvas = this.scene.textures.createCanvas(key, radius * 2, radius * 2);
            const ctx = canvas.context;

            const grd = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
            grd.addColorStop(0, 'rgba(0, 0, 0, 1)');
            grd.addColorStop(0.4, 'rgba(0, 0, 0, 1)');
            grd.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, radius * 2, radius * 2);
            canvas.refresh();
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

        this.screenRT.clear();
        this.screenRT.fill(0x000000, 1.0);

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

        // --- DRAWING HOLES ---

        // Get the exact world position of the top-left of the screen
        const topLeft = cam.getWorldPoint(0, 0);

        // Calculate scaling factor from World Distance -> RT Pixels
        // World -> Screen = * Zoom
        // Screen -> RT = * RES_SCALE
        const globalScale = zoom * this.RES_SCALE;

        // Helper function
        const drawVision = (worldX: number, worldY: number, worldRadius: number) => {
            // 1. Calculate World Delta from Camera Top-Left
            const relWorldX = worldX - topLeft.x;
            const relWorldY = worldY - topLeft.y;

            // 2. Convert to RT Coordinates
            const drawX = relWorldX * globalScale;
            const drawY = relWorldY * globalScale;

            // 3. Calculate Brush Scale
            // Visual Radius on Screen = WorldRadius * Zoom
            // Radius in RT Pixels = ScreenRadius * RES_SCALE
            const rtRadius = worldRadius * globalScale;

            // Brush texture is 128x128 (Radius 64)
            const brushScale = rtRadius / 64;

            // Apply Isometric distortion (2:1 ratio) + extra size for fade
            this.visionBrush.setScale(brushScale * 2.5, brushScale * 1.25);
            this.visionBrush.setPosition(drawX, drawY);

            this.screenRT.erase(this.visionBrush);
        };

        // Padding for culling (in world units)
        // Increased padding to ensure large light sources (like TC with 600 radius)
        // are still drawn even if their center is off-screen.
        const padding = 1000 / zoom;
        const viewRect = cam.worldView;

        // 2. Process Units
        const units = this.scene.units.getChildren();
        for (let i = 0; i < units.length; i++) {
            const u = units[i] as any;

            // Fix: Animals do not reveal fog
            if (u.unitType === UnitType.ANIMAL) continue;

            // Fix: Enemy units do not reveal fog
            if (u.getData('owner') !== 0) continue;

            // Convert Logic Coordinates (Cartesian) to Visual Coordinates (Isometric)
            // The camera looks at Iso coords, so fog must be drawn at Iso coords.
            const iso = toIso(u.x, u.y);

            if (iso.x < viewRect.x - padding || iso.x > viewRect.right + padding ||
                iso.y < viewRect.y - padding || iso.y > viewRect.bottom + padding) continue;

            const range = UNIT_VISION[u.unitType as UnitType] || 150;
            drawVision(iso.x, iso.y, range);
        }

        // 3. Process Buildings
        const buildings = this.scene.buildings.getChildren();
        for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i] as any;

            // Fix: Enemy buildings do not reveal fog
            if (b.getData('owner') !== 0) continue;

            // Convert Logic Coordinates (Cartesian) to Visual Coordinates (Isometric)
            const iso = toIso(b.x, b.y);

            if (iso.x < viewRect.x - padding || iso.x > viewRect.right + padding ||
                iso.y < viewRect.y - padding || iso.y > viewRect.bottom + padding) continue;

            const def = b.getData('def');
            const range = def.territoryRadius || def.visionRadius || 200;
            drawVision(iso.x, iso.y, range);
        }
    }

    public destroy() {
        if (this.screenRT) this.screenRT.destroy();
        this.scene.scale.off('resize', this.handleResize, this);
    }
}
