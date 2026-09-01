import { toCartesian, toIso } from '../utils/iso';

export interface CursorAlignedPlacement {
    inputWorldX: number;
    inputWorldY: number;
    centerX: number;
    centerY: number;
}

/**
 * Resolve the nearest footprint-aligned building center to the pointer.
 *
 * BuildingManager historically snaps a footprint origin, then adds half the
 * footprint to obtain the final center. Feeding the raw pointer into that
 * contract makes larger buildings drift half a footprint away from the cursor.
 * This adapter keeps the same origin lattice for dense edge-to-edge placement,
 * but chooses the lattice cell whose resulting center is nearest the pointer.
 */
export function resolveCursorAlignedPlacement(
    worldX: number,
    worldY: number,
    width: number,
    height: number,
    gridSize: number,
): CursorAlignedPlacement {
    const cart = toCartesian(worldX, worldY);
    const centerX = Math.round((cart.x - width / 2) / gridSize) * gridSize + width / 2;
    const centerY = Math.round((cart.y - height / 2) / gridSize) * gridSize + height / 2;

    // BuildingManager floors its input to the footprint-origin lattice. Feed a
    // point safely inside the desired cell so floating-point roundoff cannot
    // accidentally floor to the previous cell after the iso round trip.
    const baseInputCartX = centerX - width / 2 + gridSize / 2;
    const baseInputCartY = centerY - height / 2 + gridSize / 2;
    const baseInput = toIso(baseInputCartX, baseInputCartY);

    return {
        inputWorldX: baseInput.x,
        inputWorldY: baseInput.y,
        centerX,
        centerY,
    };
}
