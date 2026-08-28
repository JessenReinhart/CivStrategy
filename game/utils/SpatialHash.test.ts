import { describe, expect, it } from 'vitest';

import { SpatialHash } from './SpatialHash';

interface TestEntity {
    x: number;
    y: number;
    data: Map<string, unknown>;
    getData: (key: string) => unknown;
    setData: (key: string, value: unknown) => void;
    once: (event: string, handler: () => void) => void;
    destroy: () => void;
}

const createEntity = (x: number, y: number): TestEntity => {
    const data = new Map<string, unknown>();
    const onceHandlers = new Map<string, () => void>();
    let dataAvailable = true;
    return {
        x,
        y,
        data,
        getData: key => {
            if (!dataAvailable) throw new Error('entity data unavailable after destroy');
            return data.get(key);
        },
        setData: (key, value) => {
            if (!dataAvailable) throw new Error('entity data unavailable after destroy');
            if (value === undefined) data.delete(key);
            else data.set(key, value);
        },
        once: (event, handler) => {
            onceHandlers.set(event, handler);
        },
        destroy: () => {
            const handler = onceHandlers.get('destroy');
            onceHandlers.delete('destroy');
            dataAvailable = false;
            handler?.();
        },
    };
};

describe('SpatialHash', () => {
    it('re-registers a removed entity when updated in the same cell', () => {
        const hash = new SpatialHash(100);
        const entity = createEntity(25, 25);

        hash.insert(entity);
        expect(hash.query(25, 25, 10)).toContain(entity);

        hash.remove(entity);
        expect(hash.query(25, 25, 10)).not.toContain(entity);
        expect(entity.getData('spatialKey')).toBeUndefined();

        hash.update(entity);
        expect(hash.query(25, 25, 10)).toContain(entity);
    });

    it('keeps normal cross-cell updates working', () => {
        const hash = new SpatialHash(100);
        const entity = createEntity(25, 25);

        hash.insert(entity);
        entity.x = 125;
        hash.update(entity);

        expect(hash.query(25, 25, 10)).not.toContain(entity);
        expect(hash.query(125, 25, 10)).toContain(entity);
    });

    it('moves an existing registration when the entity is inserted again', () => {
        const hash = new SpatialHash(100);
        const entity = createEntity(25, 25);

        hash.insert(entity);
        entity.x = 125;
        hash.insert(entity);

        expect(hash.query(25, 25, 10)).not.toContain(entity);
        expect(hash.query(125, 25, 10)).toContain(entity);
        expect(entity.getData('spatialKey')).toBe('1,0');
    });

    it('removes a registered entity even when runtime data is unavailable during destroy', () => {
        const hash = new SpatialHash(100);
        const entity = createEntity(25, 25);

        hash.insert(entity);
        expect(hash.query(25, 25, 10)).toContain(entity);

        entity.destroy();

        expect(hash.query(25, 25, 10)).not.toContain(entity);
    });
});
