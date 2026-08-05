import Phaser from 'phaser';
import { MainScene } from '../MainScene';
import { BuildingType, UnitType, Resources, UnitState, MapMode, BuildingDef, UnitStance, GameUnit, Age, Season, SerializedAIState } from '../../types';
import { BUILDINGS, AGE_CONFIGS, EVENTS, getNextAge, SEASON_CONFIG, TECH_DEFS, VILLAGER_BUILDING_UPKEEP, TRADE_INCOME, CATHEDRAL_TRADE_BONUS_MULTIPLIER, FACTION_BONUSES, AI_TAUNTS, TAUNT_COOLDOWN_MS, AI_PERSONALITY_NAMES } from '../../constants';

// Units that count as "military" for AI coordination. Villagers/Animals are not.
const MILITARY_UNIT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.PIKESMAN,
  UnitType.CAVALRY,
  UnitType.LEGION,
  UnitType.ARCHER,
  UnitType.SLINGER,
  UnitType.AXEMAN,
  UnitType.HOPLITE,
  UnitType.CHARIOT,
  UnitType.RAM,
]);

function isMilitaryUnit(unitType: UnitType | undefined): boolean {
  return unitType !== undefined && MILITARY_UNIT_TYPES.has(unitType);
}

// Per-unit training costs for AI resource checks (mirrors MainScene/TrainButton costs)
const AI_UNIT_COSTS: Readonly<Record<string, { food: number; gold: number }>> = {
  [UnitType.PIKESMAN]: { food: 100, gold: 50 },
  [UnitType.ARCHER]:   { food: 80, gold: 40 },
  [UnitType.CAVALRY]:  { food: 150, gold: 100 },
  [UnitType.SLINGER]:  { food: 40, gold: 20 },
  [UnitType.AXEMAN]:   { food: 120, gold: 60 },
  [UnitType.HOPLITE]:  { food: 200, gold: 150 },
  [UnitType.CHARIOT]:  { food: 250, gold: 200 },
  [UnitType.RAM]:      { food: 100, gold: 80 },
};

/** Personality archetype definitions for AI opponents. */
type AIPersonality = 'aggressor' | 'defender' | 'economist' | 'balanced';
const PERSONALITY_NAMES: Record<AIPersonality, string> = {
    aggressor: 'The Wolf',
    defender: 'The Turtle',
    economist: 'The Fox',
    balanced: 'The Boar',
};

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

const BLUEPRINT_SPRAWL: BlueprintItem[] = [
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
    { type: BuildingType.MARKET, x: 0, y: -150 },
    { type: BuildingType.SMALL_PARK, x: -200, y: 0 },
    { type: BuildingType.CATHEDRAL, x: 0, y: -200 },
    { type: BuildingType.CASTLE, x: -200, y: -200 },
    { type: BuildingType.SMALL_PARK, x: 0, y: 200 },
    { type: BuildingType.WALL, x: -40, y: 120 },
    { type: BuildingType.WALL, x: 40, y: 120 },
];

// Compact base: everything within ~100px of TC, walls surround the perimeter
const BLUEPRINT_FORTRESS: BlueprintItem[] = [
    { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
    { type: BuildingType.HOUSE, x: -55, y: -20 },
    { type: BuildingType.HOUSE, x: 55, y: -20 },
    { type: BuildingType.HOUSE, x: 0, y: -65 },
    { type: BuildingType.FARM, x: 0, y: 55 },
    { type: BuildingType.LUMBER_CAMP, x: -80, y: -70 },
    { type: BuildingType.BARRACKS, x: -70, y: 60 },
    { type: BuildingType.SMALL_PARK, x: 75, y: -70 },
    { type: BuildingType.CATHEDRAL, x: 75, y: -70 },
    { type: BuildingType.CASTLE, x: -75, y: -70 },
    { type: BuildingType.WALL, x: -45, y: 110 },
    { type: BuildingType.WALL, x: 0, y: 110 },
    { type: BuildingType.WALL, x: 45, y: 110 },
    { type: BuildingType.WALL, x: -105, y: 0 },
];

// Economy-focused: extra farms and lumber camps, fewer walls, barracks further out
const BLUEPRINT_ECONOMY: BlueprintItem[] = [
    { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
    { type: BuildingType.HOUSE, x: -80, y: 0 },
    { type: BuildingType.HOUSE, x: 80, y: 0 },
    { type: BuildingType.HOUSE, x: 0, y: -80 },
    { type: BuildingType.FARM, x: 150, y: -150 },
    { type: BuildingType.FARM, x: -150, y: 150 },
    { type: BuildingType.FARM, x: 150, y: 150 },
    { type: BuildingType.LUMBER_CAMP, x: -150, y: -150 },
    { type: BuildingType.LUMBER_CAMP, x: 150, y: 0 },
    { type: BuildingType.BARRACKS, x: -100, y: 200 },
    { type: BuildingType.SMALL_PARK, x: 0, y: -150 },
    { type: BuildingType.MARKET, x: -150, y: 0 },
    { type: BuildingType.CATHEDRAL, x: 0, y: -250 },
    { type: BuildingType.CASTLE, x: 0, y: 250 },
    { type: BuildingType.WALL, x: 0, y: 120 },
];

const AI_BASE_LAYOUTS: BlueprintItem[][] = [
    BLUEPRINT_SPRAWL,
    BLUEPRINT_FORTRESS,
    BLUEPRINT_ECONOMY,
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
    public resources: Resources = { wood: 500, food: 500, gold: 500 };
    public baseX: number = 200;
    public baseY: number = 200;
    private selectedBlueprint: BlueprintItem[] = AI_BASE_LAYOUTS[Phaser.Math.Between(0, AI_BASE_LAYOUTS.length - 1)];
    public buildings: (Phaser.GameObjects.GameObject | null)[] = new Array(this.selectedBlueprint.length).fill(null);

    // Personality
    private personality: AIPersonality = 'balanced';
    private aggressionThreshold = 8;
    private unitPreference = UnitType.PIKESMAN;
    private attackTarget: Phaser.GameObjects.GameObject | null = null;
    private personalityBonusBuildings: number = 0;

    // Per-subsystem last tick times
    private lastEconomyTick: number = 0;
    private lastBuildTick: number = 0;
    private lastRecruitTick: number = 0;
    private lastDefenseTick: number = 0;
    private lastThreatCheck: number = 0;
    private lastAttackTick: number = 0;
    private nextAttackTime: number = 0;
    private ATTACK_INTERVAL_BASE = 90000; // 90 seconds between waves (adjusted by personality)
    private lastTauntTime: number = 0;

    public buildIndex: number = 0;
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

        // Pick a random personality archetype
        const archetypes: AIPersonality[] = ['aggressor', 'defender', 'economist', 'balanced'];
        this.personality = archetypes[Phaser.Math.Between(0, 3)];
        this.applyPersonality();
    }

    /** Apply personality archetype to AI parameters. */
    private applyPersonality(): void {
        switch (this.personality) {
            case 'aggressor':
                this.aggressionThreshold = 4;
                this.unitPreference = UnitType.CAVALRY;
                this.ATTACK_INTERVAL_BASE = 60000;
                break;
            case 'defender':
                this.aggressionThreshold = 12;
                this.unitPreference = UnitType.PIKESMAN;
                this.ATTACK_INTERVAL_BASE = 120000;
                break;
            case 'economist':
                this.aggressionThreshold = 10;
                this.unitPreference = UnitType.ARCHER;
                this.ATTACK_INTERVAL_BASE = 90000;
                break;
            case 'balanced':
            default:
                // Keep defaults
                break;
        }
    }

    /** Get the AI personality key. */
    public getPersonality(): string {
        return this.personality;
    }

    /** Get the display name for this AI personality. */
    public getPersonalityDisplayName(): string {
        return AI_PERSONALITY_NAMES[this.personality] ?? this.personality;
    }

    /** Send a personality-flavored taunt to the player, respecting cooldown. */
    private sendTaunt(_event: string): void {
        const now = Date.now();
        if (now - this.lastTauntTime < TAUNT_COOLDOWN_MS) return;

        const taunts = AI_TAUNTS[this.personality];
        if (!taunts || taunts.length === 0) return;

        const message = taunts[Phaser.Math.Between(0, taunts.length - 1)];
        this.lastTauntTime = now;

        // Dispatch taunt notification through FeedbackSystem
        this.scene.feedbackSystem.notifyAITaunt(
            this.personality,
            AI_PERSONALITY_NAMES[this.personality] ?? 'Enemy AI',
            message,
        );

        // Also emit event for UI to catch
        this.scene.events.emit(EVENTS.AI_AGE_ADVANCED + '-taunt', {
            personality: this.personality,
            senderName: AI_PERSONALITY_NAMES[this.personality],
            message,
        });
    }

    /** Public method for EntityFactory to trigger a building_destroyed taunt. */
    public sendTauntOnBuildingDestroyed(): void {
        this.sendTaunt('building_destroyed');
    }

    /** Public method for EntityFactory to trigger an army_lost taunt. */
    public sendTauntOnArmyLost(): void {
        this.sendTaunt('army_lost');
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

        // Seasonal attack timing: AUTUMN more aggressive, WINTER defensive
        const season = this.scene.currentSeason;
        const attackInterval = season === Season.AUTUMN ? TICK_ATTACK * 0.65
            : season === Season.WINTER ? TICK_ATTACK * 1.7
            : TICK_ATTACK;
        if (time - this.lastAttackTick > attackInterval) {
            if (this.myMilitaryCache.length === 0) this.refreshMilitaryCache();
            this.tickAttack();
            this.lastAttackTick = time;
        }
        // Forced periodic attack timer — supplements reactive attacks
        if (this.nextAttackTime === 0) {
            // Initialize with 2-minute grace period on first tick
            this.nextAttackTime = time + 120000;
        }
        if (time >= this.nextAttackTime) {
            this.tickForcedAttack(time);
        }

        // Check for enemy units near player's TC (every 5s)
        if (time - this.lastThreatCheck > 5000) {
            this.checkPlayerThreats();
            this.lastThreatCheck = time;
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
            const unitType = (u.getData('unitType') || (u as GameUnit).unitType) as UnitType | undefined;

            if (!isMilitaryUnit(unitType)) continue;
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
        // Seasonal modifiers — AI follows same rules as the player
        const season = this.scene.currentSeason;
        const seasonCfg = SEASON_CONFIG[season];

        // Proportional income: base + per-building bonus
        const lumberCamps = this.buildings.filter(b => b && b.scene && b.getData('def')?.type === BuildingType.LUMBER_CAMP && b.getData('hp') > 0).length;
        const farms = this.buildings.filter(b => b && b.scene && b.getData('def')?.type === BuildingType.FARM && b.getData('hp') > 0).length;
        const lodges = this.buildings.filter(b => b && b.scene && b.getData('def')?.type === BuildingType.HUNTERS_LODGE && b.getData('hp') > 0).length;

        const woodGen = Math.floor((8 + lumberCamps * 6) * seasonCfg.treeRegrowth);
        const foodGen = Math.floor((5 + farms * 8 + lodges * 4) * seasonCfg.farmFertility);
        const goldGen = Math.floor((3 + this.buildings.length * 1) * (season === Season.WINTER ? 0.75 : 1.0));

        // Age-based income scaling: AI economy grows with age progression
        const ageTierIndex = this.aiCurrentAge === Age.CITY_STATE ? 2 : this.aiCurrentAge === Age.TOWN ? 1 : 0;
        const ageMultiplier = 1 + ageTierIndex * 0.5; // VILLAGE: 1.0x, TOWN: 1.5x, CITY_STATE: 2.0x
        const ageBonus = ageTierIndex; // +1 wood/tick, +1 food/tick per age tier above Village

        this.resources.wood += Math.floor(woodGen * ageMultiplier) + ageBonus;
        this.resources.food += Math.floor(foodGen * ageMultiplier) + ageBonus;
        this.resources.gold += Math.floor(goldGen * ageMultiplier);
        // AI faction bonuses (using enemy faction)
        const aiFactionBonus = FACTION_BONUSES[this.scene.enemyFaction];
        if (aiFactionBonus) {
            if (aiFactionBonus.goldPerTick) {
                this.resources.gold += aiFactionBonus.goldPerTick;
            }
            // Apply gather rate multiplier to all resource generation
            if (aiFactionBonus.gatherRateMult) {
                const grm = aiFactionBonus.gatherRateMult;
                this.resources.wood += Math.floor((woodGen * ageMultiplier + ageBonus) * (grm - 1));
                this.resources.food += Math.floor((foodGen * ageMultiplier + ageBonus) * (grm - 1));
                this.resources.gold += Math.floor(goldGen * ageMultiplier * (grm - 1));
            }
        }
        // Trade income: AI earns gold when both sides have a Market and peace/treaty is active
        const aiHasMarket = this.buildings.some(b => b && b.scene && b.getData('def')?.type === BuildingType.MARKET && b.getData('hp') > 0);
        const playerHasMarket = this.scene.buildings.getChildren().some(
            (b) => b.getData('owner') === 0 && (b.getData('def') as BuildingDef)?.type === BuildingType.MARKET
        );
        const isPeaceful = this.scene.peacefulMode || this.scene.gameTime < this.scene.treatyLength;
        if (aiHasMarket && playerHasMarket && isPeaceful) {
            const aiHasCathedral = this.buildings.some(b => b && b.scene && b.getData('def')?.type === BuildingType.CATHEDRAL && b.getData('hp') > 0);
            this.resources.gold += TRADE_INCOME * (aiHasCathedral ? CATHEDRAL_TRADE_BONUS_MULTIPLIER : 1);
        }

        // Building upkeep: subtract same costs as player
        let upkeepFood = 0;
        let upkeepGold = 0;
        for (const b of this.buildings) {
            if (!b || !b.scene || b.getData('hp') <= 0) continue;
            const def = b.getData('def') as BuildingDef;
            const upkeep = VILLAGER_BUILDING_UPKEEP[def.type];
            if (upkeep) {
                if (upkeep.food) upkeepFood += upkeep.food;
                if (upkeep.gold) upkeepGold += upkeep.gold;
            }
        }

        // Simplified population food cost (AI doesn't run full carry loop)
        const aiPopulation = this.buildings.filter(b => b && b.scene && b.getData('hp') > 0).length;
        const foodCost = Math.floor(aiPopulation * 0.5);

        this.resources.food -= upkeepFood + foodCost;
        this.resources.gold -= upkeepGold;
        if (this.resources.food < 0) this.resources.food = 0;
        if (this.resources.gold < 0) this.resources.gold = 0;

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
                    // Start research for new age
                    this.tryResearchTech();
                    this.scene.events.emit(EVENTS.AI_AGE_ADVANCED, this.aiCurrentAge);
                    this.sendTaunt('age_advance');
                }
            }
        }
        // Keep researching: start next tech when current finishes
        this.tryResearchTech();
    }

    // ─── Building ──────────────────────────────────────────────────────────
    private tickBuild(): void {
        // Only attempt one build per tick to spread cost
        for (let i = 0; i <= Math.min(this.buildIndex, this.selectedBlueprint.length - 1); i++) {
            const existing = this.buildings[i];
            if (existing && !existing.scene) {
                this.buildings[i] = null;
            }

            if (!this.buildings[i]) {
                const built = this.tryConstruct(i);
                if (built) return; // One per tick
            }
        }

        if (this.buildings[this.buildIndex] && this.buildIndex < this.selectedBlueprint.length - 1) {
            this.buildIndex++;
        }

        // Personality-driven bonus buildings (once main blueprint is complete)
        if (this.buildIndex >= this.selectedBlueprint.length - 1) {
            this.tryPersonalityBuild();
        }
    }

    private tryConstruct(index: number): boolean {
        const item = this.selectedBlueprint[index];
        const def = BUILDINGS[item.type];

        if (this.canAfford(def.cost)) {
            let bx = this.baseX + item.x;
            let by = this.baseY + item.y;

            // Terrain-aware placement: skip water and stone
            if (this.scene.terrainSystem) {
                const biome = this.scene.terrainSystem.getBiomeAt(bx, by);
                if (biome === 'water' || biome === 'stone') {
                    // Mark slot as unbuildable and advance buildIndex
                    this.buildings[index] = null;
                    return true;
                }

                // Farm: avoid scrub/stone heights — prefer lowland (grass biome)
                if (item.type === BuildingType.FARM) {
                    const FARM_MAX_HEIGHT = 0.65; // below scrub threshold
                    for (let r = 0; r < 3; r++) {
                        const h = this.scene.terrainSystem.getHeightInterpolated(bx, by);
                        if (h <= FARM_MAX_HEIGHT) break;
                        bx = this.baseX + item.x + Phaser.Math.Between(-60, 60);
                        by = this.baseY + item.y + Phaser.Math.Between(-60, 60);
                    }
                }

                // Barracks: prefer high ground (combat defense bonus)
                if (item.type === BuildingType.BARRACKS) {
                    const BARRACKS_MIN_HEIGHT = 0.5; // above sand, into grass+
                    for (let r = 0; r < 3; r++) {
                        const h = this.scene.terrainSystem.getHeightInterpolated(bx, by);
                        if (h > BARRACKS_MIN_HEIGHT) break;
                        bx = this.baseX + item.x + Phaser.Math.Between(-60, 60);
                        by = this.baseY + item.y + Phaser.Math.Between(-60, 60);
                    }
                }
            }

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

    /** Personality-driven bonus buildings after main blueprint is complete. */
    private tryPersonalityBuild(): void {
        if (!this.canAfford({ wood: 100, food: 50, gold: 0 })) return;

        // Count existing personality bonus buildings
        const bonusBuildings = this.personalityBonusBuildings ?? 0;
        if (bonusBuildings >= 3) return; // Cap at 3 bonus buildings

        let bonusType: BuildingType | null = null;
        let dx = 0, dy = 0;

        switch (this.personality) {
            case 'defender': {
                // Extra walls around perimeter
                bonusType = BuildingType.WALL;
                const offsets = [[-80, 130], [80, 130], [0, 140]];
                const pick = offsets[bonusBuildings % offsets.length];
                dx = pick[0];
                dy = pick[1];
                break;
            }
            case 'economist': {
                // Extra farms
                bonusType = BuildingType.FARM;
                const offsets = [[-200, 150], [200, -200], [200, 200]];
                const pick = offsets[bonusBuildings % offsets.length];
                dx = pick[0];
                dy = pick[1];
                break;
            }
            case 'aggressor': {
                // Extra barracks
                bonusType = BuildingType.BARRACKS;
                const offsets = [[-100, 200], [100, -100], [200, 100]];
                const pick = offsets[bonusBuildings % offsets.length];
                dx = pick[0];
                dy = pick[1];
                break;
            }
            default: return; // balanced: no bonus buildings
        }

        if (!bonusType) return;
        const def = BUILDINGS[bonusType];
        if (!this.canAfford(def.cost)) return;

        const bx = this.baseX + dx;
        const by = this.baseY + dy;

        // Terrain check
        if (this.scene.terrainSystem) {
            const biome = this.scene.terrainSystem.getBiomeAt(bx, by);
            if (biome === 'water' || biome === 'stone') return;
        }

        this.resources.wood -= def.cost.wood;
        this.resources.food -= def.cost.food;
        this.resources.gold -= def.cost.gold;

        const b = this.scene.entityFactory.spawnBuilding(bonusType, bx, by, 1);
        if (b) {
            this.buildings.push(b);
            this.personalityBonusBuildings = (this.personalityBonusBuildings ?? 0) + 1;
        }
    }

    // ─── Recruitment ───────────────────────────────────────────────────────
    private getAIUnlockedUnits(): UnitType[] {
        const config = AGE_CONFIGS[this.aiCurrentAge];
        return config ? [...config.unlocksUnits].filter(u => u !== UnitType.VILLAGER && u !== UnitType.ANIMAL) : [UnitType.PIKESMAN];
    }

    private tickRecruit(): void {
        const barracksCount = this.buildings.filter(b => b && b.scene && (b.getData('def') as BuildingDef)?.type === BuildingType.BARRACKS).length;
        if (barracksCount === 0) return;

        const availableUnits = this.getAIUnlockedUnits();
        if (availableUnits.length === 0) return;

        // Bias: spawn a RAM if the AI has a strong army and is ready to push
        const hasRamAvailable = availableUnits.includes(UnitType.RAM);
        const militaryCount = this.myMilitaryCache.filter(u => u.getData('unitType') !== UnitType.RAM).length;
        const shouldForceRam = hasRamAvailable && militaryCount >= 6 && barracksCount >= 1;

        // Scale recruitment rate with resources (burst recruit when rich)
        const recruitCount = this.resources.food > 500 ? 3 : (this.resources.food > 200 ? 2 : 1);

        for (let i = 0; i < recruitCount; i++) {
            const spawnX = this.baseX + Phaser.Math.Between(-50, 50);
            const spawnY = this.baseY + Phaser.Math.Between(-50, 50);

            // First recruit slot: bias toward RAM when conditions are met
            let chosenUnit: UnitType;
            if (i === 0 && shouldForceRam) {
                chosenUnit = UnitType.RAM;
            } else {
                chosenUnit = this.unitPreference && availableUnits.includes(this.unitPreference) && Math.random() < 0.4
                    ? this.unitPreference
                    : availableUnits[Math.floor(Math.random() * availableUnits.length)];
            }

            // Check actual unit cost before spawning
            const cost = AI_UNIT_COSTS[chosenUnit];
            if (!cost || this.resources.food < cost.food || this.resources.gold < cost.gold) continue;

            this.resources.food -= cost.food;
            this.resources.gold -= cost.gold;

            const unit = this.scene.entityFactory.spawnUnit(chosenUnit, spawnX, spawnY, 1) as GameUnit | null | undefined;
            unit?.setData?.('stance', UnitStance.AGGRESSIVE);
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

    /** Check if AI military units are near the player's Town Center and notify. */
    private checkPlayerThreats(): void {
        // Find player TC
        const tc = this.scene.buildings.getChildren().find(
            (b) => (b as Phaser.GameObjects.Image).getData('owner') === 0
                && ((b as Phaser.GameObjects.Image).getData('def') as BuildingDef)?.type === BuildingType.TOWN_CENTER
        );
        if (!tc || (tc as Phaser.GameObjects.Image).getData('hp') <= 0) return;
        const tcX = (tc as Phaser.GameObjects.Image).x;
        const tcY = (tc as Phaser.GameObjects.Image).y;

        // Check AI military near player TC
        for (const u of this.myMilitaryCache) {
            const uImg = u as Phaser.GameObjects.Image;
            const dist = Phaser.Math.Distance.Between(uImg.x, uImg.y, tcX, tcY);
            if (dist < 600) {
                this.scene.feedbackSystem.notifyEnemyApproaching();
                return; // One notification per check
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
                    // Send personality taunt notification
                    this.sendTaunt('attack_start');

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

    // ─── Forced Periodic Attack ─────────────────────────────────────────────
    /**
     * Timer-driven attack wave. Supplements reactive tickAttack by guaranteeing
     * the AI sends waves periodically, scaled by age progression.
     * Age multiplier: Village 1.5x (slower), Town 1.0x (base), City-State 0.7x (more aggressive).
     */
    private tickForcedAttack(time: number): void {
        // Diplomacy checks
        if (this.scene.peacefulMode === true) {
            this.nextAttackTime = time + 30000;
            return;
        }
        if (this.scene.gameTime < this.scene.treatyLength) {
            this.nextAttackTime = time + 30000;
            return;
        }

        // Ensure military cache is populated
        if (this.myMilitaryCache.length === 0) this.refreshMilitaryCache();

        // Need at least 3 non-RAM soldiers to launch a wave (RAM tags along as siege)
        const nonRamMilitary = this.myMilitaryCache.filter(u => u.getData('unitType') !== UnitType.RAM);
        if (nonRamMilitary.length < 3) {
            this.nextAttackTime = time + 15000; // Retry soon
            return;
        }

        // Find target (reuse existing priority logic)
        const target = this.findBestAttackTarget();
        if (!target || !target.scene) {
            this.nextAttackTime = time + 15000; // Retry soon
            return;
        }

        // Gather idle military
        const idleTroops = this.myMilitaryCache.filter(
            (u) => u.getData('hp') > 0 && (u.state === UnitState.IDLE || u.state === UnitState.WANDERING)
        );

        if (idleTroops.length >= 2) {
            // Send personality taunt notification
            this.sendTaunt('attack_wave');

            // Set aggressive stance and send to target
            for (const u of idleTroops) {
                u.setData('stance', UnitStance.AGGRESSIVE);
            }
            this.scene.unitSystem.commandAttack(idleTroops, target);
            this.attackTarget = target;
        }

        // Schedule next attack based on age
        const ageMultiplier = this.aiCurrentAge === Age.CITY_STATE ? 0.7
            : this.aiCurrentAge === Age.TOWN ? 1.0
            : 1.5;
        this.nextAttackTime = time + this.ATTACK_INTERVAL_BASE * ageMultiplier;
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
    // ─── Research ─────────────────────────────────────────────────────
    /** Start the next available research for AI (owner=1). Called on age
     *  advancement and periodically in the economy tick so the AI chains
     *  techs without waiting for a new age. */
    private tryResearchTech(): void {
        if (!this.scene.researchManager) return;
        const rm = this.scene.researchManager;
        if (rm.getActive(1)) return; // Already researching

        // Priority: highest-age techs first (City-State → Town → Village)
        const ageOrder: Age[] = [Age.CITY_STATE, Age.TOWN, Age.VILLAGE];
        for (const age of ageOrder) {
            if (ageOrder.indexOf(age) > ageOrder.indexOf(this.aiCurrentAge)) continue;

            const available = Object.values(TECH_DEFS).filter(
                (def) => def.requiredAge === age && !rm.isCompleted(1, def.id)
            );
            for (const def of available) {
                // Check AI can afford it
                if (this.resources.wood >= def.cost.wood &&
                    this.resources.food >= def.cost.food &&
                    this.resources.gold >= def.cost.gold) {
                    const result = rm.tryStart(
                        1, def.id, this.aiCurrentAge, def.hostBuildingTypes[0], null, this.resources
                    );
                    if (result.ok) return;
                }
            }
        }
    }

    public getDebugInfo(): string {
        return `${PERSONALITY_NAMES[this.personality]} (${this.personality}) | Age: ${this.aiCurrentAge} | Units: ${this.myMilitaryCache.length} | Resources: W${this.resources.wood} F${this.resources.food} G${this.resources.gold}`;
    }

    // ─── Save/Load ───────────────────────────────────────────────────
    public serializeState(): SerializedAIState {
        return {
            personality: this.personality,
            currentAge: this.aiCurrentAge,
            ageProgress: this.aiAgeProgress,
            resources: { ...this.resources },
            baseX: this.baseX,
            baseY: this.baseY,
            buildIndex: this.buildIndex,
        };
    }

    public restoreState(state: SerializedAIState): void {
        this.personality = state.personality as AIPersonality;
        this.aiCurrentAge = state.currentAge;
        this.aiAgeProgress = state.ageProgress;
        this.resources = { ...state.resources };
        this.baseX = state.baseX;
        this.baseY = state.baseY;
        this.buildIndex = state.buildIndex;
        this.applyPersonality();
    }
}
