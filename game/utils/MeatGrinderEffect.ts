/**
 * MeatGrinderEffect - Grounded, tactical clash effect inspired by Total War.
 * Subtle dust, brief camera tremor, audio is the primary feedback.
 */

import Phaser from 'phaser';
import { toIso } from './iso';

const CLASH_COOLDOWN_MS = 400;
let _lastClashAt = 0;
let _bloomPulseActive = false;

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

    // 3. Subtle bloom pulse — very brief, barely noticeable.
    // Driven through the atmospheric system (the only path that affects
    // on-screen bloom). We restore to the LIVE user bloom value at expiry so a
    // bloom-slider change during the pulse is not clobbered by a stale baseline,
    // and guard with a single active pulse so overlapping clashes don't stack.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyScene = scene as any;
    if (anyScene.atmosphericSystem && !_bloomPulseActive) {
        _bloomPulseActive = true;
        anyScene.atmosphericSystem.setBloomIntensity(Math.min(2.0, anyScene.bloomIntensity + 0.3));
        scene.time.delayedCall(600, () => {
            _bloomPulseActive = false;
            anyScene.atmosphericSystem.setBloomIntensity(anyScene.bloomIntensity);
        });
    }

    // 4. Audio — the primary feedback (sword clash + low thud)
    if (anyScene.proceduralSound) {
        anyScene.proceduralSound.playSwordClash(worldX, worldY);
    }
}
