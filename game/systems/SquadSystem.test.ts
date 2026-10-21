/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SquadSystem, SoldierState } from './SquadSystem';
import { UnitType, UnitState, GameUnit } from '../../types';

// Mock Phaser math and utilities
vi.mock('phaser', () => {
    class MockVector2 {
        x: number;
        y: number;
        constructor(x = 0, y = 0) {
            this.x = x;
            this.y = y;
        }
    }

    return {
        default: {
            Math: {
                Vector2: MockVector2,
                Linear: (a: number, b: number, t: number) => a + (b - a) * t,
                Angle: {
                    Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
                    RotateTo: (current: number, target: number, step: number) => {
                        let diff = (target - current) % (Math.PI * 2);
                        if (diff < -Math.PI) diff += Math.PI * 2;
                        if (diff > Math.PI) diff -= Math.PI * 2;
                        if (Math.abs(diff) <= step) return target;
                        return current + Math.sign(diff) * step;
                    },
                },
            },
        },
    };
});

function createMockSprite() {
    const sprite = {
        x: 0,
        y: 0,
        flipX: false,
        visible: true,
        active: true,
        texture: { key: 'unit_pikesman' },
        setPosition: vi.fn((x: number, y: number) => {
            sprite.x = x;
            sprite.y = y;
            return sprite;
        }),
        setFlipX: vi.fn((flipped: boolean) => {
            sprite.flipX = flipped;
            return sprite;
        }),
        setVisible: vi.fn((v: boolean) => {
            sprite.visible = v;
            return sprite;
        }),
        setActive: vi.fn((a: boolean) => {
            sprite.active = a;
            return sprite;
        }),
        clearTint: vi.fn(() => sprite),
        setOrigin: vi.fn(() => sprite),
        setScale: vi.fn(() => sprite),
    };
    return sprite;
}

function createMockGraphics() {
    return {
        clear: vi.fn(),
        lineStyle: vi.fn(),
        fillStyle: vi.fn(),
        strokeEllipse: vi.fn(),
        fillCircle: vi.fn(),
        fillRect: vi.fn(),
        fillEllipse: vi.fn(),
    };
}

function createMockContainer() {
    const children: any[] = [];
    const container = {
        x: 0,
        y: 0,
        depth: 0,
        visible: true,
        length: 0,
        setPosition: vi.fn((x: number, y: number) => {
            container.x = x;
            container.y = y;
            return container;
        }),
        setDepth: vi.fn((d: number) => {
            container.depth = d;
            return container;
        }),
        setVisible: vi.fn((v: boolean) => {
            container.visible = v;
            return container;
        }),
        add: vi.fn((child: any) => {
            children.push(child);
            container.length = children.length;
            return container;
        }),
        remove: vi.fn((child: any) => {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            container.length = children.length;
            return container;
        }),
        getAt: vi.fn((idx: number) => children[idx]),
        destroy: vi.fn(),
    };
    return container;
}

function createMockBlitter() {
    const bobs: any[] = [];
    return {
        clear: vi.fn(() => {
            bobs.length = 0;
        }),
        create: vi.fn((x: number, y: number) => {
            const bob = { x, y, tint: 0xffffff };
            bobs.push(bob);
            return bob;
        }),
        setDepth: vi.fn(),
    };
}

function createMockUnit(opts: {
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    type?: UnitType;
    hp?: number;
    maxHp?: number;
    owner?: number;
    state?: UnitState;
    formationAngle?: number;
    squadSize?: number;
} = {}): GameUnit {
    const data: Record<string, any> = {
        hp: opts.hp ?? 100,
        maxHp: opts.maxHp ?? 100,
        owner: opts.owner ?? 0,
        unitType: opts.type ?? UnitType.PIKESMAN,
        formationAngle: opts.formationAngle ?? 0,
    };

    const count = opts.squadSize ?? 4;
    const soldiers: SoldierState[] = [];
    const sprites: any[] = [];
    for (let i = 0; i < count; i++) {
        soldiers.push({
            x: opts.x ?? 100,
            y: opts.y ?? 100,
            z: 0,
            offset: { x: (i - count / 2) * 10, y: 0 },
        });
        sprites.push(createMockSprite());
    }

    const container = createMockContainer();
    container.add(createMockGraphics()); // Selection graphic at end of container
    data.soldierStates = soldiers;
    data.soldierSprites = sprites;
    data.squadContainer = container;

    const unit = {
        x: opts.x ?? 100,
        y: opts.y ?? 100,
        unitType: opts.type ?? UnitType.PIKESMAN,
        state: opts.state ?? UnitState.IDLE,
        isSelected: false,
        target: null,
        body: opts.vx !== undefined || opts.vy !== undefined ? {
            velocity: {
                x: opts.vx ?? 0,
                y: opts.vy ?? 0,
                length: () => Math.hypot(opts.vx ?? 0, opts.vy ?? 0),
                angle: () => Math.atan2(opts.vy ?? 0, opts.vx ?? 0),
            },
        } : null,
        getData: (key: string) => data[key],
        setData: (key: string, val: any) => {
            data[key] = val;
            return unit;
        },
    } as unknown as GameUnit;

    return unit;
}

describe('SquadSystem', () => {
    let mockScene: any;
    let terrainHeights: { interpolated: number; at: number };

    beforeEach(() => {
        terrainHeights = { interpolated: 1.5, at: 1.0 };
        mockScene = {
            add: {
                blitter: () => createMockBlitter(),
                container: () => createMockContainer(),
                sprite: () => createMockSprite(),
            },
            worldLayer: { add: vi.fn() },
            worldVisuals: { add: vi.fn() },
            uiCamera: { ignore: vi.fn() },
            cameras: {
                main: {
                    getWorldPoint: () => ({ x: 0, y: 0 }),
                    zoom: 1.0,
                    width: 800,
                    height: 600,
                },
            },
            time: { now: 1000 },
            terrainSystem: {
                getHeightInterpolated: vi.fn((_x: number, _y: number) => terrainHeights.interpolated),
                getHeightAt: vi.fn((_x: number, _y: number) => terrainHeights.at),
            },
            getFactionColor: () => 0x3b82f6,
            units: {
                getChildren: vi.fn(() => []),
            },
            stressTestConfig: null,
        };
    });

    describe('Task 1: Frame-rate independent soldier lerping & rotation scaling', () => {
        it('uses delta-time based exponential decay for soldier positions', () => {
            const squadSystem = new SquadSystem(mockScene);
            const unit = createMockUnit({ x: 200, y: 200, vx: 50, vy: 0 });
            mockScene.units.getChildren = () => [unit];

            const soldiers = unit.getData('soldierStates') as SoldierState[];
            // Place soldier far from target
            soldiers[0].x = 0;
            soldiers[0].y = 0;

            // Update with 60 Hz frame (16.6ms)
            squadSystem.update(16.6);
            const xAfter60Hz = soldiers[0].x;
            expect(xAfter60Hz).toBeGreaterThan(0);

            // Reset soldier position
            soldiers[0].x = 0;
            soldiers[0].y = 0;

            // Update with 30 Hz frame (33.3ms) - larger time step means more distance covered per frame
            squadSystem.update(33.3);
            const xAfter30Hz = soldiers[0].x;
            expect(xAfter30Hz).toBeGreaterThan(xAfter60Hz);
        });

        it('scales squad rotation rate with dt instead of static 0.1 radians', () => {
            const squadSystem = new SquadSystem(mockScene);
            // Unit moving with velocity angle = PI/2, current formation angle = 0
            const unit = createMockUnit({ x: 100, y: 100, vx: 0, vy: 50, formationAngle: 0 });
            mockScene.units.getChildren = () => [unit];

            // 60 Hz (16.6ms): rotation step is approx 6.0 * (16.6/1000) ~= 0.1 rad
            squadSystem.update(16.6);
            const angle60Hz = unit.getData('formationAngle') as number;
            expect(angle60Hz).toBeCloseTo(0.1, 1);

            // Reset formation angle
            unit.setData('formationAngle', 0);
            // 30 Hz (33.3ms): rotation step is approx 6.0 * (33.3/1000) ~= 0.2 rad
            squadSystem.update(33.3);
            const angle30Hz = unit.getData('formationAngle') as number;
            expect(angle30Hz).toBeCloseTo(0.2, 1);
            expect(angle30Hz).toBeGreaterThan(angle60Hz * 1.5);
        });
    });

    describe('Task 2: Isometric screen-space facing flip', () => {
        it('flips sprite when isometric screen velocity is negative (screenVx < 0) despite Cartesian vx > 0', () => {
            const squadSystem = new SquadSystem(mockScene);
            // Cartesian vx = 20 > 0, vy = 60 > 0.
            // In isometric projection: screenVx = vx - vy = 20 - 60 = -40 < 0 (moving screen-left).
            const unit = createMockUnit({ x: 100, y: 100, vx: 20, vy: 60 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.update(16.6);

            const sprites = unit.getData('soldierSprites') as any[];
            // Must be flipped because it is moving to screen-space left
            expect(sprites[0].setFlipX).toHaveBeenCalledWith(true);
        });

        it('does not flip sprite when isometric screen velocity is positive (screenVx > 0) despite Cartesian vx < 0', () => {
            const squadSystem = new SquadSystem(mockScene);
            // Cartesian vx = -20 < 0, vy = -60 < 0.
            // In isometric projection: screenVx = vx - vy = -20 - (-60) = +40 > 0 (moving screen-right).
            const unit = createMockUnit({ x: 100, y: 100, vx: -20, vy: -60 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.update(16.6);

            const sprites = unit.getData('soldierSprites') as any[];
            // Must NOT be flipped because it is moving to screen-space right
            expect(sprites[0].setFlipX).toHaveBeenCalledWith(false);
        });

        it('uses isometric screen direction for stationary units from formationAngle', () => {
            const squadSystem = new SquadSystem(mockScene);
            // Stationary unit facing angle = 1.2 rad (~68 deg).
            // cos(1.2) = 0.362, sin(1.2) = 0.932.
            // screenDirX = cos - sin = 0.362 - 0.932 = -0.57 < 0 -> screen-left.
            const unit = createMockUnit({ x: 100, y: 100, formationAngle: 1.2 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.update(16.6);

            const sprites = unit.getData('soldierSprites') as any[];
            expect(sprites[0].setFlipX).toHaveBeenCalledWith(true);
        });
    });

    describe('Task 3: Continuous terrain elevation', () => {
        it('calls getHeightInterpolated in syncPositions and eliminates elevation popping', () => {
            const squadSystem = new SquadSystem(mockScene);
            const unit = createMockUnit({ x: 150, y: 250 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.syncPositions();

            expect(mockScene.terrainSystem.getHeightInterpolated).toHaveBeenCalledWith(150, 250);
            expect(mockScene.terrainSystem.getHeightAt).not.toHaveBeenCalled();
        });

        it('calls getHeightInterpolated during squad rendering', () => {
            const squadSystem = new SquadSystem(mockScene);
            const unit = createMockUnit({ x: 150, y: 250 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.update(16.6);

            expect(mockScene.terrainSystem.getHeightInterpolated).toHaveBeenCalled();
            expect(mockScene.terrainSystem.getHeightAt).not.toHaveBeenCalled();
        });
    });

    describe('Task 4: LOD hysteresis', () => {
        it('prevents sprite popping near LOD_FULL (800px) threshold using +/- 50px margin', () => {
            const squadSystem = new SquadSystem(mockScene);
            // Camera at (0, 0), zoom 1.0
            // Unit at (790, 0) -> dist = 790px (< 800) -> initial LOD is LOD_FULL (0)
            const unit = createMockUnit({ x: 790, y: 0 });
            mockScene.units.getChildren = () => [unit];

            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(0); // LOD_FULL

            // Distance increases to 820px (> 800, but < 800 + 50 = 850)
            // Due to hysteresis margin, it must stay in LOD_FULL
            unit.x = 820;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(0); // Still LOD_FULL! No popping!

            // Distance exceeds 850px -> transitions to LOD_MEDIUM (1)
            unit.x = 860;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(1); // LOD_MEDIUM

            // Distance decreases to 780px (< 800, but > 800 - 50 = 750)
            // Due to hysteresis margin, it must stay in LOD_MEDIUM
            unit.x = 780;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(1); // Still LOD_MEDIUM! No popping!

            // Distance drops below 750px -> transitions back to LOD_FULL
            unit.x = 740;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(0); // LOD_FULL
        });

        it('applies hysteresis at LOD_MEDIUM (1500px) and LOD_LOW (3000px) boundaries', () => {
            const squadSystem = new SquadSystem(mockScene);
            const unit = createMockUnit({ x: 1450, y: 0 });
            mockScene.units.getChildren = () => [unit];

            // Initial: 1450px -> LOD_MEDIUM (1)
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(1);

            // Moves to 1520px (< 1500 + 50 = 1550) -> stays LOD_MEDIUM
            unit.x = 1520;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(1);

            // Moves to 1560px (> 1550) -> transitions to LOD_LOW (2)
            unit.x = 1560;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(2);

            // Moves to 1480px (> 1450) -> stays LOD_LOW
            unit.x = 1480;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(2);

            // Moves to 1440px (< 1450) -> transitions back to LOD_MEDIUM
            unit.x = 1440;
            squadSystem.update(16.6);
            expect(unit.getData('squadLod')).toBe(1);
        });
    });
});
