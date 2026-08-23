export interface DisposablePoolItem {
    destroy(): void;
}

/**
 * Return an item to a bounded pool, or destroy it when the retained pool is full.
 *
 * This keeps transient Phaser objects from becoming hidden, unreachable scene
 * objects after a burst temporarily exceeds the pool's retained capacity.
 */
export function releaseToBoundedPool<T extends DisposablePoolItem>(
    pool: T[],
    item: T,
    maxSize: number,
): void {
    if (pool.length < maxSize) {
        pool.push(item);
        return;
    }

    item.destroy();
}
