
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { MapMode, UnitType } from '../../types';
import { UNIT_VISION } from '../../constants';
import { toCartesian } from '../utils/iso';

export class MinimapSystem {
    private scene: MainScene;
    private renderTexture: Phaser.GameObjects.RenderTexture;
    private staticTexture: Phaser.GameObjects.RenderTexture;

    private mapSize = 192; // Match React UI w-48
    private padding = 24;  // Match React UI bottom-6 left-6

    private unitDot: Phaser.GameObjects.Graphics;
    private buildingRect: Phaser.GameObjects.Graphics;
    private viewportGraphics: Phaser.GameObjects.Graphics;

    private maskGraphics: Phaser.GameObjects.Graphics;
    private borderGraphics: Phaser.GameObjects.Graphics;

    private updateInterval = 15;
    private frameCount = 0;
    private dirtyStatic = true; // Flag to redraw static layer

    private fogRT: Phaser.GameObjects.RenderTexture;
    private fogBrush: Phaser.GameObjects.Graphics;

    constructor(scene: MainScene) {
        this.scene = scene;

        // 1. Create Render Textures
        this.renderTexture = this.scene.add.renderTexture(0, 0, this.mapSize, this.mapSize);
        this.renderTexture.setOrigin(0, 0).setScrollFactor(0).setDepth(20000);

        // Static layer for trees, background, resources (cached)
        this.staticTexture = this.scene.make.renderTexture({ width: this.mapSize, height: this.mapSize }, false);
        this.staticTexture.setOrigin(0, 0);

        // Fog Layer
        this.fogRT = this.scene.add.renderTexture(0, 0, this.mapSize, this.mapSize);
        this.fogRT.setOrigin(0, 0).setScrollFactor(0).setDepth(20002); // Above map, below border
        this.fogRT.setAlpha(1.0); // Full black

        // 2. Create Reusable 'Brushes'
        this.unitDot = this.scene.make.graphics({});
        this.unitDot.setVisible(false);

        this.buildingRect = this.scene.make.graphics({});
        this.buildingRect.setVisible(false);

        this.viewportGraphics = this.scene.make.graphics({});
        this.viewportGraphics.setVisible(false);

        this.fogBrush = this.scene.make.graphics({});
        this.fogBrush.setVisible(false);

        // 3. Circular Mask
        this.maskGraphics = this.scene.make.graphics({});
        this.maskGraphics.fillStyle(0xffffff);
        this.maskGraphics.fillCircle(this.mapSize / 2, this.mapSize / 2, this.mapSize / 2);
        this.maskGraphics.setScrollFactor(0).setVisible(false);

        const mask = this.maskGraphics.createGeometryMask();
        this.renderTexture.setMask(mask);
        this.fogRT.setMask(mask);

        // 4. Border
        this.borderGraphics = this.scene.add.graphics();
        this.borderGraphics.setScrollFactor(0).setDepth(20003); // Top most

        // Initial Layout
        this.updateLayout();
    }

    public refreshStaticLayer() {
        this.dirtyStatic = true;
    }

    private updateLayout() {
        const cam = this.scene.cameras.main;
        const zoom = cam.zoom;
        const invZoom = 1 / zoom;
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;

        const targetX = this.padding;
        const targetY = h - this.mapSize - this.padding;

        const x = (targetX - w * 0.5) * invZoom + w * 0.5;
        const y = (targetY - h * 0.5) * invZoom + h * 0.5;

        this.renderTexture.setPosition(x, y).setScale(invZoom);
        this.fogRT.setPosition(x, y).setScale(invZoom);
        this.maskGraphics.setPosition(x, y).setScale(invZoom);

        this.borderGraphics.setPosition(x, y).setScale(invZoom);
        this.borderGraphics.clear();
        this.borderGraphics.lineStyle(3 * zoom, 0x44403c, 1.0);
        this.borderGraphics.strokeCircle(this.mapSize / 2, this.mapSize / 2, this.mapSize / 2);
    }

    private drawStaticLayer(scalar: number) {
        this.staticTexture.clear();
        this.staticTexture.fill(0x064e3b); // Background

        // Draw Fertile Zones
        this.buildingRect.clear();
        this.buildingRect.fillStyle(0x451a03, 0.5);
        for (const zone of this.scene.fertileZones) {
            const pos = this.worldToMini(zone.x, zone.y, scalar);
            if (this.isInBounds(pos)) {
                const r = zone.radius * scalar;
                this.buildingRect.fillCircle(0, 0, r);
                this.staticTexture.draw(this.buildingRect, pos.x, pos.y);
            }
        }

        // Draw Trees (The heavy part)
        this.unitDot.clear();
        this.unitDot.fillStyle(0x022c22, 0.8);

        // Batch all tree drawings into the Graphics object first
        const trees = this.scene.trees.getChildren();
        let treesDrawn = 0;
        for (const t of trees) {
            const tree = t as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (tree.getData('isChopped')) continue; // Don't draw chopped trees

            const pos = this.worldToMini(tree.x, tree.y, scalar);
            if (this.isInBounds(pos)) {
                // Direct fill circle on graphics, do NOT draw to texture yet
                this.unitDot.fillCircle(pos.x, pos.y, 1.5);
                treesDrawn++;
            }
        }

        // Single draw call to RenderTexture
        if (treesDrawn > 0) {
            this.staticTexture.draw(this.unitDot, 0, 0);
        }
    }

    private isInBounds(pos: { x: number, y: number }) {
        return pos.x >= -10 && pos.x <= this.mapSize + 10 && pos.y >= -10 && pos.y <= this.mapSize + 10;
    }

    public update() {
        this.updateLayout();

        this.frameCount++;
        if (this.frameCount < this.updateInterval) return;
        this.frameCount = 0;

        const scalar = this.getMapScalar();

        // 1. Update Static Layer if needed
        if (this.dirtyStatic) {
            this.drawStaticLayer(scalar);
            this.dirtyStatic = false;
        }

        // 2. Clear Main Texture and Draw Static Layer
        this.renderTexture.clear();
        this.renderTexture.draw(this.staticTexture, 0, 0);

        // 3. Draw Buildings (Dynamic ownership/health, so draw every time)
        const buildings = this.scene.buildings.getChildren();
        for (const b of buildings) {
            const build = b as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const pos = this.worldToMini(build.x, build.y, scalar);

            if (this.isInBounds(pos)) {
                const def = build.getData('def');
                const owner = build.getData('owner');
                const color = owner === 0 ? 0x3b82f6 : (owner === 1 ? 0xef4444 : 0xaaaaaa);
                const size = Math.max(3, def.width * scalar);

                this.buildingRect.clear();
                this.buildingRect.fillStyle(color, 1);
                this.buildingRect.fillRect(-size / 2, -size / 2, size, size);
                this.renderTexture.draw(this.buildingRect, pos.x, pos.y);
            }
        }

        // 4. Draw Units
        const units = this.scene.units.getChildren();
        this.unitDot.clear();
        for (const u of units) {
            const unit = u as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            const pos = this.worldToMini(unit.x, unit.y, scalar);

            if (this.isInBounds(pos)) {
                const type = unit.unitType;
                const owner = unit.getData('owner');
                let color = owner === 0 ? 0x60a5fa : (owner === 1 ? 0xf87171 : 0xffffff);
                let radius = 2.5;
                if (type === UnitType.ANIMAL) { color = 0x9ca3af; radius = 1; }

                this.unitDot.fillStyle(color, 1);
                this.unitDot.fillCircle(0, 0, radius);
                this.renderTexture.draw(this.unitDot, pos.x, pos.y);
            }
        }

        // 5. Update Fog of War
        this.updateFog(scalar);

        // 6. Viewport
        this.drawViewport(scalar);
    }

    private updateFog(scalar: number) {
        if (!this.scene.isFowEnabled) {
            this.fogRT.setVisible(false);
            return;
        }
        this.fogRT.setVisible(true);
        this.fogRT.clear();
        this.fogRT.fill(0x000000, 1.0);

        // Use custom blend mode to Erase
        this.fogBrush.clear();
        this.fogBrush.fillStyle(0xffffff, 1);

        const units = this.scene.units.getChildren();
        for (const u of units) {
            const unit = u as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            // Only friendly units reveal fog
            if (unit.getData('owner') !== 0) continue;
            // Animals don't reveal fog (usually)
            if (unit.unitType === UnitType.ANIMAL) continue;

            const pos = this.worldToMini(unit.x, unit.y, scalar);
            if (this.isInBounds(pos)) {
                // Approximate Minimap Vision radius
                const range = (UNIT_VISION[unit.unitType as UnitType] || 250) * scalar * 1.5;
                this.fogBrush.fillCircle(pos.x, pos.y, range);
            }
        }

        const buildings = this.scene.buildings.getChildren();
        for (const b of buildings) {
            const build = b as any; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (build.getData('owner') !== 0) continue;

            const pos = this.worldToMini(build.x, build.y, scalar);
            if (this.isInBounds(pos)) {
                const def = build.getData('def');
                // Use territory or vision radius
                const range = (def.territoryRadius || def.visionRadius || 200) * scalar;
                this.fogBrush.fillCircle(pos.x, pos.y, range);
            }
        }

        // Erase using the brush
        this.fogRT.erase(this.fogBrush);
    }

    private drawViewport(scalar: number) {
        const cam = this.scene.cameras.main;
        const tl = cam.getWorldPoint(0, 0);
        const tr = cam.getWorldPoint(cam.width, 0);
        const bl = cam.getWorldPoint(0, cam.height);
        const br = cam.getWorldPoint(cam.width, cam.height);

        const cTl = toCartesian(tl.x, tl.y);
        const cTr = toCartesian(tr.x, tr.y);
        const cBl = toCartesian(bl.x, bl.y);
        const cBr = toCartesian(br.x, br.y);

        const mTl = this.worldToMini(cTl.x, cTl.y, scalar);
        const mTr = this.worldToMini(cTr.x, cTr.y, scalar);
        const mBl = this.worldToMini(cBl.x, cBl.y, scalar);
        const mBr = this.worldToMini(cBr.x, cBr.y, scalar);

        this.viewportGraphics.clear();
        this.viewportGraphics.lineStyle(2, 0xfacc15, 1.0);
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
            return { x: center.x + dx / scalar, y: center.y + dy / scalar };
        } else {
            return { x: miniX / scalar, y: miniY / scalar };
        }
    }

    private getMapScalar(): number {
        const worldSize = this.scene.mapMode === MapMode.FIXED ? this.scene.mapWidth : 4096;
        return this.mapSize / worldSize;
    }

    private worldToMini(x: number, y: number, scalar: number) {
        if (this.scene.mapMode === MapMode.INFINITE) {
            const cam = this.scene.cameras.main;
            const center = toCartesian(cam.worldView.centerX, cam.worldView.centerY);
            const dx = x - center.x;
            const dy = y - center.y;
            return { x: dx * scalar + this.mapSize / 2, y: dy * scalar + this.mapSize / 2 };
        } else {
            return { x: x * scalar, y: y * scalar };
        }
    }

    public destroy() {
        if (this.fogRT) this.fogRT.destroy();
        if (this.fogBrush) this.fogBrush.destroy();
        if (this.renderTexture) this.renderTexture.destroy();
        if (this.staticTexture) this.staticTexture.destroy();
        if (this.borderGraphics) this.borderGraphics.destroy();
        if (this.maskGraphics) this.maskGraphics.destroy();
        if (this.unitDot) this.unitDot.destroy();
        if (this.buildingRect) this.buildingRect.destroy();
        if (this.viewportGraphics) this.viewportGraphics.destroy();
    }
}
