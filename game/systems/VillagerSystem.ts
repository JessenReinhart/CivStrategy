import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { UnitState, VillagerData, BuildingType } from '../../types';
import { VILLAGER_SPEED, VILLAGER_CARRY_CAPACITY, VILLAGER_GATHER_RATE_MS, GOLD_MINE_SEARCH_RADIUS } from '../../constants';
import { toIsoElev } from '../utils/iso';
import { WORLD_CHARACTER_SCALE } from '../worldScale';

// ── Carry-bar colors by resource type ─────────────────────────────────
const CARRY_COLORS: Record<string, number> = {
    wood: 0x8B4513,
    food: 0xFACC15,
    gold: 0xFFD700,
};

const TREE_SEARCH_RADIUS = 300;
const PATH_ARRIVAL_TOLERANCE = 64;
const VILLAGER_SPRITE_SCALE = 0.22 * WORLD_CHARACTER_SCALE;
const VILLAGER_SHADOW_WIDTH = 12 * WORLD_CHARACTER_SCALE;
const VILLAGER_SHADOW_HEIGHT = 6 * WORLD_CHARACTER_SCALE;

// Wood is the opening construction bottleneck. Keep the shared 2.5s gather
// cadence, but make each chop worth more and amortize travel over a larger load.
// Food and gold retain their existing rates and carry capacities.
const WOOD_GATHER_AMOUNT_PER_TICK = 2;
const WOOD_CARRY_CAPACITY = 20;

type PathResult = 'moving' | 'arrived' | 'unreachable';
type VillagerFacing = 'north' | 'south' | 'east' | 'west';

const VILLAGER_FACING_TEXTURES: Record<VillagerFacing, string> = {
    north: 'villager_north',
    south: 'villager_south',
    east: 'villager_east',
    west: 'villager_west',
};

export function facingFromMovement(dx: number, dy: number): VillagerFacing {
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
    return dy >= 0 ? 'south' : 'north';
}

export class VillagerSystem {
    private scene: MainScene;
    private villagers: VillagerData[] = [];
    private nextId: number = 0;

    /** Carry-bar rectangles keyed by villager id */
    private carryVisuals: Map<string, Phaser.GameObjects.Rectangle> = new Map();

    constructor(scene: MainScene) {
        this.scene = scene;
    }

    // ──────────────────────────────────────────────────────────────────────
    //  SPAWN
    // ──────────────────────────────────────────────────────────────────────

    public spawnVillager(x: number, y: number, owner: number = 0): VillagerData {
        const id = `villager_${this.nextId++}`;

        const visual = this.scene.add.container(0, 0);
        this.scene.worldVisuals.add(visual);
        if (this.scene.worldLayer) this.scene.worldLayer.add(visual);
        if (this.scene.uiCamera) this.scene.uiCamera.ignore(visual);

        const primaryColor = this.scene.getFactionColor(owner);
        const shadow = this.scene.add.graphics();
        shadow.fillStyle(primaryColor, 0.35).fillEllipse(0, 0, VILLAGER_SHADOW_WIDTH, VILLAGER_SHADOW_HEIGHT);
        const sprite = this.scene.add.image(0, 0, VILLAGER_FACING_TEXTURES.south)
            .setOrigin(0.5, 0.91)
            .setScale(VILLAGER_SPRITE_SCALE);
        visual.add([
            shadow,
            sprite,
        ]);
        visual.setData('villagerSprite', sprite);
        visual.setData('villagerFacing', 'south');

        if (!this.scene.worldLayer) this.scene.add.existing(visual);

        const iso = toIsoElev(x, y, this.scene.terrainSystem.getHeightAt(x, y));
        visual.setPosition(iso.x, iso.y).setDepth(iso.y);

        const villager: VillagerData = {
            id,
            x,
            y,
            owner,
            state: UnitState.IDLE,
            visual,
            path: undefined,
            pathStep: 0,
            jobBuilding: undefined,
            // Spatial economy carry state
            carryAmount: 0,
            carryType: null,
            gatherTimer: 0,
            targetResource: undefined,
        };

        this.villagers.push(villager);

        if (owner === 0) {
            this.scene.population++;
        }

        return villager;
    }

    // ──────────────────────────────────────────────────────────────────────
    //  UPDATE LOOP
    // ──────────────────────────────────────────────────────────────────────

    public update(_time: number, delta: number): void {
        for (let i = 0; i < this.villagers.length; i++) {
            this.updateVillagerLogic(this.villagers[i], delta);
        }
    }

    private updateVillagerLogic(villager: VillagerData, delta: number): void {
        // ── PATH FOLLOWING ──
        if (villager.path && villager.path.length > 0) {
            if (villager.pathStep !== undefined && villager.pathStep >= villager.path.length) {
                const arrivedState = villager.state;
                villager.path = undefined;
                villager.pathStep = 0;

                switch (arrivedState) {
                    case UnitState.MOVING_TO_WORK:
                        this.startWorking(villager);
                        break;
                    case UnitState.CARRYING:
                        this.depositCarry(villager);
                        break;
                    case UnitState.GATHERING:
                        // Arrived at resource — reset timer, gathering starts next tick
                        villager.gatherTimer = 0;
                        break;
                    case UnitState.MOVING_TO_RALLY:
                        villager.state = UnitState.IDLE;
                        villager.rallyPoint = undefined; // Arrived — allow future rally moves if pushed far away again
                        break;
                }
                return;
            }

            const next = villager.path[villager.pathStep!];
            const dist = Phaser.Math.Distance.Between(villager.x, villager.y, next.x, next.y);
            if (dist < 4) {
                villager.pathStep!++;
            } else {
                const dt = delta / 1000;
                const angle = Phaser.Math.Angle.Between(villager.x, villager.y, next.x, next.y);
                this.updateFacing(villager, next.x - villager.x, next.y - villager.y);
                villager.x += Math.cos(angle) * VILLAGER_SPEED * dt;
                villager.y += Math.sin(angle) * VILLAGER_SPEED * dt;
                this.syncVisual(villager);
            }
            return; // Don't run state logic while following a path
        }

        // ── STATE MACHINE (no active path) ──
        switch (villager.state) {
            case UnitState.WORKING:
                this.startWorking(villager);
                break;
            case UnitState.GATHERING:
                this.processGathering(villager, delta);
                break;
            case UnitState.CARRYING:
                // Arrived at dropsite without a path — deposit immediately
                this.depositCarry(villager);
                break;
            // IDLE and MOVING_TO_RALLY wait for external assignment.
            // MOVING_TO_WORK should always own a path; assignJob resolves the
            // adjacent/unreachable one-point cases before entering this loop.
        }
    }

    private updateFacing(villager: VillagerData, dx: number, dy: number): void {
        const visual = villager.visual;
        if (!visual) return;

        const facing = facingFromMovement(dx, dy);
        if (visual.getData('villagerFacing') === facing) return;

        const sprite = visual.getData('villagerSprite') as Phaser.GameObjects.Image | undefined;
        if (!sprite) return;
        sprite.setTexture(VILLAGER_FACING_TEXTURES[facing]);
        visual.setData('villagerFacing', facing);
    }

    // ──────────────────────────────────────────────────────────────────────
    //  STATE: WORKING — dispatch by building type
    // ──────────────────────────────────────────────────────────────────────

    private startWorking(villager: VillagerData): void {
        const bld = villager.jobBuilding;
        if (!bld) { this.clearJobBuilding(villager); villager.state = UnitState.IDLE; return; }

        const def = (bld as Phaser.GameObjects.Image).getData('def') as { type: BuildingType } | undefined;
        // Gold mine resource nodes have no building def — route directly to gold loop
        if (!def && (bld as Phaser.GameObjects.Image).getData('isGoldMine')) {
            this.beginGoldLoop(villager);
            return;
        }
        if (!def) { this.clearJobBuilding(villager); villager.state = UnitState.IDLE; return; }
        if (def.type === BuildingType.TOWN_CENTER) {
            this.beginGoldLoop(villager);
            return;
        }
        switch (def.type) {
            case BuildingType.LUMBER_CAMP:
                this.beginLumberLoop(villager);
                break;
            case BuildingType.FARM:
                this.beginFarmLoop(villager);
                break;
            case BuildingType.HUNTERS_LODGE:
                // Passive income remains assigned; worker is considered working.
                villager.state = UnitState.WORKING;
                break;
            default:
                this.clearJobBuilding(villager);
                villager.state = UnitState.IDLE;
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  LUMBER CAMP carry loop
    // ──────────────────────────────────────────────────────────────────────

    private beginLumberLoop(villager: VillagerData): void {
        const tree = this.findNearestTree(villager.x, villager.y);
        if (!tree) { this.clearJobBuilding(villager); villager.state = UnitState.IDLE; return; }

        villager.targetResource = tree;
        villager.carryType = 'wood';
        villager.gatherTimer = 0;
        villager.state = UnitState.GATHERING;
        if (this.pathTo(villager, tree.x, tree.y) === 'unreachable') {
            this.abortJob(villager);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  FARM carry loop
    // ──────────────────────────────────────────────────────────────────────

    private beginFarmLoop(villager: VillagerData): void {
        villager.carryType = 'food';
        villager.gatherTimer = 0;
        villager.targetResource = villager.jobBuilding; // farm IS the resource
        villager.state = UnitState.GATHERING;
        // Already at farm — no path needed
    }

    // ──────────────────────────────────────────────────────────────────────
    //  GOLD MINE carry loop
    // ──────────────────────────────────────────────────────────────────────

    private beginGoldLoop(villager: VillagerData): void {
        const mine = this.findNearestGoldMine(villager.x, villager.y);
        if (!mine) { this.clearJobBuilding(villager); villager.state = UnitState.IDLE; return; }

        villager.targetResource = mine;
        villager.carryType = 'gold';
        villager.gatherTimer = 0;
        villager.state = UnitState.GATHERING;
        if (this.pathTo(villager, mine.x, mine.y) === 'unreachable') {
            this.abortJob(villager);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  STATE: GATHERING
    // ──────────────────────────────────────────────────────────────────────

    private processGathering(villager: VillagerData, delta: number): void {
        // Validate resource
        if (villager.carryType === 'wood') {
            const tree = villager.targetResource;
            if (!tree || !(tree as Phaser.GameObjects.Image).active ||
                (tree as Phaser.GameObjects.Image).getData('isChopped')) {
                // Tree gone — find another or go idle
                const next = this.findNearestTree(villager.x, villager.y);
                if (!next) {
                    this.abortJob(villager);
                    return;
                }
                villager.targetResource = next;
                if (this.pathTo(villager, next.x, next.y) === 'unreachable') {
                    this.abortJob(villager);
                }
                return;
            }
        }

        // Validate gold mine resource
        if (villager.carryType === 'gold') {
            const mine = villager.targetResource;
            if (!mine || !(mine as Phaser.GameObjects.Image).active ||
                (mine as Phaser.GameObjects.Image).getData('isDepleted')) {
                const next = this.findNearestGoldMine(villager.x, villager.y);
                if (!next) {
                    this.abortJob(villager);
                    return;
                }
                villager.targetResource = next;
                if (this.pathTo(villager, next.x, next.y) === 'unreachable') {
                    this.abortJob(villager);
                }
                return;
            }
        }

        // Accumulate gather time
        villager.gatherTimer += delta;

        if (villager.gatherTimer >= VILLAGER_GATHER_RATE_MS) {
            villager.gatherTimer -= VILLAGER_GATHER_RATE_MS;
            const cap = villager.carryType === 'wood'
                ? WOOD_CARRY_CAPACITY
                : VILLAGER_CARRY_CAPACITY[villager.carryType!] ?? 5;
            const gatherAmount = villager.carryType === 'wood' ? WOOD_GATHER_AMOUNT_PER_TICK : 1;
            villager.carryAmount = Math.min(cap, villager.carryAmount + gatherAmount);
            // Play resource gather sound
            this.scene.proceduralSound.playResourceGather(villager.x, villager.y);

            // Decrement gold mine remaining when gathering gold
            if (villager.carryType === 'gold' && villager.targetResource) {
                const mine = villager.targetResource as Phaser.GameObjects.Image;
                const remaining = mine.getData('goldRemaining') ?? 0;
                const newRemaining = remaining - 1;
                mine.setData('goldRemaining', newRemaining);
                if (newRemaining <= 0) {
                    mine.setData('isDepleted', true);
                    mine.setData('depletedAt', this.scene.gameTime);
                    mine.setData('isChopped', true);
                    // Update visual to stump-like
                    mine.setData('visualTexture', 'stump');
                    mine.setData('visualTint', 0xffffff);
                    mine.setData('visualScale', 0.075);
                    const vis = (mine as any).visual; // eslint-disable-line @typescript-eslint/no-explicit-any
                    if (vis && vis.active) {
                        vis.setTexture('stump');
                        vis.setTint(0xffffff);
                        vis.setScale(0.075);
                    }
                }
            }

            if (villager.carryAmount >= cap) {
                // Full — transition to CARRYING
                villager.state = UnitState.CARRYING;
                this.showCarryVisual(villager);

                if (villager.jobBuilding) {
                    const bx = (villager.jobBuilding as Phaser.GameObjects.Image).x;
                    const by = (villager.jobBuilding as Phaser.GameObjects.Image).y;
                    const dist = Phaser.Math.Distance.Between(villager.x, villager.y, bx, by);
                    if (dist < 20) {
                        // Already at dropsite (e.g. farm)
                        this.depositCarry(villager);
                    } else {
                        const result = this.pathToBuilding(villager, villager.jobBuilding);
                        if (result === 'arrived') {
                            this.depositCarry(villager);
                        } else if (result === 'unreachable') {
                            // Keep the carried resources instead of teleport-depositing.
                            // The assignment is released so another job can be chosen.
                            this.clearJobBuilding(villager);
                            villager.state = UnitState.IDLE;
                        }
                    }
                } else {
                    this.depositCarry(villager);
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  STATE: CARRYING → deposit and restart loop
    // ──────────────────────────────────────────────────────────────────────

    private depositCarry(villager: VillagerData): void {
        if (villager.carryAmount > 0 && villager.carryType) {
            this.scene.economySystem.depositResource(
                villager.owner,
                villager.carryType,
                villager.carryAmount,
            );
        }

        // Reset carry state
        villager.carryAmount = 0;
        villager.gatherTimer = 0;
        this.removeCarryVisual(villager);

        const bld = villager.jobBuilding;
        if (!bld) { villager.carryType = null; villager.state = UnitState.IDLE; return; }

        const def = (bld as Phaser.GameObjects.Image).getData('def') as { type: BuildingType } | undefined;
        if (!def) { this.clearJobBuilding(villager); villager.carryType = null; villager.state = UnitState.IDLE; return; }
        if (def?.type === BuildingType.LUMBER_CAMP) {
            this.beginLumberLoop(villager);
        } else if (def?.type === BuildingType.FARM) {
            this.beginFarmLoop(villager);
        } else if (def?.type === BuildingType.TOWN_CENTER) {
            this.beginGoldLoop(villager);
        } else {
            villager.carryType = null;
            villager.state = UnitState.IDLE;
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  RESOURCE FINDING
    // ──────────────────────────────────────────────────────────────────────

    private findNearestTree(x: number, y: number): Phaser.GameObjects.Image | null {
        const candidates = this.scene.treeSpatialHash.query(x, y, TREE_SEARCH_RADIUS) as Phaser.GameObjects.Image[];
        let best: Phaser.GameObjects.Image | null = null;
        let bestDist = Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const t = candidates[i];
            if (!t.active || t.getData('isChopped') || t.getData('isGoldMine')) continue;
            const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
            if (d < bestDist) {
                bestDist = d;
                best = t;
            }
        }
        return best;
    }

    private findNearestGoldMine(x: number, y: number): Phaser.GameObjects.Image | null {
        const candidates = this.scene.treeSpatialHash.query(x, y, GOLD_MINE_SEARCH_RADIUS) as Phaser.GameObjects.Image[];
        let best: Phaser.GameObjects.Image | null = null;
        let bestDist = Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const t = candidates[i];
            if (!t.active || !t.getData('isGoldMine') || t.getData('isDepleted')) continue;
            const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
            if (d < bestDist) {
                bestDist = d;
                best = t;
            }
        }
        return best;
    }

    // ──────────────────────────────────────────────────────────────────────
    //  PATH HELPERS
    // ──────────────────────────────────────────────────────────────────────

    private pathTo(villager: VillagerData, tx: number, ty: number): PathResult {
        // Never leave a stale path behind when a job retargets.
        villager.path = undefined;
        villager.pathStep = 0;

        const path = this.scene.pathfinder.findPath(
            new Phaser.Math.Vector2(villager.x, villager.y),
            new Phaser.Math.Vector2(tx, ty),
        );
        if (path && path.length > 1) {
            villager.path = path;
            return 'moving';
        }

        // Pathfinder intentionally returns a one-point path both when the
        // target is already reached/adjacent and when no route exists. Treat
        // it as arrival only when that returned point is actually near target.
        if (path && path.length === 1) {
            const point = path[0];
            if (Phaser.Math.Distance.Between(point.x, point.y, tx, ty) <= PATH_ARRIVAL_TOLERANCE) {
                return 'arrived';
            }
        }
        return 'unreachable';
    }

    private pathToBuilding(villager: VillagerData, building: Phaser.GameObjects.GameObject): PathResult {
        const b = building as Phaser.GameObjects.Image;
        return this.pathTo(villager, b.x, b.y);
    }

    // ──────────────────────────────────────────────────────────────────────
    //  VISUAL HELPERS
    // ──────────────────────────────────────────────────────────────────────

    private syncVisual(villager: VillagerData): void {
        if (villager.visual) {
            const iso = toIsoElev(villager.x, villager.y, this.scene.terrainSystem.getHeightAt(villager.x, villager.y));
            villager.visual.setPosition(iso.x, iso.y);
            villager.visual.setDepth(iso.y);
        }
    }

    private showCarryVisual(villager: VillagerData): void {
        if (!villager.visual || !villager.carryType) return;
        this.removeCarryVisual(villager);
        const color = CARRY_COLORS[villager.carryType] ?? 0xffffff;
        const rect = this.scene.add.rectangle(0, -18, 8, 4, color);
        villager.visual.add(rect);
        this.carryVisuals.set(villager.id, rect);
    }

    private removeCarryVisual(villager: VillagerData): void {
        const existing = this.carryVisuals.get(villager.id);
        if (existing) {
            existing.destroy();
            this.carryVisuals.delete(villager.id);
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    //  PUBLIC API
    // ──────────────────────────────────────────────────────────────────────
    // Clear any previous building assignment to avoid stale reservations
    private clearJobBuilding(villager: VillagerData): void {
        if (villager.jobBuilding) {
            villager.jobBuilding.setData('assignedWorker', undefined);
            villager.jobBuilding = undefined;
        }
    }

    private abortJob(villager: VillagerData): void {
        this.clearJobBuilding(villager);
        villager.path = undefined;
        villager.pathStep = 0;
        villager.targetResource = undefined;
        villager.carryType = null;
        villager.carryAmount = 0;
        villager.gatherTimer = 0;
        villager.state = UnitState.IDLE;
        this.removeCarryVisual(villager);
    }

    public assignJob(villager: VillagerData, building: Phaser.GameObjects.GameObject): void {
        this.clearJobBuilding(villager);
        villager.state = UnitState.MOVING_TO_WORK;
        villager.jobBuilding = building;
        building.setData('assignedWorker', villager);

        const result = this.pathToBuilding(villager, building);
        if (result === 'arrived') {
            this.startWorking(villager);
        } else if (result === 'unreachable') {
            this.abortJob(villager);
        }
    }

    public getIdleVillagers(owner: number): VillagerData[] {
        return this.villagers.filter(v =>
            v.owner === owner &&
            (v.state === UnitState.IDLE || v.state === UnitState.MOVING_TO_RALLY),
        );
    }

    public getVillagersByOwner(owner: number): VillagerData[] {
        return this.villagers.filter(v => v.owner === owner);
    }

    public getAllVillagers(): VillagerData[] {
        return [...this.villagers];
    }

    public destroyVillager(villager: VillagerData): void {
        this.clearJobBuilding(villager);
        this.removeCarryVisual(villager);

        const index = this.villagers.indexOf(villager);
        if (index !== -1) {
            this.villagers.splice(index, 1);
        }

        if (villager.visual) {
            villager.visual.destroy();
        }

        if (villager.owner === 0) {
            this.scene.population--;
        }
    }

    public sendToRallyPoint(villager: VillagerData, rallyX: number, rallyY: number): void {
        this.clearJobBuilding(villager);
        villager.state = UnitState.MOVING_TO_RALLY;
        const result = this.pathTo(villager, rallyX, rallyY);
        if (result !== 'moving') {
            villager.state = UnitState.IDLE;
            villager.rallyPoint = undefined;
        }
    }
}
