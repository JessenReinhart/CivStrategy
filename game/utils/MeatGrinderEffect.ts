/**
 * MeatGrinderEffect - Grounded, tactical clash effect inspired by Total War.
 * Subtle dust, brief camera tremor, audio is the primary feedback.
 */

import Phaser from 'phaser';
import { toIso } from './iso';

const CLASH_COOLDOWN_MS = 400;
const CLASH_MAX_SHAKE_DISTANCE_PX = 500;
const CLASH_MAX_SHAKE_INTENSITY = 0.0045;
const CLASH_MIN_SHAKE_INTENSITY = 0.0012;
let _lastClashAt = 0;
let _bloomPulseActive = false;

/**
 * Compute distance-attenuated camera shake intensity for an isometric clash.
 * Returns 0 when the clash is outside maxDistancePx, or a smooth falloff
 * between CLASH_MIN_SHAKE_INTENSITY and CLASH_MAX_SHAKE_INTENSITY inside it.
 */
function computeClashShakeIntensity(
    distancePx: number,
    maxDistancePx: number = CLASH_MAX_SHAKE_DISTANCE_PX,
): number {
    if (!Number.isFinite(distancePx) || distancePx < 0 || maxDistancePx <= 0 || distancePx >= maxDistancePx) {
        return 0;
    }
    const proximity = 1 - distancePx / maxDistancePx;
    return CLASH_MIN_SHAKE_INTENSITY + (CLASH_MAX_SHAKE_INTENSITY - CLASH_MIN_SHAKE_INTENSITY) * proximity;
}

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

    // 1. Distance-attenuated camera tremor — heavier at screen center, subtle near edges
    const cam = scene.cameras.main;
    const dx = iso.x - cam.scrollX - cam.width / 2;
    const dy = iso.y - cam.scrollY - cam.height / 2;
    const shakeIntensity = computeClashShakeIntensity(Math.hypot(dx, dy));
    if (shakeIntensity > 0) {
        cam.shake(200, shakeIntensity);
    }

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

        // Directional metallic clash sparks above the dust plume
        const sparks = scene.add.particles(iso.x, iso.y - 2, 'smoke', {
            speed: { min: 35, max: 85 },
            angle: { min: 200, max: 340 },
            scale: { start: 0.045, end: 0.01 },
            alpha: { start: 0.85, end: 0 },
            tint: [0xffe082, 0xffb74d, 0xffffff],
            lifespan: 340,
            quantity: 6,
            emitting: false,
            gravityY: 90
        });
        sparks.setDepth(iso.y + 505);
        sparks.explode(6, iso.x, iso.y - 2);
        scene.time.delayedCall(400, () => sparks.destroy());
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
