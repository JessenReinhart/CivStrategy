
import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { Season } from '../../types';

export class AtmosphericSystem {
    private scene: MainScene;
    public clouds: Phaser.GameObjects.Sprite[] = [];

    private bloomEffect: Phaser.FX.Bloom | null = null;
    private colorGradeEffect: Phaser.FX.ColorMatrix | null = null;
    private tiltShiftEffect: unknown = null; // reserved for future DOF effect
    
    private vignetteEffect: Phaser.FX.Vignette | null = null;
    private cloudTextureKey = 'cloud-puff';
    private cloudCount = 0;

    // Store user's desired bloom multiplier so adaptive logic doesn't overwrite it
    private userBloomMultiplier: number = 1.0;
    // PostFX enabled/disabled toggle (user performance setting)
    private postFXEnabled: boolean = true;
    // Seasonal cloud speed multiplier (1.0 = default)
    private cloudSpeedMult: number = 1.0;
    // Seasonal terrain tint overlay
    private seasonalTint!: Phaser.GameObjects.Graphics;
    private seasonalTintTarget = { color: 0x000000, alpha: 0 };
    private seasonalTintCurrent = { color: 0x000000, alpha: 0 };
    // Track whether seasonal tint needs redraw to avoid full-screen Graphics clear/fill every frame
    private seasonalTintDirty: boolean = true;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.createCloudTexture();
        this.createClouds();
        this.setupBloom();
        this.createSeasonalTint();
    }
    // Camera rect tracking for seasonal tint redraw
    private prevViewRect: Phaser.Geom.Rectangle | null = null;

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

        // Keep cloud shade broad and feathered. The sprite is stretched along
        // the solar axis at runtime, so this gradient must not read as a dark
        // circular spotlight when viewed from above.
        const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grd.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
        grd.addColorStop(0.35, 'rgba(0, 0, 0, 0.24)');
        grd.addColorStop(1, 'rgba(0, 0, 0, 0)');

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
            cloud.setAlpha(Phaser.Math.FloatBetween(0.008, 0.018));
            cloud.setScale(
                Phaser.Math.FloatBetween(7.0, 12.0),
                Phaser.Math.FloatBetween(2.2, 3.8),
            );

            // Similar headings make them read as distant wisps instead of a
            // field of unrelated round stains.
            cloud.setRotation(Phaser.Math.FloatBetween(-0.65, -0.35));

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

      this.bloomEffect = target.addBloom(0xffffff, 1, 1, 0.18, 0.08);
      this.tiltShiftEffect = null; // drop DOF blur — greys edges
      this.vignetteEffect = target.addVignette(0.5, 0.5, 0.98, 0.03);
      this.colorGradeEffect = target.addColorMatrix();
      this.colorGradeEffect.saturate(0.9);
      this.colorGradeEffect.contrast(0.28, true);
    }

    public setBloomIntensity(intensity: number) {
        // Store user preference as a multiplier (range ~0.0 to 3.0)
        this.userBloomMultiplier = intensity;
    }

    /** Toggle PostFX (bloom/vignette) — full-screen GPU passes that dominate frame cost on iGPU. */
    public setPostFXEnabled(enabled: boolean): void {
        this.postFXEnabled = enabled;
        if (!enabled) {
            const target = this.scene.worldLayer
                ? this.scene.worldLayer.postFX
                : this.scene.cameras.main.postFX;
            this.bloomEffect?.destroy();
            this.vignetteEffect?.destroy();
            if (this.colorGradeEffect) {
                // Phaser's runtime ColorMatrix is an FX controller, but its
                // declaration omits that inheritance from the remove() input.
                target.remove(this.colorGradeEffect as unknown as Phaser.FX.Controller);
            }
            this.bloomEffect = null;
            this.vignetteEffect = null;
            this.colorGradeEffect = null;
            // Hide clouds when PostFX disabled to save CPU update
            this.clouds.forEach(c => c.setVisible(false));
        } else if (!this.bloomEffect || !this.vignetteEffect || !this.colorGradeEffect) {
            this.setupBloom();
            // Show clouds when PostFX re-enabled
            this.clouds.forEach(c => c.setVisible(true));
            // Mark tint dirty to ensure it redraws
            this.seasonalTintDirty = true;
        }
    }

    public update(time: number, delta: number) {
        const cam = this.scene.cameras.main;
        const viewRect = cam.worldView;

        // Track camera position for seasonal tint redraw
        const cameraMoved = !this.prevViewRect ||
            this.prevViewRect.x !== viewRect.x ||
            this.prevViewRect.y !== viewRect.y ||
            this.prevViewRect.width !== viewRect.width ||
            this.prevViewRect.height !== viewRect.height;
        if (cameraMoved) {
            this.seasonalTintDirty = true;
        }
        this.prevViewRect = Phaser.Geom.Rectangle.Clone(viewRect);

        // Bloom strength lerp only — clouds and tint run regardless of PostFX
        if (this.postFXEnabled && this.bloomEffect) {
            const zoomProgress = Phaser.Math.Clamp((cam.zoom - 0.5) / 1.5, 0, 1);
            // Mild glow only — high bloom was washing the map to grey
            const baseStrength = Phaser.Math.Linear(0.08, 0.03, zoomProgress);
            const pulse = Math.sin(time * 0.002) * 0.006;
            const dynamicTarget = Phaser.Math.Clamp(baseStrength + pulse, 0.02, 0.12);
            const target = Phaser.Math.Clamp(dynamicTarget * this.userBloomMultiplier, 0.0, 2.0);
            this.bloomEffect.strength = Phaser.Math.Linear(this.bloomEffect.strength, target, 0.08);
        }

        // Smoothly interpolate seasonal tint, only redraw when changed
        if (this.seasonalTint) {
            const t = 0.03; // ~30 frames to settle
            const prevAlpha = this.seasonalTintCurrent.alpha;
            this.seasonalTintCurrent.alpha = Phaser.Math.Linear(this.seasonalTintCurrent.alpha, this.seasonalTintTarget.alpha, t);
            this.seasonalTintCurrent.color = this.seasonalTintTarget.color;
            
            // Only clear/fill when alpha is changing (settling), camera moved, or marked dirty.
            // At 5000 units, skipping the per-frame clear/fill saves ~0.5ms on iGPU.
            const alphaChanged = Math.abs(this.seasonalTintCurrent.alpha - prevAlpha) > 0.001;
            if (this.seasonalTintDirty || alphaChanged) {
                this.seasonalTint.clear();
                if (this.seasonalTintCurrent.alpha > 0.005) {
                    this.seasonalTint.fillStyle(this.seasonalTintCurrent.color, this.seasonalTintCurrent.alpha);
                    this.seasonalTint.fillRect(viewRect.x - 100, viewRect.y - 100, viewRect.width + 200, viewRect.height + 200);
                }
                // Mark clean once settled and camera stable
                if (!alphaChanged && !cameraMoved) {
                    this.seasonalTintDirty = false;
                }
            }
        }

        // --- Cloud Logic (skipped when postFX disabled — no overhead) ---
        if (this.postFXEnabled) {
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
                cloud.x += speed * (cloud.scaleX * 0.5);
                // Wrap Logic: If cloud goes too far right, wrap to left
                if (cloud.x > wrapBounds.right) {
                    cloud.x = wrapBounds.left;
                    cloud.y = Phaser.Math.Between(wrapBounds.top, wrapBounds.bottom);
                }
                // Keep clouds contained in Y view too
                if (cloud.y > wrapBounds.bottom) {
                    cloud.y = wrapBounds.top;
                } else if (cloud.y < wrapBounds.top) {
                    cloud.y = wrapBounds.bottom;
                }
            });
        }
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
        // Mark tint dirty so it redraws with new target on next update
        this.seasonalTintDirty = true;
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
