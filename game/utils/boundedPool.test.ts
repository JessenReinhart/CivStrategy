import { describe, expect, it, vi } from 'vitest';

import { releaseToBoundedPool } from './boundedPool';

describe('releaseToBoundedPool', () => {
    it('retains an item while the pool has capacity', () => {
        const item = { destroy: vi.fn() };
        const pool: typeof item[] = [];

        releaseToBoundedPool(pool, item, 1);

        expect(pool).toHaveLength(1);
        expect(pool[0]).toBe(item);
        expect(item.destroy).not.toHaveBeenCalled();
    });

    it('destroys overflow instead of leaving an unreachable item', () => {
        const retained = { destroy: vi.fn() };
        const overflow = { destroy: vi.fn() };
        const pool = [retained];

        releaseToBoundedPool(pool, overflow, 1);

        expect(pool).toHaveLength(1);
        expect(pool[0]).toBe(retained);
        expect(overflow.destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys immediately when retention is disabled', () => {
        const item = { destroy: vi.fn() };
        const pool: typeof item[] = [];

        releaseToBoundedPool(pool, item, 0);

        expect(pool).toHaveLength(0);
        expect(item.destroy).toHaveBeenCalledTimes(1);
    });
});
