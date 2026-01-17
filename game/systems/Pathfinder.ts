
import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';

export class Pathfinder {
    private blockedCells: Set<string> = new Set();
    private cellSize = 32;

    public markGrid(x: number, y: number, width: number, height: number, blocked: boolean) {
        const halfW = width / 2;
        const halfH = height / 2;
        const minX = Math.floor((x - halfW) / this.cellSize);
        const maxX = Math.floor((x + halfW) / this.cellSize);
        const minY = Math.floor((y - halfH) / this.cellSize);
        const maxY = Math.floor((y + halfH) / this.cellSize);

        for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
                const key = `${gx},${gy}`;
                if (blocked) {
                    this.blockedCells.add(key);
                } else {
                    this.blockedCells.delete(key);
                }
            }
        }
    }

    public isBlocked(x: number, y: number): boolean {
        const gx = Math.floor(x / this.cellSize);
        const gy = Math.floor(y / this.cellSize);
        return this.blockedCells.has(`${gx},${gy}`);
    }

    public findPath(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2): Phaser.Math.Vector2[] {
        // Clamp to map boundaries
        end.x = Phaser.Math.Clamp(end.x, 0, MAP_WIDTH);
        end.y = Phaser.Math.Clamp(end.y, 0, MAP_HEIGHT);

        // Simple A* or direct path - for now, return direct path with obstacle avoidance
        // If end is blocked, find nearest unblocked cell
        if (this.isBlocked(end.x, end.y)) {
            const nearest = this.findNearestUnblocked(end.x, end.y);
            if (nearest) {
                end = nearest;
            }
        }

        // Simple straight-line path (units will use steering to avoid obstacles)
        return [end];
    }

    private findNearestUnblocked(x: number, y: number): Phaser.Math.Vector2 | null {
        const gx = Math.floor(x / this.cellSize);
        const gy = Math.floor(y / this.cellSize);

        // Search in expanding rings
        for (let radius = 1; radius <= 10; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    const key = `${gx + dx},${gy + dy}`;
                    if (!this.blockedCells.has(key)) {
                        return new Phaser.Math.Vector2(
                            (gx + dx) * this.cellSize + this.cellSize / 2,
                            (gy + dy) * this.cellSize + this.cellSize / 2
                        );
                    }
                }
            }
        }
        return null;
    }
}
