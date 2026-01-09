
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
        this.renderTexture = this.scene.add.renderTexture(0, 0, this.mapSize, this.mapSize);
        this.renderTexture.setOrigin(0, 0); 
        this.renderTexture.setScrollFactor(0);
        this.renderTexture.setDepth(20000); 

        // 2. Create Reusable 'Brushes'
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

        // 5. Border
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
        const x = (targetX - w * 0.5) * invZoom + w * 0.5;
        const y = (targetY - h * 0.5) * invZoom + h * 0.5;

        // Update Texture Transform
        this.renderTexture.setPosition(x, y);
        this.renderTexture.setScale(invZoom);

        // Update Mask Source Transform
        this.maskGraphics.setPosition(x, y);
        this.maskGraphics.setScale(invZoom);

        // Update Border
        this.borderGraphics.setPosition(x, y);
        this.borderGraphics.setScale(invZoom);
        this.borderGraphics.clear();
        
        this.borderGraphics.lineStyle(3 * zoom, 0x44403c, 1.0);
        this.borderGraphics.strokeCircle(this.mapSize / 2, this.mapSize / 2, this.mapSize / 2);
    }

    public update() {
        this.updateLayout();

        this.frameCount++;
        if (this.frameCount < this.updateInterval) return;
        this.frameCount = 0;

        // Clear and fill background
        this.renderTexture.clear();
        this.renderTexture.fill(0x064e3b); // Dark Emerald Green

        const scalar = this.getMapScalar();

        // 1. Draw Resources
        this.unitDot.clear();
        this.unitDot.fillStyle(0x022c22, 0.8); 
        this.unitDot.fillCircle(0, 0, 1.5);
        
        const trees = this.scene.trees.getChildren();
        if (trees.length < 3000) { // Bumped up limit slightly
            for (const t of trees) {
                const tree = t as any;
                const pos = this.worldToMini(tree.x, tree.y, scalar);
                // Draw if within bounds
                if (pos.x >= 0 && pos.x <= this.mapSize && pos.y >= 0 && pos.y <= this.mapSize) {
                    this.renderTexture.draw(this.unitDot, pos.x, pos.y);
                }
            }
        }

        // Fertile Zones
        this.buildingRect.clear();
        this.buildingRect.fillStyle(0x451a03, 0.5); 
        for (const zone of this.scene.fertileZones) {
             const pos = this.worldToMini(zone.x, zone.y, scalar);
             // Cull distant zones in infinite mode
             if (pos.x >= -50 && pos.x <= this.mapSize + 50 && pos.y >= -50 && pos.y <= this.mapSize + 50) {
                 const r = zone.radius * scalar;
                 this.buildingRect.fillCircle(0, 0, r);
                 this.renderTexture.draw(this.buildingRect, pos.x, pos.y);
             }
        }

        // 2. Draw Buildings
        const buildings = this.scene.buildings.getChildren();
        for (const b of buildings) {
            const build = b as any;
            const pos = this.worldToMini(build.x, build.y, scalar);
            
            if (pos.x >= 0 && pos.x <= this.mapSize && pos.y >= 0 && pos.y <= this.mapSize) {
                const def = build.getData('def');
                const owner = build.getData('owner');
                
                const color = owner === 0 ? 0x3b82f6 : (owner === 1 ? 0xef4444 : 0xaaaaaa);
                const size = Math.max(3, def.width * scalar);

                this.buildingRect.clear();
                this.buildingRect.fillStyle(color, 1);
                this.buildingRect.fillRect(-size/2, -size/2, size, size);
                
                this.renderTexture.draw(this.buildingRect, pos.x, pos.y);
            }
        }

        // 3. Draw Units
        const units = this.scene.units.getChildren();
        for (const u of units) {
            const unit = u as any;
            const pos = this.worldToMini(unit.x, unit.y, scalar);

            if (pos.x >= 0 && pos.x <= this.mapSize && pos.y >= 0 && pos.y <= this.mapSize) {
                const type = unit.unitType;
                const owner = unit.getData('owner');

                let color = 0xffffff;
                let radius = 2;

                if (type === UnitType.ANIMAL) {
                    color = 0x9ca3af;
                    radius = 1;
                } else {
                    color = owner === 0 ? 0x60a5fa : (owner === 1 ? 0xf87171 : 0xffffff);
                    radius = 2.5; 
                }

                this.unitDot.clear();
                this.unitDot.fillStyle(color, 1);
                this.unitDot.fillCircle(0, 0, radius);
                this.renderTexture.draw(this.unitDot, pos.x, pos.y);
            }
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

    public getWorldFromMinimap(miniX: number, miniY: number): { x: number, y: number } {
        const scalar = this.getMapScalar();
        
        if (this.scene.mapMode === MapMode.INFINITE) {
             const cam = this.scene.cameras.main;
             const center = toCartesian(cam.worldView.centerX, cam.worldView.centerY);
             
             const dx = miniX - this.mapSize / 2;
             const dy = miniY - this.mapSize / 2;
             
             return {
                 x: center.x + dx / scalar,
                 y: center.y + dy / scalar
             };
        } else {
            return {
                x: miniX / scalar,
                y: miniY / scalar
            };
        }
    }

    private getMapScalar(): number {
        // In Infinite mode, we treat the minimap as a 4096x4096 radar around the player
        const worldSize = this.scene.mapMode === MapMode.FIXED ? this.scene.mapWidth : 4096;
        return this.mapSize / worldSize;
    }

    private worldToMini(x: number, y: number, scalar: number) {
        if (this.scene.mapMode === MapMode.INFINITE) {
             // Relative to Camera Center (Radar Mode)
             const cam = this.scene.cameras.main;
             const center = toCartesian(cam.worldView.centerX, cam.worldView.centerY);
             
             // Offset from center
             const dx = x - center.x;
             const dy = y - center.y;
             
             // Center on map
             return {
                 x: dx * scalar + this.mapSize / 2,
                 y: dy * scalar + this.mapSize / 2
             };
        } else {
            // Absolute Positioning for Fixed Map
            return {
                x: x * scalar,
                y: y * scalar
            };
        }
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
