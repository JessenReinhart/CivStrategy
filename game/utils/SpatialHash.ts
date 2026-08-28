


export class SpatialHash {
    private cellSize: number;
    private buckets: Map<string, Set<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    private destroyTracked = new WeakSet<object>();
    private entityKeys = new WeakMap<object, string>();

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.buckets = new Map();
    }

    private getKey(x: number, y: number): string {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }

    private removeFromBucket(entity: any, key?: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (key && this.buckets.has(key)) {
            this.buckets.get(key)!.delete(entity);
            if (this.buckets.get(key)!.size === 0) {
                this.buckets.delete(key);
            }
        }
        this.entityKeys.delete(entity);
    }

    public insert(entity: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const key = this.getKey(entity.x, entity.y);
        const oldKey = this.entityKeys.get(entity) ?? entity.getData('spatialKey');
        if (oldKey && oldKey !== key) {
            this.remove(entity);
        }
        if (!this.buckets.has(key)) {
            this.buckets.set(key, new Set());
        }
        this.buckets.get(key)!.add(entity);
        this.entityKeys.set(entity, key);
        entity.setData('spatialKey', key);

        // Phaser groups forget destroyed entities automatically, but this index does not.
        // Own the same lifecycle without touching GameObject data after Phaser tears it down.
        if (typeof entity.once === 'function' && !this.destroyTracked.has(entity)) {
            this.destroyTracked.add(entity);
            entity.once('destroy', () => {
                this.removeFromBucket(entity, this.entityKeys.get(entity));
                this.destroyTracked.delete(entity);
            });
        }
    }

    public remove(entity: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const key = this.entityKeys.get(entity) ?? entity.getData('spatialKey');
        this.removeFromBucket(entity, key);
        entity.setData('spatialKey', undefined);
    }

    public update(entity: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const oldKey = this.entityKeys.get(entity) ?? entity.getData('spatialKey');
        const newKey = this.getKey(entity.x, entity.y);

        if (oldKey !== newKey) {
            this.remove(entity);
            this.insert(entity);
        }
    }

    public query(x: number, y: number, radius: number): any[] { // eslint-disable-line @typescript-eslint/no-explicit-any
        const results: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        const checkedKeys = new Set<string>();

        // Calculate range of cells to check
        const startX = Math.floor((x - radius) / this.cellSize);
        const endX = Math.floor((x + radius) / this.cellSize);
        const startY = Math.floor((y - radius) / this.cellSize);
        const endY = Math.floor((y + radius) / this.cellSize);

        for (let cx = startX; cx <= endX; cx++) {
            for (let cy = startY; cy <= endY; cy++) {
                const key = `${cx},${cy}`;
                if (checkedKeys.has(key)) continue;
                checkedKeys.add(key);

                const bucket = this.buckets.get(key);
                if (bucket) {
                    bucket.forEach(entity => {
                        // Rough check first? No, just return candidates
                        results.push(entity);
                    });
                }
            }
        }

        return results;
    }
}
