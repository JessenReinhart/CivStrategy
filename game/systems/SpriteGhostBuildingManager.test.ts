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

import { BUILDINGS } from '../../constants';
import { BuildingType } from '../../types';
import { BuildingManager } from './BuildingManager';
import { SpriteGhostBuildingManager } from './SpriteGhostBuildingManager';

function makePreviewManager(isValid: boolean) {
    vi.spyOn(BuildingManager.prototype, 'updatePreview').mockImplementation(() => undefined);

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

    return { manager, ghost, checkBuildValidity };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SpriteGhostBuildingManager placement feedback', () => {
    it('keeps a valid building ghost close to the final sprite appearance', () => {
        const { manager, ghost, checkBuildValidity } = makePreviewManager(true);

        manager.updatePreview(0, 0);

        expect(checkBuildValidity).toHaveBeenCalledWith(
            BUILDINGS[BuildingType.HOUSE].width / 2,
            BUILDINGS[BuildingType.HOUSE].height / 2,
            BuildingType.HOUSE,
        );
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
