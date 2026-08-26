import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Scenes: { Events: { POST_UPDATE: 'postupdate' } },
    },
}));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { FogOfWarSystem } from './FogOfWarSystem';

function makeFog(cameraOverrides: Record<string, number> = {}) {
    const camera = {
        scrollX: 100,
        scrollY: 200,
        zoom: 1,
        width: 1280,
        height: 720,
        ...cameraOverrides,
    };
    const fog = Object.create(FogOfWarSystem.prototype) as FogOfWarSystem;
    const update = vi.fn();

    Object.assign(fog as unknown as Record<string, unknown>, {
        screenRT: {},
        isVisible: true,
        scene: {
            stressTestConfig: null,
            cameras: { main: camera },
        },
        _lastCameraScrollX: 100,
        _lastCameraScrollY: 200,
        _lastCameraZoom: 1,
        _lastCameraWidth: 1280,
        _lastCameraHeight: 720,
        update,
    });

    return { fog, camera, update };
}

describe('FogOfWarSystem camera sync', () => {
    it('forces a fog redraw when the camera moves between throttled updates', () => {
        const { fog, camera, update } = makeFog();
        camera.scrollX += 24;

        (fog as unknown as { syncCameraOnPostUpdate(): void }).syncCameraOnPostUpdate();

        expect(update).toHaveBeenCalledOnce();
    });

    it('does not redraw again when the camera transform is unchanged', () => {
        const { fog, update } = makeFog();

        (fog as unknown as { syncCameraOnPostUpdate(): void }).syncCameraOnPostUpdate();

        expect(update).not.toHaveBeenCalled();
    });
});
