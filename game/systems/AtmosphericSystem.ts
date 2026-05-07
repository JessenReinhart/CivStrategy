
import Phaser from 'phaser';
import { MainScene } from '../MainScene';

export class AtmosphericSystem {
    private scene: MainScene;
    public clouds: Phaser.GameObjects.Sprite[] = [];

    private bloomEffect!: Phaser.FX.Bloom;
    private tiltShiftEffect!: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private vignetteEffect!: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private cloudTextureKey = 'cloud-puff';
    private cloudCount = 20;

    // Store user's desired bloom multiplier so adaptive logic doesn't overwrite it
    private userBloomMultiplier: number = 1.0;

    constructor(scene: MainScene) {
        this.scene = scene;
        this.createCloudTexture();
        this.createClouds();
        this.setupBloom();
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
            cloud.setAlpha(Phaser.Math.FloatBetween(0.1, 0.25));
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
        // Use worldLayer for PostFX if available
        const target = this.scene.worldLayer ? this.scene.worldLayer.postFX : this.scene.cameras.main.postFX;

        this.bloomEffect = target.addBloom(0xffffff, 1, 1, 1.2, 1.0);
        this.tiltShiftEffect = target.addTiltShift(0.1); // Initial blur
        this.vignetteEffect = target.addVignette(0.5, 0.5, 0.8, 0.3); // x, y, radius, strength
    }

    public setBloomIntensity(intensity: number) {
        // Store user preference as a multiplier (range ~0.0 to 3.0)
        this.userBloomMultiplier = intensity;
    }

    public update(time: number, delta: number) {
        const cam = this.scene.cameras.main;
        const viewRect = cam.worldView;

        // --- Adaptive Bloom Logic ---
        if (this.bloomEffect) {
            // 1. Zoom Adaptation:
            // High Zoom (1.5x) -> Focused on units -> Less dynamic range
            // Low Zoom (0.5x) -> High view -> More dynamic range for atmosphere
            const zoomProgress = Phaser.Math.Clamp((cam.zoom - 0.5) / 1.5, 0, 1);

            // Base dynamic target: zoomed-out = more bloom, zoomed-in = less bloom
            const baseStrength = Phaser.Math.Linear(1.5, 0.6, zoomProgress);

            // 2. "Breathing" Pulse (Simulate light intensity variance)
            const pulse = Math.sin(time * 0.002) * 0.05;

            // 3. Combine dynamic base with user's multiplier
            // User slider (0.0 to 3.0) acts as a global multiplier on the dynamic target
            const dynamicTarget = Phaser.Math.Clamp(baseStrength + pulse, 0.1, 2.0);
            const target = Phaser.Math.Clamp(dynamicTarget * this.userBloomMultiplier, 0.0, 4.0);

            // Smooth lerp (Eye Adaptation Speed) — fast enough to feel responsive
            this.bloomEffect.strength = Phaser.Math.Linear(this.bloomEffect.strength, target, 0.08);
        }

        // --- Tilt Shift Logic ---
        if (this.tiltShiftEffect) {
            // Zoom Adaptation:
            // High Zoom (1.5x) -> Close up -> Strong Depth of Field -> High Blur
            // Low Zoom (0.5x) -> Far away -> Clearer view -> Low Blur
            const zoomProgress = Phaser.Math.Clamp((cam.zoom - 0.5) / 1.5, 0, 1);

            // Blur strength range: 0.1 (Far) to 2.5 (Close)
            // Blur strength range: 0.1 (Far) to 2.5 (Close)
            // Use sqrt to ramp up blur quickly as we zoom in, so mid-zoom still feels "diaroma-like"
            const easedProgress = Math.sqrt(zoomProgress);
            const targetBlur = Phaser.Math.Linear(0.1, 2.5, easedProgress);

            this.tiltShiftEffect.blur = Phaser.Math.Linear(this.tiltShiftEffect.blur, targetBlur, 0.1);
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

        const speed = 2 * (delta / 16.6); // Increased speed for visibility (was 0.2)

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
