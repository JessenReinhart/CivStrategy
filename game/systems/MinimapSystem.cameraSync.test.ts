import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { MinimapSystem } from './MinimapSystem';

describe('MinimapSystem camera sync', () => {
    it('updates layout and viewport every frame even when content redraw is throttled', () => {
        const minimap = Object.create(MinimapSystem.prototype) as MinimapSystem;
        const updateLayout = vi.fn();
        const getMapScalar = vi.fn(() => 0.125);
        const drawViewport = vi.fn();

        Object.assign(minimap as unknown as Record<string, unknown>, {
            frameCount: 0,
            updateInterval: 45,
            updateLayout,
            getMapScalar,
            drawViewport,
        });

        minimap.update();

        expect(updateLayout).toHaveBeenCalledOnce();
        expect(getMapScalar).toHaveBeenCalledOnce();
        expect(drawViewport).toHaveBeenCalledOnce();
        expect(drawViewport).toHaveBeenCalledWith(0.125);
        expect((minimap as unknown as { frameCount: number }).frameCount).toBe(1);
    });
});
