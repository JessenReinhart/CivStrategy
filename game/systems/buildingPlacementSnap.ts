import { toCartesian, toIso } from '../utils/iso';

export interface CursorAlignedPlacement {
    inputWorldX: number;
    inputWorldY: number;
    centerX: number;
    centerY: number;
}

/** Resolve the footprint-aligned building center nearest the player's pointer.
 * BuildingManager consumes a point inside a footprint-origin grid cell and then
 * adds half the footprint. This adapter preserves that grid contract while
 * making the visible building center track the cursor instead of drifting by
 * half a footprint for larger buildings.
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

    const inputCartX = centerX - width / 2 + gridSize / 2;
    const inputCartY = centerY - height / 2 + gridSize / 2;
    const input = toIso(inputCartX, inputCartY);

    return {
        inputWorldX: input.x,
        inputWorldY: input.y,
        centerX,
        centerY,
    };
}
