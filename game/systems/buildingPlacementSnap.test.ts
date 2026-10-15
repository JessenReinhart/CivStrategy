import { describe, expect, it } from 'vitest';

import { toCartesian, toIso } from '../utils/iso';
import {
    formatBuildingPlacementFeedback,
    resolveCursorAlignedPlacement,
    snapWallToAdjacentSegment,
} from './buildingPlacementSnap';
const GRID = 16;

function finalManagerCenter(inputWorldX: number, inputWorldY: number, width: number, height: number) {
    const cart = toCartesian(inputWorldX, inputWorldY);
    return {
        x: Math.floor(cart.x / GRID) * GRID + width / 2,
        y: Math.floor(cart.y / GRID) * GRID + height / 2,
    };
}

describe('cursor-aligned building placement', () => {
    it.each([
        ['House', 32, 32],
        ['Barracks', 48, 48],
        ['Farm', 64, 64],
    ])('keeps %s within half a grid cell of the pointer', (_name, width, height) => {
        const cursorCart = { x: 517, y: 493 };
        const cursor = toIso(cursorCart.x, cursorCart.y);
        const placement = resolveCursorAlignedPlacement(cursor.x, cursor.y, width, height, GRID);
        const finalCenter = finalManagerCenter(placement.inputWorldX, placement.inputWorldY, width, height);

        expect(finalCenter).toEqual({ x: placement.centerX, y: placement.centerY });
        expect(Math.abs(finalCenter.x - cursorCart.x)).toBeLessThanOrEqual(GRID / 2);
        expect(Math.abs(finalCenter.y - cursorCart.y)).toBeLessThanOrEqual(GRID / 2);
        expect((finalCenter.x - width / 2) % GRID).toBe(0);
        expect((finalCenter.y - height / 2) % GRID).toBe(0);
    });

    it.each([
        ['House', 32],
        ['Barracks', 48],
        ['Farm', 64],
    ])('preserves exact edge adjacency for %s', (_name, extent) => {
        const firstCursor = toIso(501, 509);
        const secondCursor = toIso(501 + extent, 509);
        const first = resolveCursorAlignedPlacement(firstCursor.x, firstCursor.y, extent, extent, GRID);
        const second = resolveCursorAlignedPlacement(secondCursor.x, secondCursor.y, extent, extent, GRID);

        expect(second.centerX - first.centerX).toBe(extent);
        expect(second.centerY).toBe(first.centerY);
    });
});

describe('formatBuildingPlacementFeedback', () => {
    it('shows placement rejection reason directly on the ghost', () => {
        expect(formatBuildingPlacementFeedback({ valid: false, reason: 'Outside Territory' })).toBe('Outside Territory');
        expect(formatBuildingPlacementFeedback({ valid: false, reason: 'Terrain too steep' })).toBe('Terrain too steep');
        expect(formatBuildingPlacementFeedback({ valid: false, reason: 'Space Occupied' })).toBe('Space Occupied');
    });

    it('shows fertility context for valid farm placement', () => {
        expect(formatBuildingPlacementFeedback({ valid: true, farmYield: 1.2 })).toBe('Fertility ×1.2 · Click to place');
    });

    it('shows resource proximity bonus when available', () => {
        expect(formatBuildingPlacementFeedback({ valid: true, resourceBonus: 'Dense Forest +25%' })).toBe('Dense Forest +25% · Click to place');
    });

    it('shows default click-to-place instruction for other valid buildings', () => {
        expect(formatBuildingPlacementFeedback({ valid: true })).toBe('Click to place');
    });
});

describe('snapWallToAdjacentSegment', () => {
    it('snaps to adjacent edge when within snap radius', () => {
        const existing = [{ x: 100, y: 100, width: 32, height: 32 }];
        // Cursor at 134, 102 (close to right edge at x=132, y=100)
        const result = snapWallToAdjacentSegment(134, 102, 32, 32, existing, 24);
        expect(result.snapped).toBe(true);
        expect(result.x).toBe(132);
        expect(result.y).toBe(100);
    });

    it('does not snap when outside snap radius', () => {
        const existing = [{ x: 100, y: 100, width: 32, height: 32 }];
        const result = snapWallToAdjacentSegment(250, 250, 32, 32, existing, 24);
        expect(result.snapped).toBe(false);
        expect(result.x).toBe(250);
        expect(result.y).toBe(250);
    });
});
