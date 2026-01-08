
import Phaser from 'phaser';
import { TILE_SIZE } from '../../constants';

interface PathNode {
    x: number;
    y: number;
    g: number;
    f: number;
    parent: PathNode | null;
}

export class Pathfinder {
    public navGrid: Map<string, boolean> = new Map();

    constructor() {}

    public markGrid(x: number, y: number, width: number, height: number, blocked: boolean) {
        const gx = Math.floor((x - width/2) / TILE_SIZE);
        const gy = Math.floor((y - height/2) / TILE_SIZE);
        const gw = Math.ceil(width / TILE_SIZE);
        const gh = Math.ceil(height / TILE_SIZE);

        for(let cy = gy; cy < gy + gh; cy++) {
            for(let cx = gx; cx < gx + gw; cx++) {
                this.navGrid.set(`${cx},${cy}`, blocked);
            }
        }
    }

    private isBlocked(gx: number, gy: number): boolean {
        return this.navGrid.get(`${gx},${gy}`) === true;
    }

    public findPath(start: Phaser.Math.Vector2, target: Phaser.Math.Vector2): Phaser.Math.Vector2[] | null {
        const startX = Math.floor(start.x / TILE_SIZE);
        const startY = Math.floor(start.y / TILE_SIZE);
        let endX = Math.floor(target.x / TILE_SIZE);
        let endY = Math.floor(target.y / TILE_SIZE);
    
        // If target blocked, find nearest free neighbor
        if (this.isBlocked(endX, endY)) {
            let found = false;
            for (let r = 1; r < 5; r++) {
                for (let y = endY - r; y <= endY + r; y++) {
                    for (let x = endX - r; x <= endX + r; x++) {
                        if (!this.isBlocked(x, y)) {
                            endX = x;
                            endY = y;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
                if (found) break;
            }
            if (!found) return null;
        }
    
        const openSet: PathNode[] = [];
        const closedSet = new Set<string>();
        
        openSet.push({ x: startX, y: startY, g: 0, f: 0, parent: null });
    
        const maxIterations = 500;
        let iter = 0;

        while (openSet.length > 0 && iter < maxIterations) {
            iter++;
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift()!;
            const key = `${current.x},${current.y}`;
    
            if (current.x === endX && current.y === endY) {
                const path: Phaser.Math.Vector2[] = [];
                let curr: PathNode | null = current;
                while (curr) {
                    path.push(new Phaser.Math.Vector2(
                        curr.x * TILE_SIZE + TILE_SIZE / 2, 
                        curr.y * TILE_SIZE + TILE_SIZE / 2
                    ));
                    curr = curr.parent;
                }
                return path.reverse();
            }
    
            closedSet.add(key);
    
            const neighbors = [
                { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
                { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }
            ];
    
            for (const n of neighbors) {
                const nx = current.x + n.x;
                const ny = current.y + n.y;
    
                if (closedSet.has(`${nx},${ny}`)) continue;
    
                const dist = (n.x !== 0 && n.y !== 0) ? 1.414 : 1;
                
                let penalty = 0;
                if (this.isBlocked(nx, ny)) {
                    penalty = 100; 
                }
    
                const g = current.g + dist + penalty;
                const h = Math.abs(nx - endX) + Math.abs(ny - endY);
                const f = g + h;
    
                const existingNode = openSet.find(node => node.x === nx && node.y === ny);
                if (existingNode) {
                    if (g < existingNode.g) {
                        existingNode.g = g;
                        existingNode.f = f;
                        existingNode.parent = current;
                    }
                } else {
                    openSet.push({ x: nx, y: ny, g, f, parent: current });
                }
            }
        }
        return null;
      }
}
