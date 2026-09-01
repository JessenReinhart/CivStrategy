import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Distance: {
                Between: vi.fn(() => 0),
            },
        },
        Geom: {
            Rectangle: class {},
            Intersects: {
                RectangleToRectangle: vi.fn(() => false),
            },
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { BuildingType } from '../../types';
import { BuildingManager } from './BuildingManager';
import { SpriteGhostBuildingManager } from './SpriteGhostBuildingManager';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';

function makePreviewManager(isValid: boolean) {
    const updatePreview = vi.spyOn(BuildingManager.prototype, 'updatePreview').mockImplementation(() => undefined);

    const ghost = {
        getData: vi.fn((key: string) => key === 'placementGhostSprite'),
        setTint: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
    };
    const checkBuildValidity = vi.fn(() => isValid);
    const manager = Object.create(SpriteGhostBuildingManager.prototype) as SpriteGhostBuildingManager;
    Object.assign(manager as unknown as Record<string, unknown>, {
        previewBuilding: { list: [ghost] },
        previewBuildingType: BuildingType.HOUSE,
        checkBuildValidity,
    });

    return { manager, ghost, checkBuildValidity, updatePreview };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SpriteGhostBuildingManager placement feedback', () => {
    it('has a textured preview configuration for every building type', () => {
        expect(Object.keys(BUILDING_SPRITE_VISUALS).sort()).toEqual(Object.values(BuildingType).sort());
    });

    it('uses the cursor-centered snap for preview position and validity', () => {
        const { manager, ghost, checkBuildValidity, updatePreview } = makePreviewManager(true);

        manager.updatePreview(0, 0);

        expect(updatePreview).toHaveBeenCalledWith(0, -8);
        expect(checkBuildValidity).toHaveBeenCalledWith(0, 0, BuildingType.HOUSE);
        expect(ghost.setTint).toHaveBeenCalledWith(0xffffff);
        expect(ghost.setAlpha).toHaveBeenCalledWith(0.62);
    });

    it('marks invalid placement on the building sprite itself', () => {
        const { manager, ghost } = makePreviewManager(false);

        manager.updatePreview(0, 0);

        expect(ghost.setTint).toHaveBeenCalledWith(0xff5555);
        expect(ghost.setAlpha).toHaveBeenCalledWith(0.76);
    });
});
