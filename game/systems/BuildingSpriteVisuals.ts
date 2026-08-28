import { BuildingType } from '../../types';

export type BuildingSpriteVisualConfig = {
    key: string;
    scaleMultiplier: number;
    originY: number;
    /** Relative vertical mass used when projecting the sprite into a solar shadow. */
    shadowHeightScale: number;
};

/**
 * Canonical building-art configuration used by both placed structures and
 * placement ghosts. Keeping it exhaustive prevents a building from gaining
 * art without receiving the matching preview.
 */
export const BUILDING_SPRITE_VISUALS: Record<BuildingType, BuildingSpriteVisualConfig> = {
    [BuildingType.TOWN_CENTER]: { key: 'townhall', scaleMultiplier: 1.2, originY: 0.75, shadowHeightScale: 1.0 },
    [BuildingType.HOUSE]: { key: 'house', scaleMultiplier: 1.6, originY: 0.85, shadowHeightScale: 0.72 },
    [BuildingType.BARRACKS]: { key: 'barracks', scaleMultiplier: 1.5, originY: 0.75, shadowHeightScale: 0.72 },
    [BuildingType.FARM]: { key: 'field', scaleMultiplier: 1.3, originY: 0.5, shadowHeightScale: 0.35 },
    [BuildingType.LUMBER_CAMP]: { key: 'lumber', scaleMultiplier: 1.7, originY: 0.75, shadowHeightScale: 0.72 },
    [BuildingType.HUNTERS_LODGE]: { key: 'lodge', scaleMultiplier: 1.6, originY: 0.75, shadowHeightScale: 0.72 },
    [BuildingType.BONFIRE]: { key: 'bonfire', scaleMultiplier: 2.1, originY: 0.82, shadowHeightScale: 0.20 },
    [BuildingType.SMALL_PARK]: { key: 'park', scaleMultiplier: 1.5, originY: 0.82, shadowHeightScale: 0.35 },
    [BuildingType.MARKET]: { key: 'market', scaleMultiplier: 1.8, originY: 0.78, shadowHeightScale: 0.72 },
    [BuildingType.WALL]: { key: 'wall', scaleMultiplier: 2.4, originY: 0.76, shadowHeightScale: 0.72 },
    [BuildingType.CATHEDRAL]: { key: 'cathedral', scaleMultiplier: 1.7, originY: 0.82, shadowHeightScale: 1.0 },
    [BuildingType.CASTLE]: { key: 'castle', scaleMultiplier: 1.5, originY: 0.80, shadowHeightScale: 1.0 },
};
