/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Between: (min: number, max: number) => Math.floor((min + max) / 2),
        },
    },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { FeedbackSystem } from './FeedbackSystem';
import { toIso, toIsoElev } from '../utils/iso';

describe('FeedbackSystem - Elevation-aware visual feedback', () => {
    let mockScene: any;
    let feedbackSystem: FeedbackSystem;
    let addedTexts: any[];
    let addedArcs: any[];
    let addedTweens: any[];

    beforeEach(() => {
        addedTexts = [];
        addedArcs = [];
        addedTweens = [];

        mockScene = {
            events: {
                on: vi.fn(),
                off: vi.fn(),
            },
            add: {
                text: vi.fn().mockImplementation(() => {
                    const obj: any = {
                        x: 0,
                        y: 0,
                        text: '',
                        color: '',
                        active: true,
                        visible: true,
                        alpha: 1,
                        scale: 1,
                        originX: 0,
                        originY: 0,
                        depth: 0,
                        setText(t: string) { obj.text = t; return obj; },
                        setColor(c: string) { obj.color = c; return obj; },
                        setPosition(x: number, y: number) { obj.x = x; obj.y = y; return obj; },
                        setOrigin(ox: number, oy: number = ox) { obj.originX = ox; obj.originY = oy; return obj; },
                        setDepth(d: number) { obj.depth = d; return obj; },
                        setActive(a: boolean) { obj.active = a; return obj; },
                        setVisible(v: boolean) { obj.visible = v; return obj; },
                        setAlpha(a: number) { obj.alpha = a; return obj; },
                        setScale(s: number) { obj.scale = s; return obj; },
                        destroy: vi.fn(),
                    };
                    addedTexts.push(obj);
                    return obj;
                }),
                circle: vi.fn().mockImplementation(() => {
                    const obj: any = {
                        x: 0,
                        y: 0,
                        radius: 0,
                        color: 0,
                        alpha: 1,
                        active: true,
                        visible: true,
                        scaleX: 1,
                        scaleY: 1,
                        depth: 0,
                        setFillStyle(c: number, a: number = 1) { obj.color = c; obj.alpha = a; return obj; },
                        setRadius(r: number) { obj.radius = r; return obj; },
                        setPosition(x: number, y: number) { obj.x = x; obj.y = y; return obj; },
                        setScale(sx: number, sy: number = sx) { obj.scaleX = sx; obj.scaleY = sy; return obj; },
                        setDepth(d: number) { obj.depth = d; return obj; },
                        setActive(a: boolean) { obj.active = a; return obj; },
                        setVisible(v: boolean) { obj.visible = v; return obj; },
                        setAlpha(a: number) { obj.alpha = a; return obj; },
                        destroy: vi.fn(),
                    };
                    addedArcs.push(obj);
                    return obj;
                }),
            },
            tweens: {
                add: vi.fn().mockImplementation((config: any) => {
                    addedTweens.push(config);
                    return config;
                }),
            },
            terrainSystem: {
                getHeightInterpolated: vi.fn().mockReturnValue(0),
            },
        };

        feedbackSystem = new FeedbackSystem(mockScene);
    });

    it('positions damage numbers elevated according to terrain height', () => {
        const x = 200;
        const y = 300;
        const terrainH = 0.8;
        mockScene.terrainSystem.getHeightInterpolated.mockReturnValue(terrainH);

        feedbackSystem.showDamageNumber(x, y, 45, 'Hack');

        expect(mockScene.terrainSystem.getHeightInterpolated).toHaveBeenCalledWith(x, y);
        expect(addedTexts.length).toBe(1);

        const expectedIso = toIsoElev(x, y, terrainH);
        const flatIso = toIso(x, y);

        // Height lift should elevate the y position (y is smaller) compared to flat iso
        expect(expectedIso.y).toBeLessThan(flatIso.y);

        // Text Y is set to iso.y - 30
        const text = addedTexts[0];
        expect(text.y).toBeCloseTo(expectedIso.y - 30, 1);
        expect(text.text).toBe('-45');
    });

    it('positions floating text with terrain elevation', () => {
        const x = 150;
        const y = 250;
        const terrainH = 0.6;
        mockScene.terrainSystem.getHeightInterpolated.mockReturnValue(terrainH);

        feedbackSystem.showFloatingText(x, y, 'Level Up!', '#ffff00');

        const expectedIso = toIsoElev(x, y, terrainH);
        const text = addedTexts[0];
        expect(text.y).toBeCloseTo(expectedIso.y - 50, 1);
        expect(text.text).toBe('Level Up!');
    });

    it('positions hit sparks with terrain elevation', () => {
        const x = 120;
        const y = 180;
        const terrainH = 0.75;
        mockScene.terrainSystem.getHeightInterpolated.mockReturnValue(terrainH);

        feedbackSystem.showHitSpark(x, y, 'Pierce');

        expect(addedArcs.length).toBe(3);
        const expectedIso = toIsoElev(x, y, terrainH);
        for (const spark of addedArcs) {
            // Spark positions are around iso.x and iso.y with a jitter of [-8, 8]
            expect(Math.abs(spark.x - expectedIso.x)).toBeLessThanOrEqual(10);
            expect(Math.abs(spark.y - expectedIso.y)).toBeLessThanOrEqual(10);
        }
    });

    it('positions hit flash with terrain elevation', () => {
        const x = 100;
        const y = 100;
        const terrainH = 0.5;
        mockScene.terrainSystem.getHeightInterpolated.mockReturnValue(terrainH);

        feedbackSystem.showHitFlash(x, y);

        const expectedIso = toIsoElev(x, y, terrainH);
        const flash = addedArcs[0];
        expect(flash.x).toBeCloseTo(expectedIso.x, 1);
        expect(flash.y).toBeCloseTo(expectedIso.y - 20, 1);
    });

    it('positions death effects (ring and flash) with terrain elevation', () => {
        const x = 80;
        const y = 160;
        const terrainH = 0.9;
        mockScene.terrainSystem.getHeightInterpolated.mockReturnValue(terrainH);

        feedbackSystem.showDeathEffect(x, y, 0xff0000);

        const expectedIso = toIsoElev(x, y, terrainH);
        // Both deathRing and deathFlash are acquired
        expect(addedArcs.length).toBe(2);
        const ring = addedArcs[0];
        const flash = addedArcs[1];
        expect(ring.x).toBeCloseTo(expectedIso.x, 1);
        expect(ring.y).toBeCloseTo(expectedIso.y, 1);
        expect(flash.x).toBeCloseTo(expectedIso.x, 1);
        expect(flash.y).toBeCloseTo(expectedIso.y, 1);
    });

    it('gracefully handles missing terrainSystem by using h = 0', () => {
        mockScene.terrainSystem = undefined;
        const x = 100;
        const y = 100;

        expect(() => {
            feedbackSystem.showDamageNumber(x, y, 20);
        }).not.toThrow();

        const expectedIso = toIsoElev(x, y, 0);
        const text = addedTexts[0];
        expect(text.y).toBeCloseTo(expectedIso.y - 30, 1);
    });
});
