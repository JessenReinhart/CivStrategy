import { BuildingType } from '../../types';
import { applyBuildingWorldScale } from '../worldScale';
import type { ShadowEmitterProfile, ShadowEmitterScanBand } from './shadowEmitterMath';

applyBuildingWorldScale();

export type BuildingSpriteVisualConfig = {
    key: string;
    scaleMultiplier: number;
    originY: number;
    /** Relative vertical mass used when projecting the emitter line into a solar shadow. */
    shadowHeightScale: number;
    /** Width of the far edge relative to the detected emitter line. */
    shadowEndWidthScale: number;
    /** Vertical texture band in which the widest useful shadow-emitter row is detected. */
    shadowEmitterScanBand: ShadowEmitterScanBand;
    /** Optional hand-authored escape hatch for sprites whose alpha silhouette is unusual. */
    shadowEmitterOverride?: ShadowEmitterProfile;
};

/**
 * Canonical building-art configuration used by placed structures and placement
 * ghosts. Shadow roots are detected from each PNG's alpha silhouette once and
 * cached; these bands merely constrain the search to the ground-facing portion
 * of the isometric art so roofs and tall ornaments do not become emitters.
 */
export const BUILDING_SPRITE_VISUALS: Record<BuildingType, BuildingSpriteVisualConfig> = {
    [BuildingType.TOWN_CENTER]: {
        key: 'townhall', scaleMultiplier: 1.2, originY: 0.75,
        shadowHeightScale: 1.0, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.64, maxYNorm: 0.93 },
    },
    [BuildingType.HOUSE]: {
        key: 'house', scaleMultiplier: 1.6, originY: 0.85,
        shadowHeightScale: 0.72, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.66, maxYNorm: 0.92 },
    },
    [BuildingType.BARRACKS]: {
        key: 'barracks', scaleMultiplier: 1.5, originY: 0.75,
        shadowHeightScale: 0.74, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.62, maxYNorm: 0.92 },
    },
    [BuildingType.FARM]: {
        key: 'field', scaleMultiplier: 1.3, originY: 0.5,
        shadowHeightScale: 0.24, shadowEndWidthScale: 1.0,
        shadowEmitterScanBand: { minYNorm: 0.48, maxYNorm: 0.88 },
    },
    [BuildingType.LUMBER_CAMP]: {
        key: 'lumber', scaleMultiplier: 1.5, originY: 0.75,
        shadowHeightScale: 0.72, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.60, maxYNorm: 0.92 },
    },
    [BuildingType.HUNTERS_LODGE]: {
        key: 'lodge', scaleMultiplier: 1.4, originY: 0.75,
        shadowHeightScale: 0.68, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.62, maxYNorm: 0.92 },
    },
    [BuildingType.BONFIRE]: {
        key: 'bonfire', scaleMultiplier: 1.45, originY: 0.82,
        shadowHeightScale: 0.18, shadowEndWidthScale: 0.96,
        shadowEmitterScanBand: { minYNorm: 0.56, maxYNorm: 0.90 },
    },
    [BuildingType.SMALL_PARK]: {
        key: 'park', scaleMultiplier: 1.5, originY: 0.82,
        shadowHeightScale: 0.24, shadowEndWidthScale: 1.0,
        shadowEmitterScanBand: { minYNorm: 0.58, maxYNorm: 0.92 },
    },
    [BuildingType.MARKET]: {
        key: 'market', scaleMultiplier: 1.8, originY: 0.78,
        shadowHeightScale: 0.72, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.60, maxYNorm: 0.92 },
    },
    [BuildingType.WALL]: {
        key: 'wall', scaleMultiplier: 2.4, originY: 0.76,
        shadowHeightScale: 0.62, shadowEndWidthScale: 0.98,
        shadowEmitterScanBand: { minYNorm: 0.52, maxYNorm: 0.90 },
    },
    [BuildingType.CATHEDRAL]: {
        key: 'cathedral', scaleMultiplier: 1.7, originY: 0.82,
        shadowHeightScale: 1.0, shadowEndWidthScale: 0.96,
        shadowEmitterScanBand: { minYNorm: 0.66, maxYNorm: 0.94 },
    },
    [BuildingType.CASTLE]: {
        key: 'castle', scaleMultiplier: 1.5, originY: 0.80,
        shadowHeightScale: 1.0, shadowEndWidthScale: 0.96,
        shadowEmitterScanBand: { minYNorm: 0.62, maxYNorm: 0.94 },
    },
};
