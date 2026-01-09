
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { MAP_WIDTH, MAP_HEIGHT, FACTION_COLORS, TILE_SIZE, UNIT_VISION } from '../../constants';
import { BuildingType, UnitType, MapMode } from '../../types';
import { toCartesian } from '../utils/iso';

export class MinimapSystem {
    private scene: MainScene;
    private renderTexture: Phaser.GameObjects.RenderTexture;
    private mapSize = 192; // Match React UI w-48
    private padding = 24;  // Match React UI bottom-6 left-6
    
    // Reusable Graphics for drawing to texture
    private unitDot: Phaser.GameObjects.Graphics;
    private buildingRect: Phaser.GameObjects.Graphics;
    private viewportGraphics: Phaser.GameObjects.Graphics;
    
    // Layout Objects
    private maskGraphics: Phaser.GameObjects.Graphics;
    private borderGraphics: Phaser.GameObjects.Graphics;

    private updateInterval = 5; 
    private frameCount = 0;

    constructor(scene: MainScene) {
        this.scene = scene;
        
        // 1. Create the Render Texture
        // Default origin for RenderTextures is 0.5, 0.5. We MUST set it to 0,0 to align with our layout logic.
        this.renderTexture = this.scene.add.renderTexture(0, 0, this.mapSize, this.mapSize);
        this.renderTexture.setOrigin(0, 0); 
        this.renderTexture.setScrollFactor(0);
        this.renderTexture.setDepth(20000); 

        // 2. Create Reusable 'Brushes' (Hidden, only used for texture drawing)
        this.unitDot = this.scene.make.graphics({});
        this.unitDot.setVisible(false);

        this.buildingRect = this.scene.make.graphics({});
        this.buildingRect.setVisible(false);
        
        this.viewportGraphics = this.scene.make.graphics({});
        this.viewportGraphics.setVisible(false);

        // 3. Circular Mask
        this.maskGraphics = this.scene.make.graphics({});
        this.maskGraphics.fillStyle(0xffffff);
        this.maskGraphics.fillCircle(this.mapSize / 2, this.mapSize / 2, this.mapSize / 2);
        this.maskGraphics.setScrollFactor(0);
        this.maskGraphics.setVisible(false); 

        const mask = this.maskGraphics.createGeometryMask();
        this.renderTexture.setMask(mask);

        // 5. Border (Visual polish)
        this.borderGraphics = this.scene.add.graphics();
        this.borderGraphics.setScrollFactor(0);
        this.borderGraphics.setDepth(20001); // Above RT

        // Initial Layout
        this.updateLayout();
    }

    private updateLayout() {
        const cam = this.scene.cameras.main;
        const zoom = cam.zoom;
        const invZoom = 1 / zoom;
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        
        // Target screen position (Bottom-Left with padding)
        const targetX = this.padding;
        const targetY = h - this.mapSize - this.padding;

        // Counter-act camera zoom to keep position fixed on screen
        // Camera Zoom pivots around the screen center (w/2, h/2).
        // To keep an element visually at 'targetX, targetY', we must inverse-transform that point back to world space.
        // WorldPos = (ScreenPos - Center) / Zoom + Center
        const x = (targetX - w * 0.5) * invZoom + w * 0.5;
        const y = (targetY - h * 0.5) * invZoom + h * 0.5;

        // Update Texture Transform
        this.renderTexture.setPosition(x, y);
        this.renderTexture.setScale(invZoom);

        // Update Mask Source Transform (Must match Texture exactly)
        this.maskGraphics.setPosition(x, y);
        this.maskGraphics.setScale(invZoom);

        // Update Border
        this.borderGraphics.setPosition(x, y);
        this.borderGraphics.setScale(invZoom);
        this.borderGraphics.clear();
        
        // Scale stroke thickness so it visually remains constant (e.g. 3px)
        // Since we are scaling the graphics object down by invZoom, we multiply width by zoom.
        this.borderGraphics.lineStyle(3 * zoom, 0x44403c, 1.0);
        
        // Draw border circle. Since Graphics x,y is Top-Left of the box, center is mapSize/2
        this.borderGraphics.strokeCircle(this.mapSize / 2, this.mapSize / 2, this.mapSize / 2);
    }

    public update() {
        // Layout must update every frame to handle smooth zooming
        this.updateLayout();

        this.frameCount++;
        if (this.frameCount < this.updateInterval) return;
        this.frameCount = 0;

        // Clear and fill background
        this.renderTexture.clear();
        this.renderTexture.fill(0x064e3b); // Dark Emerald Green

        // 1. Draw Resources
        // Trees
        this.unitDot.clear();
        this.unitDot.fillStyle(0x022c22, 0.8); // Very dark green
        this.unitDot.fillCircle(0, 0, 1.5);
        
        const trees = this.scene.trees.getChildren();
        const scalar = this.getMapScalar();
        
        // Batch draw trees
        if (trees.length < 2000) {
            for (const t of trees) {
                const tree = t as any;
                // Simple culling for performance (optional)
                const pos = this.worldToMini(tree.x, tree.y, scalar);
                if (pos.x >= 0 && pos.x <= this.mapSize && pos.y >= 0 && pos.y <= this.mapSize) {
                    this.renderTexture.draw(this.unitDot, pos.x, pos.y);
                }
            }
        }

        // Fertile Zones (Brown patches)
        this.buildingRect.clear();
        this.buildingRect.fillStyle(0x451a03, 0.5); // Dark brown
        for (const zone of this.scene.fertileZones) {
             const pos = this.worldToMini(zone.x, zone.y, scalar);
             const r = zone.radius * scalar;
             this.buildingRect.fillCircle(0, 0, r);
             this.renderTexture.draw(this.buildingRect, pos.x, pos.y);
        }

        // 2. Draw Buildings
        const buildings = this.scene.buildings.getChildren();
        for (const b of buildings) {
            const build = b as any;
            const def = build.getData('def');
            const owner = build.getData('owner');
            
            const color = owner === 0 ? 0x3b82f6 : (owner === 1 ? 0xef4444 : 0xaaaaaa);
            const size = Math.max(3, def.width * scalar);

            this.buildingRect.clear();
            this.buildingRect.fillStyle(color, 1);
            this.buildingRect.fillRect(-size/2, -size/2, size, size);
            
            const pos = this.worldToMini(build.x, build.y, scalar);
            this.renderTexture.draw(this.buildingRect, pos.x, pos.y);
        }

        // 3. Draw Units
        const units = this.scene.units.getChildren();
        for (const u of units) {
            const unit = u as any;
            const type = unit.unitType;
            const owner = unit.getData('owner');

            let color = 0xffffff;
            let radius = 2;

            if (type === UnitType.ANIMAL) {
                color = 0x9ca3af; // Grey
                radius = 1;
            } else {
                color = owner === 0 ? 0x60a5fa : (owner === 1 ? 0xf87171 : 0xffffff);
                radius = 2.5; // Larger dots for visibility
            }

            this.unitDot.clear();
            this.unitDot.fillStyle(color, 1);
            this.unitDot.fillCircle(0, 0, radius);

            const pos = this.worldToMini(unit.x, unit.y, scalar);
            this.renderTexture.draw(this.unitDot, pos.x, pos.y);
        }

        // 4. Draw Viewport (Camera Frustum)
        this.drawViewport(scalar);
    }

    private drawViewport(scalar: number) {
        const cam = this.scene.cameras.main;
        
        // Get Camera corners (Iso coordinates)
        const tl = cam.getWorldPoint(0, 0);
        const tr = cam.getWorldPoint(cam.width, 0);
        const bl = cam.getWorldPoint(0, cam.height);
        const br = cam.getWorldPoint(cam.width, cam.height);

        // Convert to Cartesian (Logic coordinates)
        const cTl = toCartesian(tl.x, tl.y);
        const cTr = toCartesian(tr.x, tr.y);
        const cBl = toCartesian(bl.x, bl.y);
        const cBr = toCartesian(br.x, br.y);

        // Convert to Minimap coordinates
        const mTl = this.worldToMini(cTl.x, cTl.y, scalar);
        const mTr = this.worldToMini(cTr.x, cTr.y, scalar);
        const mBl = this.worldToMini(cBl.x, cBl.y, scalar);
        const mBr = this.worldToMini(cBr.x, cBr.y, scalar);

        // Draw Diamond Polygon
        this.viewportGraphics.clear();
        this.viewportGraphics.lineStyle(2, 0xfacc15, 1.0); // Bright Yellow
        this.viewportGraphics.beginPath();
        this.viewportGraphics.moveTo(mTl.x, mTl.y);
        this.viewportGraphics.lineTo(mTr.x, mTr.y);
        this.viewportGraphics.lineTo(mBr.x, mBr.y);
        this.viewportGraphics.lineTo(mBl.x, mBl.y);
        this.viewportGraphics.closePath();
        this.viewportGraphics.strokePath();

        this.renderTexture.draw(this.viewportGraphics, 0, 0);
    }

    private getMapScalar(): number {
        const worldSize = this.scene.mapMode === MapMode.FIXED ? this.scene.mapWidth : 4096;
        return this.mapSize / worldSize;
    }

    private worldToMini(x: number, y: number, scalar: number) {
        let wx = x;
        let wy = y;

        if (this.scene.mapMode === MapMode.INFINITE) {
            wx += 2048; 
            wy += 2048;
        }

        return {
            x: wx * scalar,
            y: wy * scalar
        };
    }

    public destroy() {
        if (this.renderTexture) this.renderTexture.destroy();
        if (this.borderGraphics) this.borderGraphics.destroy();
        if (this.maskGraphics) this.maskGraphics.destroy();
        if (this.unitDot) this.unitDot.destroy();
        if (this.buildingRect) this.buildingRect.destroy();
        if (this.viewportGraphics) this.viewportGraphics.destroy();
    }
}
