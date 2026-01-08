import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../../constants';

interface PathNode {
    x: number;
    y: number;
    g: number;
    f: number;
    parent: PathNode | null;
}

export class Pathfinder {
    public navGrid: boolean[][] = [];
    public gridCols: number = 0;
    public gridRows: number = 0;

    constructor() {
        this.gridCols = Math.ceil(MAP_WIDTH / TILE_SIZE);
        this.gridRows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
        for(let y=0; y<this.gridRows; y++) {
            this.navGrid[y] = [];
            for(let x=0; x<this.gridCols; x++) {
                this.navGrid[y][x] = false;
            }
        }
    }

    public markGrid(x: number, y: number, width: number, height: number, blocked: boolean) {
        const gx = Math.floor((x - width/2) / TILE_SIZE);
        const gy = Math.floor((y - height/2) / TILE_SIZE);
        const gw = Math.ceil(width / TILE_SIZE);
        const gh = Math.ceil(height / TILE_SIZE);

        for(let cy = gy; cy < gy + gh; cy++) {
            for(let cx = gx; cx < gx + gw; cx++) {
                if(cy >= 0 && cy < this.gridRows && cx >= 0 && cx < this.gridCols) {
                    this.navGrid[cy][cx] = blocked; 
                }
            }
        }
    }

    public findPath(start: Phaser.Math.Vector2, target: Phaser.Math.Vector2): Phaser.Math.Vector2[] | null {
        const startX = Math.floor(start.x / TILE_SIZE);
        const startY = Math.floor(start.y / TILE_SIZE);
        let endX = Math.floor(target.x / TILE_SIZE);
        let endY = Math.floor(target.y / TILE_SIZE);
    
        endX = Phaser.Math.Clamp(endX, 0, this.gridCols - 1);
        endY = Phaser.Math.Clamp(endY, 0, this.gridRows - 1);
    
        // If target blocked, find nearest free neighbor
        if (this.navGrid[endY] && this.navGrid[endY][endX]) {
            let found = false;
            for (let r = 1; r < 5; r++) {
                for (let y = endY - r; y <= endY + r; y++) {
                    for (let x = endX - r; x <= endX + r; x++) {
                        if (y >= 0 && y < this.gridRows && x >= 0 && x < this.gridCols && !this.navGrid[y][x]) {
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
    
        while (openSet.length > 0) {
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
    
                if (nx < 0 || ny < 0 || nx >= this.gridCols || ny >= this.gridRows) continue;
                if (closedSet.has(`${nx},${ny}`)) continue;
    
                const dist = (n.x !== 0 && n.y !== 0) ? 1.414 : 1;
                
                let penalty = 0;
                if (this.navGrid[ny][nx]) {
                    penalty = 50; 
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