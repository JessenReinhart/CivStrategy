
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { Season } from '../../types';

export class AtmosphericSystem {
    private scene: MainScene;
    public clouds: Phaser.GameObjects.Sprite[] = [];

    private bloomEffect!: Phaser.FX.Bloom;
    private tiltShiftEffect: Phaser.FX.TiltShift | null = null;
    private vignetteEffect!: Phaser.FX.Vignette;
    private cloudTextureKey = 'cloud-puff';
    private cloudCount = 20;

    // Store user's desired bloom multiplier so adaptive logic doesn't overwrite it
    private userBloomMultiplier: number = 1.0;
    // Seasonal cloud speed multiplier (1.0 = default)
    private cloudSpeedMult: number = 1.0;
    // Seasonal terrain tint overlay
    private seasonalTint!: Phaser.GameObjects.Graphics;
    private seasonalTintTarget = { color: 0x000000, alpha: 0 };
    private seasonalTintCurrent = { color: 0x000000, alpha: 0 };

    constructor(scene: MainScene) {
        this.scene = scene;
        this.createCloudTexture();
        this.createClouds();
        this.setupBloom();
        this.createSeasonalTint();
    }

    private createSeasonalTint() {
        this.seasonalTint = this.scene.add.graphics();
        this.seasonalTint.setScrollFactor(0);
        this.seasonalTint.setDepth(1000);
        this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.seasonalTint?.destroy();
        });
    }
    private createCloudTexture() {
        const size = 128;
        const canvas = this.scene.textures.createCanvas(this.cloudTextureKey, size, size);
        if (!canvas) return;

        const ctx = canvas.context;

        // Draw a soft radial gradient
        const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grd.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Dark center (shadow)
        grd.addColorStop(0.4, 'rgba(0, 0, 0, 0.5)');
        grd.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Transparent edge

        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, size, size);

        canvas.refresh();
    }

    private createClouds() {
        // Clear old if any
        this.clouds.forEach(c => c.destroy());
        this.clouds = [];

        const bounds = this.getSpawnBounds();

        for (let i = 0; i < this.cloudCount; i++) {
            const x = Phaser.Math.Between(bounds.left, bounds.right);
            const y = Phaser.Math.Between(bounds.top, bounds.bottom);

            const cloud = this.scene.add.sprite(x, y, this.cloudTextureKey);
            if (this.scene.worldLayer) this.scene.worldLayer.add(cloud);
            cloud.setDepth(15000 + i); // Stagger depth slightly so they layer
            cloud.setAlpha(Phaser.Math.FloatBetween(0.03, 0.07)); // light puffs only
            cloud.setScale(Phaser.Math.FloatBetween(4.0, 8.0)); // Big puffy clouds

            // Random rotation for variety
            cloud.setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2));

            this.clouds.push(cloud);
        }
    }

    private getSpawnBounds() {
        // We want clouds to cover a large area around the camera
        // Since the map can be large, we'll just spawn them around the map "working area"
        // or relative to the initial camera view.
        // For now, let's cover a reasonable 4096x4096 area (MapSize.LARGE)
        return {
            left: -1000,
            right: 5000,
            top: -1000,
            bottom: 5000
        };
    }

    private setupBloom() {
      // Low bloom + no tiltShift — both grey midtones / kill contrast.
      // Color punch lives in ground/terrain/water, not PostFX.
      const target = this.scene.worldLayer ? this.scene.worldLayer.postFX : this.scene.cameras.main.postFX;

      this.bloomEffect = target.addBloom(0xffffff, 1, 1, 0.4, 0.5);
      this.tiltShiftEffect = null; // drop DOF blur — greys edges
      this.vignetteEffect = target.addVignette(0.5, 0.5, 0.98, 0.03);
    }

    public setBloomIntensity(intensity: number) {
        // Store user preference as a multiplier (range ~0.0 to 3.0)
        this.userBloomMultiplier = intensity;
    }

    public update(time: number, delta: number) {
        const cam = this.scene.cameras.main;
        const viewRect = cam.worldView;

        if (this.bloomEffect) {
            const zoomProgress = Phaser.Math.Clamp((cam.zoom - 0.5) / 1.5, 0, 1);
            // Mild glow only — high bloom was washing the map to grey
            const baseStrength = Phaser.Math.Linear(0.55, 0.2, zoomProgress);
            const pulse = Math.sin(time * 0.002) * 0.02;
            const dynamicTarget = Phaser.Math.Clamp(baseStrength + pulse, 0.05, 0.8);
            const target = Phaser.Math.Clamp(dynamicTarget * this.userBloomMultiplier, 0.0, 2.0);
            this.bloomEffect.strength = Phaser.Math.Linear(this.bloomEffect.strength, target, 0.08);
        }

        // Smoothly interpolate seasonal tint
        if (this.seasonalTint) {
            const t = 0.03; // ~30 frames to settle
            this.seasonalTintCurrent.alpha = Phaser.Math.Linear(this.seasonalTintCurrent.alpha, this.seasonalTintTarget.alpha, t);
            this.seasonalTintCurrent.color = this.seasonalTintTarget.color;
            this.seasonalTint.clear();
            if (this.seasonalTintCurrent.alpha > 0.005) {
                this.seasonalTint.fillStyle(this.seasonalTintCurrent.color, this.seasonalTintCurrent.alpha);
                this.seasonalTint.fillRect(viewRect.x - 100, viewRect.y - 100, viewRect.width + 200, viewRect.height + 200);
            }
        }

        // --- Cloud Logic ---
        // Expand wrap bounds well beyond the camera view to avoid popping
        const pad = 500;
        const wrapBounds = {
            left: viewRect.x - pad,
            right: viewRect.x + viewRect.width + pad,
            top: viewRect.y - pad,
            bottom: viewRect.y + viewRect.height + pad
        };
        const speed = 2 * this.cloudSpeedMult * (delta / 16.6);

        this.clouds.forEach(cloud => {
            // Move cloud
            cloud.x += speed * (cloud.scaleX * 0.5); // Parallax-ish: big clouds move faster? Or slower? 
            // Actually closer clouds (bigger) should move faster if they are "above".

            // Wrap Logic:
            // If cloud goes too far right, wrap to left
            if (cloud.x > wrapBounds.right) {
                cloud.x = wrapBounds.left;
                cloud.y = Phaser.Math.Between(wrapBounds.top, wrapBounds.bottom);
            }
            // Logic for Y wrapping if needed, but horizontal drift is usually enough.
            // Let's keep them contained in Y view too.
            if (cloud.y > wrapBounds.bottom) {
                cloud.y = wrapBounds.top;
            } else if (cloud.y < wrapBounds.top) {
                cloud.y = wrapBounds.bottom;
            }
        });
    }

    public applySeasonalTint(season: Season): void {
        switch (season) {
            case Season.SPRING:
                this.seasonalTintTarget = { color: 0x88CC88, alpha: 0.04 };
                this.cloudSpeedMult = 0.9;
                break;
            case Season.SUMMER:
                this.seasonalTintTarget = { color: 0xFFDD88, alpha: 0.03 };
                this.cloudSpeedMult = 0.7;
                break;
            case Season.AUTUMN:
                this.seasonalTintTarget = { color: 0xCC8833, alpha: 0.08 };
                this.cloudSpeedMult = 1.3;
                break;
            case Season.WINTER:
                this.seasonalTintTarget = { color: 0x8899CC, alpha: 0.10 };
                this.cloudSpeedMult = 1.6;
                break;
        }
    }

    public getWindSway(x: number, y: number, time: number): number {
        // Use Perlin-like noise (sine combination) for wind
        // Low frequency base sway
        const base = Math.sin(time * 0.0005 + x * 0.002 + y * 0.002);

        // High frequency gusts (more variation)
        const gust = Math.sin(time * 0.002 + x * 0.01 + y * 0.01) * 0.3;

        // Combine and scale
        // Return a rotation value in radians (small amplitude)
        return (base + gust) * 0.05; // +/- 0.05 - 0.08 radians (approx 3-5 degrees)
    }
}
