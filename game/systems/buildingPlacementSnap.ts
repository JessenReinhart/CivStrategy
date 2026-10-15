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

export interface BuildingPlacementFeedback {
    valid: boolean;
    reason?: string;
    farmYield?: number;
    resourceBonus?: string;
}

export function formatBuildingPlacementFeedback(feedback: BuildingPlacementFeedback): string {
    if (!feedback.valid) return feedback.reason ?? 'Unable to build';
    if (feedback.farmYield !== undefined) return `Fertility ×${feedback.farmYield.toFixed(1)} · Click to place`;
    if (feedback.resourceBonus) return `${feedback.resourceBonus} · Click to place`;
    return 'Click to place';
}

export interface WallSegment {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Magnetically snaps a wall or palisade piece to align seamlessly with an
 * adjacent existing wall piece within snapRadius.
 */
export function snapWallToAdjacentSegment(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    existingWalls: WallSegment[],
    snapRadius: number = 24,
): { x: number; y: number; snapped: boolean } {
    let bestDistSq = snapRadius * snapRadius;
    let bestX = centerX;
    let bestY = centerY;
    let snapped = false;

    for (const wall of existingWalls) {
        const candidates = [
            { x: wall.x + (wall.width + width) / 2, y: wall.y },
            { x: wall.x - (wall.width + width) / 2, y: wall.y },
            { x: wall.x, y: wall.y + (wall.height + height) / 2 },
            { x: wall.x, y: wall.y - (wall.height + height) / 2 },
        ];
        for (const cand of candidates) {
            const dx = cand.x - centerX;
            const dy = cand.y - centerY;
            const dSq = dx * dx + dy * dy;
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestX = cand.x;
                bestY = cand.y;
                snapped = true;
            }
        }
    }

    return { x: bestX, y: bestY, snapped };
}
