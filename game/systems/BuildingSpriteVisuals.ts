import { BuildingType } from '../../types';

export type BuildingSpriteVisualConfig = {
    key: string;
    scaleMultiplier: number;
    originY: number;
    /** Relative vertical mass used when projecting the sprite into a solar shadow. */
    shadowHeightScale: number;
    /** Width of the authored ground footprint relative to rendered sprite width. */
    shadowFootprintScale: number;
    /** Isometric footprint depth relative to authored footprint width. */
    shadowFootprintDepthScale: number;
    /** Small world-space Y correction so the cast starts on the painted foundation. */
    shadowAnchorOffsetY: number;
    /** Width of the far edge relative to the contact edge. */
    shadowEndWidthScale: number;
};

/**
 * Canonical building-art configuration used by both placed structures and
 * placement ghosts. Shadow values are intentionally explicit and deterministic:
 * the game uses a convincing authored fake instead of trying to infer 3D
 * geometry from each PNG at runtime.
 */
export const BUILDING_SPRITE_VISUALS: Record<BuildingType, BuildingSpriteVisualConfig> = {
    [BuildingType.TOWN_CENTER]: {
        key: 'townhall', scaleMultiplier: 1.2, originY: 0.75,
        shadowHeightScale: 1.0, shadowFootprintScale: 1.12, shadowFootprintDepthScale: 0.42,
        shadowAnchorOffsetY: 5, shadowEndWidthScale: 0.90,
    },
    [BuildingType.HOUSE]: {
        key: 'house', scaleMultiplier: 1.6, originY: 0.85,
        shadowHeightScale: 0.72, shadowFootprintScale: 1.18, shadowFootprintDepthScale: 0.40,
        shadowAnchorOffsetY: 6, shadowEndWidthScale: 0.92,
    },
    [BuildingType.BARRACKS]: {
        key: 'barracks', scaleMultiplier: 1.5, originY: 0.75,
        shadowHeightScale: 0.74, shadowFootprintScale: 1.12, shadowFootprintDepthScale: 0.42,
        shadowAnchorOffsetY: 5, shadowEndWidthScale: 0.90,
    },
    [BuildingType.FARM]: {
        key: 'field', scaleMultiplier: 1.3, originY: 0.5,
        shadowHeightScale: 0.24, shadowFootprintScale: 1.06, shadowFootprintDepthScale: 0.46,
        shadowAnchorOffsetY: 2, shadowEndWidthScale: 0.96,
    },
    [BuildingType.LUMBER_CAMP]: {
        key: 'lumber', scaleMultiplier: 1.7, originY: 0.75,
        shadowHeightScale: 0.72, shadowFootprintScale: 1.14, shadowFootprintDepthScale: 0.42,
        shadowAnchorOffsetY: 5, shadowEndWidthScale: 0.92,
    },
    [BuildingType.HUNTERS_LODGE]: {
        key: 'lodge', scaleMultiplier: 1.6, originY: 0.75,
        shadowHeightScale: 0.68, shadowFootprintScale: 1.10, shadowFootprintDepthScale: 0.40,
        shadowAnchorOffsetY: 5, shadowEndWidthScale: 0.92,
    },
    [BuildingType.BONFIRE]: {
        key: 'bonfire', scaleMultiplier: 2.1, originY: 0.82,
        shadowHeightScale: 0.18, shadowFootprintScale: 0.76, shadowFootprintDepthScale: 0.44,
        shadowAnchorOffsetY: 3, shadowEndWidthScale: 0.88,
    },
    [BuildingType.SMALL_PARK]: {
        key: 'park', scaleMultiplier: 1.5, originY: 0.82,
        shadowHeightScale: 0.24, shadowFootprintScale: 1.00, shadowFootprintDepthScale: 0.46,
        shadowAnchorOffsetY: 3, shadowEndWidthScale: 0.95,
    },
    [BuildingType.MARKET]: {
        key: 'market', scaleMultiplier: 1.8, originY: 0.78,
        shadowHeightScale: 0.72, shadowFootprintScale: 1.14, shadowFootprintDepthScale: 0.42,
        shadowAnchorOffsetY: 5, shadowEndWidthScale: 0.92,
    },
    [BuildingType.WALL]: {
        key: 'wall', scaleMultiplier: 2.4, originY: 0.76,
        shadowHeightScale: 0.62, shadowFootprintScale: 1.04, shadowFootprintDepthScale: 0.34,
        shadowAnchorOffsetY: 4, shadowEndWidthScale: 0.94,
    },
    [BuildingType.CATHEDRAL]: {
        key: 'cathedral', scaleMultiplier: 1.7, originY: 0.82,
        shadowHeightScale: 1.0, shadowFootprintScale: 1.14, shadowFootprintDepthScale: 0.44,
        shadowAnchorOffsetY: 7, shadowEndWidthScale: 0.88,
    },
    [BuildingType.CASTLE]: {
        key: 'castle', scaleMultiplier: 1.5, originY: 0.80,
        shadowHeightScale: 1.0, shadowFootprintScale: 1.16, shadowFootprintDepthScale: 0.44,
        shadowAnchorOffsetY: 8, shadowEndWidthScale: 0.88,
    },
};
