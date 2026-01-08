
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UNIT_VISION, MAP_WIDTH, MAP_HEIGHT } from '../../constants';
import { toIso } from '../utils/iso';
import { MapMode } from '../../types';

export class FogOfWarSystem {
    private scene: MainScene;
    private shroud: Phaser.GameObjects.RenderTexture;
    private visionRT: Phaser.GameObjects.RenderTexture;
    private brush: Phaser.GameObjects.Graphics;
    private lastUpdate = 0;
    
    // In isometric, a 2048x2048 map has a width of 4096 (x-y) and height of 2048 (x+y)/2
    private readonly FIXED_WIDTH = 4096;
    private readonly FIXED_HEIGHT = 2048;

    constructor(scene: MainScene) {
        this.scene = scene;
        
        const isInfinite = this.scene.mapMode === MapMode.INFINITE;
        const width = isInfinite ? 4096 : this.FIXED_WIDTH + 1000; // Extra buffer
        const height = isInfinite ? 2048 : this.FIXED_HEIGHT + 1000;

        // Persistent exploration (Shroud)
        this.shroud = scene.add.renderTexture(0, 0, width, height);
        this.shroud.fill(0x000000, 1);
        this.shroud.setDepth(Number.MAX_SAFE_INTEGER - 10); 
        this.shroud.setScrollFactor(1);
        
        // Current vision (Fog)
        this.visionRT = scene.add.renderTexture(0, 0, width, height);
        this.visionRT.fill(0x000000, 0.95); // High opacity for "Fade to Black"
        this.visionRT.setDepth(Number.MAX_SAFE_INTEGER - 11);
        this.visionRT.setScrollFactor(1);

        // Brush used to erase from the textures
        this.brush = scene.make.graphics({ x: 0, y: 0 }, false);

        if (!isInfinite) {
            // Center the FOW diamond. Cartesian (0,0) is Iso (0,0). 
            // The map diamond ranges from IsoX -2048 to +2048.
            // So we start the texture at IsoX -2548 (with buffer).
            this.shroud.setPosition(-width / 2, -200); 
            this.visionRT.setPosition(-width / 2, -200);
        }

        // Force an initial update to prevent starting in total darkness
        this.update(true);
    }

    public update(force: boolean = false) {
        if (!this.scene.isFowEnabled) {
            this.shroud.setVisible(false);
            this.visionRT.setVisible(false);
            return;
        }
        
        this.shroud.setVisible(true);
        this.visionRT.setVisible(true);

        const now = this.scene.time.now;
        if (!force && now - this.lastUpdate < 30) return; 
        this.lastUpdate = now;

        const cam = this.scene.cameras.main;
        const isInfinite = this.scene.mapMode === MapMode.INFINITE;

        if (isInfinite) {
            // Track camera for infinite mode
            const targetX = cam.worldView.centerX - this.shroud.width / 2;
            const targetY = cam.worldView.centerY - this.shroud.height / 2;
            
            this.shroud.setPosition(targetX, targetY);
            this.visionRT.setPosition(targetX, targetY);
            
            // Re-fill shroud as we move (Infinite mode doesn't have exploration memory to save RAM)
            this.shroud.clear();
            this.shroud.fill(0x000000, 1);
        }

        // Reset the current vision layer
        this.visionRT.clear();
        this.visionRT.fill(0x000000, 0.95);

        // We only calculate vision for entities inside or near the camera viewport to save performance
        const viewPadding = 1200; 
        const activeRect = new Phaser.Geom.Rectangle(
            cam.worldView.x - viewPadding,
            cam.worldView.y - viewPadding,
            cam.worldView.width + viewPadding * 2,
            cam.worldView.height + viewPadding * 2
        );

        // Reveal units
        this.scene.units.getChildren().forEach((u: any) => {
            if (u.unitType === 'Animal') return;
            const iso = toIso(u.x, u.y);
            if (activeRect.contains(iso.x, iso.y)) {
                const radius = UNIT_VISION[u.unitType as keyof typeof UNIT_VISION] || 100;
                this.drawVision(iso.x, iso.y, radius);
            }
        });

        // Reveal buildings
        this.scene.buildings.getChildren().forEach((b: any) => {
            const def = b.getData('def');
            const iso = toIso(b.x, b.y);
            if (activeRect.contains(iso.x, iso.y)) {
                const radius = def.visionRadius || 150;
                this.drawVision(iso.x, iso.y, radius);
            }
        });
    }

    private drawVision(isoX: number, isoY: number, radius: number) {
        // Translate world iso coordinates to texture local coordinates
        const tx = isoX - this.shroud.x;
        const ty = isoY - this.shroud.y;

        this.brush.clear();
        this.brush.fillStyle(0xffffff, 1);
        // Ellipse creates the isometric circular vision look (2:1 ratio)
        this.brush.fillEllipse(tx, ty, radius * 2.2, radius * 1.1);

        this.shroud.erase(this.brush);
        this.visionRT.erase(this.brush);
    }
}
