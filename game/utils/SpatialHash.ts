
import Phaser from 'phaser';

export class SpatialHash {
    private cellSize: number;
    private buckets: Map<string, Set<any>>;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.buckets = new Map();
    }

    private getKey(x: number, y: number): string {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }

    public insert(entity: any) {
        const key = this.getKey(entity.x, entity.y);
        if (!this.buckets.has(key)) {
            this.buckets.set(key, new Set());
        }
        this.buckets.get(key)!.add(entity);
        entity.setData('spatialKey', key);
    }

    public remove(entity: any) {
        const key = entity.getData('spatialKey');
        if (key && this.buckets.has(key)) {
            this.buckets.get(key)!.delete(entity);
            if (this.buckets.get(key)!.size === 0) {
                this.buckets.delete(key);
            }
        }
    }

    public update(entity: any) {
        const oldKey = entity.getData('spatialKey');
        const newKey = this.getKey(entity.x, entity.y);

        if (oldKey !== newKey) {
            this.remove(entity);
            this.insert(entity);
        }
    }

    public query(x: number, y: number, radius: number): any[] {
        const results: any[] = [];
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
