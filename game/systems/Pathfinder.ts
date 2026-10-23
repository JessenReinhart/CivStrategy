    /**
     * Create Pathfinder with actual map dimensions (dynamic size supported).
     * Pass mapWidth/mapHeight from MainScene to enable correct coordinate handling on LARGE maps.
     */
import Phaser from 'phaser';
import { MAP_WIDTH, MAP_HEIGHT, BIOME_PATH_COSTS, SEASON_CONFIG, TERRAIN_CONFIG } from '../../constants';
import { Season } from '../../types';

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

interface FlowField {
    dirX: Float64Array;
    dirY: Float64Array;
    cols: number;
    rows: number;
    targetX: number;
    targetY: number;
    version: number;
}

type FlowFieldRef = Pick<FlowField, 'dirX' | 'dirY' | 'cols' | 'rows'> & Partial<Pick<FlowField, 'targetX' | 'targetY' | 'version'>>;

export class Pathfinder {
    // Building-blocked cells (1D bit array; toggled by markGrid only)
    private blocked: Uint8Array;
    // Permanent terrain water mask — never cleared by markGrid(false)
    private waterBlocked: Uint8Array;
    private gridCols: number;
    private mapWidth: number;
    private mapHeight: number;
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

    // Flow field cache (version-stamped: rejected if gridVersion changed)
    private flowFieldCache: Map<string, FlowField> = new Map();

    // Flow field versioning: bumped on navigation-field changes so active shared refs refresh
    private gridVersion = 0;

    // Queue depth cap: drop oldest beyond this to prevent unbounded growth under load
    private maxQueueDepth = 500;
    private droppedRequests = 0;

    // Per-frame profiling (reset via beginFrame)
    public frameStats = { jpsCalls: 0, pathMs: 0, flowFieldRebuilds: 0, flowFieldMs: 0, queueProcessed: 0, queueDropped: 0 };
    // Cumulative totals (never reset; PERF report divides by frames)
    public totals = { jpsCalls: 0, pathMs: 0, flowFieldRebuilds: 0, flowFieldMs: 0, queueProcessed: 0, queueDropped: 0, frames: 0 };

    // Statistics
    public pathsComputed: number = 0;
    public flowFieldsGenerated: number = 0;

    constructor(mapWidth: number = MAP_WIDTH, mapHeight: number = MAP_HEIGHT) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.gridCols = Math.ceil(mapWidth / CELL);
        this.gridRows = Math.ceil(mapHeight / CELL);
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

    private invalidateFlowFields(): void {
        this.gridVersion++;
        this.flowFieldCache.clear();
    }

    // ─── Terrain Cost Layer ─────────────────────────────────────────────────
    /** Recompute per-cell path costs from biome + seasonal multiplier. */
    public updateTerrainCosts(
        terrainSystem: { getBiomeAt(wx: number, wy: number): string; isRiverAt?(wx: number, wy: number): boolean },
        currentSeason?: Season
    ): void {
        const halfCell = CELL / 2;
        const seasonMult = currentSeason != null
            ? SEASON_CONFIG[currentSeason].movementCostMult
            : 1.0;
        for (let gy = 0; gy < this.gridRows; gy++) {
            for (let gx = 0; gx < this.gridCols; gx++) {
                const wx = gx * CELL + halfCell;
                const wy = gy * CELL + halfCell;
                const biome = terrainSystem.getBiomeAt(wx, wy);
                const baseCost = BIOME_PATH_COSTS[biome] ?? 1.0;
                // Apply river crossing penalty if terrain system supports it
                const riverMult = terrainSystem.isRiverAt?.(wx, wy) ? TERRAIN_CONFIG.RIVER_PATH_COST : 1.0;
                const raw = baseCost * seasonMult * riverMult;
                this.costs[this.idx(gx, gy)] = Math.min(255, Math.max(1, Math.round(raw)));
            }
        }
        this.invalidateFlowFields();
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
        const nextValue = blocked ? 1 : 0;
        let changed = false;

        for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
                const i = this.idx(gx, gy);
                if (this.blocked[i] === nextValue) continue;
                this.blocked[i] = nextValue;
                changed = true;
            }
        }
        if (changed) this.invalidateFlowFields();
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
        this.invalidateFlowFields();
    }

    // ─── JPS Pathfinding (Jump Point Search) ──────────────────────────────
    /**
     * Find a path using Jump Point Search - optimal for uniform-cost grids.
     * Returns array of waypoints from start to end (inclusive).
     */
    public findPath(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2): Phaser.Math.Vector2[] {
        const _pfT0 = performance.now();
        const sx = this.gridX(Phaser.Math.Clamp(start.x, 0, this.mapWidth));
        const sy = this.gridY(Phaser.Math.Clamp(start.y, 0, this.mapHeight));
        const ex = this.gridX(Phaser.Math.Clamp(end.x, 0, this.mapWidth));
        const ey = this.gridY(Phaser.Math.Clamp(end.y, 0, this.mapHeight));

        // Same cell
        if (sx === ex && sy === ey) {
            const _ms = performance.now() - _pfT0; this.frameStats.pathMs += _ms; this.totals.pathMs += _ms;
            return [new Phaser.Math.Vector2(end.x, end.y)];
        }

        // If end is blocked (building or water), find nearest unblocked
        if (this.isCellBlocked(this.idx(ex, ey))) {
            const nearest = this.findNearestUnblockedGrid(ex, ey);
            if (!nearest) { const _ms = performance.now() - _pfT0; this.frameStats.pathMs += _ms; this.totals.pathMs += _ms; return [new Phaser.Math.Vector2(start.x, start.y)]; }
            return this.findPath(start, new Phaser.Math.Vector2(
                nearest.gx * CELL + CELL / 2,
                nearest.gy * CELL + CELL / 2
            ));
        }

        // If start is blocked (building or water), find nearest unblocked
        if (this.isCellBlocked(this.idx(sx, sy))) {
            const nearest = this.findNearestUnblockedGrid(sx, sy);
            if (!nearest) { const _ms = performance.now() - _pfT0; this.frameStats.pathMs += _ms; this.totals.pathMs += _ms; return [new Phaser.Math.Vector2(start.x, start.y)]; }
            const newStart = new Phaser.Math.Vector2(
                nearest.gx * CELL + CELL / 2,
                nearest.gy * CELL + CELL / 2
            );
            return this.findPath(newStart, end);
        }

        // Run JPS
        this.frameStats.jpsCalls++;
        this.totals.jpsCalls++;
        const path = this.jps(sx, sy, ex, ey);

        if (!path || path.length === 0) {
            const _ms = performance.now() - _pfT0; this.frameStats.pathMs += _ms; this.totals.pathMs += _ms;
            return [new Phaser.Math.Vector2(start.x, start.y)];
        }

        this.pathsComputed++;

        // Convert grid coords to world coords, preserving exact start/end pixel
        // positions so formation offsets aren't snapped to cell centers.
        const waypoints = path.map((p, i) => {
            if (i === 0) return new Phaser.Math.Vector2(start.x, start.y);
            if (i === path.length - 1) return new Phaser.Math.Vector2(end.x, end.y);
            return new Phaser.Math.Vector2(
                p.gx * CELL + CELL / 2,
                p.gy * CELL + CELL / 2
            );
        });

        // String-pull: remove intermediate waypoints that have a clear line of sight
        // to eliminate jagged 45°/90° zig-zags across open terrain.
        const pruned = this.prunePath(waypoints);

        const _ms = performance.now() - _pfT0; this.frameStats.pathMs += _ms; this.totals.pathMs += _ms;
        return pruned;
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
            // Forced neighbors for diagonal pruning (E5): when both orthogonal
            // walk constraints collapse, the two diagonal-facing cardinal cells
            // are forced onto the open list.
            if (!this.isWalkable(gx - dx, gy) && this.isWalkable(gx - dx, gy + dy)) {
                neighbors.push([gx - dx, gy + dy]);
            }
            if (!this.isWalkable(gx, gy - dy) && this.isWalkable(gx + dx, gy - dy)) {
                neighbors.push([gx + dx, gy - dy]);
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

    /**
     * Line of sight check between two world positions using grid DDA (Amanatides-Woo).
     * Returns true if a straight ray from `from` to `to` does not intersect any blocked cells
     * and does not cut corners diagonally across blocked cells.
     */
    public hasLineOfSight(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): boolean {
        let gx = this.gridX(from.x);
        let gy = this.gridY(from.y);
        const endGx = this.gridX(to.x);
        const endGy = this.gridY(to.y);

        if (!this.isValid(gx, gy) || !this.isValid(endGx, endGy)) return false;
        if (!this.isWalkable(gx, gy) || !this.isWalkable(endGx, endGy)) return false;
        if (gx === endGx && gy === endGy) return true;

        const dx = to.x - from.x;
        const dy = to.y - from.y;

        const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);

        let tMaxX = stepX > 0
            ? ((gx + 1) * CELL - from.x) / dx
            : (stepX < 0 ? (gx * CELL - from.x) / dx : Infinity);

        let tMaxY = stepY > 0
            ? ((gy + 1) * CELL - from.y) / dy
            : (stepY < 0 ? (gy * CELL - from.y) / dy : Infinity);

        const tDeltaX = stepX !== 0 ? (stepX * CELL) / dx : Infinity;
        const tDeltaY = stepY !== 0 ? (stepY * CELL) / dy : Infinity;

        while (gx !== endGx || gy !== endGy) {
            if (Math.abs(tMaxX - tMaxY) < 1e-8) {
                // Ray crosses corner: ensure both adjacent orthogonal cells are walkable
                if (!this.isWalkable(gx + stepX, gy) || !this.isWalkable(gx, gy + stepY)) {
                    return false;
                }
                gx += stepX;
                gy += stepY;
                tMaxX += tDeltaX;
                tMaxY += tDeltaY;
            } else if (tMaxX < tMaxY) {
                gx += stepX;
                tMaxX += tDeltaX;
            } else {
                gy += stepY;
                tMaxY += tDeltaY;
            }

            if (!this.isWalkable(gx, gy)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Greedy string pulling / raycast path pruning:
     * Shortcuts unnecessary intermediate waypoints when a clear line of sight exists,
     * smoothing rigid 45°/90° JPS jump turns into direct straight-line corridors.
     */
    public prunePath(waypoints: Phaser.Math.Vector2[]): Phaser.Math.Vector2[] {
        if (waypoints.length <= 2) return waypoints;

        const pruned: Phaser.Math.Vector2[] = [waypoints[0]];
        let current = 0;

        while (current < waypoints.length - 1) {
            let furthest = current + 1;
            for (let test = waypoints.length - 1; test > current; test--) {
                if (this.hasLineOfSight(waypoints[current], waypoints[test])) {
                    furthest = test;
                    break;
                }
            }
            pruned.push(waypoints[furthest]);
            current = furthest;
        }

        return pruned;
    }

    // ─── Flow Field Generation ────────────────────────────────────────────
    /**
     * Generate a flow field for mass unit movement.
     * All units moving to the same destination share one flow field.
     * Returns a lookup function that gives direction vectors.
     */
    public generateFlowField(targetX: number, targetY: number): FlowField {
        const tgx = this.gridX(targetX);
        const tgy = this.gridY(targetY);
        const key = `${tgx},${tgy}`;

        const cached = this.flowFieldCache.get(key);
        if (cached) return cached;

        const genT0 = performance.now();
        const total = this.gridCols * this.gridRows;
        const integration = new Float64Array(total);
        const dirX = new Float64Array(total);
        const dirY = new Float64Array(total);
        integration.fill(Number.MAX_VALUE);

        // Priority queue (MinHeap) Dijkstra propagation from target outward (E3)
        const queue = new MinHeap<number>();
        const targetIdx = this.idx(tgx, tgy);
        
        if (!this.isCellBlocked(targetIdx)) {
            integration[targetIdx] = 0;
            dirX[targetIdx] = 0;
            dirY[targetIdx] = 0;
            queue.push(0, targetIdx);
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
                    queue.push(1, nIdx);
                }
            }
        }

        // Dijkstra propagation: lower integration costs expand first
        while (queue.size > 0) {
            const currentIdx = queue.pop();
            if (currentIdx === null) break;
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
                    queue.push(newCost, nIdx);
                }
            }
        }

        this.flowFieldsGenerated++;
        const result: FlowField = { dirX, dirY, cols: this.gridCols, rows: this.gridRows, targetX, targetY, version: this.gridVersion };
        
        // Cache (invalidate when blocks change)
        if (this.flowFieldCache.size > 10) {
            // LRU: delete oldest
            const firstKey = this.flowFieldCache.keys().next().value;
            if (firstKey !== undefined) this.flowFieldCache.delete(firstKey);
        }
        this.flowFieldCache.set(key, result);

        const genMs = performance.now() - genT0;
        this.frameStats.flowFieldMs += genMs;
        this.frameStats.flowFieldRebuilds++;
        this.totals.flowFieldMs += genMs;
        this.totals.flowFieldRebuilds++;
        return result;
    }

    /**
     * Get flow direction for a specific world position.
     */
    public getFlowDirection(flowField: FlowFieldRef, x: number, y: number): { x: number; y: number } | null {
        if (flowField.version !== undefined && flowField.version !== this.gridVersion) {
            if (flowField.targetX === undefined || flowField.targetY === undefined) return null;
            const refreshed = this.generateFlowField(flowField.targetX, flowField.targetY);
            flowField.dirX = refreshed.dirX;
            flowField.dirY = refreshed.dirY;
            flowField.cols = refreshed.cols;
            flowField.rows = refreshed.rows;
            flowField.targetX = refreshed.targetX;
            flowField.targetY = refreshed.targetY;
            flowField.version = refreshed.version;
        }

        // Primary cell check
        const gx = this.gridX(x);
        const gy = this.gridY(y);
        if (!this.isValid(gx, gy)) return null;
        const primaryIdx = this.idx(gx, gy);
        if (this.isCellBlocked(primaryIdx)) return null;

        const primaryDx = flowField.dirX[primaryIdx];
        const primaryDy = flowField.dirY[primaryIdx];

        // Destination cell or unreachable: no interpolation needed
        if (primaryDx === 0 && primaryDy === 0) {
            return { x: 0, y: 0 };
        }

        // Bilinear interpolation across the 4 nearest cell centers for smooth
        // direction transitions instead of 45°/90° snapping at cell boundaries.
        const fxRaw = x / CELL - 0.5;
        const fyRaw = y / CELL - 0.5;
        const gx0 = Math.floor(fxRaw);
        const gy0 = Math.floor(fyRaw);
        const fx = fxRaw - gx0;
        const fy = fyRaw - gy0;

        let bx = 0;
        let by = 0;
        let wSum = 0;

        for (let oi = 0; oi <= 1; oi++) {
            for (let oj = 0; oj <= 1; oj++) {
                const cx = gx0 + oi;
                const cy = gy0 + oj;
                if (!this.isValid(cx, cy)) continue;
                const ci = this.idx(cx, cy);
                if (this.isCellBlocked(ci)) continue;
                const cdx = flowField.dirX[ci];
                const cdy = flowField.dirY[ci];
                if (cdx === 0 && cdy === 0) continue; // destination / unreachable
                const w = (oi === 0 ? 1 - fx : fx) * (oj === 0 ? 1 - fy : fy);
                bx += cdx * w;
                by += cdy * w;
                wSum += w;
            }
        }

        // If no valid neighbors contributed, fall back to primary cell direction
        if (wSum < 0.001) {
            const len = Math.sqrt(primaryDx * primaryDx + primaryDy * primaryDy);
            if (len < 0.001) return null;
            return { x: primaryDx / len, y: primaryDy / len };
        }

        bx /= wSum;
        by /= wSum;

        const len = Math.sqrt(bx * bx + by * by);
        if (len < 0.001) return null;
        return { x: bx / len, y: by / len };
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
        if (this.requestQueue.length >= (this.maxQueueDepth ?? 500)) {
            this.frameStats.queueDropped++;
            this.totals.queueDropped++;
            return -1;
        }
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
        this.frameStats.queueProcessed += processed;
        this.totals.queueProcessed += processed;
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
        this.frameStats.queueProcessed += processed;
        this.totals.queueProcessed += processed;
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

    /** Reset per-frame counters. Call at start of each game frame. */
    public beginFrame(): void {
        this.frameStats.jpsCalls = 0;
        this.frameStats.pathMs = 0;
        this.frameStats.flowFieldRebuilds = 0;
        this.frameStats.flowFieldMs = 0;
        this.frameStats.queueProcessed = 0;
        this.frameStats.queueDropped = 0;
        this.totals.frames++;
    }

    /** Get diagnostics snapshot including per-frame averages. */
    public getCacheStats(): { flowFieldCaches: number; queueSize: number; pathsComputed: number; flowFieldsGenerated: number; gridVersion: number; queueDepth: number; droppedRequests: number } {
        return {
            flowFieldCaches: this.flowFieldCache.size,
            queueSize: this.requestQueue.length,
            pathsComputed: this.pathsComputed,
            flowFieldsGenerated: this.flowFieldsGenerated,
            gridVersion: this.gridVersion,
            queueDepth: this.requestQueue.length,
            droppedRequests: this.droppedRequests,
        };
    }

    /** Averages-per-frame from cumulative totals. Used by PERF report. */
    public getPerfReport(): { avgPathMs: number; avgFlowMs: number; avgJpsCalls: number; avgQueueProcessed: number; avgQueueDropped: number; frames: number } {
        const n = Math.max(1, this.totals.frames);
        return {
            avgPathMs: this.totals.pathMs / n,
            avgFlowMs: this.totals.flowFieldMs / n,
            avgJpsCalls: this.totals.jpsCalls / n,
            avgQueueProcessed: this.totals.queueProcessed / n,
            avgQueueDropped: this.totals.queueDropped / n,
            frames: this.totals.frames,
        };
    }
}
