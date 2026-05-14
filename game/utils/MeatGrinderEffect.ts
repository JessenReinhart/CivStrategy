/**
 * MeatGrinderEffect - Grounded, tactical clash effect inspired by Total War.
 * Subtle dust, brief camera tremor, audio is the primary feedback.
 */

import Phaser from 'phaser';
import { toIso } from './iso';

const CLASH_COOLDOWN_MS = 400;
let _lastClashAt = 0;

export function triggerMeatGrinder(scene: Phaser.Scene, worldX: number, worldY: number): void {
    // Cooldown — only one clash per 400ms to prevent effect stacking
    const now = Date.now();
    if (now - _lastClashAt < CLASH_COOLDOWN_MS) {
        // Still play the audio snippet since it's the primary feedback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = scene as any;
        if (s.proceduralSound) s.proceduralSound.playSwordClash(worldX, worldY);
        return;
    }
    _lastClashAt = now;

    const iso = toIso(worldX, worldY);

    // 1. Subtle camera tremor — tight, grounded, like a heavy thud
    scene.cameras.main.shake(200, 0.004);

    // 2. Ground dust plume at clash point (uses 'smoke' texture)
    if (scene.textures.exists('smoke')) {
        const dust = scene.add.particles(iso.x, iso.y + 10, 'smoke', {
            speed: { min: 15, max: 40 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.08, end: 0.25 },
            alpha: { start: 0.45, end: 0 },
            tint: [0x8b7355, 0x9e8c70, 0x7a6a50], // earthy browns
            lifespan: 800,
            quantity: 8,
            emitting: false,
            gravityY: -30 // drift upward gently
        });
        dust.setDepth(iso.y + 500);
        dust.explode(8, iso.x, iso.y + 10);
        scene.time.delayedCall(900, () => dust.destroy());
    }

    // 3. Subtle bloom pulse — very brief, barely noticeable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyScene = scene as any;
    if (anyScene.atmosphericSystem) {
        const original = anyScene.bloomIntensity;
        anyScene.bloomIntensity = Math.min(2.0, original + 0.3);
        scene.time.delayedCall(600, () => {
            anyScene.bloomIntensity = original;
        });
    }

    // 4. Audio — the primary feedback (sword clash + low thud)
    if (anyScene.proceduralSound) {
        anyScene.proceduralSound.playSwordClash(worldX, worldY);
    }
}
