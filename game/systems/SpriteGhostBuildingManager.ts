import type Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import { BuildingType } from '../../types';
import { BUILDINGS } from '../../constants';
import { BUILD_PLACEMENT_GRID_SIZE, BuildingManager } from './BuildingManager';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';
import { resolveCursorAlignedPlacement } from './buildingPlacementSnap';

/**
 * Adds the same textured building visual used by placed structures to the
 * placement container. The existing BuildingManager graphics remain as the
 * footprint/radius overlay and as the fallback for procedural-only buildings.
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
        const config = BUILDING_SPRITE_VISUALS[buildingType];
        if (!preview || !config || !this.ghostScene.textures.exists(config.key)) return;

        const def = BUILDINGS[buildingType];
        const sprite = this.ghostScene.add.image(0, 0, config.key);
        sprite.setOrigin(0.5, config.originY);
        sprite.setScale((def.width * config.scaleMultiplier) / sprite.width);
        sprite.setAlpha(0.62);
        sprite.setData('placementGhostSprite', true);
        preview.add(sprite);
    }

    public override updatePreview(worldX: number, worldY: number): void {
        if (!this.previewBuildingType) {
            super.updatePreview(worldX, worldY);
            return;
        }

        const def = BUILDINGS[this.previewBuildingType];
        const placement = resolveCursorAlignedPlacement(
            worldX,
            worldY,
            def.width,
            def.height,
            BUILD_PLACEMENT_GRID_SIZE,
        );
        super.updatePreview(placement.inputWorldX, placement.inputWorldY);

        if (!this.previewBuilding) return;
        const ghost = this.previewBuilding.list.find((child) => {
            const candidate = child as Phaser.GameObjects.Image;
            return typeof candidate.getData === 'function' && candidate.getData('placementGhostSprite') === true;
        }) as Phaser.GameObjects.Image | undefined;
        if (!ghost) return;

        const managerValidity = this as unknown as {
            checkBuildValidity(x: number, y: number, type: BuildingType): boolean;
        };
        const isValid = managerValidity.checkBuildValidity(
            placement.centerX,
            placement.centerY,
            this.previewBuildingType,
        );

        ghost.setTint(isValid ? 0xffffff : 0xff5555);
        ghost.setAlpha(isValid ? 0.62 : 0.76);
    }

    public override tryBuild(worldX: number, worldY: number): void {
        if (!this.previewBuildingType) {
            super.tryBuild(worldX, worldY);
            return;
        }

        const def = BUILDINGS[this.previewBuildingType];
        const placement = resolveCursorAlignedPlacement(
            worldX,
            worldY,
            def.width,
            def.height,
            BUILD_PLACEMENT_GRID_SIZE,
        );
        super.tryBuild(placement.inputWorldX, placement.inputWorldY);
    }
}
