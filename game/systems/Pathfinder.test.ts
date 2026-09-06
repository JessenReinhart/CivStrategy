import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
    class Vector2 {
        constructor(public x: number, public y: number) {}
    }

    return {
        default: {
            Math: {
                Vector2,
                Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
            },
        },
    };
});

import { Pathfinder } from './Pathfinder';

describe('Pathfinder flow-field generation', () => {
    it('refreshes an active shared flow field after the building grid changes', () => {
        const pathfinder = new Pathfinder(320, 320);
        const flowField = pathfinder.generateFlowField(272, 272);
        const initialVersion = pathfinder.getCacheStats().gridVersion;

        expect(flowField.version).toBe(initialVersion);
        expect(pathfinder.getFlowDirection(flowField, 48, 48)).not.toBeNull();

        pathfinder.markGrid(160, 160, 32, 32, true);
        const blockedVersion = pathfinder.getCacheStats().gridVersion;
        const generatedBeforeRefresh = pathfinder.flowFieldsGenerated;

        expect(blockedVersion).toBe(initialVersion + 1);
        expect(flowField.version).toBe(initialVersion);

        expect(pathfinder.getFlowDirection(flowField, 48, 48)).not.toBeNull();
        expect(pathfinder.flowFieldsGenerated).toBe(generatedBeforeRefresh + 1);
        expect(flowField.version).toBe(blockedVersion);

        pathfinder.markGrid(160, 160, 32, 32, true);
        expect(pathfinder.getCacheStats().gridVersion).toBe(blockedVersion);

        pathfinder.markGrid(160, 160, 32, 32, false);
        const reopenedVersion = pathfinder.getCacheStats().gridVersion;
        const generatedBeforeReopenRefresh = pathfinder.flowFieldsGenerated;

        expect(reopenedVersion).toBe(blockedVersion + 1);
        expect(pathfinder.getFlowDirection(flowField, 48, 48)).not.toBeNull();
        expect(pathfinder.flowFieldsGenerated).toBe(generatedBeforeReopenRefresh + 1);
        expect(flowField.version).toBe(reopenedVersion);
    });
});
