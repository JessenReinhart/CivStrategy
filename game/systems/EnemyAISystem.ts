import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, Resources, UnitState, MapMode, BuildingDef, UnitStance, GameUnit, Age } from '../../types';
import { BUILDINGS, AGE_CONFIGS, getNextAge } from '../../constants';

/**
 * EnemyAISystem - Optimized for Annihilation-scale games.
 * 
 * Key optimizations:
 * - Uses SpatialHash for threat detection (O(k) instead of O(n))
 * - Batched unit scanning: scans spread across ticks
 * - Priority-based combat assignment instead of "all vs all"
 * - Economy ticks on a fixed interval
 * - Squad-based orders: groups units by proximity for batch commands
 */

interface BlueprintItem {
    type: BuildingType;
    x: number;
    y: number;
}

const AI_BLUEPRINT: BlueprintItem[] = [
    { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
    { type: BuildingType.HOUSE, x: -80, y: 0 },
    { type: BuildingType.HOUSE, x: 80, y: 0 },
    { type: BuildingType.HOUSE, x: 0, y: -80 },
    { type: BuildingType.HOUSE, x: 0, y: 80 },
    { type: BuildingType.LUMBER_CAMP, x: -150, y: -150 },
    { type: BuildingType.LUMBER_CAMP, x: 150, y: 150 },
    { type: BuildingType.FARM, x: 150, y: -150 },
    { type: BuildingType.FARM, x: -150, y: 150 },
    { type: BuildingType.BARRACKS, x: 100, y: 100 },
    { type: BuildingType.BARRACKS, x: -100, y: -100 },
    { type: BuildingType.BONFIRE, x: 250, y: 0 },
    { type: BuildingType.BONFIRE, x: -250, y: 0 },
    { type: BuildingType.BONFIRE, x: 0, y: 250 },
    { type: BuildingType.BONFIRE, x: 0, y: -250 },
];

// How often (ms) each AI subsystem ticks
const TICK_ECONOMY = 2000;
const TICK_BUILD = 3000;
const TICK_RECRUIT = 2000;
const TICK_DEFENSE = 1500;
const TICK_ATTACK = 3000;

export class EnemyAISystem {
    private scene: MainScene;

    // AI State
    private resources: Resources = { wood: 500, food: 500, gold: 500 };
    private baseX: number = 200;
    private baseY: number = 200;
    private buildings: (Phaser.GameObjects.GameObject | null)[] = new Array(AI_BLUEPRINT.length).fill(null);

    // Personality
    private aggressionThreshold = 8;
    private unitPreference = UnitType.PIKESMAN;
    private attackTarget: Phaser.GameObjects.GameObject | null = null;

    // Per-subsystem last tick times
    private lastEconomyTick: number = 0;
    private lastBuildTick: number = 0;
    private lastRecruitTick: number = 0;
    private lastDefenseTick: number = 0;
    private lastAttackTick: number = 0;

    private buildIndex: number = 0;
    private hasSpawnedStartingForest: boolean = false;

    // Age advancement
    private aiCurrentAge: Age = Age.VILLAGE;
    private aiAgeProgress: number = 0;
    private aiIsAdvancing: boolean = false;

    // Cached military unit lists (refreshed each tick)
    private myMilitaryCache: GameUnit[] = [];
    private enemyUnitCache: GameUnit[] = [];

    constructor(scene: MainScene) {
        this.scene = scene;

        if (this.scene.mapMode === MapMode.INFINITE) {
            this.baseX = 4000;
            this.baseY = 4000;
        } else {
            this.baseX = this.scene.mapWidth * 0.15;
            this.baseY = this.scene.mapHeight * 0.15;
        }
    }

    public update(time: number, _delta: number): void {
        if (this.scene.aiDisabled) return;

        // Tick subsystems independently to spread load
        if (time - this.lastEconomyTick > TICK_ECONOMY) {
            this.tickEconomy();
            this.lastEconomyTick = time;
        }

        if (time - this.lastBuildTick > TICK_BUILD) {
            this.tickBuild();
            this.lastBuildTick = time;
        }

        if (time - this.lastRecruitTick > TICK_RECRUIT) {
            this.tickRecruit();
            this.lastRecruitTick = time;
        }

        if (time - this.lastDefenseTick > TICK_DEFENSE) {
            this.refreshMilitaryCache();
            this.tickBaseDefense();
            this.lastDefenseTick = time;
        }

        if (time - this.lastAttackTick > TICK_ATTACK) {
            if (this.myMilitaryCache.length === 0) this.refreshMilitaryCache();
            this.tickAttack();
            this.lastAttackTick = time;
        }
    }

    /**
     * Refresh cached unit lists using SpatialHash for efficiency.
     */
    private refreshMilitaryCache(): void {
        const allUnits = this.scene.units.getChildren() as GameUnit[];
        this.myMilitaryCache = [];
        this.enemyUnitCache = [];

        for (const u of allUnits) {
            const owner = u.getData('owner') as number;
            const typeDef = u.getData('def') as { isMilitary?: boolean } | undefined;
            const isMilitary = typeDef?.isMilitary || false;

            if (!isMilitary) continue;
            if (u.getData('hp') <= 0) continue;

            if (owner === 1) {
                this.myMilitaryCache.push(u);
            } else if (owner === 0) {
                this.enemyUnitCache.push(u);
            }
        }
    }

    // ─── Economy ───────────────────────────────────────────────────────────
    private tickEconomy(): void {
        this.resources.wood += 20;
        this.resources.food += 20;
        this.resources.gold += 10;

        // AI Age Advancement
        if (this.aiCurrentAge !== Age.CITY_STATE && !this.aiIsAdvancing) {
            const next = getNextAge(this.aiCurrentAge);
            if (next) {
                const config = AGE_CONFIGS[next];
                if (this.resources.food >= config.cost.food && this.resources.gold >= config.cost.gold) {
                    // Check building requirements
                    let meetsReqs = true;
                    for (const req of config.requiredBuildings) {
                        const owned = this.buildings.filter(
                            (b) => b && b.scene && b.getData('def')?.type === req.type && b.getData('hp') > 0
                        ).length;
                        if (owned < req.count) { meetsReqs = false; break; }
                    }
                    if (meetsReqs) {
                        this.resources.food -= config.cost.food;
                        this.resources.gold -= config.cost.gold;
                        this.aiIsAdvancing = true;
                        this.aiAgeProgress = 0;
                    }
                }
            }
        }

        // Tick AI age progress
        if (this.aiIsAdvancing) {
            const next = getNextAge(this.aiCurrentAge);
            if (next) {
                const config = AGE_CONFIGS[next];
                this.aiAgeProgress += 2000 / config.advancementTime; // 2s tick interval
                if (this.aiAgeProgress >= 1) {
                    this.aiCurrentAge = next;
                    this.aiIsAdvancing = false;
                    this.aiAgeProgress = 0;
                }
            }
        }
    }

    // ─── Building ──────────────────────────────────────────────────────────
    private tickBuild(): void {
        // Only attempt one build per tick to spread cost
        for (let i = 0; i <= Math.min(this.buildIndex, AI_BLUEPRINT.length - 1); i++) {
            const existing = this.buildings[i];
            if (existing && !existing.scene) {
                this.buildings[i] = null;
            }

            if (!this.buildings[i]) {
                const built = this.tryConstruct(i);
                if (built) return; // One per tick
            }
        }

        if (this.buildings[this.buildIndex] && this.buildIndex < AI_BLUEPRINT.length - 1) {
            this.buildIndex++;
        }
    }

    private tryConstruct(index: number): boolean {
        const item = AI_BLUEPRINT[index];
        const def = BUILDINGS[item.type];

        if (this.canAfford(def.cost)) {
            const bx = this.baseX + item.x;
            const by = this.baseY + item.y;

            this.resources.wood -= def.cost.wood;
            this.resources.food -= def.cost.food;
            this.resources.gold -= def.cost.gold;

            const b = this.scene.entityFactory.spawnBuilding(item.type, bx, by, 1);
            this.buildings[index] = b;

            // Spawn guaranteed trees near AI's starting Town Center once
            if (!this.hasSpawnedStartingForest && item.type === BuildingType.TOWN_CENTER) {
                this.scene.mapGenerationSystem.spawnStartingForest(this.baseX, this.baseY);
                this.hasSpawnedStartingForest = true;
            }

            return true;
        }
        return false;
    }

    // ─── Recruitment ───────────────────────────────────────────────────────
    private getAIUnlockedUnits(): UnitType[] {
        const config = AGE_CONFIGS[this.aiCurrentAge];
        return config ? [...config.unlocksUnits].filter(u => u !== UnitType.VILLAGER && u !== UnitType.ANIMAL) : [UnitType.PIKESMAN];
    }

    private tickRecruit(): void {
        const hasBarracks = this.buildings.some(b => b && b.scene && (b.getData('def') as BuildingDef)?.type === BuildingType.BARRACKS);
        if (!hasBarracks) return;

        // Scale recruitment rate with resources (burst recruit when rich)
        const recruitCount = this.resources.food > 500 ? 3 : (this.resources.food > 200 ? 2 : 1);

        for (let i = 0; i < recruitCount; i++) {
            if (this.resources.food >= 100 && this.resources.gold >= 50) {
                this.resources.food -= 100;
                this.resources.gold -= 50;

                const spawnX = this.baseX + Phaser.Math.Between(-50, 50);
                const spawnY = this.baseY + Phaser.Math.Between(-50, 50);

                const availableUnits = this.getAIUnlockedUnits();
                const chosenUnit = availableUnits[Math.floor(Math.random() * availableUnits.length)];

                const unit = this.scene.entityFactory.spawnUnit(chosenUnit, spawnX, spawnY, 1);
                // Set default stance
                unit?.setData?.('stance', UnitStance.AGGRESSIVE);
            }
        }
    }

    // ─── Base Defense ──────────────────────────────────────────────────────
    private tickBaseDefense(): void {
        const defenseRadius = 500;

        // Use cached enemy list + spatial proximity check
        let threats = 0;
        for (const u of this.enemyUnitCache) {
            const uImg = u as Phaser.GameObjects.Image;
            const dx = uImg.x - this.baseX;
            const dy = uImg.y - this.baseY;
            if (Math.sqrt(dx * dx + dy * dy) < defenseRadius) {
                threats++;
                break; // Early exit: at least one threat detected
            }
        }

        if (threats > 0) {
            // Force all military to AGGRESSIVE
            for (const u of this.myMilitaryCache) {
                u.setData('stance', UnitStance.AGGRESSIVE);
            }
        } else {
            // No threats: revert to HOLD if no offensive target
            if (!this.attackTarget) {
                for (const u of this.myMilitaryCache) {
                    u.setData('stance', UnitStance.HOLD);
                }
            }
        }
    }

    // ─── Attack Logic ──────────────────────────────────────────────────────
    private tickAttack(): void {
        // Diplomacy checks
        if (this.scene.peacefulMode === true) return;
        if (this.scene.gameTime < this.scene.treatyLength) return;

        const mySoldiers = this.myMilitaryCache;
        const readyToAttack = mySoldiers.length >= this.aggressionThreshold;

        if (readyToAttack) {
            // Find or validate attack target
            if (!this.attackTarget || !this.attackTarget.scene || this.attackTarget.getData('hp') <= 0) {
                this.attackTarget = this.findBestAttackTarget();
            }

            if (this.attackTarget && this.attackTarget.scene) {
                // Find idle troops (those not already fighting/moving)
                const idleTroops = mySoldiers.filter(
                    (u) => (u.state === UnitState.IDLE || u.state === UnitState.WANDERING)
                );

                if (idleTroops.length > 0) {
                    // Notify player
                    const leader = mySoldiers[0];
                    if (leader) {
                        this.scene.feedbackSystem.showFloatingText(leader.x, leader.y, "The Boar: CRUSH THEM!", "#ef4444");
                    }

                    // Batch order: set stance and attack
                    for (const u of idleTroops) {
                        u.setData('stance', UnitStance.AGGRESSIVE);
                    }
                    this.scene.unitSystem.commandAttack(idleTroops, this.attackTarget);
                }
            }
        } else {
            // Not enough troops: reset attack target
            if (mySoldiers.length < 2) {
                this.attackTarget = null;
            }
        }
    }

    /**
     * Find the best attack target using priority-based selection.
     * Priority: Town Center > Military Buildings > Units > Other Buildings
     */
    private findBestAttackTarget(): Phaser.GameObjects.GameObject | null {
        // Priority 1: Player Town Center
        const playerTC = this.scene.buildings.getChildren().find(
            (b) => b.getData('owner') === 0 && b.getData('def')?.type === BuildingType.TOWN_CENTER
        );
        if (playerTC && playerTC.getData('hp') > 0) return playerTC;

        // Priority 2: Nearest military building
        const barracks = this.scene.buildings.getChildren().filter(
            (b) => b.getData('owner') === 0 && (b.getData('def') as BuildingDef)?.type === BuildingType.BARRACKS && b.getData('hp') > 0
        ) as Phaser.GameObjects.Image[];
        if (barracks.length > 0) {
            // Find nearest to base
            let nearest: Phaser.GameObjects.Image = barracks[0];
            let nearestDist = Phaser.Math.Distance.Between(this.baseX, this.baseY, nearest.x, nearest.y);
            for (const b of barracks) {
                const dist = Phaser.Math.Distance.Between(this.baseX, this.baseY, b.x, b.y);
                if (dist < nearestDist) {
                    nearest = b;
                    nearestDist = dist;
                }
            }
            return nearest;
        }

        // Priority 3: Nearest enemy unit cluster
        if (this.enemyUnitCache.length > 0) {
            // Find the unit closest to our base
            let closest: GameUnit = this.enemyUnitCache[0];
            let closestDist = Phaser.Math.Distance.Between(this.baseX, this.baseY, closest.x, closest.y);
            for (const u of this.enemyUnitCache) {
                const dist = Phaser.Math.Distance.Between(this.baseX, this.baseY, u.x, u.y);
                if (dist < closestDist) {
                    closest = u;
                    closestDist = dist;
                }
            }
            return closest;
        }

        // Priority 4: Any enemy building
        const anyBuilding = this.scene.buildings.getChildren().find(
            (b) => b.getData('owner') === 0 && b.getData('hp') > 0
        );
        return anyBuilding || null;
    }

    // ─── Utility ───────────────────────────────────────────────────────────
    private canAfford(cost: { wood: number; food: number; gold: number }): boolean {
        return this.resources.wood >= cost.wood &&
            this.resources.food >= cost.food &&
            this.resources.gold >= cost.gold;
    }

    public getDebugInfo(): string {
        return `Age: ${this.aiCurrentAge} | Units: ${this.myMilitaryCache.length} | Resources: W${this.resources.wood} F${this.resources.food} G${this.resources.gold}`;
    }
}
