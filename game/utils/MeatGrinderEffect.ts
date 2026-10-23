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

/**
 * R22: cooldown/bloom state and the two particle emitters are owned per-scene
 * (WeakMap) instead of leaking through module globals. Emitters are pooled so
 * repeated clashes reuse them instead of creating/destroying particle systems.
 */
interface ClashEffectState {
    lastClashAt: number;
    bloomPulseActive: boolean;
    dust: Phaser.GameObjects.Particles.ParticleEmitter | null;
    sparks: Phaser.GameObjects.Particles.ParticleEmitter | null;
}

const sceneStates = new WeakMap<Phaser.Scene, ClashEffectState>();

function getClashState(scene: Phaser.Scene): ClashEffectState {
    let state = sceneStates.get(scene);
    if (!state) {
        state = { lastClashAt: 0, bloomPulseActive: false, dust: null, sparks: null };
        sceneStates.set(scene, state);
    }
    return state;
}

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
    const state = getClashState(scene);

    // Cooldown — only one clash per 400ms to prevent effect stacking
    const now = Date.now();
    if (now - state.lastClashAt < CLASH_COOLDOWN_MS) {
        // Still play the audio snippet since it's the primary feedback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = scene as any;
        if (s.proceduralSound) s.proceduralSound.playSwordClash(worldX, worldY);
        return;
    }
    state.lastClashAt = now;

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
        if (!state.dust) {
            state.dust = scene.add.particles(0, 0, 'smoke', {
                speed: { min: 15, max: 40 },
                angle: { min: 0, max: 360 },
                scale: { start: 0.08, end: 0.25 },
                alpha: { start: 0.45, end: 0 },
                tint: [0x8b7355, 0x9e8c70, 0x7a6a50], // earthy browns
                lifespan: 800,
                emitting: false,
                gravityY: -30, // drift upward gently
            });
        }
        state.dust.setDepth(iso.y + 500);
        state.dust.explode(8, iso.x, iso.y + 10);

        // Directional metallic clash sparks above the dust plume
        if (!state.sparks) {
            state.sparks = scene.add.particles(0, 0, 'smoke', {
                speed: { min: 35, max: 85 },
                angle: { min: 200, max: 340 },
                scale: { start: 0.045, end: 0.01 },
                alpha: { start: 0.85, end: 0 },
                tint: [0xffe082, 0xffb74d, 0xffffff],
                lifespan: 340,
                emitting: false,
                gravityY: 90,
            });
        }
        state.sparks.setDepth(iso.y + 505);
        state.sparks.explode(6, iso.x, iso.y - 2);
    }

    // 3. Subtle bloom pulse — driven through the atmospheric system. Per-scene
    // guard so overlapping clashes in one scene don't stack, and different
    // scenes don't share a stale flag.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyScene = scene as any;
    if (anyScene.atmosphericSystem && !state.bloomPulseActive) {
        state.bloomPulseActive = true;
        anyScene.atmosphericSystem.setBloomIntensity(Math.min(2.0, anyScene.bloomIntensity + 0.3));
        scene.time.delayedCall(600, () => {
            state.bloomPulseActive = false;
            anyScene.atmosphericSystem.setBloomIntensity(anyScene.bloomIntensity);
        });
    }

    // 4. Audio — the primary feedback (sword clash + low thud)
    if (anyScene.proceduralSound) {
        anyScene.proceduralSound.playSwordClash(worldX, worldY);
    }
}