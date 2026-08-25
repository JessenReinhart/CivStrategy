import type { MainScene } from '../MainScene';
import { BuildingType } from '../../types';
import { BUILDINGS } from '../../constants';
import { BuildingManager } from './BuildingManager';

type SpriteVisualConfig = {
    key: string;
    scaleMultiplier: number;
    originY: number;
};

const SPRITE_VISUALS: Partial<Record<BuildingType, SpriteVisualConfig>> = {
    [BuildingType.FARM]: { key: 'field', scaleMultiplier: 1.3, originY: 0.5 },
    [BuildingType.HOUSE]: { key: 'house', scaleMultiplier: 1.6, originY: 0.85 },
    [BuildingType.HUNTERS_LODGE]: { key: 'lodge', scaleMultiplier: 1.6, originY: 0.75 },
    [BuildingType.TOWN_CENTER]: { key: 'townhall', scaleMultiplier: 1.2, originY: 0.75 },
    [BuildingType.BARRACKS]: { key: 'barracks', scaleMultiplier: 1.5, originY: 0.75 },
    [BuildingType.LUMBER_CAMP]: { key: 'lumber', scaleMultiplier: 1.7, originY: 0.75 },
};

/**
 * Adds the same textured building visual used by placed structures to the
 * placement container. The existing BuildingManager graphics remain as the
 * validity/radius overlay and as the fallback for procedural-only buildings.
 */
export class SpriteGhostBuildingManager extends BuildingManager {
    private readonly ghostScene: MainScene;

    constructor(scene: MainScene) {
        super(scene);
        this.ghostScene = scene;
    }

    public override enterBuildMode(buildingType: BuildingType): void {
        super.enterBuildMode(buildingType);

        const preview = this.previewBuilding;
        const config = SPRITE_VISUALS[buildingType];
        if (!preview || !config || !this.ghostScene.textures.exists(config.key)) return;

        const def = BUILDINGS[buildingType];
        const sprite = this.ghostScene.add.image(0, 0, config.key);
        sprite.setOrigin(0.5, config.originY);
        sprite.setScale((def.width * config.scaleMultiplier) / sprite.width);
        sprite.setAlpha(0.62);
        sprite.setData('placementGhostSprite', true);
        preview.add(sprite);
    }
}
