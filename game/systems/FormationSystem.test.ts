import { describe, it, expect, vi } from 'vitest';

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
            },
        },
    };
});

import Phaser from 'phaser';
import { FormationSystem } from './FormationSystem';
import { FormationType } from '../../types';

describe('FormationSystem', () => {
    describe('Canonical local offsets', () => {
        it('returns pure canonical local offsets centered at origin for LINE formation', () => {
            const count = 5;
            const spacing = 10;
            const offsets = FormationSystem.getFormationOffsets(FormationType.LINE, count, spacing);

            expect(offsets.length).toBe(count);
            // Centered on 0 along X axis
            expect(offsets[0].x).toBe(-20);
            expect(offsets[2].x).toBe(0);
            expect(offsets[4].x).toBe(20);
            // Y is 0 for all points in a horizontal line
            offsets.forEach(o => expect(o.y).toBe(0));
        });

        it('returns pure canonical local offsets for BOX formation', () => {
            const count = 4;
            const spacing = 10;
            const offsets = FormationSystem.getFormationOffsets(FormationType.BOX, count, spacing);

            expect(offsets.length).toBe(count);
            // 2x2 grid centered on (0,0)
            const sumX = offsets.reduce((acc, o) => acc + o.x, 0);
            const sumY = offsets.reduce((acc, o) => acc + o.y, 0);
            expect(sumX).toBeCloseTo(0, 5);
            expect(sumY).toBeCloseTo(0, 5);
        });

        it('returns pure canonical local offsets for CIRCLE formation', () => {
            const count = 8;
            const spacing = 10;
            const offsets = FormationSystem.getFormationOffsets(FormationType.CIRCLE, count, spacing);

            expect(offsets.length).toBe(count);
            const sumX = offsets.reduce((acc, o) => acc + o.x, 0);
            const sumY = offsets.reduce((acc, o) => acc + o.y, 0);
            expect(sumX).toBeCloseTo(0, 5);
            expect(sumY).toBeCloseTo(0, 5);
        });

        it('returns pure canonical local offsets centered at centroid for WEDGE formation', () => {
            const count = 6;
            const spacing = 10;
            const offsets = FormationSystem.getFormationOffsets(FormationType.WEDGE, count, spacing);

            expect(offsets.length).toBe(count);
            const sumX = offsets.reduce((acc, o) => acc + o.x, 0);
            const sumY = offsets.reduce((acc, o) => acc + o.y, 0);
            expect(sumX).toBeCloseTo(0, 5);
            expect(sumY).toBeCloseTo(0, 5);
        });

        it('returns pure canonical local offsets for SKIRMISH formation', () => {
            const count = 10;
            const spacing = 10;
            const offsets = FormationSystem.getFormationOffsets(FormationType.SKIRMISH, count, spacing);

            expect(offsets.length).toBe(count);
            expect(offsets[0].x).toBe(0);
            expect(offsets[0].y).toBe(0);
        });
    });

    describe('Double-rotation prevention', () => {
        it('does not rotate offsets even when facingAngleRad is passed to getFormationOffsets', () => {
            const count = 5;
            const spacing = 10;
            const canonical = FormationSystem.getFormationOffsets(FormationType.LINE, count, spacing);
            const withAngle = FormationSystem.getFormationOffsets(FormationType.LINE, count, spacing, Math.PI / 2);

            // getFormationOffsets must return pure canonical offsets without rotating
            // to prevent double-rotation in SquadSystem / UnitSystem
            for (let i = 0; i < count; i++) {
                expect(withAngle[i].x).toBeCloseTo(canonical[i].x, 5);
                expect(withAngle[i].y).toBeCloseTo(canonical[i].y, 5);
            }
        });

        it('allows explicit rotation via rotateFormationOffsets utility method', () => {
            const original = [new Phaser.Math.Vector2(10, 0)];
            const rotated = FormationSystem.rotateFormationOffsets(original, Math.PI / 2);

            expect(rotated[0].x).toBeCloseTo(0, 5);
            expect(rotated[0].y).toBeCloseTo(10, 5);
        });
    });
});
