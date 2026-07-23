import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT } from '../../constants';

/**
 * Pathfinder optimized for Annihilation-scale games (thousands+ units).
 * 
 * Architecture:
 * - JPS (Jump Point Search) for long-range pathfinding (10-100x faster than naive A*)
 * - Flow Field for mass unit movement to a single destination
 * - Heuristic: Octile distance (diagonal movement on grid)
 * - Bucket-based scheduling: path requests are queued and processed in batches
 */

const CELL = 32; // Must match MapGenerationSystem's tree collision grid

// ─── Priority Queue (Min-Heap) ────────────────────────────────────────────
class MinHeap<T> {
    private items: { key: number; value: T }[] = [];
    
    get size(): number { return this.items.length; }
    
    push(key: number, value: T): void {
        this.items.push({ key, value });
        this.siftUp(this.items.length - 1);
    }
    
    pop(): T | null {
        if (this.items.length === 0) return null;
        const top = this.items[0].value;
        const last = this.items.pop()!;
        if (this.items.length > 0) {
            this.items[0] = last;
            this.siftDown(0);
        }
        return top;
    }
    
    private siftUp(idx: number): void {
        while (idx > 0) {
            const parentIdx = (idx - 1) >> 1;
            if (this.items[idx].key >= this.items[parentIdx].key) break;
            [this.items[idx], this.items[parentIdx]] = [this.items[parentIdx], this.items[idx]];
            idx = parentIdx;
        }
    }
    
    private siftDown(idx: number): void {
        const size = this.items.length;
        while (true) {
            let smallest = idx;
            const left = (idx << 1) + 1;
            const right = left + 1;
            if (left < size && this.items[left].key < this.items[smallest].key) smallest = left;
            if (right < size && this.items[right].key < this.items[smallest].key) smallest = right;
            if (smallest === idx) break;
            [this.items[idx], this.items[smallest]] = [this.items[smallest], this.items[idx]];
            idx = smallest;
        }
    }
}

// ─── Math Helpers ─────────────────────────────────────────────────────────
const octileDistance = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
};

// ─── Path Request Queue ───────────────────────────────────────────────────
interface PathRequest {
    id: number;
    start: Phaser.Math.Vector2;
    end: Phaser.Math.Vector2;
    callback: (path: Phaser.Math.Vector2[] | null) => void;
}

export class Pathfinder {
    // Building-blocked cells (1D bit array; toggled by markGrid only)
    private blocked: Uint8Array;
    // Permanent terrain water mask — never cleared by markGrid(false)
    private waterBlocked: Uint8Array;
    private gridCols: number;
    private gridRows: number;

    // Cost map (for terrain weighting, initially all 1 = walkable)
    private costs: Uint8Array;

    // A* node tracking (recycled to avoid GC)
    private nodeG: Float64Array;
    private nodeParent: Int32Array; // packed: (px << 16) | py
    private nodeOpen: Uint8Array;   // 0=unvisited, 1=open, 2=closed
    private nodeVersion: Uint16Array; // Version stamp for clearing
    private currentVersion: number = 0;

    // Direction vectors for 8-directional movement
    private static readonly DX = [1, 1, 0, -1, -1, -1, 0, 1];
    private static readonly DY = [0, 1, 1, 1, 0, -1, -1, -1];

    // Path request queue
    private requestQueue: PathRequest[] = [];
    private nextRequestId: number = 0;
    private maxPathsPerFrame: number = 20; // Budget: paths to compute per frame

    // Flow field cache
    private flowFieldCache: Map<string, { dirX: Float64Array; dirY: Float64Array; cols: number; rows: number; targetX: number; targetY: number }> = new Map();


    // Statistics
    public pathsComputed: number = 0;
    public flowFieldsGenerated: number = 0;

    constructor() {
        this.gridCols = Math.ceil(MAP_WIDTH / CELL);
        this.gridRows = Math.ceil(MAP_HEIGHT / CELL);
        const total = this.gridCols * this.gridRows;
        
        this.blocked = new Uint8Array(total);
        this.waterBlocked = new Uint8Array(total);
        this.costs = new Uint8Array(total);
        this.costs.fill(1); // All cells walkable by default
        
        // Recycled A* arrays
        this.nodeG = new Float64Array(total);
        this.nodeParent = new Int32Array(total);
        this.nodeOpen = new Uint8Array(total);
        this.nodeVersion = new Uint16Array(total);
    }

    // ─── Grid Indexing ────────────────────────────────────────────────────
    private idx(gx: number, gy: number): number {
        return gy * this.gridCols + gx;
    }

    private coord(idx: number): { gx: number; gy: number } {
        return {
            gx: idx % this.gridCols,
            gy: Math.floor(idx / this.gridCols)
        };
    }

    private isValid(gx: number, gy: number): boolean {
        return gx >= 0 && gx < this.gridCols && gy >= 0 && gy < this.gridRows;
    }

    private gridX(worldX: number): number { return Math.floor(worldX / CELL); }
    private gridY(worldY: number): number { return Math.floor(worldY / CELL); }

    // ─── Blocking / Unblocking ─────────────────────────────────────────────
    public markGrid(x: number, y: number, width: number, height: number, blocked: boolean): void {
        const halfW = width / 2;
        const halfH = height / 2;
        const minX = Math.max(0, this.gridX(x - halfW));
        const maxX = Math.min(this.gridCols - 1, this.gridX(x + halfW));
        const minY = Math.max(0, this.gridY(y - halfH));
        const maxY = Math.min(this.gridRows - 1, this.gridY(y + halfH));

        for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
                const i = this.idx(gx, gy);
                this.blocked[i] = blocked ? 1 : 0;
            }
        }
        // Invalidate flow field cache when grid changes
        this.flowFieldCache.clear();
    }
    /** True if building or water blocks this world position. */
    public isBlocked(x: number, y: number): boolean {
        const gx = this.gridX(x);
        const gy = this.gridY(y);
        if (!this.isValid(gx, gy)) return true;
        return this.isCellBlocked(this.idx(gx, gy));
    }

    /** Apply permanent water mask from height samples at pathfinder cell centers. */
    public applyWaterMask(getHeight: (wx: number, wy: number) => number, waterLevel: number): void {
        for (let gy = 0; gy < this.gridRows; gy++) {
            for (let gx = 0; gx < this.gridCols; gx++) {
                const wx = gx * CELL + CELL / 2;
                const wy = gy * CELL + CELL / 2;
                const i = this.idx(gx, gy);
                this.waterBlocked[i] = getHeight(wx, wy) < waterLevel ? 1 : 0;
            }
        }
        this.flowFieldCache.clear();
    }

    // ─── JPS Pathfinding (Jump Point Search) ──────────────────────────────
    /**
     * Find a path using Jump Point Search - optimal for uniform-cost grids.
     * Returns array of waypoints from start to end (inclusive).
     */
    public findPath(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2): Phaser.Math.Vector2[] {
        // Clamp and snap
        const sx = this.gridX(Phaser.Math.Clamp(start.x, 0, MAP_WIDTH));
        const sy = this.gridY(Phaser.Math.Clamp(start.y, 0, MAP_HEIGHT));
        const ex = this.gridX(Phaser.Math.Clamp(end.x, 0, MAP_WIDTH));
        const ey = this.gridY(Phaser.Math.Clamp(end.y, 0, MAP_HEIGHT));

        // Same cell
        if (sx === ex && sy === ey) {
            return [new Phaser.Math.Vector2(end.x, end.y)];
        }

        // If end is blocked (building or water), find nearest unblocked
        if (this.isCellBlocked(this.idx(ex, ey))) {
            const nearest = this.findNearestUnblockedGrid(ex, ey);
            if (!nearest) return [new Phaser.Math.Vector2(start.x, start.y)];
            return this.findPath(start, new Phaser.Math.Vector2(
                nearest.gx * CELL + CELL / 2,
                nearest.gy * CELL + CELL / 2
            ));
        }

        // If start is blocked (building or water), find nearest unblocked
        if (this.isCellBlocked(this.idx(sx, sy))) {
            const nearest = this.findNearestUnblockedGrid(sx, sy);
            if (!nearest) return [new Phaser.Math.Vector2(start.x, start.y)];
            // Use nearest as start
            const newStart = new Phaser.Math.Vector2(
                nearest.gx * CELL + CELL / 2,
                nearest.gy * CELL + CELL / 2
            );
            return this.findPath(newStart, end);
        }

        // Run JPS
        const path = this.jps(sx, sy, ex, ey);
        
        if (!path || path.length === 0) {
            // No route (e.g. water barrier) — stay put, never straight-line through blocked cells
            return [new Phaser.Math.Vector2(start.x, start.y)];
        }

        this.pathsComputed++;

        // Convert grid coords to world coords (center of cell)
        return path.map(p => new Phaser.Math.Vector2(
            p.gx * CELL + CELL / 2,
            p.gy * CELL + CELL / 2
        ));
    }

    /**
     * Jump Point Search implementation.
     */
    private jps(sx: number, sy: number, ex: number, ey: number): { gx: number; gy: number }[] | null {
        // Bump version to clear stale state
        this.currentVersion = (this.currentVersion + 1) & 0xFFFF;
        const v = this.currentVersion;

        const open = new MinHeap<number>();
        const startIdx = this.idx(sx, sy);
        const endIdx = this.idx(ex, ey);

        this.nodeG[startIdx] = 0;
        this.nodeParent[startIdx] = -1;
        this.nodeVersion[startIdx] = v;
        this.nodeOpen[startIdx] = 1;

        open.push(octileDistance(sx, sy, ex, ey), startIdx);

        while (open.size > 0) {
            const currentIdx = open.pop()!;
            
            if (currentIdx === endIdx) {
                return this.reconstructPath(currentIdx, v);
            }

            this.nodeOpen[currentIdx] = 2; // Closed

            const { gx, gy } = this.coord(currentIdx);

            // Identify successors using JPS pruning
            const parentIdx = this.nodeParent[currentIdx];
            let px = -1, py = -1;
            if (parentIdx >= 0) {
                const p = this.coord(parentIdx);
                px = p.gx; py = p.gy;
            }

            const neighbors = this.getSuccessors(gx, gy, px, py);

            for (const [nx, ny] of neighbors) {
                // Jump to find the next significant node
                const jumpPoint = this.jump(nx, ny, gx, gy, ex, ey);
                if (!jumpPoint) continue;

                const nIdx = this.idx(jumpPoint.gx, jumpPoint.gy);
                if (this.nodeVersion[nIdx] === v && this.nodeOpen[nIdx] === 2) continue;

                const dist = octileDistance(gx, gy, jumpPoint.gx, jumpPoint.gy);
                const tentG = this.nodeG[currentIdx] + dist;

                if (this.nodeVersion[nIdx] !== v || this.nodeOpen[nIdx] === 0) {
                    this.nodeVersion[nIdx] = v;
                    this.nodeG[nIdx] = tentG;
                    this.nodeParent[nIdx] = currentIdx;
                    this.nodeOpen[nIdx] = 1;
                    const f = tentG + octileDistance(jumpPoint.gx, jumpPoint.gy, ex, ey);
                    open.push(f, nIdx);
                } else if (tentG < this.nodeG[nIdx]) {
                    this.nodeG[nIdx] = tentG;
                    this.nodeParent[nIdx] = currentIdx;
                    const f = tentG + octileDistance(jumpPoint.gx, jumpPoint.gy, ex, ey);
                    open.push(f, nIdx);
                }
            }
        }

        return null; // No path found
    }

    /**
     * Get pruned neighbor set based on direction from parent.
     * Uses JPS natural + forced neighbor pruning rules.
     */
    private getSuccessors(gx: number, gy: number, px: number, py: number): [number, number][] {
        const neighbors: [number, number][] = [];

        if (px < 0 && py < 0) {
            // No parent: explore all 8 directions
            for (let d = 0; d < 8; d++) {
                const nx = gx + Pathfinder.DX[d];
                const ny = gy + Pathfinder.DY[d];
                if (this.isValid(nx, ny) && !this.isCellBlocked(this.idx(nx, ny))) {
                    neighbors.push([nx, ny]);
                }
            }
            return neighbors;
        }

        // Direction from parent to current
        const dx = Math.sign(gx - px);
        const dy = Math.sign(gy - py);
        // Normalize to diagonal axis
        const dxx = Math.abs(dx);
        const dyy = Math.abs(dy);

        if (dxx === 1 && dyy === 1) {
            // Diagonal movement
            // Natural: the diagonal neighbor
            if (this.isWalkable(gx + dx, gy + dy)) neighbors.push([gx + dx, gy + dy]);
            // Natural: the cardinal neighbors in the direction
            if (this.isWalkable(gx + dx, gy)) neighbors.push([gx + dx, gy]);
            if (this.isWalkable(gx, gy + dy)) neighbors.push([gx, gy + dy]);
            // Forced neighbors for diagonal
            if (!this.isWalkable(gx - dx, gy) && this.isWalkable(gx + dx, gy)) {
                // Force the diagonal if one side is blocked
            }
            if (!this.isWalkable(gx, gy - dy) && this.isWalkable(gx, gy + dy)) {
                // Force the diagonal if one side is blocked
            }
        } else if (dxx === 1) {
            // Horizontal movement (dy = 0)
            if (this.isWalkable(gx + dx, gy)) neighbors.push([gx + dx, gy]);
            // Forced neighbors
            if (!this.isWalkable(gx, gy - 1) && this.isWalkable(gx + dx, gy - 1))
                neighbors.push([gx + dx, gy - 1]);
            if (!this.isWalkable(gx, gy + 1) && this.isWalkable(gx + dx, gy + 1))
                neighbors.push([gx + dx, gy + 1]);
        } else {
            // Vertical movement (dx = 0, dy = 1 or -1)
            if (this.isWalkable(gx, gy + dy)) neighbors.push([gx, gy + dy]);
            // Forced neighbors
            if (!this.isWalkable(gx - 1, gy) && this.isWalkable(gx - 1, gy + dy))
                neighbors.push([gx - 1, gy + dy]);
            if (!this.isWalkable(gx + 1, gy) && this.isWalkable(gx + 1, gy + dy))
                neighbors.push([gx + 1, gy + dy]);
        }

        return neighbors;
    }

    /**
     * Jump function: traverse until hitting a "jump point".
     */
    private jump(gx: number, gy: number, px: number, py: number, ex: number, ey: number): { gx: number; gy: number } | null {
        if (!this.isWalkable(gx, gy)) return null;
        if (gx === ex && gy === ey) return { gx, gy };

        const dx = gx - px;
        const dy = gy - py;
        const dxx = Math.abs(dx);
        const dyy = Math.abs(dy);

        // Check for forced neighbors
        if (dxx === 1 && dyy === 1) {
            // Diagonal: check if there's a forced neighbor
            if ((!this.isWalkable(gx - dx, gy) && this.isWalkable(gx - dx, gy + dy)) ||
                (!this.isWalkable(gx, gy - dy) && this.isWalkable(gx + dx, gy - dy))) {
                return { gx, gy };
            }
            // Recursively jump in cardinal directions first
            if (this.jump(gx + dx, gy, gx, gy, ex, ey) || this.jump(gx, gy + dy, gx, gy, ex, ey)) {
                return { gx, gy };
            }
            // Continue diagonal jump
            if (this.isWalkable(gx + dx, gy + dy)) {
                return this.jump(gx + dx, gy + dy, gx, gy, ex, ey);
            }
        } else if (dxx === 1) {
            // Horizontal
            if ((!this.isWalkable(gx, gy - 1) && this.isWalkable(gx + dx, gy - 1)) ||
                (!this.isWalkable(gx, gy + 1) && this.isWalkable(gx + dx, gy + 1))) {
                return { gx, gy };
            }
            if (this.isWalkable(gx + dx, gy)) {
                return this.jump(gx + dx, gy, gx, gy, ex, ey);
            }
        } else {
            // Vertical
            if ((!this.isWalkable(gx - 1, gy) && this.isWalkable(gx - 1, gy + dy)) ||
                (!this.isWalkable(gx + 1, gy) && this.isWalkable(gx + 1, gy + dy))) {
                return { gx, gy };
            }
            if (this.isWalkable(gx, gy + dy)) {
                return this.jump(gx, gy + dy, gx, gy, ex, ey);
            }
        }

        return null;
    }

    private isCellBlocked(i: number): boolean {
        return this.blocked[i] === 1 || this.waterBlocked[i] === 1;
    }

    private isWalkable(gx: number, gy: number): boolean {
        if (!this.isValid(gx, gy)) return false;
        return !this.isCellBlocked(this.idx(gx, gy));
    }

    private reconstructPath(endIdx: number, version: number): { gx: number; gy: number }[] {
        const path: { gx: number; gy: number }[] = [];
        let current = endIdx;
        while (current >= 0 && this.nodeVersion[current] === version) {
            const c = this.coord(current);
            path.unshift(c);
            const parent = this.nodeParent[current];
            if (parent < 0) break;
            current = parent;
        }
        return path;
    }

    // ─── Flow Field Generation ────────────────────────────────────────────
    /**
     * Generate a flow field for mass unit movement.
     * All units moving to the same destination share one flow field.
     * Returns a lookup function that gives direction vectors.
     */
    public generateFlowField(targetX: number, targetY: number): { dirX: Float64Array; dirY: Float64Array; cols: number; rows: number; targetX: number; targetY: number } {
        const tgx = this.gridX(targetX);
        const tgy = this.gridY(targetY);
        const key = `${tgx},${tgy}`;

        const cached = this.flowFieldCache.get(key);
        if (cached) return cached;

        const total = this.gridCols * this.gridRows;
        const integration = new Float64Array(total);
        const dirX = new Float64Array(total);
        const dirY = new Float64Array(total);
        integration.fill(Number.MAX_VALUE);

        // BFS from target outward
        const queue: number[] = [];
        const targetIdx = this.idx(tgx, tgy);
        
        if (!this.isCellBlocked(targetIdx)) {
            integration[targetIdx] = 0;
            dirX[targetIdx] = 0;
            dirY[targetIdx] = 0;
            queue.push(targetIdx);
        } else {
            // Target blocked: seed from neighbors
            for (let d = 0; d < 8; d++) {
                const nx = tgx + Pathfinder.DX[d];
                const ny = tgy + Pathfinder.DY[d];
                if (this.isWalkable(nx, ny)) {
                    const nIdx = this.idx(nx, ny);
                    integration[nIdx] = 1;
                    dirX[nIdx] = -Pathfinder.DX[d];
                    dirY[nIdx] = -Pathfinder.DY[d];
                    queue.push(nIdx);
                }
            }
        }

        // BFS propagation (Dijkstra-like)
        let qIdx = 0;
        while (qIdx < queue.length) {
            const currentIdx = queue[qIdx++];
            const cur = this.coord(currentIdx);
            const baseCost = integration[currentIdx];

            for (let d = 0; d < 8; d++) {
                const nx = cur.gx + Pathfinder.DX[d];
                const ny = cur.gy + Pathfinder.DY[d];
                if (!this.isWalkable(nx, ny)) continue;

                const nIdx = this.idx(nx, ny);
                // Diagonal movement costs more
                const moveCost = (Pathfinder.DX[d] !== 0 && Pathfinder.DY[d] !== 0) ? Math.SQRT2 : 1;
                const newCost = baseCost + moveCost * this.costs[nIdx];

                if (newCost < integration[nIdx]) {
                    integration[nIdx] = newCost;
                    dirX[nIdx] = -Pathfinder.DX[d];
                    dirY[nIdx] = -Pathfinder.DY[d];
                    queue.push(nIdx);
                }
            }
        }

        this.flowFieldsGenerated++;
        const result = { dirX, dirY, cols: this.gridCols, rows: this.gridRows, targetX, targetY };
        
        // Cache (invalidate when blocks change)
        if (this.flowFieldCache.size > 10) {
            // LRU: delete oldest
            const firstKey = this.flowFieldCache.keys().next().value;
            if (firstKey !== undefined) this.flowFieldCache.delete(firstKey);
        }
        this.flowFieldCache.set(key, result);

        return result;
    }

    /**
     * Get flow direction for a specific world position.
     */
    public getFlowDirection(flowField: { dirX: Float64Array; dirY: Float64Array; cols: number; rows: number }, x: number, y: number): { x: number; y: number } | null {
        const gx = this.gridX(x);
        const gy = this.gridY(y);
        if (!this.isValid(gx, gy)) return null;
        
        const idx = this.idx(gx, gy);
        if (this.isCellBlocked(idx)) return null;

        const dx = flowField.dirX[idx];
        const dy = flowField.dirY[idx];

        // No direction = arrived or unreachable
        if (dx === 0 && dy === 0) {
            return { x: 0, y: 0 };
        }

        // Normalize
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return null;
        return { x: dx / len, y: dy / len };
    }

    // ─── Path Request Queue (for async/batched pathfinding) ───────────────
    /**
     * Queue a pathfinding request. Callback fires when path is computed.
     * Use this for non-urgent paths to spread computation across frames.
     */
    public requestPath(
        start: Phaser.Math.Vector2,
        end: Phaser.Math.Vector2,
        callback: (path: Phaser.Math.Vector2[] | null) => void
    ): number {
        const id = this.nextRequestId++;
        this.requestQueue.push({ id, start, end, callback });
        return id;
    }

    /**
     * Cancel a queued path request.
     */
    public cancelRequest(id: number): void {
        this.requestQueue = this.requestQueue.filter(r => r.id !== id);
    }

    /**
     * Process queued path requests (call once per frame).
     * Computes up to maxPathsPerFrame paths.
     */
    public processQueue(): void {
        let processed = 0;
        while (this.requestQueue.length > 0 && processed < this.maxPathsPerFrame) {
            const req = this.requestQueue.shift()!;
            const path = this.findPath(req.start, req.end);
            req.callback(path);
            processed++;
        }
    }

    /**
     * Budgeted queue processing for large unit counts.
     * Only processes up to `budget` items per call, preserving rest for next frame.
     */
    public processQueueBudgeted(budget: number): void {
        let processed = 0;
        while (this.requestQueue.length > 0 && processed < budget) {
            const req = this.requestQueue.shift()!;
            const path = this.findPath(req.start, req.end);
            req.callback(path);
            processed++;
        }
    }

    // ─── Utility ───────────────────────────────────────────────────────────
    private findNearestUnblockedGrid(gx: number, gy: number): { gx: number; gy: number } | null {
        // Search expanding rings
        for (let radius = 1; radius <= 15; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    const nx = gx + dx;
                    const ny = gy + dy;
                    if (this.isWalkable(nx, ny)) {
                        return { gx: nx, gy: ny };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Get cached path memory size for diagnostics.
     */
    public getCacheStats(): { flowFieldCaches: number; queueSize: number; pathsComputed: number; flowFieldsGenerated: number } {
        return {
            flowFieldCaches: this.flowFieldCache.size,
            queueSize: this.requestQueue.length,
            pathsComputed: this.pathsComputed,
            flowFieldsGenerated: this.flowFieldsGenerated
        };
    }
}
