/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
            Between: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
            FloatBetween: (min: number, max: number) => Math.random() * (max - min) + min,
            Linear: (p0: number, p1: number, t: number) => p0 + t * (p1 - p0),
        },
        Scenes: {
            Events: {
                SHUTDOWN: 'shutdown',
            },
        },
        Geom: {
            Rectangle: {
                Clone: (rect: any) => ({ ...rect }),
            },
        },
    },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { Season } from '../../types';
import { AtmosphericSystem } from './AtmosphericSystem';

describe('AtmosphericSystem - Tilt-shift effect', () => {
    let mockScene: any;
    let mockCamera: any;
    let mockPostFX: any;
    let mockTiltShift: any;
    let atmosphericSystem: AtmosphericSystem;

    beforeEach(() => {
        mockTiltShift = {
            blurX: 1,
            blurY: 1,
            radius: 0.2,
            destroy: vi.fn(),
        };

        mockPostFX = {
            addBloom: vi.fn().mockReturnValue({ destroy: vi.fn(), strength: 0.04 }),
            addVignette: vi.fn().mockReturnValue({ destroy: vi.fn() }),
            addColorMatrix: vi.fn().mockReturnValue({
                saturate: vi.fn(),
                brightness: vi.fn(),
                multiply: vi.fn(),
            }),
            addTiltShift: vi.fn().mockImplementation(() => mockTiltShift),
            remove: vi.fn(),
        };

        mockCamera = {
            zoom: 1.0,
            worldView: { x: 0, y: 0, width: 800, height: 600 },
            postFX: mockPostFX,
        };

        const mockGraphics = {
            setDepth: vi.fn(),
            clear: vi.fn(),
            fillStyle: vi.fn(),
            fillRect: vi.fn(),
            destroy: vi.fn(),
        };

        mockScene = {
            textures: {
                createCanvas: vi.fn().mockReturnValue({
                    context: {
                        createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
                        fillStyle: '',
                        fillRect: vi.fn(),
                    },
                    refresh: vi.fn(),
                }),
            },
            add: {
                sprite: vi.fn().mockReturnValue({
                    setDepth: vi.fn(),
                    setAlpha: vi.fn(),
                    setScale: vi.fn(),
                    setRotation: vi.fn(),
                    setVisible: vi.fn(),
                    destroy: vi.fn(),
                }),
                graphics: vi.fn().mockReturnValue(mockGraphics),
            },
            worldLayer: {
                add: vi.fn(),
                postFX: mockPostFX,
            },
            cameras: {
                main: mockCamera,
            },
            events: {
                once: vi.fn(),
            },
        };

        atmosphericSystem = new AtmosphericSystem(mockScene);
    });

    it('1. setTiltShiftEnabled(true) adds the tilt-shift effect when postFX is enabled', () => {
        expect(mockPostFX.addTiltShift).not.toHaveBeenCalled();

        atmosphericSystem.setTiltShiftEnabled(true);

        expect(mockPostFX.addTiltShift).toHaveBeenCalledTimes(1);
        expect(mockPostFX.addTiltShift).toHaveBeenCalledWith(0.5, 1, 1.0, 1, 1, 1);
    });

    it('2. isTiltShiftEnabled() reflects current toggle state', () => {
        expect(atmosphericSystem.isTiltShiftEnabled()).toBe(false);

        atmosphericSystem.setTiltShiftEnabled(true);
        expect(atmosphericSystem.isTiltShiftEnabled()).toBe(true);

        atmosphericSystem.setTiltShiftEnabled(false);
        expect(atmosphericSystem.isTiltShiftEnabled()).toBe(false);
    });

    it('3. setTiltShiftBlur(amount) updates user blur setting and effect blurX/blurY when enabled', () => {
        atmosphericSystem.setTiltShiftEnabled(true);
        expect(atmosphericSystem.getTiltShiftBlur()).toBe(1.0);

        atmosphericSystem.setTiltShiftBlur(2.5);
        expect(atmosphericSystem.getTiltShiftBlur()).toBe(2.5);

        // zoom = 1.0, blurFactor = (1 / 1.0) * 2.5 = 2.5
        // blurX = blurY = clamp(2.5 * 1.2, 0, 2.0) = 2.0
        expect(mockTiltShift.blurX).toBeCloseTo(2.0);
        expect(mockTiltShift.blurY).toBeCloseTo(2.0);
    });

    it('4. setTiltShiftEnabled(false) destroys the effect and clears reference', () => {
        atmosphericSystem.setTiltShiftEnabled(true);
        expect(mockPostFX.addTiltShift).toHaveBeenCalledTimes(1);

        atmosphericSystem.setTiltShiftEnabled(false);
        expect(mockTiltShift.destroy).toHaveBeenCalledTimes(1);

        // Calling setTiltShiftBlur should not attempt to update destroyed effect
        mockTiltShift.blurX = -1;
        atmosphericSystem.setTiltShiftBlur(2.0);
        expect(mockTiltShift.blurX).toBe(-1);
    });

    it('5. setPostFXEnabled(false) destroys the tilt-shift effect, and setPostFXEnabled(true) restores it if tiltShiftEnabled was true', () => {
        atmosphericSystem.setTiltShiftEnabled(true);
        expect(mockPostFX.addTiltShift).toHaveBeenCalledTimes(1);

        atmosphericSystem.setPostFXEnabled(false);
        expect(mockTiltShift.destroy).toHaveBeenCalledTimes(1);

        const newMockTiltShift = {
            blurX: 1,
            blurY: 1,
            radius: 0.2,
            destroy: vi.fn(),
        };
        mockPostFX.addTiltShift.mockReturnValue(newMockTiltShift);

        atmosphericSystem.setPostFXEnabled(true);
        expect(mockPostFX.addTiltShift).toHaveBeenCalledTimes(2);
    });

    it('removes bloom, vignette, and colorGrade from worldLayer.postFX while removing tiltShift from camera.postFX', () => {
        const worldPostFX = {
            addBloom: vi.fn().mockReturnValue({ destroy: vi.fn(), strength: 0.04 }),
            addVignette: vi.fn().mockReturnValue({ destroy: vi.fn() }),
            addColorMatrix: vi.fn().mockReturnValue({
                saturate: vi.fn(),
                brightness: vi.fn(),
                multiply: vi.fn(),
                destroy: vi.fn(),
            }),
            remove: vi.fn(),
        };
        const cameraPostFX = {
            addTiltShift: vi.fn().mockReturnValue(mockTiltShift),
            remove: vi.fn(),
        };
        mockScene.worldLayer.postFX = worldPostFX;
        mockScene.cameras.main.postFX = cameraPostFX;

        const system = new AtmosphericSystem(mockScene);
        system.setTiltShiftEnabled(true);
        system.setPostFXEnabled(false);

        expect(worldPostFX.remove).toHaveBeenCalledTimes(3);
        expect(cameraPostFX.remove).toHaveBeenCalledWith(mockTiltShift);
    });

    it('6. Camera zoom scaling updates blur and radius during update()', () => {
        atmosphericSystem.setTiltShiftEnabled(true);

        // Zoom in to 2.0
        mockCamera.zoom = 2.0;
        atmosphericSystem.update(1000, 16.6);

        // zoom = 2.0
        // blurFactor = (1 / 2.0) * 1.0 = 0.5
        // blurX = blurY = clamp(0.5 * 1.2, 0, 2.0) = 0.6
        // radius = clamp(0.35 * 2.0, 0.1, 1.5) = 0.7
        expect(mockTiltShift.blurX).toBeCloseTo(0.6);
        expect(mockTiltShift.blurY).toBeCloseTo(0.6);
        expect(mockTiltShift.radius).toBeCloseTo(0.7);

        // Zoom out to 0.5
        mockCamera.zoom = 0.5;
        atmosphericSystem.update(2000, 16.6);

        // zoom = 0.5
        // blurFactor = (1 / 0.5) * 1.0 = 2.0
        // blurX = blurY = clamp(2.0 * 1.2, 0, 2.0) = 2.0
        // radius = clamp(0.35 * 0.5, 0.1, 1.5) = 0.175
        expect(mockTiltShift.blurX).toBeCloseTo(2.0);
        expect(mockTiltShift.blurY).toBeCloseTo(2.0);
        expect(mockTiltShift.radius).toBeCloseTo(0.175);
    });

    it('7. applySeasonalTint updates seasonal wind multiplier and scales canopy wind sway', () => {
        expect(atmosphericSystem.getSeasonalWindMultiplier()).toBe(1.0);

        atmosphericSystem.applySeasonalTint(Season.SUMMER);
        expect(atmosphericSystem.getSeasonalWindMultiplier()).toBeCloseTo(0.7);
        const summerPeak = Math.max(
            Math.abs(atmosphericSystem.getWindSway(120, 80, 500)),
            Math.abs(atmosphericSystem.getWindSway(120, 80, 1400)),
        );

        atmosphericSystem.applySeasonalTint(Season.WINTER);
        expect(atmosphericSystem.getSeasonalWindMultiplier()).toBeCloseTo(1.6);
        const winterPeak = Math.max(
            Math.abs(atmosphericSystem.getWindSway(120, 80, 500)),
            Math.abs(atmosphericSystem.getWindSway(120, 80, 1400)),
        );

        expect(winterPeak).toBeGreaterThan(summerPeak);
    });
});
